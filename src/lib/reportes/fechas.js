// @ts-check
// Bolivia is a fixed UTC-4 with no DST; exceljs writes Dates as UTC, so shifting by -4h makes Excel show La Paz wall-clock time.
const OFFSET_LA_PAZ_MS = -4 * 60 * 60 * 1000

/**
 * @param {unknown} value ISO instant or Date.
 * @returns {Date | ''}
 */
export function aFechaExcelLaPaz(value) {
  if (!value) return ''
  const fecha = value instanceof Date ? value : new Date(/** @type {string} */ (value))
  return Number.isNaN(fecha.getTime()) ? '' : new Date(fecha.getTime() + OFFSET_LA_PAZ_MS)
}

/**
 * @param {unknown} value `YYYY-MM-DD` (extra time part ignored).
 * @returns {Date | ''}
 */
export function aFechaSolo(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return ''
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}
