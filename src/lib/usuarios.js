// @ts-check
import { isValidEmail, normalizeEmail } from './textUtils.js'

export const ROLES = ['activador', 'lider', 'facturador', 'administrador', 'banco']
export const ESTADOS = ['activo', 'inhabilitado']

const CONTRASENA_FUERTE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/

/**
 * @param {string} password
 * @returns {string | null}
 */
export function validarContrasena(password) {
  if (!password) return 'Ingresa la nueva contrasena.'
  if (!CONTRASENA_FUERTE.test(password))
    return 'La contrasena debe tener al menos 10 caracteres, mayuscula, minuscula, numero y simbolo.'
  return null
}

/** @param {string | null | undefined} valor */
export function etiqueta(valor) {
  return valor ? valor.charAt(0).toUpperCase() + valor.slice(1) : 'Sin asignar'
}

/** @param {unknown} value */
function normalizarRol(value) {
  return (
    String(value ?? '')
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase() || 'activador'
  )
}

/**
 * @param {{ roles?: string[], rol?: string } | null | undefined} usuario
 * @returns {string[]}
 */
export function rolesUsuario(usuario) {
  return Array.isArray(usuario?.roles) ? [...usuario.roles] : [normalizarRol(usuario?.rol)]
}

/**
 * @param {{ roles?: string[], rol?: string } | null | undefined} usuario
 * @param {string} rol
 */
export function esRol(usuario, rol) {
  return rolesUsuario(usuario).includes(rol)
}

/** @param {{ estado?: string }} usuario */
export function estaActivo(usuario) {
  return (usuario.estado ?? 'activo') === 'activo'
}

export function formularioVacio() {
  return {
    email: '',
    password: '',
    nombre: '',
    plaza: '',
    plaza_id: '',
    equipo_id: '',
    equipo_ids: /** @type {string[]} */ ([]),
    facturador_equipo_ids: /** @type {string[]} */ ([]),
    roles: ['activador'],
    estado: 'activo',
    lider_id: '',
    motivo_inhabilitacion: '',
    puede_activar: false,
  }
}

/** @typedef {ReturnType<typeof formularioVacio>} FormularioUsuario */

/**
 * @param {any} usuario
 * @param {{ id: string, plaza_id?: string, lider_actual_id?: string }[]} equipos
 * @returns {FormularioUsuario}
 */
export function formularioDesdeUsuario(usuario, equipos) {
  const equipo = equipos.find((item) => item.id === usuario.equipo_id)
  return {
    ...formularioVacio(),
    nombre: usuario.nombre ?? '',
    email: usuario.email ?? '',
    plaza: usuario.plaza_base ?? usuario.plaza ?? '',
    plaza_id: equipo?.plaza_id ?? '',
    equipo_id: usuario.equipo_id ?? '',
    equipo_ids: equipos
      .filter((item) => item.lider_actual_id === usuario.usuario_id)
      .map((item) => item.id),
    facturador_equipo_ids:
      usuario.equipos_facturados?.map((/** @type {{ id: string }} */ item) => item.id) ?? [],
    roles: rolesUsuario(usuario),
    estado: usuario.estado ?? 'activo',
    lider_id: usuario.lider_id ?? '',
    motivo_inhabilitacion: usuario.motivo_inhabilitacion ?? '',
    puede_activar: usuario.puede_activar === true,
  }
}

/**
 * Clears the fields that no longer apply to the selected roles.
 * @param {FormularioUsuario} form
 */
export function ajustarRoles(form) {
  if (!esRol(form, 'activador'))
    Object.assign(form, { equipo_id: '', plaza_id: '', lider_id: '', plaza: '' })
  if (!esRol(form, 'lider')) Object.assign(form, { equipo_ids: [], puede_activar: false })
  if (!esRol(form, 'facturador')) form.facturador_equipo_ids = []
}

/**
 * @param {FormularioUsuario} form
 * @param {{ esNuevo: boolean }} opciones
 * @returns {string | null}
 */
export function validarFormulario(form, { esNuevo }) {
  if (!form.roles?.length || form.roles.some((rol) => !ROLES.includes(rol)))
    return 'Selecciona al menos un rol valido.'
  if (!form.nombre?.trim() || !normalizeEmail(form.email) || (esNuevo && !form.password))
    return 'Completa todos los campos obligatorios.'
  if (!isValidEmail(form.email)) return 'Ingresa un correo valido.'
  if (esNuevo) {
    const errorContrasena = validarContrasena(form.password)
    if (errorContrasena) return errorContrasena
  }
  if (form.estado === 'inhabilitado' && !form.motivo_inhabilitacion?.trim())
    return 'Ingresa el motivo de inhabilitacion.'
  return null
}

/**
 * @param {FormularioUsuario} form
 * @param {{ organizacionDisponible: boolean, esNuevo: boolean }} opciones
 */
export function payloadUsuario(form, { organizacionDisponible, esNuevo }) {
  /** @type {Record<string, unknown>} */
  const payload = {
    email: normalizeEmail(form.email),
    nombre: form.nombre.trim(),
    plaza: form.plaza?.trim() ?? '',
    roles: [...form.roles],
    estado: form.estado,
    lider_id: !organizacionDisponible && esRol(form, 'activador') ? form.lider_id || null : null,
    puede_activar: esRol(form, 'lider') && form.puede_activar === true,
    motivo_inhabilitacion:
      form.estado === 'inhabilitado' ? form.motivo_inhabilitacion.trim() : null,
  }
  if (esNuevo) payload.password = form.password
  if (organizacionDisponible && esRol(form, 'activador')) payload.equipo_id = form.equipo_id
  if (organizacionDisponible && esRol(form, 'lider')) payload.equipo_ids = form.equipo_ids ?? []
  if (organizacionDisponible && esRol(form, 'facturador'))
    payload.facturador_equipo_ids = form.facturador_equipo_ids ?? []
  return payload
}

/**
 * @param {any} usuario
 * @returns {string}
 */
export function equiposDelUsuario(usuario) {
  const esLider = esRol(usuario, 'lider')
  const facturados = esRol(usuario, 'facturador') ? (usuario.equipos_facturados ?? []) : []
  if (!esLider && !facturados.length)
    return usuario.equipo_numero ? `#${usuario.equipo_numero}` : 'Sin equipo'
  /** @type {{ id: string, numero: number | string }[]} */
  const equipos = []
  /** @param {{ id?: string, numero: number | string }} equipo */
  const agregar = (equipo) => {
    if (equipo?.id && !equipos.some((item) => item.id === equipo.id))
      equipos.push({ id: equipo.id, numero: equipo.numero })
  }
  if (esLider) (usuario.equipos_asignados ?? []).forEach(agregar)
  facturados.forEach(agregar)
  if (!esLider && usuario.equipo_numero)
    agregar({ id: usuario.equipo_id, numero: usuario.equipo_numero })
  return equipos.length ? equipos.map((e) => `#${e.numero}`).join(', ') : 'Sin equipo'
}
