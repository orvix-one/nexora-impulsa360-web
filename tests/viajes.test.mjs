import test from 'node:test'
import assert from 'node:assert/strict'
import { estadoViaje, nombreMunicipio, validarNuevoViaje } from '../server/viajes.js'

const ID = '10000000-0000-0000-0000-000000000001'
const base = { activador_ids: [ID, ID], municipio_id: '12', inicio: '2026-11-14T08:00', fin: '2026-11-18T23:00', nota: '  ' }

test('valida el viaje, deduplica activadores y descarta la nota vacia', () => {
  const { viaje } = /** @type {any} */ (validarNuevoViaje(base))
  assert.deepEqual(viaje.activadorIds, [ID])
  assert.equal(viaje.municipioId, 12)
  assert.equal(viaje.nota, null)
})

test('rechaza viajes sin activadores, sin destino o con fechas invertidas', () => {
  assert.match(/** @type {any} */ (validarNuevoViaje({ ...base, activador_ids: [] })).error, /activador/)
  assert.match(/** @type {any} */ (validarNuevoViaje({ ...base, activador_ids: ['x'] })).error, /activador/)
  assert.match(/** @type {any} */ (validarNuevoViaje({ ...base, municipio_id: null })).error, /municipio/)
  assert.match(/** @type {any} */ (validarNuevoViaje({ ...base, fin: base.inicio })).error, /posterior/)
})

test('estado del viaje segun la fecha', () => {
  const ahora = new Date('2026-11-17T12:00:00Z')
  const viaje = { inicio: '2026-11-14T00:00:00Z', fin: '2026-11-18T00:00:00Z' }
  assert.equal(estadoViaje(viaje, ahora), 'en_curso')
  assert.equal(estadoViaje({ ...viaje, inicio: '2026-11-18T00:00:00Z', fin: '2026-11-19T00:00:00Z' }, ahora), 'programado')
  assert.equal(estadoViaje({ ...viaje, fin: '2026-11-17T12:00:00Z' }, ahora), 'finalizado')
  assert.equal(estadoViaje({ ...viaje, cancelado_at: '2026-11-15T00:00:00Z' }, ahora), 'cancelado')
})

test('usa el nombre comun del municipio cuando existe', () => {
  assert.equal(nombreMunicipio({ nombre: 'Nuestra Señora de La Paz', nombre_comun: 'La Paz' }), 'La Paz')
  assert.equal(nombreMunicipio({ nombre: 'Sacaba', nombre_comun: null }), 'Sacaba')
})

test('solo pueden viajar usuarios activos con rol activador, lideres incluidos', async () => {
  const { activadoresElegibles } = await import('../src/lib/viajes.js')
  const elegibles = activadoresElegibles([
    { usuario_id: 'a', nombre: 'Zoe', roles: ['activador'] },
    { usuario_id: 'b', nombre: 'Ana', roles: ['lider', 'activador'], plaza_nombre: 'Oruro' },
    { usuario_id: 'c', nombre: 'Luis', roles: ['lider'] },
    { usuario_id: 'd', nombre: 'Eva', roles: ['activador'], estado: 'inhabilitado' },
  ])
  assert.deepEqual(elegibles, [{ id: 'b', nombre: 'Ana', detalle: 'Oruro' }, { id: 'a', nombre: 'Zoe', detalle: '' }])
})

test('filtra viajes por estado y por activador o destino', async () => {
  const { filtrarViajes } = await import('../src/lib/viajes.js')
  const viajes = [
    { activador: 'Angélica Gil', destino: 'Puerto Quijarro', estado: 'en_curso' },
    { activador: 'Ivan Mollo', destino: 'Llallagua', estado: 'finalizado' },
  ]
  assert.equal(filtrarViajes(viajes, { texto: 'angelica' }).length, 1)
  assert.equal(filtrarViajes(viajes, { texto: 'quijarro', estado: 'finalizado' }).length, 0)
})
