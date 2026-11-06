// @ts-check
// Identity rules: ciudad = ciudad_activacion only (organizational plaza is team attribution, not geography);
// leader = snapshot lider_id_registro, else the creator's current leader, else none (never by name);
// activator = usuario_id only; team = equipo_id_registro, else an unambiguous numero, else numero, else name.

import {
  ciudadActivacion,
  etiquetaCiudadActivacion,
  normalizarPlazaClave,
  SIN_CIUDAD_REGISTRADA,
} from '../plazas.js'
import { normalizado, texto } from './formato.js'

/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./tipos.js').Usuario} Usuario */

/**
 * Only types with a technical value confirmed in code. Others appear as historical when present in data.
 * The category (Comercio/Barrio/…) is not a stored field: it is derived by `clasificacionRegistro`.
 */
export const TIPOS_FUNCIONALES = [
  { tecnico: 'reimpresion_qr', nombre: 'Reimpresión QR' },
  { tecnico: 'cliente_antiguo', nombre: 'Cliente antiguo' },
]

/**
 * @typedef {object} Contexto
 * @property {Activacion[]} activaciones
 * @property {Map<string, Usuario>} usuariosPorId
 * @property {Usuario[]} catalogoActivadores Includes disabled profiles: they keep historical activations.
 * @property {Map<string, { nombre: string, estado: string }>} catalogoLideres
 * @property {Map<string, string>} liderCatalogo leader id -> name, from the users catalog.
 * @property {Map<string, string>} activadorCatalogo activator id -> name, from the activations.
 * @property {{ porId: Map<string, { numero: string, nombre: string }>, numeroAId: Map<string, string> }} equipoCatalogo
 * @property {{ nombre?: string }[]} plazas
 */

/** @param {Usuario | undefined} usuario */
export function rolesCatalogo(usuario) {
  if (Array.isArray(usuario?.roles))
    return usuario.roles.map((rol) =>
      String(rol ?? '')
        .trim()
        .toLowerCase(),
    )
  return [
    String(usuario?.rol ?? '')
      .trim()
      .toLowerCase(),
  ]
}

/** @param {{ activaciones: Activacion[], usuarios: Usuario[], plazas: { nombre?: string }[] }} datos @returns {Contexto} */
export function crearContexto({ activaciones, usuarios, plazas }) {
  const usuariosPorId = new Map(
    usuarios.map((usuario) => [texto(usuario.usuario_id).toLowerCase(), usuario]),
  )

  const catalogoActivadores = [...usuariosPorId.values()].filter(
    (usuario) => Boolean(texto(usuario.usuario_id)) && rolesCatalogo(usuario).includes('activador'),
  )

  const catalogoLideres = new Map()
  for (const usuario of usuarios) {
    if (!rolesCatalogo(usuario).includes('lider')) continue
    const id = texto(usuario.usuario_id).toLowerCase()
    if (!id || catalogoLideres.has(id)) continue
    catalogoLideres.set(id, {
      nombre: texto(usuario.nombre),
      estado: texto(usuario.estado) || 'activo',
    })
  }

  const liderCatalogo = new Map()
  for (const usuario of usuarios) {
    const id = texto(usuario.lider_id).toLowerCase()
    if (!id || liderCatalogo.has(id)) continue
    const nombre = texto(usuario.lider_nombre)
    if (nombre) liderCatalogo.set(id, nombre)
  }

  const activadorCatalogo = new Map()
  for (const item of activaciones) {
    const id = texto(item.usuario_id).toLowerCase()
    if (!id || activadorCatalogo.has(id)) continue
    const nombre = texto(item.impulsador)
    if (nombre) activadorCatalogo.set(id, nombre)
  }

  return {
    activaciones,
    usuariosPorId,
    catalogoActivadores,
    catalogoLideres,
    liderCatalogo,
    activadorCatalogo,
    equipoCatalogo: catalogarEquipos(activaciones),
    plazas,
  }
}

/** @param {Activacion[]} activaciones */
function catalogarEquipos(activaciones) {
  const porId = new Map()
  const idsPorNumero = new Map()
  for (const item of activaciones) {
    const id = equipoIdTexto(item)
    if (!id) continue
    const numero = equipoNumeroTexto(item)
    const nombre = texto(item.equipo_nombre_registro)
    let entry = porId.get(id)
    if (!entry) {
      entry = { numero: '', nombre: '' }
      porId.set(id, entry)
    }
    if (!entry.numero && numero) entry.numero = numero
    if (!entry.nombre && nombre) entry.nombre = nombre
    if (numero) {
      let ids = idsPorNumero.get(numero)
      if (!ids) {
        ids = new Set()
        idsPorNumero.set(numero, ids)
      }
      ids.add(id)
    }
  }
  const numeroAId = new Map()
  for (const [numero, ids] of idsPorNumero) {
    if (ids.size === 1) numeroAId.set(numero, [...ids][0])
  }
  return { porId, numeroAId }
}

/** @param {Usuario | undefined} usuario */
function estadoNormalizado(usuario) {
  return normalizado(usuario?.estado || 'activo')
}

/** @param {Usuario | undefined} usuario @param {string} etiqueta */
export function etiquetaConEstado(usuario, etiqueta) {
  if (estadoNormalizado(usuario) === 'activo') return etiqueta
  return /\(inhabilitado\)$/i.test(etiqueta) ? etiqueta : `${etiqueta} (inhabilitado)`
}

/** @param {Activacion} item */
export function plazaKey(item) {
  const nombre = ciudadActivacion(item)
  return nombre ? `pkey:${normalizarPlazaClave(nombre)}` : 'none'
}

/** @param {Activacion} item */
export function plazaEtiqueta(item) {
  return ciudadActivacion(item) || SIN_CIUDAD_REGISTRADA
}

/** @param {Activacion} item */
export function plazaRegistro(item) {
  return etiquetaCiudadActivacion(item)
}

/** @param {Activacion | Usuario} item @param {Contexto} ctx */
export function liderKey(item, ctx) {
  const registro = texto(/** @type {Activacion} */ (item).lider_id_registro).toLowerCase()
  if (registro) return `lid:${registro}`
  const usuario = ctx.usuariosPorId.get(texto(item.usuario_id).toLowerCase())
  const id = texto(usuario?.lider_id).toLowerCase()
  return id ? `lid:${id}` : 'none'
}

/** @param {Activacion} item @param {string | undefined} key @param {Contexto} ctx */
export function liderEtiqueta(item, key, ctx) {
  const resolvedKey = key ?? liderKey(item, ctx)
  if (!resolvedKey.startsWith('lid:')) return ''
  const id = resolvedKey.slice(4)
  const registroId = texto(item?.lider_id_registro).toLowerCase()
  const nombreRegistro = texto(item?.lider_nombre_registro)
  if (registroId && registroId === id && nombreRegistro) return nombreRegistro
  return (
    ctx.liderCatalogo.get(id) || ctx.catalogoLideres.get(id)?.nombre || `Líder · ${id.slice(0, 8)}`
  )
}

/** @param {Activacion | Usuario} item */
export function activadorKey(item) {
  const id = texto(item.usuario_id).toLowerCase()
  return id ? `uid:${id}` : 'none'
}

/** @param {Activacion} item @param {string | undefined} key @param {Contexto} ctx */
export function activadorEtiqueta(item, key, ctx) {
  const nombre = texto(item.impulsador)
  if (nombre) return nombre
  const resolvedKey = key ?? activadorKey(item)
  if (resolvedKey.startsWith('uid:')) {
    return (
      ctx.activadorCatalogo.get(resolvedKey.slice(4)) || `Activador · ${resolvedKey.slice(4, 12)}`
    )
  }
  return 'Sin activador'
}

/** Only spaces/case are normalized; the label keeps the first-seen text. @param {Activacion} item */
export function tipoKey(item) {
  return normalizado(texto(item.tipo_activacion)) || 'none'
}

/** @param {Activacion} item */
function equipoIdTexto(item) {
  return texto(item.equipo_id_registro).toLowerCase()
}

/** @param {Activacion} item */
function equipoNumeroTexto(item) {
  const raw = item.equipo_numero_registro
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/** @param {Pick<Activacion, 'equipo_id_registro' | 'equipo_numero_registro' | 'equipo_nombre_registro'>} item @param {Contexto} ctx */
export function equipoKey(item, ctx) {
  const id = equipoIdTexto(item)
  if (id) return `id:${id}`
  const numero = equipoNumeroTexto(item)
  if (numero) {
    const unificado = ctx.equipoCatalogo.numeroAId.get(numero)
    return unificado ? `id:${unificado}` : `num:${numero}`
  }
  const nombre = texto(item.equipo_nombre_registro)
  return nombre ? `name:${nombre.toLocaleLowerCase('es')}` : 'none'
}

/** @param {Pick<Activacion, 'equipo_id_registro' | 'equipo_numero_registro' | 'equipo_nombre_registro'>} item @param {string | undefined} key @param {Contexto} ctx */
export function equipoEtiqueta(item, key, ctx) {
  const resolvedKey = key ?? equipoKey(item, ctx)
  const porId = (/** @type {'numero' | 'nombre'} */ campo) =>
    resolvedKey.startsWith('id:')
      ? (ctx.equipoCatalogo.porId.get(resolvedKey.slice(3))?.[campo] ?? '')
      : ''
  const numero =
    equipoNumeroTexto(item) ||
    porId('numero') ||
    (resolvedKey.startsWith('num:') ? resolvedKey.slice(4) : '')
  if (numero) return `Equipo #${numero}`
  const nombre = texto(item.equipo_nombre_registro) || porId('nombre')
  if (nombre) return nombre
  if (resolvedKey.startsWith('id:')) return `Equipo · ${resolvedKey.slice(3, 11)}`
  return 'Sin equipo'
}

/** @param {Activacion} item */
export function comercioRegistro(item) {
  return (
    texto(item.nombre_comercio) ||
    texto(item.comercio) ||
    texto(item.cliente) ||
    texto(item.nombres_cliente)
  )
}

/** Not a stored field: derived from the combined text. @param {Activacion} item */
export function clasificacionRegistro(item) {
  const value = `${normalizado(item.tipo_activacion)} ${normalizado(item.tipo_comercio)} ${normalizado(item.tipo_tienda)}`
  if (value.includes('cliente_antiguo') || value.includes('cliente antiguo'))
    return 'Cliente antiguo'
  if (value.includes('mercado')) return 'Mercado'
  if (value.includes('barrio') || value.includes('tienda')) return 'Barrio'
  if (value.includes('comercio')) return 'Comercio'
  return 'Sin clasificación'
}

const BASES_COMERCIO_NUEVO = ['tienda_barrio', 'comercio']
const TIPOS_COMERCIO_NUEVO = ['comercio', 'limbo']

/** @param {Activacion} item */
export function esComercioNuevo(item) {
  return (
    BASES_COMERCIO_NUEVO.includes(normalizado(item.base_activacion)) &&
    TIPOS_COMERCIO_NUEVO.includes(tipoKey(item))
  )
}
