// @ts-check
import { isValidEmail, normalizeEmail } from './textUtils.js'

export const ROLES = ['activador', 'lider', 'facturador', 'administrador', 'banco']
const ROLES_GLOBALES = ['administrador', 'banco']
const ROLES_POR_EQUIPO = ['lider', 'activador', 'facturador']
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
    equipos_activador: /** @type {string[]} */ ([]),
    equipo_ids: /** @type {string[]} */ ([]),
    facturador_equipo_ids: /** @type {string[]} */ ([]),
    roles: ['activador'],
    lider_id: '',
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
    equipos_activador: Array.isArray(usuario.equipos)
      ? usuario.equipos
          .filter((/** @type {{ roles: string[] }} */ item) => item.roles.includes('activador'))
          .map((/** @type {{ id: string }} */ item) => item.id)
      : usuario.equipo_id
        ? [usuario.equipo_id]
        : [],
    equipo_ids: equipos
      .filter((item) => item.lider_actual_id === usuario.usuario_id)
      .map((item) => item.id),
    facturador_equipo_ids:
      usuario.equipos_facturados?.map((/** @type {{ id: string }} */ item) => item.id) ?? [],
    roles: rolesUsuario(usuario),
    lider_id: usuario.lider_id ?? '',
  }
}

/**
 * Clears the fields that no longer apply to the selected roles.
 * @param {FormularioUsuario} form
 */
export function ajustarRoles(form) {
  if (!esRol(form, 'activador'))
    Object.assign(form, { equipo_id: '', equipos_activador: [], plaza_id: '', lider_id: '', plaza: '' })
  if (!esRol(form, 'lider')) form.equipo_ids = []
  if (!esRol(form, 'facturador')) form.facturador_equipo_ids = []
}

/**
 * A leader activates by default: ticking Líder also ticks Activador.
 * @param {FormularioUsuario} form
 */
export function marcarLider(form) {
  if (esRol(form, 'lider') && !esRol(form, 'activador')) form.roles.push('activador')
}

/**
 * Newly led teams become teams the leader activates in, when they are an activador.
 * @param {FormularioUsuario} form
 * @param {string[]} agregados
 */
export function sumarEquiposLiderados(form, agregados) {
  if (!esRol(form, 'activador')) return
  form.equipos_activador = [...new Set([...form.equipos_activador, ...agregados])]
  fijarPrincipal(form)
}

/**
 * The principal team is always one of the teams the activador works in.
 * @param {FormularioUsuario} form
 */
export function fijarPrincipal(form) {
  if (!form.equipos_activador.includes(form.equipo_id)) form.equipo_id = form.equipos_activador[0] ?? ''
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
    lider_id: !organizacionDisponible && esRol(form, 'activador') ? form.lider_id || null : null,
  }
  if (esNuevo) payload.password = form.password
  if (organizacionDisponible && esRol(form, 'activador')) {
    payload.equipo_id = form.equipo_id
    payload.equipos_activador = [...form.equipos_activador]
  }
  if (organizacionDisponible && esRol(form, 'lider')) payload.equipo_ids = form.equipo_ids ?? []
  if (organizacionDisponible && esRol(form, 'facturador'))
    payload.facturador_equipo_ids = form.facturador_equipo_ids ?? []
  return payload
}

/**
 * @typedef {{ id: string, numero: number | string, plaza?: string | null, lider_nombre?: string | null, principal?: boolean, roles: string[] }} EquipoDeUsuario
 * @typedef {{ rol: string, equipos: EquipoDeUsuario[] | null }} RolConEquipos
 */

/**
 * Global roles first (no teams), then each team role with the teams where the user holds it.
 * @param {any} usuario
 * @returns {RolConEquipos[]}
 */
export function rolesConEquipos(usuario) {
  const roles = rolesUsuario(usuario)
  /** @type {EquipoDeUsuario[]} */
  const equipos = Array.isArray(usuario.equipos)
    ? usuario.equipos
    : usuario.equipo_numero
      ? [{ id: usuario.equipo_id, numero: usuario.equipo_numero, principal: true, roles: ['activador'] }]
      : []
  return [
    ...ROLES_GLOBALES.filter((rol) => roles.includes(rol)).map((rol) => ({ rol, equipos: null })),
    ...ROLES_POR_EQUIPO.filter((rol) => roles.includes(rol)).map((rol) => ({
      rol,
      equipos: equipos.filter((equipo) => equipo.roles.includes(rol)),
    })),
  ]
}

/**
 * @param {any} usuario
 * @param {string} equipoId
 */
export function participaEnEquipo(usuario, equipoId) {
  return rolesConEquipos(usuario).some((item) => item.equipos?.some((equipo) => equipo.id === equipoId))
}
