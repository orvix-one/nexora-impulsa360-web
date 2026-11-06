// @ts-check
import { neutralizeSpreadsheetFormula } from '../exportSafety.js'
import { fechaRegistro } from './fechas.js'
import { texto } from './formato.js'
import { plazaRegistro } from './identidad.js'

const ENCABEZADOS = ['Fecha', 'Activador', 'Ciudad', 'Tipo', 'Cash-In', 'Error']

/** @param {unknown} value */
function celda(value) {
  return `"${String(neutralizeSpreadsheetFormula(value) ?? '').replace(/"/g, '""')}"`
}

/** @param {import('./tipos.js').Activacion[]} rows Returns the file content, BOM included. */
export function dashboardCsv(rows) {
  const lineas = rows.map((item) =>
    [
      fechaRegistro(item),
      texto(item.impulsador),
      plazaRegistro(item),
      texto(item.tipo_activacion),
      item.cash_in === true ? 'Si' : 'No',
      item.hubo_error === true ? 'Si' : 'No',
    ]
      .map(celda)
      .join(','),
  )
  return `\uFEFF${[ENCABEZADOS.map(celda).join(','), ...lineas].join('\n')}`
}
