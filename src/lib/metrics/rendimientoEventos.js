// @ts-check
// Per-event performance and live progress for the Metrics Eventos tab, computed from the already filtered activations.

import { ESTADOS_EVENTO } from '../eventos.js'
import { fechaRegistro } from './fechas.js'
import { esComercioNuevo } from './identidad.js'

/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./tipos.js').Evento} Evento */
/** @typedef {import('./tipos.js').Hoy} Hoy */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
})

/** @param {Date} fecha */
function enBolivia(fecha) {
  const p = Object.fromEntries(formato.formatToParts(fecha).map((x) => [x.type, x.value]))
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) }
}

/** @param {string} fecha YYYY-MM-DD @param {string} anioActual */
function diaMes(fecha, anioActual) {
  const [anio, mes, dia] = fecha.split('-')
  return `${Number(dia)} ${MESES[Number(mes) - 1]}${anio === anioActual ? '' : ` ${anio}`}`
}

/** Calendar days the event spans in Bolivia; an end at midnight closes the previous day. @param {Pick<Evento, 'inicio' | 'fin'>} evento */
export function diasEvento({ inicio, fin }) {
  const desde = enBolivia(new Date(inicio)).fecha
  const hasta = fin ? enBolivia(new Date(new Date(fin).getTime() - 1)).fecha : null
  return { desde, hasta: hasta && hasta < desde ? desde : hasta }
}

/** "18 nov", "18–21 nov", "28 nov – 2 dic", "Desde 18 nov". @param {Pick<Evento, 'inicio' | 'fin'>} evento @param {Hoy} hoy */
export function rangoEvento(evento, hoy) {
  const anio = hoy.todayKey.slice(0, 4)
  const { desde, hasta } = diasEvento(evento)
  if (!hasta) return `Desde ${diaMes(desde, anio)}`
  if (hasta === desde) return diaMes(desde, anio)
  if (desde.slice(0, 7) === hasta.slice(0, 7)) return `${Number(desde.slice(8))}–${diaMes(hasta, anio)}`
  return `${diaMes(desde, anio)} – ${diaMes(hasta, anio)}`
}

/** @param {number} parte @param {number} total */
const proporcion = (parte, total) => (total ? parte / total : 0)

/**
 * @param {{ eventos: Evento[], filas: Activacion[], hoy: Hoy, periodo: { desde: string, hasta: string }, soloConActividad?: boolean }} datos
 * `soloConActividad` hides events none of the filtered activations landed in (a person or territory filter is on).
 */
export function calcularEventos({ eventos, filas, hoy, periodo, soloConActividad = false }) {
  /** @type {Map<string, Activacion[]>} */
  const porEvento = new Map()
  for (const fila of filas) {
    const id = String(fila.evento_id ?? '').toLowerCase()
    if (!id) continue
    const lista = porEvento.get(id)
    if (lista) lista.push(fila)
    else porEvento.set(id, [fila])
  }
  const resultado = []
  for (const evento of eventos) {
    const { desde, hasta } = diasEvento(evento)
    if (periodo.hasta && desde > periodo.hasta) continue
    if (periodo.desde && (hasta ?? hoy.todayKey) < periodo.desde) continue
    const propias = porEvento.get(evento.id.toLowerCase()) ?? []
    if (soloConActividad && !propias.length) continue
    const activos = new Set()
    const activosHoy = new Set()
    const activadorDias = new Set()
    const porHoraHoy = Array(24).fill(0)
    let comercios = 0
    let errores = 0
    let deHoy = 0
    let ultima = ''
    for (const fila of propias) {
      const usuario = String(fila.usuario_id ?? '')
      const fecha = fechaRegistro(fila)
      activos.add(usuario)
      activadorDias.add(`${usuario}|${fecha}`)
      if (esComercioNuevo(fila)) comercios += 1
      if (fila.hubo_error === true) errores += 1
      if (fila.created_at && fila.created_at > ultima) ultima = fila.created_at
      if (fecha === hoy.todayKey) {
        deHoy += 1
        activosHoy.add(usuario)
        if (fila.created_at) {
          const momento = enBolivia(new Date(fila.created_at))
          if (momento.fecha === hoy.todayKey) porHoraHoy[momento.hora] += 1
        }
      }
    }
    resultado.push({
      id: evento.id,
      nombre: evento.nombre,
      estado: evento.estado,
      rango: rangoEvento(evento, hoy),
      inicio: evento.inicio,
      lugar: evento.lugar,
      asignados: evento.activadores.length,
      total: propias.length,
      activos: activos.size,
      porActivadorDia: proporcion(propias.length, activadorDias.size),
      pctComercios: proporcion(comercios, propias.length),
      pctErrores: proporcion(errores, propias.length),
      hoy: deHoy,
      activosHoy: activosHoy.size,
      ultima: ultima || null,
      porHoraHoy,
    })
  }
  return resultado
}

/** @template {{ estado: string }} T @param {T[]} filas */
export function agruparPorEstado(filas) {
  return ESTADOS_EVENTO.map(({ value, label }) => ({ estado: value, label, filas: filas.filter((f) => f.estado === value) }))
    .filter((grupo) => grupo.filas.length)
}
