import test from 'node:test'
import assert from 'node:assert/strict'
import { validarEvento } from '../server/eventos.js'
import { SIN_LUGAR, accionesEvento, accionesLugar, indicePasoRadio, PASOS_RADIO, estadoEvento, fechaFinEvento, fechaInicioEvento, filtrarEventos, rangoEvento } from '../src/lib/eventos.js'

const ID = '10000000-0000-0000-0000-000000000001'
const LUGAR = '20000000-0000-0000-0000-000000000002'

test('un evento necesita nombre, inicio y activadores; el lugar es opcional y trae su radio', () => {
  const base = { nombre: ' Feria ', inicio: '2026-11-20T13:00:00Z', activador_ids: [ID, ID] }
  assert.deepEqual(validarEvento(base), {
    evento: { nombre: 'Feria', inicio: '2026-11-20T13:00:00.000Z', fin: null, lugar_id: null, radio_m: null },
    activadorIds: [ID],
  })
  assert.equal(validarEvento({ ...base, lugar_id: LUGAR, radio_m: 150 }).evento.radio_m, 150)
  assert.match(validarEvento({ ...base, lugar_id: LUGAR }).error, /radio/)
  assert.match(validarEvento({ ...base, nombre: '' }).error, /nombre/)
  assert.match(validarEvento({ ...base, fin: base.inicio }).error, /posterior/)
  assert.match(validarEvento({ ...base, activador_ids: [] }).error, /activador/)
})

test('estado: abierto sin fin sigue en curso; cancelado gana a todo', () => {
  const ahora = new Date('2026-11-20T15:00:00Z')
  assert.equal(estadoEvento({ inicio: '2026-11-20T13:00:00Z', fin: null }, ahora), 'en_curso')
  assert.equal(estadoEvento({ inicio: '2026-11-21T13:00:00Z' }, ahora), 'programado')
  assert.equal(estadoEvento({ inicio: '2026-11-19T13:00:00Z', fin: '2026-11-20T14:00:00Z' }, ahora), 'finalizado')
  assert.equal(estadoEvento({ inicio: '2026-11-19T13:00:00Z', cancelado_at: '2026-11-19T14:00:00Z' }, ahora), 'cancelado')
})

test('con activaciones se puede finalizar pero no cancelar', () => {
  assert.deepEqual(accionesEvento('en_curso', 3), { anadir: true, finalizar: true, cancelar: false })
  assert.deepEqual(accionesEvento('en_curso', 0), { anadir: true, finalizar: true, cancelar: true })
  assert.deepEqual(accionesEvento('programado', 0), { anadir: true, finalizar: false, cancelar: true })
  assert.deepEqual(accionesEvento('finalizado', 0), { anadir: false, finalizar: false, cancelar: false })
})

test('rango: sin hora de fin cubre el dia completo; sin fecha de fin queda abierto', () => {
  const dias = rangoEvento({ desde: '2026-11-20', hasta: '2026-11-21' })
  assert.equal(new Date(dias.fin) - new Date(dias.inicio), 2 * 24 * 3600 * 1000)
  const horas = rangoEvento({ desde: '2026-11-20', horaDesde: '09:00', hasta: '2026-11-20', horaHasta: '13:00' })
  assert.equal(new Date(horas.fin) - new Date(horas.inicio), 4 * 3600 * 1000)
  assert.equal(rangoEvento({ desde: '2026-11-20' }).fin, null)
  assert.match(rangoEvento({ desde: '' }).error, /inicio/)
  assert.match(rangoEvento({ desde: '2026-11-21', hasta: '2026-11-20' }).error, /posterior/)
  assert.match(rangoEvento({ desde: '2026-11-20', horaHasta: '13:00' }).error, /fecha de fin/)
})

test('muestra solo la fecha cuando no se dio hora, y el fin de dia completo como ese dia', () => {
  assert.equal(fechaInicioEvento('2026-11-20T04:00:00Z'), '20/11/2026')
  assert.match(fechaInicioEvento('2026-11-20T13:30:00Z'), /20\/11\/2026.*09:30/)
  assert.equal(fechaFinEvento('2026-11-21T04:00:00Z'), '20/11/2026')
  assert.equal(fechaFinEvento(null), 'Abierto')
})

test('filtra por nombre, lugar o activador sin importar tildes', () => {
  const eventos = [
    { nombre: 'Feria', lugar: 'Mercado Integración', activadores: [{ nombre: 'Angélica Gil' }], estado: 'en_curso' },
    { nombre: 'UAGRM', lugar: null, activadores: [], estado: 'finalizado' },
  ]
  assert.equal(filtrarEventos(eventos, { texto: 'integracion' }).length, 1)
  assert.equal(filtrarEventos(eventos, { texto: 'angelica' }).length, 1)
  assert.equal(filtrarEventos(eventos, { estado: 'finalizado' })[0].nombre, 'UAGRM')
})

test('filtra por departamento del lugar, o por eventos sin lugar', () => {
  const eventos = [
    { nombre: 'Feria', lugar: 'UAGRM', departamento: 'Santa Cruz', activadores: [], estado: 'en_curso' },
    { nombre: 'Campaña', lugar: null, departamento: null, activadores: [], estado: 'programado' },
  ]
  assert.deepEqual(filtrarEventos(eventos, { departamento: 'Santa Cruz' }).map((e) => e.nombre), ['Feria'])
  assert.deepEqual(filtrarEventos(eventos, { departamento: SIN_LUGAR }).map((e) => e.nombre), ['Campaña'])
})

test('un lugar con activaciones conserva su punto; con eventos o activaciones no se elimina', () => {
  assert.deepEqual(accionesLugar({ activaciones: 0, eventos: 0 }), { moverPunto: true, eliminar: true })
  assert.deepEqual(accionesLugar({ activaciones: 0, eventos: 1 }), { moverPunto: true, eliminar: false })
  assert.deepEqual(accionesLugar({ activaciones: 4, eventos: 1 }), { moverPunto: false, eliminar: false })
})

test('el slider de radio cae en el paso mas cercano', () => {
  assert.equal(PASOS_RADIO[indicePasoRadio(200)], 200)
  assert.equal(PASOS_RADIO[indicePasoRadio(120)], 100)
  assert.equal(PASOS_RADIO[indicePasoRadio(5000)], 1000)
})
