import test from 'node:test'
import assert from 'node:assert/strict'
import { ANONIMIZACION, columnasDeCsv, sqlInsertarDesdeTemporal, tablasACargar, validarDestinoDev } from '../scripts/restaurar-respaldo-en-dev.mjs'

const PROD = 'postgresql://postgres.prodref:secreto@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
const DEV = 'postgresql://postgres.devref:secreto@aws-1-sa-east-1.pooler.supabase.com:5432/postgres'

test('rechaza cargar en DEV si .env.dev apunta al proyecto de prod', () => {
  assert.throws(() => validarDestinoDev({ devUrl: PROD, prodUrl: PROD }), /mismo proyecto/)
  assert.throws(() => validarDestinoDev({ prodUrl: PROD }), /Falta DB_URL/)
  assert.doesNotThrow(() => validarDestinoDev({ devUrl: DEV, prodUrl: PROD }))
})

test('solo carga tablas de public', () => {
  const manifest = { archivos: [{ tabla: 'auth.users' }, { tabla: 'public.activaciones' }, { tabla: 'supabase_migrations.schema_migrations' }] }
  assert.deepEqual(tablasACargar(manifest).map((a) => a.tabla), ['public.activaciones'])
})

test('reemplaza la PII del cliente y conserva el resto de columnas', () => {
  const sql = sqlInsertarDesdeTemporal('public.activaciones', ['id', 'ci_cliente', 'telefono_cliente', 'email_cliente', 'latitud'])
  assert.match(sql, /^insert into "public"\."activaciones" \("id", "ci_cliente", "telefono_cliente", "email_cliente", "latitud"\)/)
  assert.match(sql, /hashtext\(ci_cliente\)/)
  assert.match(sql, /hashtext\(telefono_cliente\)/)
  assert.match(sql, /, null, "latitud" from carga$/)
})

test('cubre toda la PII de clientes de activaciones', () => {
  assert.deepEqual(Object.keys(ANONIMIZACION['public.activaciones']).sort(),
    ['apellidos_cliente', 'ci_cliente', 'email_cliente', 'nombres_cliente', 'telefono_cliente'])
})

test('lee el encabezado del CSV del respaldo', () => {
  assert.deepEqual(columnasDeCsv(Buffer.from('id,"nombre",x\n1,a,b\n')), ['id', 'nombre', 'x'])
})
