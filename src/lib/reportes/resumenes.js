// @ts-check
// Per-event and per-trip summaries of the exported activations, so they follow the same filters and leader scope.
import { inferActivationCategory } from '../activationEditing.js'

const DIA_MS = 24 * 3600 * 1000

/** @param {{ nombre?: string | null, nombre_comun?: string | null } | null | undefined} municipio */
export const nombreMunicipio = (municipio) => municipio?.nombre_comun || municipio?.nombre || ''

/**
 * @template T
 * @param {Record<string, any>[]} filas
 * @param {(fila: Record<string, any>) => string | undefined} clave
 * @param {(fila: Record<string, any>) => T} crear
 * @param {(acumulado: T, fila: Record<string, any>) => void} sumar
 */
function agrupar(filas, clave, crear, sumar) {
  /** @type {Map<string, T>} */
  const grupos = new Map()
  for (const fila of filas) {
    const id = clave(fila)
    if (!id) continue
    if (!grupos.has(id)) grupos.set(id, crear(fila))
    sumar(/** @type {T} */ (grupos.get(id)), fila)
  }
  return [...grupos.values()]
}

/** @param {{ primera: string | null, ultima: string | null }} acumulado @param {string | null | undefined} momento */
function extenderRango(acumulado, momento) {
  if (!momento) return
  if (!acumulado.primera || momento < acumulado.primera) acumulado.primera = momento
  if (!acumulado.ultima || momento > acumulado.ultima) acumulado.ultima = momento
}

/** @param {Record<string, any>[]} filas */
export function resumirEventos(filas) {
  return agrupar(
    filas,
    (fila) => fila.evento?.id,
    (fila) => ({
      evento: fila.evento.nombre ?? '',
      lugar: fila.lugar?.nombre ?? '',
      activaciones: 0,
      activadores: new Set(),
      comercios: 0,
      tiendasBarrio: 0,
      transeuntes: 0,
      cashIn: 0,
      creditos: 0,
      remesas: 0,
      primera: /** @type {string | null} */ (null),
      ultima: /** @type {string | null} */ (null),
    }),
    (acc, fila) => {
      acc.activaciones += 1
      if (fila.usuario_id) acc.activadores.add(fila.usuario_id)
      if (!acc.lugar && fila.lugar?.nombre) acc.lugar = fila.lugar.nombre
      const categoria = inferActivationCategory(fila)
      if (categoria === 'comercio') acc.comercios += 1
      if (categoria === 'tienda_barrio') acc.tiendasBarrio += 1
      if (categoria === 'transeunte') acc.transeuntes += 1
      if (fila.cash_in) acc.cashIn += 1
      if (fila.creditos) acc.creditos += 1
      if (fila.remesas) acc.remesas += 1
      extenderRango(acc, fila.created_at)
    },
  )
    .map(({ activadores, ...resto }) => ({ ...resto, activadores: activadores.size }))
    .sort((a, b) => b.activaciones - a.activaciones || a.evento.localeCompare(b.evento, 'es'))
}

/** @param {string | null | undefined} inicio @param {string | null | undefined} fin */
export function diasViaje(inicio, fin) {
  const desde = inicio ? new Date(inicio).getTime() : NaN
  const hasta = fin ? new Date(fin).getTime() : NaN
  if (Number.isNaN(desde) || Number.isNaN(hasta) || hasta <= desde) return 0
  return Math.max(1, Math.ceil((hasta - desde) / DIA_MS))
}

/** @param {Record<string, any>[]} filas */
export function resumirViajes(filas) {
  return agrupar(
    filas,
    (fila) => fila.viaje?.id,
    (fila) => ({
      activador: fila.impulsador ?? '',
      destino: nombreMunicipio(fila.viaje.municipio),
      desde: fila.viaje.inicio ?? null,
      hasta: fila.viaje.fin ?? null,
      dias: diasViaje(fila.viaje.inicio, fila.viaje.fin),
      activaciones: 0,
    }),
    (acc) => { acc.activaciones += 1 },
  )
    .map((viaje) => ({ ...viaje, activacionesPorDia: viaje.dias ? Math.round((viaje.activaciones / viaje.dias) * 10) / 10 : '' }))
    .sort((a, b) => String(b.desde).localeCompare(String(a.desde)) || a.activador.localeCompare(b.activador, 'es'))
}
