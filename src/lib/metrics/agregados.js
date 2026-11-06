// @ts-check

import { SIN_CIUDAD_REGISTRADA } from '../plazas.js'
import { diasEntre, fechaRegistro, monthRegistro, weekRegistro } from './fechas.js'
import { claveFiltrable, coincideFiltros } from './filtros.js'
import { normalizado, texto } from './formato.js'
import {
  activadorEtiqueta,
  clasificacionRegistro,
  comercioRegistro,
  esComercioNuevo,
  equipoEtiqueta,
  liderEtiqueta,
  plazaEtiqueta,
  TIPOS_FUNCIONALES,
  tipoKey,
} from './identidad.js'
import { construirRanking } from './ranking.js'

/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./tipos.js').Filtros} Filtros */
/** @typedef {import('./tipos.js').Hoy} Hoy */
/** @typedef {import('./tipos.js').Conteo} Conteo */
/** @typedef {import('./identidad.js').Contexto} Contexto */

/** @param {Map<string, number>} map @param {unknown} key */
function sumar(map, key) {
  const label = texto(key) || 'Sin especificar'
  map.set(label, (map.get(label) ?? 0) + 1)
}

/** @param {Map<string, number>} map @param {number} [limit] */
function ranking(map, limit = Infinity) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .slice(0, limit)
    .map(([label, value]) => ({ label, value }))
}

/** @param {Activacion} item */
function coordenadas(item) {
  const vacio = (/** @type {unknown} */ v) => v === null || v === undefined || v === ''
  if (vacio(item.latitud) || vacio(item.longitud)) return null
  const lat = Number(item.latitud)
  const lng = Number(item.longitud)
  const valida =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  return valida ? { lat, lng } : null
}

/**
 * @param {{ activaciones: Activacion[], ctx: Contexto, filtros: Filtros, hoy: Hoy }} datos
 */
export function calcularDashboard({ activaciones, ctx, filtros, hoy }) {
  const { todayKey, monthKey, weekStartKey } = hoy
  /** @type {Activacion[]} */ const rows = []
  /** @type {{ lat: number, lng: number, label: string }[]} */ const points = []
  const maps = {
    dia: new Map(),
    semana: new Map(),
    mes: new Map(),
    plaza: new Map(),
    tipo: new Map(),
    lider: new Map(),
    clasificacion: new Map(),
    errores: new Map(),
  }
  const kpis = {
    total: 0,
    enPeriodo: 0,
    hoy: 0,
    semana: 0,
    mes: 0,
    cashIn: 0,
    errores: 0,
    tiendas: 0,
    comercios: 0,
  }
  // Without dates the window is the current month up to today; future days are never counted.
  const periodoDesde = filtros.desde || `${monthKey}-01`
  const periodoHastaSel = filtros.hasta || todayKey
  const periodoHasta = periodoHastaSel > todayKey ? todayKey : periodoHastaSel
  /** @type {Map<string, import('./tipos.js').EstadisticaActivador>} */
  const estadisticasActivador = new Map()
  const teamStats = new Map()
  const teamMonthStats = new Map()
  const activadoresUnicos = new Set()
  const nombresPlaza = new Map([['none', SIN_CIUDAD_REGISTRADA]])
  const nombresActivador = new Map([['none', 'Sin activador']])
  const nombresTipo = new Map([
    ['none', 'Sin especificar'],
    ...TIPOS_FUNCIONALES.map((t) => [tipoKey({ tipo_activacion: t.tecnico }), t.nombre]),
  ])
  const nombresLider = new Map()
  for (const item of activaciones) {
    const fecha = fechaRegistro(item)
    const claves = claveFiltrable(item, ctx)
    if (!coincideFiltros(fecha, claves, filtros)) continue
    const { plaza, activador, tipo, lider, equipo } = claves
    const plazaDisplay = plazaEtiqueta(item)
    const activadorDisplay = activadorEtiqueta(item, activador, ctx)
    const liderDisplay = liderEtiqueta(item, lider, ctx)
    const equipoNombre = equipoEtiqueta(item, equipo, ctx)
    const comercio = comercioRegistro(item)
    const clasificacion = clasificacionRegistro(item)
    const conError = item.hubo_error === true
    rows.push(item)
    if (activador !== 'none') activadoresUnicos.add(activador)
    if (!nombresPlaza.has(plaza)) nombresPlaza.set(plaza, plazaDisplay)
    if (!nombresActivador.has(activador)) nombresActivador.set(activador, activadorDisplay)
    if (tipo !== 'none' && !nombresTipo.has(tipo))
      nombresTipo.set(tipo, texto(item.tipo_activacion))
    if (lider !== 'none' && !nombresLider.has(lider)) nombresLider.set(lider, liderDisplay)
    if (tipo === 'comercio') kpis.comercios += 1
    kpis.total += 1
    if (fecha >= periodoDesde && fecha <= periodoHasta) kpis.enPeriodo += 1
    if (fecha === todayKey) kpis.hoy += 1
    if (fecha >= weekStartKey && fecha <= todayKey) kpis.semana += 1
    if (fecha.startsWith(monthKey)) kpis.mes += 1
    if (item.cash_in === true) kpis.cashIn += 1
    if (conError) kpis.errores += 1
    if (clasificacion === 'Barrio') kpis.tiendas += 1
    sumar(maps.dia, fecha || 'Sin fecha')
    sumar(maps.semana, weekRegistro(fecha))
    sumar(maps.mes, monthRegistro(fecha))
    sumar(maps.plaza, plaza)
    const estadistica = estadisticasActivador.get(activador) ?? {
      value: 0,
      dias: new Set(),
      comercios: 0,
    }
    estadistica.value += 1
    if (fecha) estadistica.dias.add(fecha)
    if (esComercioNuevo(item)) estadistica.comercios += 1
    estadisticasActivador.set(activador, estadistica)
    sumar(maps.tipo, tipo)
    sumar(maps.clasificacion, clasificacion)
    sumar(maps.errores, conError ? 'Con error' : 'Sin error')
    if (lider !== 'none') sumar(maps.lider, lider)
    const team = teamStats.get(equipo) ?? {
      nombre: equipoNombre,
      total: 0,
      errores: 0,
      integrantes: new Set(),
    }
    team.total += 1
    if (conError) team.errores += 1
    team.integrantes.add(activador)
    teamStats.set(equipo, team)
    const teamMonthKey = `${equipo}__${monthRegistro(fecha)}`
    const teamMonth = teamMonthStats.get(teamMonthKey) ?? {
      equipo: equipoNombre,
      mes: monthRegistro(fecha),
      total: 0,
      activadores: new Set(),
      errores: 0,
      comercios: new Set(),
    }
    teamMonth.total += 1
    teamMonth.activadores.add(activador)
    if (conError) teamMonth.errores += 1
    if (comercio) teamMonth.comercios.add(normalizado(comercio))
    teamMonthStats.set(teamMonthKey, teamMonth)
    const punto = coordenadas(item)
    if (punto) points.push({ ...punto, label: `${activadorDisplay} · ${plazaDisplay}` })
  }
  const porEquipo = [...teamStats.values()]
    .map((team) => ({
      nombre: team.nombre,
      total: team.total,
      integrantes: team.integrantes.size,
      promedio: team.integrantes.size ? team.total / team.integrantes.size : 0,
      errores: team.errores,
      cumplimiento: team.total ? ((team.total - team.errores) / team.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))
  const resumenEquipoMes = [...teamMonthStats.values()]
    .map((item) => ({
      equipo: item.equipo,
      mes: item.mes,
      total: item.total,
      activadores: item.activadores.size,
      comercios: item.comercios.size,
      errores: item.errores,
    }))
    .sort(
      (a, b) =>
        b.mes.localeCompare(a.mes) || b.total - a.total || a.equipo.localeCompare(b.equipo, 'es'),
    )
  const diasPeriodo = diasEntre(periodoDesde, periodoHasta)
  const promedios = {
    diario: maps.dia.size ? kpis.total / maps.dia.size : 0,
    semanal: maps.semana.size ? kpis.total / maps.semana.size : 0,
    mensual: maps.mes.size ? kpis.total / maps.mes.size : 0,
    calendarioDiario: diasPeriodo > 0 ? kpis.enPeriodo / diasPeriodo : 0,
    // Under 7 days the weekly average is not extrapolated: it is the observed total.
    calendarioSemanal: diasPeriodo > 0 ? kpis.enPeriodo / (Math.max(diasPeriodo, 7) / 7) : 0,
    diasPeriodo,
    periodoDesde,
    periodoHasta,
  }
  /** @param {{ label: string, value: number }[]} entries @param {Map<string, string>} nombres @returns {Conteo[]} */
  const traducir = (entries, nombres) =>
    entries.map((entry) => ({
      key: entry.label,
      label: nombres.get(entry.label) ?? entry.label,
      value: entry.value,
    }))
  return {
    rows,
    points,
    kpis,
    promedios,
    activadoresUnicos: activadoresUnicos.size,
    porEquipo,
    resumenEquipoMes,
    porDia: ranking(maps.dia).sort((a, b) => a.label.localeCompare(b.label)),
    porPlaza: traducir(ranking(maps.plaza), nombresPlaza),
    topActivadores: construirRanking({
      ctx,
      filtros,
      estadisticas: estadisticasActivador,
      nombres: nombresActivador,
    }),
    porTipo: traducir(ranking(maps.tipo), nombresTipo),
    porClasificacion: ranking(maps.clasificacion),
    porErrores: ranking(maps.errores),
    topLideres: traducir(ranking(maps.lider, 10), nombresLider),
  }
}
