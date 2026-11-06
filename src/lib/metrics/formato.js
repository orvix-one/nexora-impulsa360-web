// @ts-check
const numberFormatter = new Intl.NumberFormat('es-BO')
const fechaCorta = new Intl.DateTimeFormat('es-BO', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
})
const mesLargo = new Intl.DateTimeFormat('es-BO', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** @param {unknown} value */
export function texto(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** @param {unknown} value */
export function normalizado(value) {
  return texto(value).toLocaleLowerCase('es')
}

/** @param {unknown} value */
export function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0)
}

/** @param {number} value */
export function formatDecimal(value) {
  return numberFormatter.format(Number(value.toFixed(1)) || 0)
}

/** @param {unknown} value */
export function formatPromedio(value) {
  const n = Math.round((Number(value) || 0) * 10) / 10
  return n.toFixed(1).replace('.', ',')
}

/** @param {number} parte @param {number} total */
export function formatPorcentaje(parte, total) {
  return `${total ? ((parte / total) * 100).toFixed(1).replace('.', ',') : '0,0'}%`
}

/** @param {unknown} value YYYY-MM-DD */
export function formatDate(value) {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${day}/${month}/${year}` : 'Sin fecha'
}

/** @param {unknown} value YYYY-MM-DD */
export function formatShortDate(value) {
  const [year, month, day] = String(value || '').split('-')
  return year && month && day ? `${Number(day)}/${Number(month)}` : 'S/F'
}

/** @param {unknown} value YYYY-MM */
export function formatMonth(value) {
  const [year, month] = String(value || '').split('-')
  return year && month ? `${month}/${year}` : 'Sin mes'
}

/** @param {string} value */
function capitalizar(value) {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1)
}

/** @param {string} fecha YYYY-MM-DD */
export function formatDiaSemana(fecha) {
  return capitalizar(fechaCorta.format(new Date(`${fecha}T12:00:00Z`)).replace(/[.,]/g, ''))
}

/** @param {string} mes YYYY-MM */
export function formatMesLargo(mes) {
  return capitalizar(mesLargo.format(new Date(`${mes}-15T12:00:00Z`)))
}
