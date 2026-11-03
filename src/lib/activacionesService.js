import { apiRequest } from './api'

export async function fetchMetricasActivaciones() {
  const payload = await apiRequest('/portal/metrics/activations')
  return payload.activations ?? []
}

const CLAVES_FILTRO = ['plaza', 'distrito', 'impulsador', 'fechaDesde', 'fechaHasta']

function filtrosAQuery(filtros = {}) {
  const params = new URLSearchParams()
  for (const clave of CLAVES_FILTRO) if (filtros[clave]) params.set(clave, filtros[clave])
  return params
}

export async function fetchActivacionesPagina({ page = 1, pageSize = 50, filtros } = {}) {
  const params = filtrosAQuery(filtros)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  const payload = await apiRequest(`/portal/activations/page?${params}`)
  return { activations: payload.activations ?? [], total: payload.total ?? 0 }
}

export async function fetchActivacionDetalle(id) {
  const payload = await apiRequest(`/portal/activations/${encodeURIComponent(id)}`)
  return payload.activation
}

export async function fetchActivacionesExportacion(filtros) {
  const payload = await apiRequest(`/portal/activations/export-rows?${filtrosAQuery(filtros)}`)
  return payload.activations ?? []
}

export function fetchExcelExport(filtros) {
  const params = filtrosAQuery(filtros)
  params.set('exportVersion', 'links-v2')
  return apiRequest(`/portal/activations/export-excel?${params}`, { raw: true, cache: 'no-store' })
}
