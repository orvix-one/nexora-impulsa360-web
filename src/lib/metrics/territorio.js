// @ts-check
// Territory filter keys: a whole departamento (`dep:<INE 2 digits>`), a client plaza (`pla:<name>`),
// one municipio (`mun:<id>`) or `none` for activations without GPS. Choosing a group is one key, never its municipios.

/** @typedef {import('./identidad.js').Contexto} Contexto */
/** @typedef {import('./tipos.js').Opcion} Opcion */

export const SIN_MUNICIPIO = 'Sin municipio (sin GPS)'

/** @param {unknown} municipioId @param {Contexto} ctx */
export function clavesMunicipio(municipioId, ctx) {
  const id = Number(municipioId)
  if (!Number.isInteger(id) || id <= 0) return { municipio: 'none', departamento: '', plaza: '' }
  const catalogado = ctx.municipios.get(id)
  return {
    municipio: `mun:${id}`,
    departamento: catalogado?.codigo_ine ? `dep:${catalogado.codigo_ine.slice(0, 2)}` : '',
    plaza: catalogado?.plaza ? `pla:${catalogado.plaza}` : '',
  }
}

/** @param {string[]} seleccion @param {ReturnType<typeof clavesMunicipio>} claves */
export function enSeleccion(seleccion, claves) {
  return seleccion.some((k) => k === claves.municipio || (k && (k === claves.departamento || k === claves.plaza)))
}

/** @param {string} key */
export function nivelTerritorio(key) {
  if (key.startsWith('dep:')) return 'departamento'
  if (key.startsWith('pla:')) return 'plaza'
  return 'municipio'
}

/** Departamentos and plazas of the whole catalog, so a map click on any polygon is a valid key. @param {Contexto} ctx @returns {Opcion[]} */
export function gruposTerritorio(ctx) {
  /** @type {Map<string, Opcion>} */
  const grupos = new Map()
  for (const municipio of ctx.municipios.values()) {
    const claves = clavesMunicipio(municipio.id, ctx)
    if (claves.departamento && municipio.departamento && !grupos.has(claves.departamento)) {
      grupos.set(claves.departamento, { key: claves.departamento, nombre: municipio.departamento, nivel: 'departamento' })
    }
    if (claves.plaza && municipio.plaza && !grupos.has(claves.plaza)) {
      grupos.set(claves.plaza, { key: claves.plaza, nombre: `Plaza ${municipio.plaza}`, nivel: 'plaza' })
    }
  }
  return [...grupos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** @param {string} municipioKey `mun:<id>` or `none` @param {string[]} seleccion @param {Contexto} ctx */
export function municipioEnSeleccion(municipioKey, seleccion, ctx) {
  return enSeleccion(seleccion, clavesMunicipio(municipioKey.startsWith('mun:') ? municipioKey.slice(4) : null, ctx))
}
