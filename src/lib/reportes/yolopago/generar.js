// @ts-check
import { neutralizeSpreadsheetFormula } from '../../exportSafety.js'
import { aFilaYolopago } from './adaptador.js'
import { COLUMNAS_YOLOPAGO } from './columnas.js'

export const HOJA_YOLOPAGO = 'Hoja 1'

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const FUENTE = { name: 'Arial', size: 10 }

/**
 * @param {typeof import('exceljs')} ExcelJS Injected so the browser can load it lazily.
 * @param {Record<string, any>[]} activaciones
 * @param {{ urlEvidencia: (rutaRelativa: string) => string }} opciones
 */
export async function generarReporteYolopago(ExcelJS, activaciones, opciones) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Impulsa 360'
  const hoja = workbook.addWorksheet(HOJA_YOLOPAGO, { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = COLUMNAS_YOLOPAGO.map(({ clave, header, width, numFmt }) => ({
    key: clave, header, width, style: { font: FUENTE, ...(numFmt ? { numFmt } : {}) },
  }))
  hoja.getRow(1).font = { ...FUENTE, bold: true }
  hoja.getRow(1).alignment = { horizontal: 'left', vertical: 'middle' }

  for (const activacion of activaciones) {
    const fila = aFilaYolopago(activacion, opciones)
    const celdas = Object.fromEntries(
      Object.entries(fila).map(([clave, valor]) => [clave, neutralizeSpreadsheetFormula(valor)]),
    )
    const agregada = hoja.addRow(celdas)
    agregada.eachCell((celda) => {
      if (celda.value && typeof celda.value === 'object' && 'hyperlink' in celda.value) {
        celda.font = { ...FUENTE, color: { argb: 'FF0000FF' }, underline: true }
      }
    })
  }
  return workbook.xlsx.writeBuffer()
}

/** @param {string} fecha `YYYY-MM-DD` */
function partes(fecha) {
  const match = String(fecha ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? { anio: Number(match[1]), mes: Number(match[2]), dia: Number(match[3]) } : null
}

/**
 * `ACTIVACIONES OCT 2Q.xlsx` when the range is exactly one quincena, otherwise the range itself.
 * @param {{ fechaDesde?: string, fechaHasta?: string }} filtros
 */
export function nombreArchivoYolopago({ fechaDesde, fechaHasta } = {}) {
  const desde = partes(fechaDesde ?? '')
  const hasta = partes(fechaHasta ?? '')
  if (desde && hasta && desde.anio === hasta.anio && desde.mes === hasta.mes) {
    const ultimoDia = new Date(Date.UTC(desde.anio, desde.mes, 0)).getUTCDate()
    const mes = MESES[desde.mes - 1]
    if (desde.dia === 1 && hasta.dia === 15) return `ACTIVACIONES ${mes} 1Q.xlsx`
    if (desde.dia === 16 && hasta.dia === ultimoDia) return `ACTIVACIONES ${mes} 2Q.xlsx`
  }
  const rango = [fechaDesde, fechaHasta].filter(Boolean)
  if (!rango.length) return 'ACTIVACIONES.xlsx'
  return `ACTIVACIONES ${rango.join(' a ')}.xlsx`
}
