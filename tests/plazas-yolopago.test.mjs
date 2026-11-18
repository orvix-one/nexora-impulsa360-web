import test from 'node:test'
import assert from 'node:assert/strict'
import { municipioIdValido } from '../server/plazaMunicipios.js'
import { filasPlazas, municipiosConvertibles } from '../src/lib/plazasYolopago.js'

test('distingue plazas departamentales de municipales y solo ofrece extraer municipios departamentales', () => {
  const plazas = [{ id: 'sc', nombre: 'Santa Cruz', activa: true }, { id: 'mo', nombre: 'Montero', activa: true }]
  const municipios = [
    { id: 1, nombre: 'Santa Cruz de la Sierra', departamento: 'Santa Cruz' },
    { id: 2, nombre: 'Yapacaní', departamento: 'Santa Cruz' },
    { id: 3, nombre: 'Montero', departamento: 'Santa Cruz' },
  ]
  const vinculos = [{ plaza_id: 'sc', municipio_id: 1 }, { plaza_id: 'sc', municipio_id: 2 }, { plaza_id: 'mo', municipio_id: 3 }]
  const filas = filasPlazas(plazas, vinculos, municipios)
  assert.deepEqual(filas.map((f) => [f.nombre, f.tipo]), [['Santa Cruz', 'Departamento · 2 municipios'], ['Montero', 'Municipio']])
  const convertibles = municipiosConvertibles(filas, vinculos, municipios)
  assert.deepEqual(convertibles.map((m) => [m.nombre, m.plaza]), [['Santa Cruz de la Sierra', 'Santa Cruz'], ['Yapacaní', 'Santa Cruz']])
  assert.equal(convertibles[1].detalle, 'Depto. Santa Cruz · plaza actual: Santa Cruz')
  assert.equal(municipioIdValido('12'), 12)
  assert.equal(municipioIdValido('x'), null)
})
