// @ts-check
// Event rules shared by the portal and the admin API: state, allowed actions, date range and display.
import { containsNormalized } from './textUtils.js'

export const ESTADOS_EVENTO = [
  { value: 'en_curso', label: 'En curso' },
  { value: 'programado', label: 'Programado' },
  { value: 'finalizado', label: 'Finalizado' },
  { value: 'cancelado', label: 'Cancelado' },
]

/** @param {string} estado */
export function etiquetaEstadoEvento(estado) {
  return ESTADOS_EVENTO.find((item) => item.value === estado)?.label ?? estado
}

/** @param {{ inicio: string, fin?: string | null, cancelado_at?: string | null }} evento @param {Date} [ahora] */
export function estadoEvento(evento, ahora = new Date()) {
  if (evento.cancelado_at) return 'cancelado'
  if (evento.fin && new Date(evento.fin) <= ahora) return 'finalizado'
  if (new Date(evento.inicio) > ahora) return 'programado'
  return 'en_curso'
}

/**
 * An event that already has activations happened: it can be finished, never cancelled.
 * @param {string} estado @param {number} activaciones
 */
export function accionesEvento(estado, activaciones) {
  const abierto = estado === 'programado' || estado === 'en_curso'
  return { anadir: abierto, finalizar: estado === 'en_curso', cancelar: abierto && activaciones === 0 }
}

/**
 * Builds the range from local dates and optional hours. Without an end hour the event lasts the whole end day; without an end date it stays open until finished.
 * @param {{ desde: string, horaDesde?: string, hasta?: string, horaHasta?: string }} rango
 * @returns {{ inicio: string, fin: string | null } | { error: string }}
 */
export function rangoEvento({ desde, horaDesde = '', hasta = '', horaHasta = '' }) {
  if (!desde) return { error: 'La fecha de inicio es obligatoria.' }
  const inicio = new Date(`${desde}T${horaDesde || '00:00'}`)
  if (Number.isNaN(inicio.getTime())) return { error: 'Fecha de inicio inválida.' }
  if (!hasta) {
    if (horaHasta) return { error: 'Elige la fecha de fin para esa hora.' }
    return { inicio: inicio.toISOString(), fin: null }
  }
  const fin = new Date(`${hasta}T${horaHasta || '00:00'}`)
  if (!horaHasta) fin.setDate(fin.getDate() + 1)
  if (Number.isNaN(fin.getTime()) || fin <= inicio) return { error: 'El fin debe ser posterior al inicio.' }
  return { inicio: inicio.toISOString(), fin: fin.toISOString() }
}

const ZONA = 'America/La_Paz'
const esMedianoche = (fecha) => fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA }) === '00:00'
const soloFecha = (fecha) => fecha.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONA })
const fechaHora = (fecha) => fecha.toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ZONA })

/** Midnight means no hour was given. @param {string} valor */
export function fechaInicioEvento(valor) {
  const fecha = new Date(valor)
  return esMedianoche(fecha) ? soloFecha(fecha) : fechaHora(fecha)
}

/** An end at midnight closes the previous whole day. @param {string | null | undefined} valor */
export function fechaFinEvento(valor) {
  if (!valor) return 'Abierto'
  const fecha = new Date(valor)
  return esMedianoche(fecha) ? soloFecha(new Date(fecha.getTime() - 1)) : fechaHora(fecha)
}

export const SIN_LUGAR = '__sin_lugar'

/**
 * @param {{ nombre: string, lugar?: string | null, departamento?: string | null, activadores: { nombre: string }[], estado: string }[]} eventos
 * @param {{ estado?: string, texto?: string, departamento?: string }} filtros
 */
export function filtrarEventos(eventos, { estado = '', texto = '', departamento = '' }) {
  const enDepartamento = (evento) => !departamento || (departamento === SIN_LUGAR ? !evento.lugar : evento.departamento === departamento)
  return eventos.filter((evento) => (!estado || evento.estado === estado) && enDepartamento(evento) && (
    containsNormalized(evento.nombre, texto) || containsNormalized(evento.lugar, texto)
    || evento.activadores.some((a) => containsNormalized(a.nombre, texto))))
}

/** @param {{ id: string, nombre: string }[]} lugares */
export function opcionesLugar(lugares) {
  return lugares.map((l) => ({ id: l.id, nombre: l.nombre }))
}

/**
 * Activations keep the distance measured to the point when they were recorded, so a place with activations keeps its point.
 * Its radius only seeds new events, which copy it, so it can always be calibrated.
 * @param {{ activaciones: number, eventos: number }} usos
 */
export function accionesLugar({ activaciones, eventos }) {
  return { moverPunto: activaciones === 0, eliminar: activaciones === 0 && eventos === 0 }
}

export const PASOS_RADIO = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000]
export const RADIO_INICIAL = 200

/** @param {number} radio */
export function indicePasoRadio(radio) {
  return PASOS_RADIO.reduce((mejor, paso, i) => (Math.abs(paso - radio) < Math.abs(PASOS_RADIO[mejor] - radio) ? i : mejor), 0)
}
