// @ts-check
import { containsNormalized } from './textUtils.js'

export const ESTADOS_VIAJE = [
  { value: 'en_curso', label: 'En curso' },
  { value: 'programado', label: 'Programado' },
  { value: 'finalizado', label: 'Finalizado' },
  { value: 'cancelado', label: 'Cancelado' },
]

/** @param {string} estado */
export function etiquetaEstadoViaje(estado) {
  return ESTADOS_VIAJE.find((item) => item.value === estado)?.label ?? estado
}

/**
 * @param {{ activador?: string | null, destino?: string | null, estado: string }[]} viajes
 * @param {{ estado?: string, texto?: string }} filtros
 */
export function filtrarViajes(viajes, { estado = '', texto = '' }) {
  return viajes.filter((viaje) =>
    (!estado || viaje.estado === estado) &&
    (containsNormalized(viaje.activador, texto) || containsNormalized(viaje.destino, texto)))
}

/**
 * Users who can travel: active, with the activador role (leaders included when they have it).
 * @param {{ usuario_id: string, nombre?: string | null, email?: string | null, roles?: string[], rol?: string, estado?: string | null, plaza_nombre?: string | null }[]} usuarios
 */
export function activadoresElegibles(usuarios) {
  return usuarios
    .filter((u) => (u.estado ?? 'activo') === 'activo' && (Array.isArray(u.roles) ? u.roles : [u.rol]).includes('activador'))
    .map((u) => ({ id: u.usuario_id, nombre: u.nombre || u.email || 'Sin nombre', detalle: u.plaza_nombre ?? '' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** @param {{ id: number, nombre: string, departamento?: string | null, plaza?: string | null }[]} municipios */
export function opcionesMunicipio(municipios) {
  return municipios.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    detalle: [m.departamento, m.plaza && m.plaza !== m.nombre ? `plaza ${m.plaza}` : ''].filter(Boolean).join(' · '),
  }))
}

/** @param {string} valor */
export function fechaHoraBolivia(valor) {
  return new Date(valor).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/La_Paz',
  })
}
