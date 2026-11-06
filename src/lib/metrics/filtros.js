// @ts-check

import { normalizarPlazaClave } from '../plazas.js'
import { texto } from './formato.js'
import {
  activadorEtiqueta,
  activadorKey,
  equipoEtiqueta,
  equipoKey,
  etiquetaConEstado,
  liderEtiqueta,
  liderKey,
  plazaEtiqueta,
  plazaKey,
  TIPOS_FUNCIONALES,
  tipoKey,
} from './identidad.js'

/** @typedef {import('./tipos.js').Filtros} Filtros */
/** @typedef {import('./tipos.js').Opcion} Opcion */
/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./identidad.js').Contexto} Contexto */

/**
 * @typedef {object} DefinicionFiltro
 * @property {keyof Filtros} key State key.
 * @property {string} param URL query parameter.
 * @property {string} label
 * @property {'fecha' | 'seleccion'} tipo
 * @property {'plazas' | 'activadores' | 'equipos' | 'lideres' | 'tipos'} [opciones] Option list of a select.
 * @property {string} [vacio] Label of the "no filter" option.
 * @property {boolean} [ocultarSinOpciones] Hide the control when its option list is empty.
 */

/** Order is the UI order. @type {DefinicionFiltro[]} */
export const FILTROS = [
  { key: 'desde', param: 'desde', label: 'Fecha desde', tipo: 'fecha' },
  { key: 'hasta', param: 'hasta', label: 'Fecha hasta', tipo: 'fecha' },
  {
    key: 'plaza',
    param: 'ciudad',
    label: 'Ciudad de activación',
    tipo: 'seleccion',
    opciones: 'plazas',
    vacio: 'Todas',
  },
  {
    key: 'activador',
    param: 'activador',
    label: 'Activador',
    tipo: 'seleccion',
    opciones: 'activadores',
    vacio: 'Todos',
  },
  {
    key: 'equipo',
    param: 'equipo',
    label: 'Equipo',
    tipo: 'seleccion',
    opciones: 'equipos',
    vacio: 'Todos',
  },
  {
    key: 'lider',
    param: 'lider',
    label: 'Líder de registro',
    tipo: 'seleccion',
    opciones: 'lideres',
    vacio: 'Todos',
    ocultarSinOpciones: true,
  },
  {
    key: 'tipo',
    param: 'tipo',
    label: 'Tipo de activación',
    tipo: 'seleccion',
    opciones: 'tipos',
    vacio: 'Todos',
  },
]

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_VALOR = 200

/** @returns {Filtros} */
export function filtrosVacios() {
  return { desde: '', hasta: '', plaza: '', activador: '', tipo: '', lider: '', equipo: '' }
}

/** @param {Filtros} filtros */
export function hayFiltros(filtros) {
  return FILTROS.some(({ key }) => Boolean(filtros[key]))
}

/** @param {Record<string, unknown>} query vue-router `route.query`. @returns {Filtros} */
export function filtrosDesdeQuery(query) {
  const filtros = filtrosVacios()
  for (const { key, param, tipo } of FILTROS) {
    const raw = Array.isArray(query[param]) ? query[param][0] : query[param]
    const valor = typeof raw === 'string' ? raw.trim().slice(0, MAX_VALOR) : ''
    filtros[key] = tipo === 'fecha' && !FECHA_ISO.test(valor) ? '' : valor
  }
  return filtros
}

/** @param {Filtros} filtros @returns {Record<string, string>} */
export function filtrosAQuery(filtros) {
  /** @type {Record<string, string>} */
  const query = {}
  for (const { key, param } of FILTROS) if (filtros[key]) query[param] = filtros[key]
  return query
}

/** @param {Filtros} filtros @param {ReturnType<typeof construirOpciones>} opciones @returns {Filtros} */
export function sanearFiltros(filtros, opciones) {
  const saneados = { ...filtros }
  for (const { key, opciones: lista } of FILTROS) {
    if (!lista || !saneados[key]) continue
    if (!opciones[lista].some((opcion) => opcion.key === saneados[key])) saneados[key] = ''
  }
  return saneados
}

/** @param {Activacion} item @param {Contexto} ctx */
export function claveFiltrable(item, ctx) {
  return {
    plaza: plazaKey(item),
    activador: activadorKey(item),
    tipo: tipoKey(item),
    lider: liderKey(item, ctx),
    equipo: equipoKey(item, ctx),
  }
}

/**
 * @param {string} fecha Registration day.
 * @param {ReturnType<typeof claveFiltrable>} claves
 * @param {Filtros} filtros
 */
export function coincideFiltros(fecha, claves, filtros) {
  if (filtros.desde && (!fecha || fecha < filtros.desde)) return false
  if (filtros.hasta && (!fecha || fecha > filtros.hasta)) return false
  if (filtros.plaza && claves.plaza !== filtros.plaza) return false
  if (filtros.activador && claves.activador !== filtros.activador) return false
  if (filtros.tipo && claves.tipo !== filtros.tipo) return false
  if (filtros.lider && claves.lider !== filtros.lider) return false
  if (filtros.equipo && claves.equipo !== filtros.equipo) return false
  return true
}

/** @param {Contexto} ctx @param {Filtros} filtros */
function integrantesEquipo(ctx, filtros) {
  if (!filtros.equipo) return []
  return ctx.catalogoActivadores.filter((usuario) => {
    const equipoId = texto(usuario.equipo_id).toLowerCase()
    if (!equipoId) return false
    if (`id:${equipoId}` !== filtros.equipo) return false
    return !filtros.lider || liderKey(usuario, ctx) === filtros.lider
  })
}

/** @param {Contexto} ctx @param {Filtros} filtros */
export function integrantesRanking(ctx, filtros) {
  return (filtros.equipo ? integrantesEquipo(ctx, filtros) : ctx.catalogoActivadores).filter(
    (usuario) => {
      if (filtros.activador && activadorKey(usuario) !== filtros.activador) return false
      if (filtros.lider && liderKey(usuario, ctx) !== filtros.lider) return false
      return true
    },
  )
}

/** @param {Contexto} ctx */
export function construirOpciones(ctx) {
  /** @type {Map<string, Opcion>} */ const plazas = new Map()
  /** @type {Map<string, Opcion>} */ const activadores = new Map()
  /** @type {Map<string, Opcion>} */ const tipos = new Map()
  /** @type {Map<string, Opcion>} */ const lideres = new Map()
  /** @type {Map<string, Opcion>} */ const equipos = new Map()
  for (const item of ctx.activaciones) {
    const plaza = plazaKey(item)
    if (!plazas.has(plaza)) plazas.set(plaza, { key: plaza, nombre: plazaEtiqueta(item) })
    const activador = activadorKey(item)
    if (!activadores.has(activador))
      activadores.set(activador, {
        key: activador,
        nombre: activadorEtiqueta(item, activador, ctx),
      })
    const tipo = tipoKey(item)
    if (tipo !== 'none' && !tipos.has(tipo))
      tipos.set(tipo, { key: tipo, nombre: texto(item.tipo_activacion) })
    const lider = liderKey(item, ctx)
    if (lider !== 'none' && !lideres.has(lider))
      lideres.set(lider, { key: lider, nombre: liderEtiqueta(item, lider, ctx) })
    const key = equipoKey(item, ctx)
    if (!equipos.has(key)) equipos.set(key, { key, nombre: equipoEtiqueta(item, key, ctx) })
  }
  for (const plaza of ctx.plazas) {
    const nombre = texto(plaza.nombre)
    const clave = normalizarPlazaClave(nombre)
    if (!clave) continue
    const key = `pkey:${clave}`
    if (!plazas.has(key)) plazas.set(key, { key, nombre })
  }
  for (const usuario of ctx.catalogoActivadores) {
    const id = texto(usuario.equipo_id).toLowerCase()
    if (!id) continue
    const key = `id:${id}`
    if (!equipos.has(key)) {
      const sintetico = {
        equipo_id_registro: id,
        equipo_numero_registro: usuario.equipo_numero,
        equipo_nombre_registro: usuario.equipo_nombre,
      }
      equipos.set(key, { key, nombre: equipoEtiqueta(sintetico, key, ctx) })
    }
  }
  for (const usuario of ctx.catalogoActivadores) {
    const key = activadorKey(usuario)
    if (!activadores.has(key)) {
      activadores.set(key, {
        key,
        nombre: etiquetaConEstado(
          usuario,
          texto(usuario.nombre) || activadorEtiqueta(usuario, key, ctx),
        ),
      })
    }
  }
  for (const [key, entry] of activadores) {
    const usuario = ctx.usuariosPorId.get(key.startsWith('uid:') ? key.slice(4) : '')
    if (usuario) entry.nombre = etiquetaConEstado(usuario, entry.nombre)
  }
  for (const funcional of TIPOS_FUNCIONALES) {
    const key = tipoKey({ tipo_activacion: funcional.tecnico })
    if (key === 'none') continue
    const existente = tipos.get(key)
    if (existente) {
      existente.nombre = funcional.nombre
      continue
    }
    tipos.set(key, { key, nombre: funcional.nombre })
  }
  for (const [id, catalogado] of ctx.catalogoLideres) {
    const key = `lid:${id}`
    const existente = lideres.get(key)
    if (existente) {
      if (catalogado.estado !== 'activo' && !/\(inhabilitado\)$/i.test(existente.nombre)) {
        existente.nombre = `${existente.nombre} (inhabilitado)`
      }
      continue
    }
    if (catalogado.estado !== 'activo' || !catalogado.nombre) continue
    lideres.set(key, { key, nombre: catalogado.nombre })
  }
  const ordenar = (/** @type {Iterable<Opcion>} */ entries) =>
    [...entries].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return {
    plazas: ordenar(plazas.values()),
    activadores: ordenar(activadores.values()),
    tipos: ordenar(tipos.values()),
    lideres: ordenar(lideres.values()),
    equipos: ordenarEquipos(equipos.values()),
  }
}

/** @param {Iterable<Opcion>} entries */
function ordenarEquipos(entries) {
  return [...entries].sort((a, b) => {
    const numeroA = a.nombre.match(/^Equipo #(\d+)/)?.[1]
    const numeroB = b.nombre.match(/^Equipo #(\d+)/)?.[1]
    if (numeroA && numeroB) return Number(numeroA) - Number(numeroB)
    if (numeroA) return -1
    if (numeroB) return 1
    if (a.nombre === 'Sin equipo') return 1
    if (b.nombre === 'Sin equipo') return -1
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}
