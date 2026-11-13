import test from 'node:test'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { createAdminApiApp } from '../server/app.js'
import { respaldarDb, RESPALDO_ESTADO_KEY } from '../server/respaldoDb.js'
import { createR2BackupStorage, createR2Storage } from '../server/r2.js'
import { createFakeR2 } from './helpers/fakeR2.mjs'
import { createFakeSupabase } from './helpers/fakeSupabase.mjs'

const NOW = new Date('2026-11-13T09:00:00Z')
const ENV = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  EVIDENCE_LINK_SECRET: 'secreto-de-prueba',
  CRON_SECRET: 'cron-secreto',
}
const TABLAS = [
  { esquema: 'auth', tabla: 'users', filas: 2, csv: 'id,email\n1,a@x\n2,b@x\n' },
  { esquema: 'public', tabla: 'activaciones', filas: 1, csv: 'id,foto_url\n9,r2:a.jpg\n' },
  { esquema: 'supabase_migrations', tabla: 'schema_migrations', filas: 1, csv: 'version\n20261109230000\n' },
]

function fakeFuente({ fallaEn = null } = {}) {
  const sentencias = []
  return {
    sentencias,
    cerrada: false,
    async query(sql) {
      sentencias.push(sql)
      if (sql.includes('pg_catalog.pg_class')) return { rows: TABLAS.map(({ esquema, tabla }) => ({ esquema, tabla })) }
      if (sql.includes('max(version)')) return { rows: [{ version: '20261109230000' }] }
      const conteo = sql.match(/count\(\*\)::bigint as filas from "([^"]+)"\."([^"]+)"/)
      if (conteo) return { rows: [{ filas: String(TABLAS.find((t) => t.esquema === conteo[1] && t.tabla === conteo[2]).filas) }] }
      return { rows: [] }
    },
    async copyCsv(sql) {
      const tabla = TABLAS.find((t) => sql.includes(`"${t.esquema}"."${t.tabla}"`))
      if (tabla.tabla === fallaEn) throw new Error('conexion perdida')
      return Buffer.from(tabla.csv)
    },
    async end() {
      this.cerrada = true
    },
  }
}

test('respaldarDb writes every table, a manifest and an ok status from one read-only snapshot', async () => {
  const r2 = createFakeR2()
  const fuente = fakeFuente()
  const estado = await respaldarDb({ abrirFuente: async () => fuente, r2, now: NOW })

  assert.equal(estado.ok, true)
  assert.equal(estado.tablas, 3)
  assert.equal(estado.filas, 4)
  assert.match(fuente.sentencias[0], /repeatable read read only/)
  assert.equal(fuente.sentencias.at(-1), 'commit')
  assert.equal(fuente.cerrada, true)
  assert.equal(gunzipSync(r2.objects.get('db/2026-11-13/auth.users.csv.gz')).toString(), TABLAS[0].csv)

  const manifest = await r2.getJson('db/2026-11-13/manifest.json')
  assert.equal(manifest.ultima_migracion, '20261109230000')
  assert.deepEqual(manifest.archivos.map((a) => [a.tabla, a.filas]), [
    ['auth.users', 2], ['public.activaciones', 1], ['supabase_migrations.schema_migrations', 1],
  ])
  assert.deepEqual(await r2.getJson(RESPALDO_ESTADO_KEY), estado)
})

test('respaldarDb records a failed status and closes the connection when a table fails', async () => {
  const r2 = createFakeR2()
  const fuente = fakeFuente({ fallaEn: 'activaciones' })
  const estado = await respaldarDb({ abrirFuente: async () => fuente, r2, now: NOW })

  assert.equal(estado.ok, false)
  assert.equal(estado.error, 'conexion perdida')
  assert.equal(fuente.cerrada, true)
  assert.equal(r2.objects.has('db/2026-11-13/manifest.json'), false)
  assert.equal((await r2.getJson(RESPALDO_ESTADO_KEY)).ok, false)
})

test('photos and backups share the R2 credentials but use their own buckets', () => {
  const env = { R2_ACCOUNT_ID: 'e1e8aa8cdd6027b541ecb3b9340e5d7c', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }
  assert.equal(createR2Storage(env).bucket, 'impulsa360-fotos')
  assert.equal(createR2BackupStorage(env).bucket, 'impulsa360-respaldos')
  assert.equal(createR2BackupStorage({ ...env, R2_SECRET_ACCESS_KEY: '' }), null)
})

async function startApp(options) {
  const app = createAdminApiApp({ env: ENV, adminSupabase: createFakeSupabase({ tables: {} }), ...options })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    get: (path, token) => fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('GET /cron/respaldo-db requires the cron secret and runs the backup', async () => {
  const r2 = createFakeR2()
  const portal = await startApp({ r2Respaldos: r2, abrirFuenteRespaldo: async () => fakeFuente() })
  try {
    assert.equal((await portal.get('/cron/respaldo-db')).status, 401)
    assert.equal((await portal.get('/cron/respaldo-db', 'otro')).status, 401)
    const response = await portal.get('/cron/respaldo-db', ENV.CRON_SECRET)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).ok, true)
    assert.equal((await r2.getJson(RESPALDO_ESTADO_KEY)).ok, true)
  } finally {
    await portal.close()
  }
})

test('GET /cron/respaldo-db answers 500 when the backup fails', async () => {
  const portal = await startApp({ r2Respaldos: createFakeR2(), abrirFuenteRespaldo: async () => { throw new Error('sin DB_URL') } })
  try {
    const response = await portal.get('/cron/respaldo-db', ENV.CRON_SECRET)
    assert.equal(response.status, 500)
    assert.equal((await response.json()).error, 'sin DB_URL')
  } finally {
    await portal.close()
  }
})

test('GET /cron/respaldo-db answers 503 without a backups bucket', async () => {
  const portal = await startApp({ r2Respaldos: null })
  try {
    assert.equal((await portal.get('/cron/respaldo-db', ENV.CRON_SECRET)).status, 503)
  } finally {
    await portal.close()
  }
})
