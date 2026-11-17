// Restores a nightly prod backup into DEV with client PII replaced, at the backup's schema version, so pending migrations can be tested on real data.
// Usage: node scripts/restaurar-respaldo-en-dev.mjs [--fecha YYYY-MM-DD]   (then: supabase db push with .env.dev). Run again to roll DEV back.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import dotenv from 'dotenv'
import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createR2BackupStorage } from '../server/r2.js'
import { RESPALDO_DB_PREFIX, RESPALDO_ESTADO_KEY } from '../server/respaldoDb.js'
import { pathToFileURL } from 'node:url'

const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`

/** Deterministic replacements: the same CI or phone maps to the same fake value, so the 60-day rule still matches. */
export const ANONIMIZACION = {
  'public.activaciones': {
    nombres_cliente: `'Cliente'`,
    apellidos_cliente: `'Prueba ' || left(md5(id::text), 6)`,
    ci_cliente: `case when nullif(btrim(ci_cliente), '') is null then ci_cliente else lpad((abs(hashtext(ci_cliente)) % 10000000)::text, 7, '9') end`,
    telefono_cliente: `case when nullif(btrim(telefono_cliente), '') is null then telefono_cliente else '7' || lpad((abs(hashtext(telefono_cliente)) % 10000000)::text, 7, '0') end`,
    email_cliente: `null`,
  },
  'public.activadores': {
    email: `usuario_id::text || '@dev.local'`,
    auth_user_id: `null`,
  },
}

/** @param {string} url */
function proyecto(url) {
  return new URL(url).username
}

/** @param {{ devUrl?: string, prodUrl?: string }} urls */
export function validarDestinoDev({ devUrl, prodUrl }) {
  if (!devUrl) throw new Error('Falta DB_URL en .env.dev.')
  if (prodUrl && proyecto(devUrl) === proyecto(prodUrl)) {
    throw new Error('DB_URL de .env.dev apunta al mismo proyecto que .env (prod). Abortado.')
  }
}

/** @param {{ archivos: { tabla: string, key: string, filas: number }[] }} manifest */
export function tablasACargar(manifest) {
  return manifest.archivos.filter((archivo) => archivo.tabla.startsWith('public.'))
}

/**
 * @param {string} tabla schema-qualified name, e.g. public.activaciones
 * @param {string[]} columnas CSV header
 */
export function sqlInsertarDesdeTemporal(tabla, columnas) {
  const reglas = ANONIMIZACION[tabla] ?? {}
  const destino = tabla.split('.').map(quoteIdent).join('.')
  const lista = columnas.map(quoteIdent).join(', ')
  const valores = columnas.map((columna) => reglas[columna] ?? quoteIdent(columna)).join(', ')
  return `insert into ${destino} (${lista}) overriding system value select ${valores} from carga`
}

/** @param {Buffer} csv */
export function columnasDeCsv(csv) {
  const fin = csv.indexOf(10)
  const header = csv.subarray(0, fin < 0 ? csv.length : fin).toString('utf8').replace(/\r$/, '')
  return header.split(',').map((columna) => columna.replace(/^"|"$/g, '').replaceAll('""', '"'))
}


async function conectar(devUrl) {
  const url = new URL(devUrl)
  url.searchParams.delete('sslmode')
  const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 })
  try {
    await client.connect()
  } catch (error) {
    throw new Error(`No se pudo conectar a DEV (${error.message}). Si está pausado, reactívalo en el dashboard de Supabase.`)
  }
  return client
}

async function restaurar(args) {
  const prodEnv = dotenv.parse(readFileSync('.env'))
  const devUrl = dotenv.parse(readFileSync('.env.dev')).DB_URL
  validarDestinoDev({ devUrl, prodUrl: prodEnv.DB_URL })
  const fechaArg = args.includes('--fecha') ? args[args.indexOf('--fecha') + 1] : undefined

  const r2 = createR2BackupStorage(prodEnv)
  if (!r2) throw new Error('R2 no está configurado en .env.')
  const fecha = fechaArg ?? (await r2.getJson(RESPALDO_ESTADO_KEY))?.fecha
  const manifest = await r2.getJson(`${RESPALDO_DB_PREFIX}/${fecha}/manifest.json`)
  if (!manifest) throw new Error(`No hay respaldo para ${fecha}.`)

  const prueba = await conectar(devUrl)
  await prueba.end()
  console.log(`Reseteando DEV a la migración ${manifest.ultima_migracion} (respaldo ${fecha})…`)
  execFileSync('supabase', ['db', 'reset', '--db-url', devUrl, '--version', manifest.ultima_migracion, '--no-seed', '--yes'], { stdio: 'inherit' })

  const client = await conectar(devUrl)
  const resumen = []
  try {
    await client.query('begin')
    await client.query('set local session_replication_role = replica')
    for (const archivo of tablasACargar(manifest)) {
      const csv = gunzipSync(await r2.getBuffer(archivo.key))
      const columnas = columnasDeCsv(csv)
      const [esquema, tabla] = archivo.tabla.split('.')
      await client.query(`create temp table carga on commit drop as select * from "${esquema}"."${tabla}" with no data`)
      await pipeline(Readable.from([csv]), client.query(copyFrom(`copy carga (${columnas.map((c) => `"${c}"`).join(', ')}) from stdin with (format csv, header)`)))
      await client.query(`delete from "${esquema}"."${tabla}"`)
      const { rowCount } = await client.query(sqlInsertarDesdeTemporal(archivo.tabla, columnas))
      await client.query('drop table carga')
      resumen.push({ tabla: archivo.tabla, esperado: archivo.filas, cargado: rowCount })
    }
    await client.query(`select setval(pg_get_serial_sequence('public.equipos', 'numero'), coalesce((select max(numero) from public.equipos), 1))`)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
  console.table(resumen)
  const distintos = resumen.filter((r) => r.esperado !== r.cargado)
  if (distintos.length) throw new Error(`Conteos distintos al manifest: ${distintos.map((r) => r.tabla).join(', ')}`)
  console.log(`DEV listo en ${manifest.ultima_migracion}. Siguiente: supabase db push con .env.dev.`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await restaurar(process.argv.slice(2))
