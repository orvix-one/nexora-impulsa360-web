// @ts-check
// YoloPago's Google-Form wording for our internal activation codes. Unknown codes fall through as-is so nothing is silently blank.
import { inferActivationCategory } from '../../activationEditing.js'
import { ciudadActivacion } from '../../plazas.js'

export const ETIQUETA_MERCADOS = 'Mercados'
export const ETIQUETA_TIENDAS = 'Tiendas de barrio (Santa Cruz, La Paz, El Alto)'

const TIPO_ACTIVACION = {
  comercio: 'Comercio',
  reactivacion_comercio: 'Reactivación Comercio',
  reactivacion: 'Reactivación Comercio',
  transeunte: 'Transeunte',
  reactivacion_transeunte: 'Reactivación Transeunte',
  reimpresion_qr: 'Reimpresion QR',
  no_habilitado: 'No Habilitado',
  limbo: 'Limbo (Configuración de Cuenta)',
  cliente_antiguo: 'Cliente Antiguo',
}

const CIUDAD = {
  'Santa Cruz de la Sierra': 'Santa Cruz',
}

const clave = (valor) => String(valor ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_')

/** @param {Record<string, any>} activacion */
export function esTiendaBarrio(activacion) {
  return inferActivationCategory(activacion) === 'tienda_barrio'
}

/** @param {Record<string, any>} activacion */
export function etiquetaTipoActivacionGeneral(activacion) {
  return esTiendaBarrio(activacion) ? ETIQUETA_TIENDAS : ETIQUETA_MERCADOS
}

/** @param {unknown} tipoActivacion */
export function etiquetaSubtipo(tipoActivacion) {
  const original = String(tipoActivacion ?? '').trim()
  if (!original) return ''
  return TIPO_ACTIVACION[clave(original)] ?? original
}

/** @param {Record<string, any>} activacion */
export function etiquetaCiudad(activacion) {
  const ciudad = ciudadActivacion(activacion)
  return CIUDAD[ciudad] ?? ciudad
}

export const TIPOS_ACTIVACION_CONOCIDOS = Object.keys(TIPO_ACTIVACION)
