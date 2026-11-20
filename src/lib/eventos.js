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

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIA_MS = 24 * 3600 * 1000
const formatoBolivia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** @param {Date} fecha */
function enBolivia(fecha) {
  const p = Object.fromEntries(formatoBolivia.formatToParts(fecha).map((x) => [x.type, x.value]))
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: `${p.hour}:${p.minute}`, n: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DIA_MS }
}

/** @param {ReturnType<typeof enBolivia>} d @param {ReturnType<typeof enBolivia>} hoy */
function etiquetaDia(d, hoy) {
  const relativo = { [-1]: 'ayer', 0: 'hoy', 1: 'mañana' }[d.n - hoy.n]
  if (relativo) return relativo
  return `${d.dia} ${MESES[d.mes - 1]}${d.anio === hoy.anio ? '' : ` ’${String(d.anio).slice(2)}`}`
}

const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1)
const plural = (n, palabra) => `${n} ${palabra}${n === 1 ? '' : 's'}`

/** "hoy, 10:20", "12 nov, 10:20". @param {string} valor @param {Date} [ahora] */
export function momentoEvento(valor, ahora = new Date()) {
  const d = enBolivia(new Date(valor))
  return `${etiquetaDia(d, enBolivia(ahora))}, ${d.hora}`
}

/**
 * Start and end as dates with an optional hour. Midnight means no hour was given; 00:01 and 23:59 come from assignments that meant the whole day.
 * @param {string} inicio @param {string | null | undefined} fin
 */
function extremos(inicio, fin) {
  const desde = enBolivia(new Date(inicio))
  const desdeHora = ['00:00', '00:01'].includes(desde.hora) ? null : desde.hora
  if (!fin) return { desde, desdeHora, hasta: null, hastaHora: null }
  const fecha = new Date(fin)
  const crudo = enBolivia(fecha)
  if (crudo.hora === '00:00') return { desde, desdeHora, hasta: enBolivia(new Date(fecha.getTime() - 1)), hastaHora: null }
  return { desde, desdeHora, hasta: crudo, hastaHora: crudo.hora === '23:59' ? null : crudo.hora }
}

/** @param {number} ms */
function duracionHoras(ms) {
  const minutos = Math.round(ms / 60000)
  if (minutos < 60) return `${minutos} min`
  if (minutos < 24 * 60) return `${Math.round(minutos / 60)} h`
  return plural(Math.round(ms / DIA_MS), 'día')
}

/**
 * Range and length in plain words for lists: "Hoy, 08:30–15:30" · "7 h", "12–30 nov" · "19 días", "Desde 20 nov" · "Sin fecha de fin".
 * @param {{ inicio: string, fin?: string | null }} evento @param {Date} [ahora]
 * @returns {{ texto: string, duracion: string }}
 */
export function cuandoEvento({ inicio, fin }, ahora = new Date()) {
  const hoy = enBolivia(ahora)
  const { desde, desdeHora, hasta, hastaHora } = extremos(inicio, fin)
  const punto = (d, hora) => (hora ? `${etiquetaDia(d, hoy)}, ${hora}` : etiquetaDia(d, hoy))
  if (!hasta) return { texto: mayuscula(`desde ${punto(desde, desdeHora)}`), duracion: 'Sin fecha de fin' }

  const sinHoras = !desdeHora && !hastaHora
  const duracion = sinHoras
    ? (hasta.n === desde.n ? 'Todo el día' : plural(hasta.n - desde.n + 1, 'día'))
    : duracionHoras(new Date(fin).getTime() - new Date(inicio).getTime())

  if (hasta.n === desde.n) {
    const horas = desdeHora && hastaHora ? `, ${desdeHora}–${hastaHora}` : desdeHora ? `, desde ${desdeHora}` : hastaHora ? `, hasta ${hastaHora}` : ''
    return { texto: mayuscula(etiquetaDia(desde, hoy) + horas), duracion }
  }
  if (!sinHoras) return { texto: mayuscula(`${punto(desde, desdeHora)} → ${punto(hasta, hastaHora)}`), duracion }
  const a = etiquetaDia(desde, hoy)
  const b = etiquetaDia(hasta, hoy)
  const mismoMes = desde.mes === hasta.mes && desde.anio === hasta.anio && a.startsWith(String(desde.dia)) && b.startsWith(String(hasta.dia))
  return { texto: mayuscula(mismoMes ? `${desde.dia}–${b}` : `${a} – ${b}`), duracion }
}

/**
 * What each member recorded during the event, plus anyone else whose activations landed in it.
 * @param {{ usuario_id: string, categoria?: string | null, cash_in?: boolean | null, creditos?: boolean | null, remesas?: boolean | null, created_at: string }[]} activaciones
 * @param {{ id: string, nombre: string }[]} miembros
 * @param {Map<string, string>} [otrosNombres]
 */
export function resumenEvento(activaciones, miembros, otrosNombres = new Map()) {
  const vacia = (id, nombre) => ({ id, nombre, total: 0, comercios: 0, transeuntes: 0, cashIn: 0, creditos: 0, remesas: 0, ultima: null })
  const filas = new Map(miembros.map((m) => [m.id, vacia(m.id, m.nombre)]))
  const total = vacia('total', 'Total')
  for (const x of activaciones) {
    if (!filas.has(x.usuario_id)) filas.set(x.usuario_id, vacia(x.usuario_id, otrosNombres.get(x.usuario_id) ?? 'Sin nombre'))
    for (const fila of [filas.get(x.usuario_id), total]) {
      fila.total += 1
      if (x.categoria === 'comercio' || x.categoria === 'tienda_barrio') fila.comercios += 1
      if (x.categoria === 'transeunte') fila.transeuntes += 1
      if (x.cash_in) fila.cashIn += 1
      if (x.creditos) fila.creditos += 1
      if (x.remesas) fila.remesas += 1
      if (!fila.ultima || x.created_at > fila.ultima) fila.ultima = x.created_at
    }
  }
  const orden = [...filas.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'))
  return { filas: orden, total }
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
