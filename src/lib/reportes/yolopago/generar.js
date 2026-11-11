// @ts-check
import { neutralizeSpreadsheetFormula } from '../../exportSafety.js'
import { aFilaYolopago } from './adaptador.js'
import { nombreArchivoReporte } from '../nombreArchivo.js'
import { COLUMNAS_YOLOPAGO } from './columnas.js'

export const HOJA_YOLOPAGO = 'Hoja 1'

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

export const nombreArchivoYolopago = (filtros) => nombreArchivoReporte('activaciones_yolopago', filtros)
