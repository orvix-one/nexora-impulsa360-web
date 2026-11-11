// @ts-check
// Maps one internal activation row to YoloPago's report cells. The only module that knows both vocabularies.
import { aFechaExcelLaPaz, aFechaSolo } from '../fechas.js'
import { siNo } from '../valores.js'
import {
  esTiendaBarrio,
  etiquetaCiudad,
  etiquetaSubtipo,
  etiquetaTipoActivacionGeneral,
} from './vocabulario.js'

const SOLO_DIGITOS_SIN_CERO_INICIAL = /^[1-9]\d{0,14}$/

/** @param {unknown} valor */
function numeroSiEsSeguro(valor) {
  const texto = String(valor ?? '').trim()
  if (!texto) return ''
  return SOLO_DIGITOS_SIN_CERO_INICIAL.test(texto) ? Number(texto) : texto
}

/**
 * @param {string | undefined} ruta
 * @param {(rutaRelativa: string) => string} urlEvidencia
 */
function celdaEnlace(ruta, urlEvidencia) {
  const url = ruta ? urlEvidencia(ruta) : ''
  return url ? { text: url, hyperlink: url } : ''
}

/** @param {...unknown} partes */
function unir(...partes) {
  return partes.map((parte) => String(parte ?? '').trim()).filter(Boolean).join(' - ')
}

/**
 * @param {Record<string, any>} activacion
 * @param {{ urlEvidencia: (rutaRelativa: string) => string }} opciones
 * @returns {Record<string, any>} cells keyed by `COLUMNAS_YOLOPAGO[].clave`.
 */
export function aFilaYolopago(activacion, { urlEvidencia }) {
  const tienda = esTiendaBarrio(activacion)
  const subtipo = etiquetaSubtipo(activacion.tipo_activacion)
  return {
    marcaTemporal: aFechaExcelLaPaz(activacion.created_at),
    tipoActivacion: etiquetaTipoActivacionGeneral(activacion),
    tamanoTienda: tienda ? (activacion.tamano_tienda ?? activacion.tipo_tienda ?? '') : '',
    tipoTienda: tienda ? subtipo : '',
    tipoMercados: tienda ? '' : subtipo,
    tipoComercio: activacion.tipo_comercio ?? '',
    ciudad: etiquetaCiudad(activacion),
    zona: activacion.zona_activacion ?? '',
    activador: activacion.impulsador ?? '',
    fecha: aFechaSolo(activacion.fecha_activacion),
    nombres: activacion.nombres_cliente ?? '',
    apellidos: activacion.apellidos_cliente ?? '',
    cedula: numeroSiEsSeguro(activacion.ci_cliente),
    telefono: numeroSiEsSeguro(activacion.telefono_cliente),
    huboError: siNo(activacion.hubo_error),
    detalleError: unir(activacion.tipo_error, activacion.descripcion_error),
    fotografia: celdaEnlace(activacion.foto_url_evidencia, urlEvidencia),
    comprobanteCashIn: celdaEnlace(activacion.foto_cash_in_evidencia, urlEvidencia),
    creditos: siNo(activacion.creditos),
    remesas: siNo(activacion.remesas),
  }
}
