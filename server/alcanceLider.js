const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(value) {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

export function expresionAlcanceLider(userIds, liderId) {
  if (!esUuid(liderId)) return ''
  const historico = `lider_id_registro.eq.${liderId}`
  const integrantes = [...new Set((userIds ?? []).filter(esUuid))]
  if (!integrantes.length) return historico
  return `${historico},and(lider_id_registro.is.null,usuario_id.in.(${integrantes.join(',')}))`
}

export function aplicarAlcanceLider(query, alcance) {
  if (!alcance) return query
  const expresion = expresionAlcanceLider(alcance.userIds, alcance.liderId)
  if (!expresion) return null
  return query.or(expresion)
}

// Administradores y banco no tienen alcance: devuelve { alcance: null }.
// Integrantes = quienes hoy pertenecen a algun equipo que el lider dirige, mas los que lo tienen como lider_id.
export async function resolverAlcanceLider(adminSupabase, user) {
  const roles = user.roles ?? [user.rol]
  if (user.isAdmin || roles.includes('banco') || !roles.includes('lider')) return { alcance: null, error: null }
  const [porLider, equipos] = await Promise.all([
    adminSupabase.from('activadores').select('usuario_id').eq('lider_id', user.usuario_id),
    adminSupabase.from('equipos').select('id').eq('lider_actual_id', user.usuario_id),
  ])
  const error = porLider.error ?? equipos.error
  if (error) return { alcance: null, error }
  const equipoIds = (equipos.data ?? []).map((item) => item.id)
  const membresias = equipoIds.length
    ? await adminSupabase.from('activador_equipo_historial').select('activador_id').in('equipo_id', equipoIds).is('fin', null)
    : { data: [], error: null }
  if (membresias.error) return { alcance: null, error: membresias.error }
  const userIds = [...new Set([
    ...(porLider.data ?? []).map((item) => item.usuario_id),
    ...(membresias.data ?? []).map((item) => item.activador_id),
  ])]
  return { alcance: { userIds, liderId: user.usuario_id }, error: null }
}
