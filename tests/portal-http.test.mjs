import assert from 'node:assert/strict'
import test from 'node:test'
import { seedTables, startPortal, TOKENS, IDS } from './helpers/portalApp.mjs'

async function conPortal(fn, tables) {
  const portal = await startPortal(tables)
  try {
    await fn(portal)
  } finally {
    await portal.close()
  }
}

test('auth: sin token, token invalido, perfil inactivo y activador raso reciben 401', () =>
  conPortal(async ({ get }) => {
    assert.equal((await get('/portal/plazas')).status, 401)
    assert.equal((await get('/portal/plazas', 'tok-falso')).status, 401)
    assert.equal((await get('/portal/plazas', TOKENS.inactivo)).status, 401)
    assert.equal((await get('/portal/plazas', TOKENS.activador)).status, 401)
  }))

test('auth: administrador, lider y banco acceden a /portal', () =>
  conPortal(async ({ get }) => {
    for (const token of [TOKENS.admin, TOKENS.lider, TOKENS.banco]) {
      const response = await get('/portal/plazas', token)
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).plazas, [{ id: 'p1', nombre: 'La Paz' }])
    }
  }))

test('GET /portal/me devuelve el perfil sin auth_user_id y con roles', () =>
  conPortal(async ({ get }) => {
    const { profile } = await (await get('/portal/me', TOKENS.lider)).json()
    assert.equal(profile.usuario_id, IDS.lider)
    assert.ok(!('auth_user_id' in profile))
    assert.deepEqual(profile.roles, ['lider'])
  }))

test('GET /portal/me resuelve perfil y roles con una sola consulta', () =>
  conPortal(async ({ get, supabase }) => {
    assert.equal((await get('/portal/me', TOKENS.lider)).status, 200)
    assert.deepEqual(supabase.calls.from, ['activadores'])
  }))

test('/admin: exige Bearer de administrador; otros esquemas y lideres reciben 401/403', () =>
  conPortal(async ({ get, base }) => {
    assert.equal((await get('/admin/healthz')).status, 401)
    assert.equal((await get('/admin/healthz', TOKENS.lider)).status, 403)
    assert.equal((await get('/admin/healthz', TOKENS.admin)).status, 200)
    const otroEsquema = await fetch(`${base}/admin/healthz`, { headers: { Authorization: 'Token abc' } })
    assert.equal(otroEsquema.status, 401)
  }))

test('administrador por activador_roles: accede a /admin y ve todo el alcance aunque su rol principal sea lider', () => {
  const tables = seedTables()
  tables.activador_roles.push({ usuario_id: IDS.lider, rol: 'administrador' })
  return conPortal(async ({ get }) => {
    assert.equal((await get('/admin/healthz', TOKENS.lider)).status, 200)
    const { profile } = await (await get('/portal/me', TOKENS.lider)).json()
    assert.deepEqual(profile.roles, ['lider', 'administrador'])
    const { activations } = await (await get('/portal/activations/export-rows', TOKENS.lider)).json()
    assert.equal(activations.length, 6)
  }, tables)
})

test('GET /portal/activations/export-rows: cuenta filas segun alcance y filtros', () =>
  conPortal(async ({ get }) => {
    const contar = async (query, token) => {
      const response = await get(`/portal/activations/export-rows${query}`, token)
      assert.equal(response.status, 200)
      return (await response.json()).activations.length
    }
    assert.equal(await contar('', TOKENS.admin), 6)
    assert.equal(await contar('', TOKENS.lider), 3)
    assert.equal(await contar('?fechaDesde=2026-10-04&fechaHasta=2026-10-05', TOKENS.admin), 2)
    assert.equal(await contar('?plaza=la%20paz', TOKENS.admin), 3)
  }))

test('GET /portal/users: el lider solo ve a su equipo', () =>
  conPortal(async ({ get }) => {
    const { users } = await (await get('/portal/users', TOKENS.lider)).json()
    assert.deepEqual(
      users.map((user) => user.usuario_id),
      [IDS.activador],
    )
  }))

const asignacionTemporal = {
  plaza_temporal: 'Unifranz',
  tipo_zona: 'universidad',
  motivo: 'Evento',
  inicio: '2026-10-30T13:00:00.000Z',
  fin: '2026-10-31T03:59:00.000Z',
}

test('POST temporary-plaza: acepta a un lider activo y rechaza a un usuario inactivo', () =>
  conPortal(async ({ post, supabase }) => {
    const ok = await post(`/admin/users/${IDS.lider}/temporary-plaza`, TOKENS.admin, asignacionTemporal)
    assert.equal(ok.status, 201)
    assert.equal(supabase.tables.activador_plaza_temporal.length, 1)

    const rechazado = await post(`/admin/users/${IDS.inactivo}/temporary-plaza`, TOKENS.admin, asignacionTemporal)
    assert.equal(rechazado.status, 400)
    assert.equal(supabase.tables.activador_plaza_temporal.length, 1)
  }))
