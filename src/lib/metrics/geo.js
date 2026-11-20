// @ts-check
// Polygon layers of the Campo map: static GeoJSON in public/geo keyed by INE code, joined to the municipios catalog.

import { clavesMunicipio, enSeleccion } from './territorio.js'

/** @typedef {import('./tipos.js').Activacion} Activacion */
/** @typedef {import('./identidad.js').Contexto} Contexto */
/** @typedef {'departamento' | 'municipio'} NivelGeo */

/** @type {Record<NivelGeo, string>} */
const ARCHIVOS = { departamento: '/geo/departamentos.geojson', municipio: '/geo/municipios.geojson' }
/** @type {Map<NivelGeo, Promise<any>>} */
const cache = new Map()

/** @param {NivelGeo} nivel @param {typeof fetch} [obtener] */
export function cargarGeometria(nivel, obtener = fetch) {
  if (!cache.has(nivel)) {
    const promesa = obtener(ARCHIVOS[nivel]).then((respuesta) => {
      if (!respuesta.ok) throw new Error(`No se pudo cargar ${ARCHIVOS[nivel]}`)
      return respuesta.json()
    })
    promesa.catch(() => cache.delete(nivel))
    cache.set(nivel, promesa)
  }
  return /** @type {Promise<any>} */ (cache.get(nivel))
}

/** @param {{ codigo_ine?: string, departamento_ine?: string }} propiedades @param {NivelGeo} nivel */
export function codigoPoligono(propiedades, nivel) {
  return (nivel === 'departamento' ? propiedades.departamento_ine : propiedades.codigo_ine) ?? ''
}

/** @param {Contexto} ctx @param {unknown} municipioId @param {NivelGeo} nivel */
function codigoDe(ctx, municipioId, nivel) {
  const codigo = ctx.municipios.get(Number(municipioId))?.codigo_ine
  if (!codigo) return ''
  return nivel === 'departamento' ? codigo.slice(0, 2) : codigo
}

/**
 * Activations per polygon; rows without a located municipio are counted apart.
 * @param {Activacion[]} filas @param {Contexto} ctx @param {NivelGeo} nivel
 */
export function conteoPorPoligono(filas, ctx, nivel) {
  /** @type {Map<string, number>} */
  const conteo = new Map()
  let sinUbicar = 0
  for (const fila of filas) {
    const codigo = codigoDe(ctx, fila.municipio_id, nivel)
    if (!codigo) sinUbicar += 1
    else conteo.set(codigo, (conteo.get(codigo) ?? 0) + 1)
  }
  return { conteo, sinUbicar }
}

/** Polygon code -> display name and the territory filter key a click toggles. @param {Contexto} ctx @param {NivelGeo} nivel */
export function indicePoligonos(ctx, nivel) {
  /** @type {Map<string, { nombre: string, key: string }>} */
  const indice = new Map()
  for (const municipio of ctx.municipios.values()) {
    if (nivel === 'municipio') {
      indice.set(municipio.codigo_ine, { nombre: municipio.nombre, key: `mun:${municipio.id}` })
      continue
    }
    const codigo = municipio.codigo_ine.slice(0, 2)
    if (!indice.has(codigo)) indice.set(codigo, { nombre: municipio.departamento ?? codigo, key: `dep:${codigo}` })
  }
  return indice
}

/** Polygons drawn as chosen: their own key, or a departamento or plaza that contains them. @param {string[]} seleccion @param {Contexto} ctx @param {NivelGeo} nivel */
export function codigosElegidos(seleccion, ctx, nivel) {
  const codigos = new Set()
  if (!seleccion.length) return codigos
  for (const municipio of ctx.municipios.values()) {
    if (nivel === 'departamento') {
      if (seleccion.includes(`dep:${municipio.codigo_ine.slice(0, 2)}`)) codigos.add(municipio.codigo_ine.slice(0, 2))
    } else if (enSeleccion(seleccion, clavesMunicipio(municipio.id, ctx))) {
      codigos.add(municipio.codigo_ine)
    }
  }
  return codigos
}
