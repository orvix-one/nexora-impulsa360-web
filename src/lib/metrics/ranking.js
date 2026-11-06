// @ts-check
import { texto } from './formato.js'
import { activadorEtiqueta, activadorKey, etiquetaConEstado } from './identidad.js'
import { integrantesRanking } from './filtros.js'

/** @typedef {import('./tipos.js').FilaRanking} FilaRanking */
/** @typedef {import('./tipos.js').Filtros} Filtros */
/** @typedef {import('./tipos.js').EstadisticaActivador} EstadisticaActivador */
/** @typedef {import('./identidad.js').Contexto} Contexto */

/**
 * @type {{ key: string, label: string, tipo: 'texto' | 'barra' | 'porcentaje' | 'numero', valor: (fila: FilaRanking) => string | number, ayuda?: string }[]}
 */
export const RANKING_COLUMNAS = [
  { key: 'activador', label: 'Activador', tipo: 'texto', valor: (fila) => fila.label },
  { key: 'activaciones', label: 'Activaciones', tipo: 'barra', valor: (fila) => fila.value },
  { key: 'porcentaje', label: '%', tipo: 'porcentaje', valor: (fila) => fila.value },
  {
    key: 'salidas',
    label: 'Salidas',
    tipo: 'numero',
    valor: (fila) => fila.salidas,
    ayuda: 'Días distintos con al menos una activación en el periodo filtrado.',
  },
  {
    key: 'comercios',
    label: 'Comercios',
    tipo: 'numero',
    valor: (fila) => fila.comercios,
    ayuda:
      'Comercios nuevos: activaciones de Tienda de barrio o Comercio con subtipo Comercio o Limbo.',
  },
]

/**
 * @param {EstadisticaActivador | undefined} estadistica
 * @returns {Pick<FilaRanking, 'value' | 'salidas' | 'comercios'>}
 */
function metricas(estadistica) {
  return {
    value: estadistica?.value ?? 0,
    salidas: estadistica?.dias.size ?? 0,
    comercios: estadistica?.comercios ?? 0,
  }
}

/**
 * @param {{ ctx: Contexto, filtros: Filtros, estadisticas: Map<string, EstadisticaActivador>, nombres: Map<string, string> }} datos
 * @returns {FilaRanking[]}
 */
export function construirRanking({ ctx, filtros, estadisticas, nombres }) {
  /** @type {Map<string, FilaRanking>} */
  const filas = new Map()
  for (const usuario of integrantesRanking(ctx, filtros)) {
    const key = activadorKey(usuario)
    filas.set(key, {
      key,
      label: etiquetaConEstado(
        usuario,
        texto(usuario.nombre) || nombres.get(key) || activadorEtiqueta(usuario, key, ctx),
      ),
      ...metricas(estadisticas.get(key)),
    })
  }
  for (const [key, estadistica] of estadisticas) {
    if (key === 'none') continue
    const existente = filas.get(key)
    if (existente) {
      Object.assign(existente, metricas(estadistica))
      continue
    }
    const usuario = ctx.usuariosPorId.get(key.slice(4))
    const base =
      nombres.get(key) ??
      ctx.activadorCatalogo.get(key.slice(4)) ??
      `Activador · ${key.slice(4, 12)}`
    filas.set(key, { key, label: etiquetaConEstado(usuario, base), ...metricas(estadistica) })
  }
  return [...filas.values()].sort(
    (a, b) =>
      b.value - a.value || a.label.localeCompare(b.label, 'es') || a.key.localeCompare(b.key),
  )
}
