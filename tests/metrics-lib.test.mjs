import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarioHoy, diasEntre, weekRegistro } from '../src/lib/metrics/fechas.js'
import {
  filtrosAQuery,
  filtrosDesdeQuery,
  filtrosVacios,
  hayFiltros,
  sanearFiltros,
} from '../src/lib/metrics/filtros.js'
import {
  escalaEjeY,
  estiloCeldaCalor,
  matrizEquipoMes,
  serieDiariaContinua,
} from '../src/lib/metrics/graficos.js'
import { RANKING_COLUMNAS } from '../src/lib/metrics/ranking.js'

test('calendarioHoy usa America/La_Paz y arranca la semana el lunes', () => {
  // 02:00 UTC del jueves 15 de octubre sigue siendo miércoles 14 en La Paz (UTC-4).
  const hoy = calendarioHoy(new Date('2026-10-15T02:00:00Z'))
  assert.deepEqual(hoy, { todayKey: '2026-10-14', monthKey: '2026-10', weekStartKey: '2026-10-12' })
  assert.equal(weekRegistro('2026-10-18'), '2026-10-12')
  assert.equal(weekRegistro(''), 'Sin semana')
})

test('diasEntre es inclusivo y devuelve 0 con intervalos inválidos', () => {
  assert.equal(diasEntre('2026-10-01', '2026-10-05'), 5)
  assert.equal(diasEntre('2026-10-05', '2026-10-01'), 0)
  assert.equal(diasEntre('', '2026-10-01'), 0)
})

test('los filtros viajan por la URL sin valores vacíos ni fechas inválidas', () => {
  const filtros = { ...filtrosVacios(), desde: '2026-10-01', plaza: 'pkey:lapaz', equipo: 'id:abc' }
  assert.deepEqual(filtrosAQuery(filtros), {
    desde: '2026-10-01',
    ciudad: 'pkey:lapaz',
    equipo: 'id:abc',
  })
  assert.deepEqual(filtrosDesdeQuery(filtrosAQuery(filtros)), filtros)
  assert.equal(filtrosDesdeQuery({ desde: 'ayer', ciudad: ['pkey:oruro', 'x'] }).desde, '')
  assert.equal(filtrosDesdeQuery({ ciudad: ['pkey:oruro', 'x'] }).plaza, 'pkey:oruro')
  assert.equal(hayFiltros(filtrosVacios()), false)
  assert.equal(hayFiltros(filtros), true)
})

test('sanearFiltros descarta valores que el catálogo del usuario no ofrece', () => {
  const opciones = {
    plazas: [{ key: 'pkey:lapaz', nombre: 'La Paz' }],
    activadores: [],
    equipos: [],
    lideres: [],
    tipos: [],
  }
  const filtros = {
    ...filtrosVacios(),
    desde: '2026-10-01',
    plaza: 'pkey:lapaz',
    equipo: 'id:ajeno',
  }
  assert.deepEqual(sanearFiltros(filtros, opciones), { ...filtros, equipo: '' })
})

test('escalaEjeY elige pasos redondos con a lo sumo 8 intervalos', () => {
  assert.deepEqual(escalaEjeY(1), { paso: 5, tope: 5 })
  assert.deepEqual(escalaEjeY(41), { paso: 10, tope: 50 })
  assert.deepEqual(escalaEjeY(9000), { paso: 2500, tope: 10000 })
})

test('serieDiariaContinua rellena con 0 los días sin activaciones', () => {
  const serie = serieDiariaContinua([
    { label: 'Sin fecha', value: 9 },
    { label: '2026-10-01', value: 2 },
    { label: '2026-10-04', value: 1 },
  ])
  assert.deepEqual(serie, [
    { label: '2026-10-01', value: 2 },
    { label: '2026-10-02', value: 0 },
    { label: '2026-10-03', value: 0 },
    { label: '2026-10-04', value: 1 },
  ])
})

test('matrizEquipoMes totaliza por equipo, mes y global', () => {
  const matriz = matrizEquipoMes([
    { equipo: 'A', mes: '2026-09', total: 2 },
    { equipo: 'A', mes: '2026-10', total: 3 },
    { equipo: 'B', mes: '2026-10', total: 4 },
  ])
  assert.deepEqual(matriz.meses, ['2026-09', '2026-10'])
  assert.deepEqual(
    matriz.rows.map((r) => [r.equipo, r.total]),
    [
      ['A', 5],
      ['B', 4],
    ],
  )
  assert.deepEqual(matriz.totals, { '2026-09': 2, '2026-10': 7 })
  assert.equal(matriz.grandTotal, 9)
  assert.equal(matriz.max, 4)
  assert.equal(estiloCeldaCalor(0, 4).color, '#143b5e')
  assert.equal(estiloCeldaCalor(4, 4).color, '#ffffff')
})

test('las columnas del ranking declaran su tipo y exponen Salidas y Comercios', () => {
  assert.deepEqual(
    RANKING_COLUMNAS.map((c) => c.label),
    ['Activador', 'Activaciones', '%', 'Salidas', 'Comercios'],
  )
  const fila = { key: 'uid:1', label: 'Ana', value: 4, salidas: 2, comercios: 1 }
  assert.deepEqual(
    RANKING_COLUMNAS.map((c) => c.valor(fila)),
    ['Ana', 4, 4, 2, 1],
  )
})
