// @ts-check
import { texto } from './formato.js'

/** @typedef {import('./tipos.js').Hoy} Hoy */

/** @param {Date} [ahora] @returns {Hoy} */
export function calendarioHoy(ahora = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(ahora)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const todayKey = `${parts.year}-${parts.month}-${parts.day}`
  const todayDate = new Date(`${todayKey}T12:00:00Z`)
  const weekStart = new Date(todayDate)
  weekStart.setUTCDate(todayDate.getUTCDate() - ((todayDate.getUTCDay() + 6) % 7))
  return {
    todayKey,
    monthKey: `${parts.year}-${parts.month}`,
    weekStartKey: weekStart.toISOString().slice(0, 10),
  }
}

/** @param {string} [fecha] YYYY-MM-DD */
export function weekRegistro(fecha) {
  if (!fecha) return 'Sin semana'
  const date = new Date(`${fecha}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Sin semana'
  const start = new Date(date)
  start.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return start.toISOString().slice(0, 10)
}

/** @param {unknown} fecha */
export function monthRegistro(fecha) {
  return String(fecha || '').match(/^\d{4}-\d{2}/)?.[0] ?? 'Sin mes'
}

/** @param {string} desde @param {string} hasta */
export function diasEntre(desde, hasta) {
  if (!desde || !hasta || desde > hasta) return 0
  const a = Date.parse(`${desde}T12:00:00Z`)
  const b = Date.parse(`${hasta}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86400000) + 1
}

/** @param {import('./tipos.js').Activacion} item */
export function fechaRegistro(item) {
  return (
    (texto(item.fecha_activacion) || texto(item.created_at)).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
  )
}
