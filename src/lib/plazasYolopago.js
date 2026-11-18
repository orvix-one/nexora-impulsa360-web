// @ts-check

/**
 * @typedef {{ id: string, nombre: string, activa: boolean }} Plaza
 * @typedef {{ plaza_id: string, municipio_id: number }} Vinculo
 * @typedef {{ id: number, nombre: string, departamento?: string | null }} Municipio
 */

/**
 * A plaza grouping one municipio is municipal; grouping several, departmental.
 * @param {Plaza[]} plazas @param {Vinculo[]} vinculos @param {Municipio[]} municipios
 */
export function filasPlazas(plazas, vinculos, municipios) {
  const municipioPorId = new Map(municipios.map((m) => [m.id, m]))
  return plazas
    .map((plaza) => {
      const propios = vinculos.filter((v) => v.plaza_id === plaza.id).map((v) => municipioPorId.get(v.municipio_id)).filter(Boolean)
      const departamentos = [...new Set(propios.map((m) => m?.departamento).filter(Boolean))]
      const tipo = propios.length === 0 ? 'Sin municipios' : propios.length === 1 ? 'Municipio' : `Departamento · ${propios.length} municipios`
      return { ...plaza, tipo, municipios: propios.length, departamento: departamentos.join(', ') }
    })
    .sort((a, b) => (a.departamento || '￿').localeCompare(b.departamento || '￿', 'es') || b.municipios - a.municipios || a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Municipios still grouped in a departmental plaza: the only ones that can become a plaza.
 * @param {ReturnType<typeof filasPlazas>} filas @param {Vinculo[]} vinculos @param {Municipio[]} municipios
 */
export function municipiosConvertibles(filas, vinculos, municipios) {
  const filaPorPlaza = new Map(filas.map((f) => [f.id, f]))
  const plazaPorMunicipio = new Map(vinculos.map((v) => [v.municipio_id, filaPorPlaza.get(v.plaza_id)]))
  return municipios
    .filter((m) => (plazaPorMunicipio.get(m.id)?.municipios ?? 0) > 1)
    .map((m) => {
      const plaza = plazaPorMunicipio.get(m.id)?.nombre ?? ''
      return { id: m.id, nombre: m.nombre, plaza, detalle: [m.departamento && `Depto. ${m.departamento}`, `plaza actual: ${plaza}`].filter(Boolean).join(' · ') }
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
