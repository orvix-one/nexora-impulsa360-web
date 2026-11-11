import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminApiApp, buildEvidenceToken } from '../server/app.js'
import { archivarFotos } from '../server/archivarFotos.js'
import { createFotoStorage } from '../server/fotoStorage.js'
import { resolveR2AccountId } from '../server/r2.js'
import { resolveStorageLocation, resolveStorageObjectPathFromFotoUrl, toR2StoredValue } from '../server/storagePaths.js'
import { createFakeR2 } from './helpers/fakeR2.mjs'
import { createFakeSupabase } from './helpers/fakeSupabase.mjs'

const BUCKET = 'fotos-activaciones'
const AUTH_ACTIVADOR = 'aaaaaaaa-0000-4000-8000-000000000001'
const AUTH_LIDER = 'aaaaaaaa-0000-4000-8000-000000000002'
const AUTH_INACTIVO = 'aaaaaaaa-0000-4000-8000-000000000003'
const ACTIVACION = 'bbbbbbbb-0000-4000-8000-000000000001'
const ownPath = `activaciones/${AUTH_ACTIVADOR}/${ACTIVACION}/principal.jpg`
const ENV = {
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
  EVIDENCE_LINK_SECRET: 'secreto-de-prueba',
  CRON_SECRET: 'cron-secreto',
}

function seed() {
  return {
    activadores: [
      { usuario_id: AUTH_ACTIVADOR, auth_user_id: AUTH_ACTIVADOR, rol: 'activador', estado: 'activo' },
      { usuario_id: AUTH_LIDER, auth_user_id: AUTH_LIDER, rol: 'lider', estado: 'activo' },
      { usuario_id: AUTH_INACTIVO, auth_user_id: AUTH_INACTIVO, rol: 'activador', estado: 'inhabilitado' },
    ],
    activador_roles: [],
    activaciones: [],
  }
}

async function startApp({ r2 = createFakeR2(), env = ENV, canReadTeam = () => false, tables = seed() } = {}) {
  const supabase = createFakeSupabase({
    tables,
    tokens: { activador: { id: AUTH_ACTIVADOR }, lider: { id: AUTH_LIDER }, inactivo: { id: AUTH_INACTIVO } },
  })
  const userRpcCalls = []
  const createUserSupabase = (token) => ({
    async rpc(name, params) {
      userRpcCalls.push({ token, name, params })
      return { data: canReadTeam(token, params.p_nombre), error: null }
    },
  })
  const app = createAdminApiApp({ env, adminSupabase: supabase, r2, createUserSupabase })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (method, path, token, body) => fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { supabase, r2, userRpcCalls, request, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('r2: prefix resolves to the same object path, so evidence tokens stay valid', () => {
  const stored = toR2StoredValue(ownPath)
  assert.equal(stored, `r2:${ownPath}`)
  assert.deepEqual(resolveStorageLocation(stored, BUCKET), { provider: 'r2', objectPath: ownPath })
  assert.deepEqual(resolveStorageLocation(ownPath, BUCKET), { provider: 'supabase', objectPath: ownPath })
  assert.equal(resolveStorageObjectPathFromFotoUrl(stored, BUCKET), ownPath)
  assert.equal(resolveStorageLocation('r2:', BUCKET), null)
  const before = buildEvidenceToken('s', ACTIVACION, 'principal', resolveStorageObjectPathFromFotoUrl(ownPath, BUCKET))
  const after = buildEvidenceToken('s', ACTIVACION, 'principal', resolveStorageObjectPathFromFotoUrl(stored, BUCKET))
  assert.equal(before, after)
})

test('resolveR2AccountId accepts the hex id or the full endpoint URL', () => {
  const id = 'e1e8aa8cdd6027b541ecb3b9340e5d7c'
  assert.equal(resolveR2AccountId(id), id)
  assert.equal(resolveR2AccountId(`https://${id}.r2.cloudflarestorage.com`), id)
  assert.equal(resolveR2AccountId(''), null)
})

test('fotoStorage signs each value with its own provider', async () => {
  const supabase = createFakeSupabase()
  const fotoStorage = createFotoStorage({ adminSupabase: supabase, bucketName: BUCKET, r2: createFakeR2() })
  const signed = await fotoStorage.signMany(['u1/a.jpg', 'r2:u1/b.jpg', null, 'u1/a.jpg'], 60)
  assert.equal(signed.get('u1/a.jpg'), `https://signed.test/${BUCKET}/u1/a.jpg?ttl=60`)
  assert.equal(signed.get('r2:u1/b.jpg'), 'https://r2.test/u1/b.jpg?ttl=60')
  assert.deepEqual(supabase.calls.sign, [{ bucket: BUCKET, paths: ['u1/a.jpg'], ttl: 60 }])
})

test('fotoStorage refuses R2 values when R2 is not configured', async () => {
  const fotoStorage = createFotoStorage({ adminSupabase: createFakeSupabase(), bucketName: BUCKET, r2: null })
  await assert.rejects(fotoStorage.signMany(['r2:u1/b.jpg'], 60), /R2 no esta configurado/)
})

test('POST /movil/fotos/subida signs an upload only for the caller\'s own path and size', async () => {
  const portal = await startApp()
  try {
    const ok = await portal.request('POST', '/movil/fotos/subida', 'activador', { path: ownPath, size: 1234 })
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.storedValue, `r2:${ownPath}`)
    assert.equal(body.method, 'PUT')
    assert.match(body.url, /len=1234/)
    assert.match(body.url, /type=image%2Fjpeg/)

    const foreign = await portal.request('POST', '/movil/fotos/subida', 'activador', {
      path: `activaciones/${AUTH_LIDER}/${ACTIVACION}/principal.jpg`, size: 10,
    })
    assert.equal(foreign.status, 403)
    const traversal = await portal.request('POST', '/movil/fotos/subida', 'activador', {
      path: `activaciones/${AUTH_ACTIVADOR}/../x/principal.jpg`, size: 10,
    })
    assert.equal(traversal.status, 403)
    const tooBig = await portal.request('POST', '/movil/fotos/subida', 'activador', { path: ownPath, size: 6 * 1024 * 1024 + 1 })
    assert.equal(tooBig.status, 400)
    assert.equal((await portal.request('POST', '/movil/fotos/subida', null, { path: ownPath, size: 10 })).status, 401)
    assert.equal((await portal.request('POST', '/movil/fotos/subida', 'inactivo', {
      path: `activaciones/${AUTH_INACTIVO}/${ACTIVACION}/principal.jpg`, size: 10,
    })).status, 401)
  } finally {
    await portal.close()
  }
})

test('POST /movil/fotos/subida asks the app to fall back to Supabase when R2 uploads are disabled', async () => {
  for (const options of [{ r2: null }, { env: { ...ENV, R2_UPLOADS_ENABLED: 'false' } }]) {
    const portal = await startApp(options)
    try {
      const response = await portal.request('POST', '/movil/fotos/subida', 'activador', { path: ownPath, size: 10 })
      assert.equal(response.status, 409)
      assert.equal((await response.json()).fallback, 'supabase')
    } finally {
      await portal.close()
    }
  }
})

test('POST /movil/fotos/lectura signs own photos and team photos the caller may read', async () => {
  const teamPath = `activaciones/${AUTH_LIDER}/${ACTIVACION}/cash-in.jpg`
  const otherPath = `activaciones/${AUTH_INACTIVO}/${ACTIVACION}/cash-in.jpg`
  const portal = await startApp({ canReadTeam: (_token, path) => path === teamPath })
  try {
    const response = await portal.request('POST', '/movil/fotos/lectura', 'activador', {
      values: [`r2:${ownPath}`, `r2:${teamPath}`, otherPath],
    })
    assert.equal(response.status, 200)
    const { urls } = await response.json()
    assert.equal(urls[`r2:${ownPath}`], `https://r2.test/${ownPath}?ttl=3600`)
    assert.equal(urls[`r2:${teamPath}`], `https://r2.test/${teamPath}?ttl=3600`)
    assert.equal(urls[otherPath], null)
    assert.deepEqual(portal.userRpcCalls.map((call) => [call.token, call.params.p_nombre]), [
      ['activador', teamPath],
      ['activador', otherPath],
    ])
    assert.equal((await portal.request('POST', '/movil/fotos/lectura', 'activador', { values: [] })).status, 400)
  } finally {
    await portal.close()
  }
})

test('evidence links keep redirecting after a photo moves to R2', async () => {
  const tables = seed()
  tables.activaciones.push({ id: ACTIVACION, foto_url: `r2:${ownPath}`, foto_cash_in: null })
  const portal = await startApp({ tables })
  try {
    const token = buildEvidenceToken(ENV.EVIDENCE_LINK_SECRET, ACTIVACION, 'principal', ownPath)
    const response = await portal.request('GET', `/evidencia/${ACTIVACION}/principal/${token}`)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), `https://r2.test/${ownPath}?ttl=300`)
  } finally {
    await portal.close()
  }
})

test('GET /cron/archivar-fotos requires the cron secret', async () => {
  const portal = await startApp()
  try {
    assert.equal((await portal.request('GET', '/cron/archivar-fotos')).status, 401)
    assert.equal((await portal.request('GET', '/cron/archivar-fotos', 'otro')).status, 401)
  } finally {
    await portal.close()
  }
})

function archiveFixture({ corruptHead = false } = {}) {
  const bytes = Buffer.from('jpeg-bytes')
  const tables = { activaciones: [{ id: ACTIVACION, foto_url: ownPath, foto_cash_in: null }] }
  const candidatos = [{ name: ownPath, size: bytes.length, activacion_id: ACTIVACION, campo: 'foto_url' }]
  const supabase = createFakeSupabase({
    tables,
    objects: new Map([[ownPath, bytes]]),
    rpc: { listar_fotos_para_archivar: () => candidatos },
  })
  return { supabase, tables, r2: createFakeR2({ corruptHead }), bytes }
}

test('archivarFotos copies, verifies, swaps the column and deletes from Supabase', async () => {
  const { supabase, tables, r2, bytes } = archiveFixture()
  const resumen = await archivarFotos({ adminSupabase: supabase, r2, bucketName: BUCKET, antesDe: new Date() })
  assert.equal(resumen.movidas, 1)
  assert.equal(resumen.bytes, bytes.length)
  assert.equal(tables.activaciones[0].foto_url, `r2:${ownPath}`)
  assert.deepEqual(r2.objects.get(ownPath), bytes)
  assert.equal(supabase.objects.has(ownPath), false)
})

test('archivarFotos leaves Supabase untouched when R2 verification fails', async () => {
  const { supabase, tables, r2 } = archiveFixture({ corruptHead: true })
  const resumen = await archivarFotos({ adminSupabase: supabase, r2, bucketName: BUCKET, antesDe: new Date() })
  assert.equal(resumen.fallidas, 1)
  assert.equal(tables.activaciones[0].foto_url, ownPath)
  assert.equal(supabase.objects.has(ownPath), true)
})

test('archivarFotos skips a photo replaced during the copy and drops its R2 copy', async () => {
  const { supabase, tables, r2 } = archiveFixture()
  const originalPut = r2.put
  r2.put = async (key, body) => {
    tables.activaciones[0].foto_url = 'portal-reemplazos/foto_url/nueva.jpg'
    return originalPut(key, body)
  }
  const resumen = await archivarFotos({ adminSupabase: supabase, r2, bucketName: BUCKET, antesDe: new Date() })
  assert.equal(resumen.omitidas, 1)
  assert.equal(tables.activaciones[0].foto_url, 'portal-reemplazos/foto_url/nueva.jpg')
  assert.equal(r2.objects.has(ownPath), false)
  assert.equal(supabase.objects.has(ownPath), true)
})

test('archivarFotos dry run only reports sizes', async () => {
  const { supabase, tables, r2, bytes } = archiveFixture()
  const resumen = await archivarFotos({ adminSupabase: supabase, r2, bucketName: BUCKET, antesDe: new Date(), dryRun: true })
  assert.equal(resumen.bytes, bytes.length)
  assert.equal(resumen.movidas, 0)
  assert.equal(tables.activaciones[0].foto_url, ownPath)
  assert.equal(r2.objects.size, 0)
})
