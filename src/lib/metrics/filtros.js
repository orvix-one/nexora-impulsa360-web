// @ts-check
// Metrics filters: definitions, URL round-trip, scope (global vs per tab) and option catalogs.

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
  territorioEtiqueta,
  territorioKey,
  TIPOS_FUNCIONALES,
  tipoKey,
} from './identidad.js'
import { clavesMunicipio, enSeleccion, gruposTerritorio, SIN_MUNICIPIO } from './territorio.js'

export { SIN_MUNICIPIO }

/** @typedef {import('./tipos.js').Filtros} Filtros */
/** @typedef {import('./tipos.js').Opcion} Opcion */
/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./tipos.js').Hoy} Hoy */
/** @typedef {import('./identidad.js').Contexto} Contexto */

export const PERIODOS = [
  { value: 'hoy', label: 'Hoy', dias: 1 },
  { value: '7d', label: 'Últimos 7 días', dias: 7 },
  { value: '15d', label: 'Últimos 15 días', dias: 15 },
  { value: 'mes', label: 'Este mes', dias: 0 },
]

/**
 * @typedef {object} DefinicionFiltro
 * @property {keyof Filtros} key State key.
 * @property {string} param URL query parameter.
 * @property {string} label
 * @property {'periodo' | 'fecha' | 'seleccion'} tipo
 * @property {'global' | 'resumen' | 'campo'} ambito Global filters apply to every tab; the rest only to their tab.
 * @property {'territorios' | 'zonas' | 'activadores' | 'equipos' | 'lideres' | 'tipos'} [opciones] Option list of a select.
 * @property {boolean} [multiple] Value is a list of keys; an empty list means no filter.
 * @property {string} [vacio] Label of the "no filter" option.
 */

/** @type {DefinicionFiltro[]} */
export const FILTROS = [
  { key: 'periodo', param: 'periodo', label: 'Período', tipo: 'periodo', ambito: 'global' },
  { key: 'desde', param: 'desde', label: 'Desde', tipo: 'fecha', ambito: 'global' },
  { key: 'hasta', param: 'hasta', label: 'Hasta', tipo: 'fecha', ambito: 'global' },
  { key: 'territorio', param: 'municipio', label: 'Territorio', tipo: 'seleccion', ambito: 'global', opciones: 'territorios', multiple: true, vacio: 'Todo el país' },
  { key: 'activador', param: 'activador', label: 'Activadores', tipo: 'seleccion', ambito: 'global', opciones: 'activadores', multiple: true, vacio: 'Todos' },
  { key: 'equipo', param: 'equipo', label: 'Equipo', tipo: 'seleccion', ambito: 'global', opciones: 'equipos', vacio: 'Todos' },
  { key: 'lider', param: 'lider', label: 'Líder de registro', tipo: 'seleccion', ambito: 'global', opciones: 'lideres', vacio: 'Todos' },
  { key: 'tipo', param: 'tipo', label: 'Tipo de activación', tipo: 'seleccion', ambito: 'resumen', opciones: 'tipos', vacio: 'Todos' },
  { key: 'zona', param: 'zona', label: 'Barrio / zona', tipo: 'seleccion', ambito: 'campo', opciones: 'zonas', vacio: 'Todos' },
]

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_VALOR = 200
const MAX_SELECCION = 400

/** @param {string | string[]} valor */
export const tieneValor = (valor) => (Array.isArray(valor) ? valor.length > 0 : Boolean(valor))

/** @param {unknown} raw */
const limpiar = (raw) => (typeof raw === 'string' ? raw.trim().slice(0, MAX_VALOR) : '')

/** @returns {Filtros} */
export function filtrosVacios() {
  return { periodo: '', desde: '', hasta: '', territorio: [], activador: [], equipo: '', lider: '', tipo: '', zona: '' }
}

/** @param {Filtros} filtros @param {DefinicionFiltro['ambito']} [ambito] */
export function hayFiltros(filtros, ambito) {
  return FILTROS.some(({ key, ambito: propio }) => (!ambito || propio === ambito) && tieneValor(filtros[key]))
}

/** @param {Filtros} filtros @param {DefinicionFiltro['ambito']} ambito */
export function limpiarAmbito(filtros, ambito) {
  const vacios = filtrosVacios()
  for (const { key, ambito: propio } of FILTROS) if (propio === ambito) Object.assign(filtros, { [key]: vacios[key] })
}

/** @param {Record<string, unknown>} query vue-router `route.query`. @returns {Filtros} */
export function filtrosDesdeQuery(query) {
  /** @type {Record<string, string | string[]>} */
  const filtros = filtrosVacios()
  for (const { key, param, tipo, multiple } of FILTROS) {
    const raw = query[param]
    if (multiple) {
      const valores = (Array.isArray(raw) ? raw : [raw]).map(limpiar).filter(Boolean)
      filtros[key] = [...new Set(valores)].slice(0, MAX_SELECCION)
      continue
    }
    const valor = limpiar(Array.isArray(raw) ? raw[0] : raw)
    if (tipo === 'fecha') filtros[key] = FECHA_ISO.test(valor) ? valor : ''
    else if (tipo === 'periodo') filtros[key] = PERIODOS.some((p) => p.value === valor) ? valor : ''
    else filtros[key] = valor
  }
  if (filtros.periodo) Object.assign(filtros, { desde: '', hasta: '' })
  return /** @type {Filtros} */ (filtros)
}

/** @param {Filtros} filtros @returns {Record<string, string | string[]>} */
export function filtrosAQuery(filtros) {
  /** @type {Record<string, string | string[]>} */
  const query = {}
  for (const { key, param } of FILTROS) if (tieneValor(filtros[key])) query[param] = filtros[key]
  return query
}

/** @param {string} fecha YYYY-MM-DD @param {number} dias */
function restarDias(fecha, dias) {
  const date = new Date(`${fecha}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - dias)
  return date.toISOString().slice(0, 10)
}

/** A preset is relative to today, so a shared link keeps meaning "last 7 days". @param {Filtros} filtros @param {Hoy} hoy */
export function resolverPeriodo(filtros, hoy) {
  const preset = PERIODOS.find((p) => p.value === filtros.periodo)
  if (!preset) return { desde: filtros.desde, hasta: filtros.hasta }
  if (preset.value === 'mes') return { desde: `${hoy.monthKey}-01`, hasta: hoy.todayKey }
  return { desde: restarDias(hoy.todayKey, preset.dias - 1), hasta: hoy.todayKey }
}

/**
 * Filters that actually apply: the period resolved to dates and, given a tab, other tabs' filters dropped.
 * @param {Filtros} filtros @param {Hoy} hoy @param {string} [tab] @returns {Filtros}
 */
export function filtrosEfectivos(filtros, hoy, tab) {
  const vacios = filtrosVacios()
  /** @type {Filtros} */
  const efectivos = { ...filtros, ...resolverPeriodo(filtros, hoy), periodo: '' }
  for (const { key, ambito } of FILTROS) {
    if (tab && ambito !== 'global' && ambito !== tab) Object.assign(efectivos, { [key]: vacios[key] })
  }
  return efectivos
}

/** @param {Filtros} filtros @param {ReturnType<typeof construirOpciones>} opciones @returns {Filtros} */
export function sanearFiltros(filtros, opciones) {
  /** @type {Record<string, string | string[]>} */
  const saneados = { ...filtros }
  for (const { key, opciones: lista } of FILTROS) {
    const valor = saneados[key]
    if (!lista || !tieneValor(valor)) continue
    const validas = new Set(opciones[lista].map((opcion) => opcion.key))
    saneados[key] = Array.isArray(valor) ? valor.filter((v) => validas.has(v)) : validas.has(valor) ? valor : ''
  }
  return /** @type {Filtros} */ (saneados)
}

/** @param {Activacion} item */
export function zonaKey(item) {
  const clave = normalizarPlazaClave(item.zona_activacion)
  return clave ? `${territorioKey(item)}|${clave}` : ''
}

/** @param {Activacion} item @param {Contexto} ctx */
export function claveFiltrable(item, ctx) {
  return {
    territorio: territorioKey(item),
    territorioGrupos: clavesMunicipio(item.municipio_id, ctx),
    zona: zonaKey(item),
    activador: activadorKey(item),
    tipo: tipoKey(item),
    lider: liderKey(item, ctx),
    equipo: equipoKey(item, ctx),
  }
}

/**
 * @param {string} fecha Registration day.
 * @param {ReturnType<typeof claveFiltrable>} claves
 * @param {Filtros} filtros Effective filters (see `filtrosEfectivos`).
 */
export function coincideFiltros(fecha, claves, filtros) {
  if (filtros.desde && (!fecha || fecha < filtros.desde)) return false
  if (filtros.hasta && (!fecha || fecha > filtros.hasta)) return false
  if (filtros.territorio.length && !enSeleccion(filtros.territorio, claves.territorioGrupos)) return false
  if (filtros.zona && claves.zona !== filtros.zona) return false
  if (filtros.activador.length && !filtros.activador.includes(claves.activador)) return false
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
      if (filtros.activador.length && !filtros.activador.includes(activadorKey(usuario))) return false
      if (filtros.lider && liderKey(usuario, ctx) !== filtros.lider) return false
      return true
    },
  )
}

/** @param {Contexto} ctx */
export function construirOpciones(ctx) {
  /** @type {Map<string, Opcion>} */ const territorios = new Map()
  /** @type {Map<string, Opcion>} */ const zonas = new Map()
  /** @type {Map<string, Opcion>} */ const activadores = new Map()
  /** @type {Map<string, Opcion>} */ const tipos = new Map()
  /** @type {Map<string, Opcion>} */ const lideres = new Map()
  /** @type {Map<string, Opcion>} */ const equipos = new Map()
  for (const item of ctx.activaciones) {
    const territorio = territorioKey(item)
    if (!territorios.has(territorio)) territorios.set(territorio, opcionTerritorio(item, ctx))
    const zona = zonaKey(item)
    if (zona && !zonas.has(zona)) zonas.set(zona, { key: zona, nombre: texto(item.zona_activacion), ciudad: territorio })
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
    territorios: [...ordenar(territorios.values()), ...gruposTerritorio(ctx)],
    zonas: ordenar(zonas.values()),
    activadores: ordenar(activadores.values()),
    tipos: ordenar(tipos.values()),
    lideres: ordenar(lideres.values()),
    equipos: ordenarEquipos(equipos.values()),
  }
}

/** @param {Activacion} item @param {Contexto} ctx @returns {Opcion} */
export function opcionTerritorio(item, ctx) {
  const key = territorioKey(item)
  const municipio = ctx.municipios.get(Number(item.municipio_id))
  if (!municipio) return { key, nombre: key === 'none' ? SIN_MUNICIPIO : territorioEtiqueta(item, ctx), departamento: null, plaza: null, nivel: 'municipio' }
  const claves = clavesMunicipio(item.municipio_id, ctx)
  return {
    key,
    nombre: municipio.nombre,
    departamento: municipio.departamento,
    plaza: municipio.plaza,
    nivel: 'municipio',
    grupos: [claves.departamento, claves.plaza].filter(Boolean),
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
