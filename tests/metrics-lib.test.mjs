import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarioHoy, diasEntre, weekRegistro } from '../src/lib/metrics/fechas.js'
import {
  filtrosAQuery,
  filtrosDesdeQuery,
  filtrosVacios,
  hayFiltros,
  resolverPeriodo,
  sanearFiltros,
} from '../src/lib/metrics/filtros.js'
import { chipsSeleccion, resumenPeriodo } from '../src/lib/metrics/resumenFiltros.js'
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
  const filtros = { ...filtrosVacios(), desde: '2026-10-01', territorio: ['mun:1', 'none'], equipo: 'id:abc' }
  assert.deepEqual(filtrosAQuery(filtros), {
    desde: '2026-10-01',
    municipio: ['mun:1', 'none'],
    equipo: 'id:abc',
  })
  assert.deepEqual(filtrosDesdeQuery(filtrosAQuery(filtros)), filtros)
  assert.equal(filtrosDesdeQuery({ desde: 'ayer' }).desde, '')
  assert.deepEqual(filtrosDesdeQuery({ municipio: ['mun:3', 'mun:3', ' '] }).territorio, ['mun:3'])
  assert.deepEqual(filtrosDesdeQuery({ activador: 'uid:a' }).activador, ['uid:a'])
  assert.deepEqual(filtrosDesdeQuery({ periodo: '7d', desde: '2026-10-01' }), { ...filtrosVacios(), periodo: '7d' }, 'un preset manda sobre el rango')
  assert.equal(filtrosDesdeQuery({ periodo: '99d' }).periodo, '')
  assert.equal(hayFiltros(filtrosVacios()), false)
  assert.equal(hayFiltros(filtros), true)
})

test('sanearFiltros descarta valores que el catálogo del usuario no ofrece', () => {
  const opciones = {
    territorios: [{ key: 'mun:1', nombre: 'La Paz' }],
    zonas: [],
    activadores: [],
    equipos: [],
    lideres: [],
    tipos: [],
  }
  const filtros = {
    ...filtrosVacios(),
    desde: '2026-10-01',
    territorio: ['mun:1', 'mun:999'],
    equipo: 'id:ajeno',
  }
  assert.deepEqual(sanearFiltros(filtros, opciones), { ...filtros, territorio: ['mun:1'], equipo: '' })
})

test('resolverPeriodo convierte presets en fechas relativas a hoy', () => {
  const hoy = { todayKey: '2026-11-20', monthKey: '2026-11', weekStartKey: '2026-11-16' }
  const con = (cambios) => resolverPeriodo({ ...filtrosVacios(), ...cambios }, hoy)
  assert.deepEqual(con({ periodo: 'hoy' }), { desde: '2026-11-20', hasta: '2026-11-20' })
  assert.deepEqual(con({ periodo: '7d' }), { desde: '2026-11-14', hasta: '2026-11-20' })
  assert.deepEqual(con({ periodo: '15d' }), { desde: '2026-11-06', hasta: '2026-11-20' })
  assert.deepEqual(con({ periodo: 'mes' }), { desde: '2026-11-01', hasta: '2026-11-20' })
  assert.deepEqual(con({ desde: '2026-10-01', hasta: '2026-10-31' }), { desde: '2026-10-01', hasta: '2026-10-31' })
})

test('los chips resumen las selecciones largas y el período en palabras', () => {
  const muchos = Array.from({ length: 7 }, (_, i) => ({ key: `uid:${i}`, nombre: `A${i}` }))
  assert.deepEqual(chipsSeleccion(muchos.map((o) => o.key), muchos, 'activadores').map((c) => c.texto), ['A0', 'A1', 'A2', 'A3', '+3 activadores'])
  assert.equal(resumenPeriodo({ periodo: '', desde: '2026-11-01', hasta: '2026-11-15' }), '01/11/2026 – 15/11/2026')
  assert.equal(resumenPeriodo({ periodo: '', desde: '', hasta: '' }), 'Todo el historial')
})

test('elegir un departamento o una plaza es una sola clave que incluye a sus municipios', async () => {
  const { crearContexto } = await import('../src/lib/metrics/identidad.js')
  const { clavesMunicipio, enSeleccion, gruposTerritorio, municipioEnSeleccion } = await import('../src/lib/metrics/territorio.js')
  const ctx = crearContexto({
    activaciones: [],
    usuarios: [],
    municipios: [
      { id: 1, codigo_ine: '070101', nombre: 'Santa Cruz de la Sierra', departamento: 'Santa Cruz', plaza: 'Santa Cruz de la Sierra' },
      { id: 2, codigo_ine: '071001', nombre: 'Montero', departamento: 'Santa Cruz', plaza: 'Montero' },
      { id: 3, codigo_ine: '040101', nombre: 'Oruro', departamento: 'Oruro', plaza: 'Oruro' },
    ],
  })
  assert.deepEqual(clavesMunicipio(2, ctx), { municipio: 'mun:2', departamento: 'dep:07', plaza: 'pla:Montero' })
  assert.deepEqual(clavesMunicipio(null, ctx), { municipio: 'none', departamento: '', plaza: '' })
  assert.equal(enSeleccion(['dep:07'], clavesMunicipio(2, ctx)), true)
  assert.equal(enSeleccion(['dep:07'], clavesMunicipio(3, ctx)), false)
  assert.equal(enSeleccion(['pla:Montero'], clavesMunicipio(1, ctx)), false)
  assert.equal(enSeleccion(['none'], clavesMunicipio(null, ctx)), true)
  assert.equal(municipioEnSeleccion('mun:1', ['dep:07'], ctx), true)
  assert.deepEqual(gruposTerritorio(ctx).map((g) => [g.key, g.nombre]), [
    ['dep:04', 'Oruro'],
    ['pla:Montero', 'Plaza Montero'],
    ['pla:Oruro', 'Plaza Oruro'],
    ['pla:Santa Cruz de la Sierra', 'Plaza Santa Cruz de la Sierra'],
    ['dep:07', 'Santa Cruz'],
  ])
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

test('el mapa cuenta por código INE de municipio o departamento y aparta lo no ubicado', async () => {
  const { conteoPorPoligono, indicePoligonos, codigoPoligono } = await import('../src/lib/metrics/geo.js')
  const { crearContexto } = await import('../src/lib/metrics/identidad.js')
  const ctx = crearContexto({
    activaciones: [],
    usuarios: [],
    municipios: [
      { id: 1, codigo_ine: '020101', nombre: 'La Paz', departamento: 'La Paz', plaza: 'La Paz' },
      { id: 2, codigo_ine: '020105', nombre: 'El Alto', departamento: 'La Paz', plaza: 'El Alto' },
      { id: 3, codigo_ine: '040101', nombre: 'Oruro', departamento: 'Oruro', plaza: 'Oruro' },
    ],
  })
  const filas = [{ municipio_id: 1 }, { municipio_id: 2 }, { municipio_id: 2 }, { municipio_id: 3 }, { municipio_id: null }, { municipio_id: 99 }]
  const municipal = conteoPorPoligono(filas, ctx, 'municipio')
  assert.deepEqual([...municipal.conteo], [['020101', 1], ['020105', 2], ['040101', 1]])
  assert.equal(municipal.sinUbicar, 2)
  assert.deepEqual([...conteoPorPoligono(filas, ctx, 'departamento').conteo], [['02', 3], ['04', 1]])
  assert.deepEqual(indicePoligonos(ctx, 'departamento').get('02'), { nombre: 'La Paz', key: 'dep:02' })
  assert.deepEqual(indicePoligonos(ctx, 'municipio').get('020105'), { nombre: 'El Alto', key: 'mun:2' })
  const { codigosElegidos } = await import('../src/lib/metrics/geo.js')
  assert.deepEqual([...codigosElegidos(['dep:02'], ctx, 'municipio')], ['020101', '020105'], 'un departamento elegido resalta sus municipios')
  assert.deepEqual([...codigosElegidos(['mun:3'], ctx, 'departamento')], [])
  assert.equal(codigoPoligono({ codigo_ine: '020101', departamento_ine: '02' }, 'departamento'), '02')
})

test('los archivos de geometría cubren los 339 municipios y 9 departamentos con punto de etiqueta', async () => {
  const { readFileSync } = await import('node:fs')
  const leer = (n) => JSON.parse(readFileSync(new URL(`../public/geo/${n}.geojson`, import.meta.url), 'utf8'))
  const municipios = leer('municipios')
  const departamentos = leer('departamentos')
  assert.equal(new Set(municipios.features.map((f) => f.properties.codigo_ine)).size, 339)
  assert.equal(departamentos.features.length, 9)
  for (const f of [...municipios.features, ...departamentos.features]) assert.equal(f.properties.etiqueta.length, 2)
  assert.match(municipios.fuente, /OCHA COD-AB/)
})

test('rendimiento por evento: act./activador-día, progreso de hoy y corte por período', async () => {
  const { agruparPorEstado, calcularEventos, rangoEvento } = await import('../src/lib/metrics/rendimientoEventos.js')
  const hoy = { todayKey: '2026-11-20', monthKey: '2026-11', weekStartKey: '2026-11-16' }
  const evento = (id, estado, inicio, fin, activadores = 2) => ({
    id, nombre: id, estado, inicio, fin, lugar: null,
    activadores: Array.from({ length: activadores }, (_, i) => ({ id: `u${i}`, nombre: `U${i}`, desde: inicio })),
  })
  const eventos = [
    evento('feria', 'en_curso', '2026-11-18T12:00:00Z', null),
    evento('expo', 'finalizado', '2026-10-01T12:00:00Z', '2026-10-03T04:00:00Z'),
    evento('futuro', 'programado', '2026-12-01T12:00:00Z', '2026-12-02T04:00:00Z'),
  ]
  const fila = (evento_id, usuario_id, fecha_activacion, created_at, extra = {}) => ({ evento_id, usuario_id, fecha_activacion, created_at, ...extra })
  const filas = [
    fila('feria', 'u0', '2026-11-19', '2026-11-19T14:00:00Z'),
    fila('feria', 'u0', '2026-11-20', '2026-11-20T13:10:00Z'),
    fila('feria', 'u0', '2026-11-20', '2026-11-20T13:40:00Z', { hubo_error: true }),
    fila('feria', 'u1', '2026-11-20', '2026-11-20T15:05:00Z'),
    fila('expo', 'u0', '2026-10-01', '2026-10-01T14:00:00Z'),
    fila(null, 'u0', '2026-11-20', '2026-11-20T15:00:00Z'),
  ]
  const todos = calcularEventos({ eventos, filas, hoy, periodo: { desde: '', hasta: '' } })
  const feria = todos.find((e) => e.id === 'feria')
  assert.equal(feria.total, 4)
  assert.equal(feria.porActivadorDia, 4 / 3, 'u0 trabajó 2 días y u1 uno')
  assert.equal(feria.hoy, 3)
  assert.equal(feria.activosHoy, 2)
  assert.equal(feria.pctErrores, 0.25)
  assert.equal(feria.ultima, '2026-11-20T15:05:00Z')
  assert.equal(feria.porHoraHoy[9], 2, '13:10Z y 13:40Z son las 9 en La Paz')
  assert.equal(feria.porHoraHoy[11], 1)

  const noviembre = calcularEventos({ eventos, filas, hoy, periodo: { desde: '2026-11-01', hasta: '2026-11-20' } })
  assert.deepEqual(noviembre.map((e) => e.id), ['feria'], 'solo eventos que se solapan con el período')
  assert.deepEqual(calcularEventos({ eventos, filas, hoy, periodo: { desde: '', hasta: '' }, soloConActividad: true }).map((e) => e.id), ['feria', 'expo'])
  assert.deepEqual(agruparPorEstado(todos).map((g) => g.estado), ['en_curso', 'programado', 'finalizado'])

  assert.equal(rangoEvento(eventos[0], hoy), 'Desde 18 nov')
  assert.equal(rangoEvento(eventos[1], hoy), '1–2 oct', 'un fin a medianoche cierra el día anterior')
  assert.equal(rangoEvento({ inicio: '2025-12-30T12:00:00Z', fin: '2026-01-02T12:00:00Z' }, hoy), '30 dic 2025 – 2 ene')
})
