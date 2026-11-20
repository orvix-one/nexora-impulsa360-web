import test from 'node:test'
import assert from 'node:assert/strict'
import { validarEvento } from '../server/eventos.js'
import { SIN_LUGAR, accionesEvento, accionesLugar, indicePasoRadio, PASOS_RADIO, cuandoEvento, estadoEvento, filtrarEventos, momentoEvento, rangoEvento, resumenEvento } from '../src/lib/eventos.js'

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

test('cuándo: fechas relativas, sin año en curso, horas solo si se dieron, y su duración', () => {
  const ahora = new Date('2026-11-20T15:00:00Z')
  const c = (inicio, fin) => cuandoEvento({ inicio, fin }, ahora)
  assert.deepEqual(c('2026-11-20T12:34:00Z', '2026-11-20T19:30:00Z'), { texto: 'Hoy, 08:34–15:30', duracion: '7 h' })
  assert.deepEqual(c('2026-11-12T04:00:00Z', '2026-12-01T03:59:00Z'), { texto: '12–30 nov', duracion: '19 días' })
  assert.deepEqual(c('2026-11-14T04:01:00Z', '2026-11-15T03:59:00Z'), { texto: '14 nov', duracion: 'Todo el día' })
  assert.deepEqual(c('2026-11-20T04:00:00Z', '2026-12-01T04:00:00Z'), { texto: 'Hoy – 30 nov', duracion: '11 días' })
  assert.deepEqual(c('2026-10-23T12:53:00Z', '2026-10-24T12:57:00Z'), { texto: '23 oct, 08:53 → 24 oct, 08:57', duracion: '1 día' })
  assert.deepEqual(c('2026-11-13T13:35:00Z', '2026-11-14T03:59:00Z'), { texto: '13 nov, desde 09:35', duracion: '14 h' })
  assert.deepEqual(c('2026-11-21T04:00:00Z', null), { texto: 'Desde mañana', duracion: 'Sin fecha de fin' })
  assert.equal(c('2025-12-30T04:00:00Z', '2026-01-02T04:00:00Z').texto, '30 dic ’25 – 1 ene')
  assert.equal(momentoEvento('2026-11-19T14:20:00Z', ahora), 'ayer, 10:20')
})

test('resumen: cuenta por activador, incluye miembros sin activaciones y suma el total', () => {
  const activaciones = [
    { usuario_id: 'a', categoria: 'comercio', cash_in: true, creditos: true, remesas: false, created_at: '2026-11-20T13:00:00Z' },
    { usuario_id: 'a', categoria: 'transeunte', cash_in: false, creditos: false, remesas: true, created_at: '2026-11-20T14:00:00Z' },
    { usuario_id: 'x', categoria: 'tienda_barrio', cash_in: true, creditos: false, remesas: false, created_at: '2026-11-20T12:00:00Z' },
  ]
  const { filas, total } = resumenEvento(activaciones, [{ id: 'a', nombre: 'Ana' }, { id: 'b', nombre: 'Beto' }], new Map([['x', 'Ximena']]))
  assert.deepEqual(filas.map((f) => [f.nombre, f.total, f.comercios, f.transeuntes]), [['Ana', 2, 1, 1], ['Ximena', 1, 1, 0], ['Beto', 0, 0, 0]])
  assert.equal(filas[0].ultima, '2026-11-20T14:00:00Z')
  assert.deepEqual([total.total, total.cashIn, total.creditos, total.remesas], [3, 2, 1, 1])
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
