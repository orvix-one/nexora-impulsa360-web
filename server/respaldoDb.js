// Nightly logical DB backup to the R2 backups bucket: one read-only snapshot of every public table plus auth users, as gzipped CSV with a manifest and a status file.
import crypto from 'node:crypto'
import { gzipSync } from 'node:zlib'
import pg from 'pg'
import { to as copyTo } from 'pg-copy-streams'

export const RESPALDO_DB_PREFIX = 'db'
export const RESPALDO_ESTADO_KEY = `${RESPALDO_DB_PREFIX}/ultimo.json`
const TABLAS_FUERA_DE_PUBLIC = ['auth.users', 'auth.identities', 'supabase_migrations.schema_migrations']

const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

export async function abrirFuentePostgres(dbUrl) {
  if (!dbUrl) throw new Error('DB_URL no esta configurado.')
  const url = new URL(dbUrl)
  url.searchParams.delete('sslmode')
  // The Supabase pooler presents a certificate from Supabase's own CA, which is not in Node's trust store.
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  return {
    query: (sql, params) => client.query(sql, params),
    async copyCsv(selectSql) {
      const chunks = []
      for await (const chunk of client.query(copyTo(`COPY (${selectSql}) TO STDOUT WITH (FORMAT csv, HEADER)`))) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    },
    end: () => client.end(),
  }
}

async function listarTablas(fuente) {
  const { rows } = await fuente.query(
    `select n.nspname as esquema, c.relname as tabla
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and (n.nspname = 'public' or n.nspname || '.' || c.relname = any($1))
      order by n.nspname <> 'auth', n.nspname, c.relname`,
    [TABLAS_FUERA_DE_PUBLIC]
  )
  return rows
}

async function ultimaMigracion(fuente, tablas) {
  if (!tablas.some((t) => t.esquema === 'supabase_migrations' && t.tabla === 'schema_migrations')) return null
  const { rows } = await fuente.query('select max(version) as version from supabase_migrations.schema_migrations')
  return rows[0]?.version ?? null
}

export async function respaldarDb({ abrirFuente, r2, now = new Date() }) {
  if (!r2) throw new Error('R2 no esta configurado.')
  const fecha = now.toISOString().slice(0, 10)
  const carpeta = `${RESPALDO_DB_PREFIX}/${fecha}`
  const inicio = Date.now()
  let fuente = null
  let estado
  try {
    fuente = await abrirFuente()
    await fuente.query('begin isolation level repeatable read read only')
    const tablas = await listarTablas(fuente)
    const archivos = []
    for (const { esquema, tabla } of tablas) {
      const nombre = `${quoteIdent(esquema)}.${quoteIdent(tabla)}`
      const { rows } = await fuente.query(`select count(*)::bigint as filas from ${nombre}`)
      const gz = gzipSync(await fuente.copyCsv(`select * from ${nombre}`))
      const key = `${carpeta}/${esquema}.${tabla}.csv.gz`
      await r2.put(key, gz, 'application/gzip')
      archivos.push({ tabla: `${esquema}.${tabla}`, key, filas: Number(rows[0].filas), bytes: gz.length, sha256: sha256(gz) })
    }
    const migracion = await ultimaMigracion(fuente, tablas)
    await fuente.query('commit')

    const bytes = archivos.reduce((sum, archivo) => sum + archivo.bytes, 0)
    const manifest = { fecha, creado: now.toISOString(), formato: 'csv+gzip, COPY con HEADER', ultima_migracion: migracion, archivos }
    await r2.put(`${carpeta}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json')
    estado = { ok: true, fecha, creado: now.toISOString(), carpeta, tablas: archivos.length, filas: archivos.reduce((s, a) => s + a.filas, 0), bytes, duracion_ms: Date.now() - inicio }
  } catch (error) {
    estado = { ok: false, fecha, creado: now.toISOString(), carpeta, error: error instanceof Error ? error.message : String(error), duracion_ms: Date.now() - inicio }
  } finally {
    await fuente?.end().catch(() => {})
  }
  await r2.put(RESPALDO_ESTADO_KEY, Buffer.from(JSON.stringify(estado)), 'application/json')
  return estado
}
