import { aplicarAlcanceLider } from './alcanceLider.js'
import { etiquetaCiudadActivacion, normalizarPlazaClave } from '../src/lib/plazas.js'

const PAGE_SIZE = 1000

function applyFilters(query, filters) {
  if (filters.fechaDesde) query = query.gte('fecha_activacion', filters.fechaDesde)
  if (filters.fechaHasta) query = query.lte('fecha_activacion', filters.fechaHasta)
  return query
}

function matchesTextFilters(row, filters) {
  const includes = (value, search) =>
    !search ||
    String(value ?? '')
      .toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es'))
  const mismaCiudad = (value, search) => !search || normalizarPlazaClave(value).includes(normalizarPlazaClave(search))
  return (
    includes(row.impulsador, filters.impulsador) &&
    includes(row.zona_activacion, filters.distrito) &&
    mismaCiudad(etiquetaCiudadActivacion(row), filters.plaza)
  )
}

export async function fetchActivaciones(adminSupabase, filters, alcance) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = adminSupabase.from('activaciones').select('*').order('created_at', { ascending: false })
    query = applyFilters(query, filters)
    if (alcance) {
      const acotado = aplicarAlcanceLider(query, alcance)
      if (!acotado) return rows
      query = acotado
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = data ?? []
    rows.push(...page.filter((row) => matchesTextFilters(row, filters)))
    if (page.length < PAGE_SIZE) return rows
  }
}
