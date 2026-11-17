// @ts-check
// Portal's own Excel export (internal vocabulary, grouped by activation category). Client-neutral: no YoloPago wording here.
import { activationCategoryLabel, inferActivationCategory } from '../activationEditing.js'
import { neutralizeExportRow } from '../exportSafety.js'
import { etiquetaCiudadActivacion } from '../plazas.js'
import { nombreArchivoReporte } from './nombreArchivo.js'
import { aFechaExcelLaPaz, aFechaSolo } from './fechas.js'
import { siNo } from './valores.js'

export const nombreArchivoExcel = (filtros) => nombreArchivoReporte('activaciones', filtros)
const HOJA_EXCEL = 'Activaciones'
const ENCABEZADO_FECHA = 'Fecha de la Activación'

const tieneValor = (valor) => valor != null && String(valor).trim() !== ''
const unir = (...partes) => partes.filter(Boolean).join(' - ')

const esTiendaBarrio = (fila) => inferActivationCategory(fila) === 'tienda_barrio'
const esComercio = (fila) => inferActivationCategory(fila) === 'comercio'
const esTranseunte = (fila) => inferActivationCategory(fila) === 'transeunte'

const equipo = (fila) =>
  fila.equipo_nombre_registro || (fila.equipo_numero_registro ? `Equipo #${fila.equipo_numero_registro}` : '')

/**
 * @typedef {{ urlEvidencia: (rutaRelativa: string) => string }} ContextoExcel
 * @type {[string, (fila: Record<string, any>, contexto: ContextoExcel) => unknown][]}
 */
export const COLUMNAS_EXCEL = [
  [ENCABEZADO_FECHA, (fila) => aFechaExcelLaPaz(fila.created_at) || aFechaSolo(fila.fecha_activacion)],
  ['Ciudad', (fila) => etiquetaCiudadActivacion(fila)],
  ['Zona de Activación', (fila) => fila.zona_activacion],
  ['Categoría', (fila) => activationCategoryLabel(fila)],
  ['Subtipo', (fila) => fila.tipo_activacion],
  ['Tienda Barrio - Tamaño', (fila) => tieneValor(fila.tamano_tienda) ? fila.tamano_tienda : esTiendaBarrio(fila) ? fila.tipo_tienda : ''],
  ['Tienda Barrio - Subtipo', (fila) => tieneValor(fila.tamano_tienda) ? 'Tienda de Barrio' : esTiendaBarrio(fila) ? (fila.tipo_activacion || fila.tipo_comercio) : ''],
  ['Comercio - Tipo de Comercio', (fila) => esComercio(fila) ? fila.tipo_comercio : ''],
  ['Comercio - Rubro', (fila) => unir(fila.rubro_comercio, fila.rubro_comercio_otro)],
  ['Comercio - Fuera del mercado', (fila) => siNo(fila.comercio_fuera_mercado)],
  ['Transeúnte - Subtipo', (fila) => esTranseunte(fila) ? fila.tipo_activacion : ''],
  ['Nombre del Activador', (fila) => fila.impulsador],
  ['Nombre', (fila) => fila.nombres_cliente],
  ['Apellidos', (fila) => fila.apellidos_cliente],
  ['Cédula', (fila) => fila.ci_cliente],
  ['Teléfono', (fila) => fila.telefono_cliente],
  ['Correo', (fila) => fila.email_cliente],
  ['Foto de la Activación', (fila, { urlEvidencia }) => enlaceFoto(fila.foto_url_evidencia, urlEvidencia)],
  ['Foto Cash-In / Reporte', (fila, { urlEvidencia }) => enlaceFoto(fila.foto_cash_in_evidencia, urlEvidencia)],
  ['Checklist - Descargó App', (fila) => siNo(fila.descargo_app)],
  ['Checklist - Registro', (fila) => siNo(fila.registro)],
  ['Checklist - Cash-In', (fila) => siNo(fila.cash_in)],
  ['Checklist - Cash-Out', (fila) => siNo(fila.cash_out)],
  ['Checklist - P2P', (fila) => siNo(fila.p2p)],
  ['Checklist - QR Físico', (fila) => siNo(fila.qr_fisico)],
  ['Checklist - Respaldo', (fila) => siNo(fila.respaldo)],
  ['Hubo Error', (fila) => siNo(fila.hubo_error)],
  ['Tipo de Error', (fila) => fila.tipo_error],
  ['Descripción del Error', (fila) => fila.descripcion_error],
  ['Créditos', (fila) => fila.creditos ? 'Si' : 'No'],
  ['Remesas', (fila) => fila.remesas ? 'Si' : 'No'],
  ['Plaza Base', (fila) => fila.plaza_base_registro],
  ['Equipo', (fila) => equipo(fila)],
  ['Facturador', (fila) => fila.facturador_nombre_registro],
  ['Líder Vigente', (fila) => fila.lider_nombre_registro],
  ['Observaciones', (fila) => fila.observaciones],
  ['Latitud', (fila) => fila.latitud],
  ['Longitud', (fila) => fila.longitud],
  ['Usuario ID', (fila) => fila.usuario_id],
]

/**
 * @param {string | undefined} ruta
 * @param {(rutaRelativa: string) => string} urlEvidencia
 */
function enlaceFoto(ruta, urlEvidencia) {
  const url = ruta ? urlEvidencia(ruta) : ''
  return url ? { text: 'Ver foto', hyperlink: url } : ''
}

const BORDE = { style: 'thin', color: { argb: 'FFDCE8F4' } }

/**
 * @param {typeof import('exceljs')} ExcelJS Injected so the browser can load it lazily.
 * @param {Record<string, any>[]} activaciones
 * @param {ContextoExcel} contexto
 */
export async function generarExcel(ExcelJS, activaciones, contexto) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Impulsa 360'
  workbook.created = new Date()
  const hoja = workbook.addWorksheet(HOJA_EXCEL)

  hoja.columns = COLUMNAS_EXCEL.map(([header]) => ({
    header,
    key: header,
    width: Math.max(14, Math.min(36, header.length + 4)),
  }))
  hoja.views = [{ state: 'frozen', ySplit: 1 }]
  hoja.autoFilter = { from: 'A1', to: `${hoja.getColumn(COLUMNAS_EXCEL.length).letter}1` }
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1769FF' } }

  for (const activacion of activaciones) {
    hoja.addRow(neutralizeExportRow(Object.fromEntries(
      COLUMNAS_EXCEL.map(([header, valor]) => [header, valor(activacion, contexto) ?? '']),
    )))
  }

  hoja.getColumn(ENCABEZADO_FECHA).numFmt = 'dd/mm/yyyy hh:mm'
  hoja.eachRow((fila) => {
    fila.eachCell((celda) => {
      celda.alignment = { vertical: 'top', wrapText: true }
      celda.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE }
      if (celda.value && typeof celda.value === 'object' && 'hyperlink' in celda.value) {
        celda.font = { color: { argb: 'FF0563C1' }, underline: true }
      }
    })
  })
  return workbook.xlsx.writeBuffer()
}
