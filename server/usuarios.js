// @ts-check
// User lifecycle: disabled users keep their login but banned; only users without history can be deleted.

/** Columns that make a profile part of the record. Its own team-membership rows are not history. */
export const REFERENCIAS_HISTORIAL = Object.freeze([
  ['activaciones', 'usuario_id'],
  ['activaciones', 'lider_id_registro'],
  ['activador_equipo_historial', 'autorizado_por'],
  ['equipo_lider_historial', 'lider_id'],
  ['equipo_lider_historial', 'autorizado_por'],
  ['equipos', 'lider_actual_id'],
  ['activadores', 'lider_id'],
  ['viajes', 'activador_id'],
  ['viajes', 'creado_por'],
  ['eventos', 'creado_por'],
  ['evento_activadores', 'activador_id'],
  ['evento_activadores', 'agregado_por'],
  ['lugares', 'creado_por'],
  ['facturadores', 'usuario_id'],
  ['notificaciones', 'usuario_objetivo_id'],
])

const BAN_INDEFINIDO = '876000h'

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db Service-role client.
 * @param {string} usuarioId
 * @returns {Promise<boolean>}
 */
export async function tieneHistorial(db, usuarioId) {
  const conteos = await Promise.all(REFERENCIAS_HISTORIAL.map(([tabla, columna]) =>
    db.from(tabla).select(columna, { count: 'exact', head: true }).eq(columna, usuarioId)))
  const fallido = conteos.find((item) => item.error)
  if (fallido) throw new Error(`No se pudo verificar el historial del usuario: ${fallido.error?.message}`)
  return conteos.some((item) => (item.count ?? 0) > 0)
}

/**
 * Banning revokes refresh tokens, so a disabled user is signed out within one access-token lifetime.
 * @param {import('@supabase/supabase-js').SupabaseClient} db Service-role client.
 * @param {string} authUserId
 * @param {boolean} habilitado
 */
export async function cambiarAcceso(db, authUserId, habilitado) {
  const { error } = await db.auth.admin.updateUserById(authUserId, { ban_duration: habilitado ? 'none' : BAN_INDEFINIDO })
  if (error) throw new Error(`No se pudo ${habilitado ? 'habilitar' : 'bloquear'} el acceso: ${error.message}`)
}
