// @ts-check
// Resolves the portal user (profile + roles) from a Supabase access token.

const PORTAL_PRIMARY_ROLES = ['lider', 'banco']
const PROFILE_COLUMNS =
  'usuario_id,auth_user_id,nombre,email,rol,estado,lider_id,puede_activar,activador_roles(rol)'

/**
 * @typedef {object} PortalUser
 * @property {string} usuario_id
 * @property {string} auth_user_id
 * @property {string} nombre
 * @property {string} email
 * @property {string} rol Primary role.
 * @property {string} estado
 * @property {string | null} lider_id
 * @property {boolean} puede_activar
 * @property {string[]} roles Primary role plus every row in `activador_roles`.
 * @property {boolean} isAdmin True when `roles` includes `administrador`.
 */

/**
 * @param {any} profile Row from `activadores` with embedded `activador_roles`.
 * @returns {PortalUser | null} Null when the user is inactive or has no portal access.
 */
export function buildPortalUser(profile) {
  if (!profile || profile.estado !== 'activo') return null

  const { activador_roles: roleRows, ...rest } = profile
  const roles = [...new Set([rest.rol, ...(roleRows ?? []).map((row) => row.rol)].filter(Boolean))]
  const isAdmin = roles.includes('administrador')
  if (!isAdmin && !PORTAL_PRIMARY_ROLES.includes(rest.rol)) return null

  return { ...rest, roles, isAdmin }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} adminSupabase Service-role client.
 * @param {string | undefined} authorization Raw `Authorization` header.
 * @returns {Promise<PortalUser | null>}
 */
export async function resolvePortalUser(adminSupabase, authorization) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null

  const { data, error } = await adminSupabase.auth.getClaims(authorization.slice(7))
  const authUserId = data?.claims?.sub
  if (error || !authUserId) return null

  const { data: profile } = await adminSupabase
    .from('activadores')
    .select(PROFILE_COLUMNS)
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return buildPortalUser(profile)
}
