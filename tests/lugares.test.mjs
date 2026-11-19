import test from 'node:test'
import assert from 'node:assert/strict'
import { crearBuscadorLugares, resultadoPhoton, validarLugar } from '../server/lugares.js'

test('un lugar siempre tiene nombre, punto completo y radio razonable', () => {
  assert.deepEqual(validarLugar({ nombre: ' UAGRM ', latitud: -17.77, longitud: -63.19 }).lugar,
    { nombre: 'UAGRM', latitud: -17.77, longitud: -63.19, radio_m: 200 })
  assert.match(validarLugar({ nombre: '' }).error, /nombre/)
  assert.match(validarLugar({ nombre: 'Sin punto' }).error, /punto/)
  assert.match(validarLugar({ nombre: 'X', latitud: -17 }).error, /punto/)
  assert.match(validarLugar({ nombre: 'X', latitud: -17, longitud: -63, radio_m: 5 }).error, /radio/)
  assert.deepEqual(validarLugar({ radio_m: 150 }, { parcial: true }).lugar, { radio_m: 150 })
  assert.match(validarLugar({ latitud: null }, { parcial: true }).error, /punto/)
})

test('el buscador traduce Photon y cachea la misma consulta', async () => {
  let llamadas = 0
  const fetch = async () => {
    llamadas += 1
    return { ok: true, json: async () => ({ features: [{ properties: { name: 'UAGRM', city: 'Santa Cruz de la Sierra', osm_type: 'W', osm_id: 1 }, geometry: { coordinates: [-63.19, -17.77] } }] }) }
  }
  const buscar = crearBuscadorLugares({ fetch, ahora: () => 0 })
  const [r] = await buscar('UAGRM')
  assert.deepEqual(r, { nombre: 'UAGRM', detalle: 'Santa Cruz de la Sierra', latitud: -17.77, longitud: -63.19, osm: 'W1' })
  await buscar('uagrm')
  assert.equal(llamadas, 1)
  assert.deepEqual(await buscar('ab'), [])
  assert.equal(resultadoPhoton({}).nombre, 'Sin nombre')
})
