import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { COLUMNAS_EXCEL } from '../src/lib/reportes/excel.js'

const componentSource = readFileSync(new URL('../src/components/ActivacionesTable.vue', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('../server/app.js', import.meta.url), 'utf8')

const seccionesDetalle = componentSource.match(/const seccionesDetalleConfig = \[([\s\S]*?)\n\]/)?.[1] ?? ''
const editableFields = serverSource.match(/const ACTIVATION_EDITABLE_FIELDS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''

test('el Excel agrega Créditos y Remesas tras las columnas de error', () => {
  const headers = COLUMNAS_EXCEL.map(([header]) => header)
  assert.ok(headers.indexOf('Créditos') > headers.indexOf('Descripción del Error'))
  assert.equal(headers.indexOf('Remesas'), headers.indexOf('Créditos') + 1)
  const valor = (header, fila) => COLUMNAS_EXCEL.find(([h]) => h === header)[1](fila, {})
  assert.deepEqual([valor('Créditos', { creditos: true }), valor('Remesas', {})], ['Si', 'No'])
})

test('el detalle muestra creditos y remesas de forma explícita y sin duplicados', () => {
  assert.match(seccionesDetalle, /'creditos',\s*'remesas'/)
  assert.match(componentSource, /siempreVisibles\.has\(key\) \? row\[key\] === true/)
})

test('PATCH permite editar creditos y remesas como booleanos con elegibilidad', () => {
  assert.match(editableFields, /['"]creditos['"]/)
  assert.match(editableFields, /['"]remesas['"]/)
  assert.match(serverSource, /'creditos', 'remesas'/)
  assert.match(serverSource, /isCreditosEligible/)
  assert.match(serverSource, /isRemesasEligible/)
  assert.match(componentSource, /'creditos', 'remesas'/)
})
