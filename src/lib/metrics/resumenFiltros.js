// @ts-check
// Human-readable summaries and removable chips for the global metrics filters.

import { PERIODOS } from './filtros.js'
import { formatDate } from './formato.js'

/** @typedef {import('./tipos.js').Filtros} Filtros */
/** @typedef {import('./tipos.js').Opcion} Opcion */

const MAX_CHIPS_POR_FILTRO = 5

/** @param {Pick<Filtros, 'periodo' | 'desde' | 'hasta'>} filtros */
export function resumenPeriodo({ periodo, desde, hasta }) {
  const preset = PERIODOS.find((p) => p.value === periodo)
  if (preset) return preset.label
  if (desde && hasta) return desde === hasta ? formatDate(desde) : `${formatDate(desde)} – ${formatDate(hasta)}`
  if (desde) return `Desde ${formatDate(desde)}`
  if (hasta) return `Hasta ${formatDate(hasta)}`
  return 'Todo el historial'
}

/** @param {string[]} keys @param {Opcion[]} opciones @param {string} vacio @param {string} plural */
export function resumenSeleccion(keys, opciones, vacio, plural) {
  if (!keys.length) return vacio
  if (keys.length === 1) return opciones.find((o) => o.key === keys[0])?.nombre ?? vacio
  return `${keys.length} ${plural}`
}

/** @param {string[]} keys @param {Opcion[]} opciones */
export function chipsSeleccion(keys, opciones, plural = 'más') {
  return chipsSueltas(keys, new Map(opciones.map((o) => [o.key, o.nombre])), plural)
}

/** @param {string[]} keys @param {Map<string, string>} nombres @param {string} plural */
function chipsSueltas(keys, nombres, plural) {
  const visibles = keys.length > MAX_CHIPS_POR_FILTRO ? keys.slice(0, MAX_CHIPS_POR_FILTRO - 1) : keys
  const chips = visibles.map((k) => ({ id: k, texto: nombres.get(k) ?? k, keys: [k] }))
  const resto = keys.slice(visibles.length)
  if (resto.length) chips.push({ id: `resto:${resto[0]}`, texto: `+${resto.length} ${plural}`, keys: resto })
  return chips
}
