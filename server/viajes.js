// Admin API for trips (an activator working in another municipio between two dates) and the municipio catalog they point to.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** @param {{ nombre: string, nombre_comun?: string | null }} municipio */
export function nombreMunicipio(municipio) {
  return municipio.nombre_comun || municipio.nombre
}

/**
 * @param {any} body
 * @returns {{ error: string } | { viaje: { activadorIds: string[], municipioId: number, inicio: string, fin: string, nota: string | null } }}
 */
export function validarNuevoViaje(body) {
  const activadorIds = Array.isArray(body?.activador_ids) ? [...new Set(body.activador_ids)] : []
  if (!activadorIds.length || activadorIds.some((id) => typeof id !== 'string' || !UUID.test(id))) {
    return { error: 'Selecciona al menos un activador.' }
  }
  const municipioId = Number(body?.municipio_id)
  if (!Number.isInteger(municipioId) || municipioId <= 0) return { error: 'Selecciona el municipio de destino.' }
  const inicio = new Date(body?.inicio)
  const fin = new Date(body?.fin)
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return { error: 'Inicio y fin son obligatorios.' }
  if (fin <= inicio) return { error: 'El fin debe ser posterior al inicio.' }
  const nota = typeof body?.nota === 'string' && body.nota.trim() ? body.nota.trim() : null
  return { viaje: { activadorIds, municipioId, inicio: inicio.toISOString(), fin: fin.toISOString(), nota } }
}

/** @param {{ inicio: string, fin: string, cancelado_at?: string | null }} viaje @param {Date} [ahora] */
export function estadoViaje(viaje, ahora = new Date()) {
  if (viaje.cancelado_at) return 'cancelado'
  if (new Date(viaje.fin) <= ahora) return 'finalizado'
  if (new Date(viaje.inicio) > ahora) return 'programado'
  return 'en_curso'
}

/** @returns {Promise<Map<number, string>>} */
export async function nombresMunicipios(supabase, ids) {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (!unicos.length) return new Map()
  const { data, error } = await supabase.from('municipios').select('id,nombre,nombre_comun').in('id', unicos)
  if (error) throw error
  return new Map((data ?? []).map((municipio) => [municipio.id, nombreMunicipio(municipio)]))
}

async function cargarMunicipios(supabase) {
  const [municipios, provincias, departamentos, plazaMunicipios, plazas] = await Promise.all([
    supabase.from('municipios').select('id,nombre,nombre_comun,provincia_id').order('nombre'),
    supabase.from('provincias').select('id,departamento_id'),
    supabase.from('departamentos').select('id,nombre'),
    supabase.from('plaza_municipios').select('plaza_id,municipio_id'),
    supabase.from('plazas').select('id,nombre'),
  ])
  const fallo = [municipios, provincias, departamentos, plazaMunicipios, plazas].find((r) => r.error)
  if (fallo) throw fallo.error
  const departamentoPorProvincia = new Map((provincias.data ?? []).map((p) => [p.id, p.departamento_id]))
  const departamentoNombre = new Map((departamentos.data ?? []).map((d) => [d.id, d.nombre]))
  const plazaNombre = new Map((plazas.data ?? []).map((p) => [p.id, p.nombre]))
  const plazaPorMunicipio = new Map((plazaMunicipios.data ?? []).map((pm) => [pm.municipio_id, plazaNombre.get(pm.plaza_id) ?? null]))
  return (municipios.data ?? []).map((municipio) => ({
    id: municipio.id,
    nombre: nombreMunicipio(municipio),
    departamento: departamentoNombre.get(departamentoPorProvincia.get(municipio.provincia_id)) ?? null,
    plaza: plazaPorMunicipio.get(municipio.id) ?? null,
  }))
}

export function registrarRutasViajes(app, { adminSupabase, asyncRoute, jsonError }) {
  app.get('/admin/municipios', asyncRoute(async (_req, res) => {
    res.json({ municipios: await cargarMunicipios(adminSupabase) })
  }))

  app.get('/admin/viajes', asyncRoute(async (_req, res) => {
    const { data: viajes, error } = await adminSupabase.from('viajes')
      .select('id,activador_id,municipio_id,inicio,fin,nota,cancelado_at,created_at')
      .order('inicio', { ascending: false })
    if (error) { jsonError(res, 500, 'No se pudo obtener los viajes.', error.message); return }
    const lista = viajes ?? []
    const ids = lista.map((viaje) => viaje.id)
    const activadorIds = [...new Set(lista.map((viaje) => viaje.activador_id))]
    const [destinos, activadores, activaciones] = await Promise.all([
      nombresMunicipios(adminSupabase, lista.map((viaje) => viaje.municipio_id)),
      activadorIds.length
        ? adminSupabase.from('activadores').select('usuario_id,nombre').in('usuario_id', activadorIds)
        : { data: [], error: null },
      ids.length
        ? adminSupabase.from('activaciones').select('viaje_id').in('viaje_id', ids)
        : { data: [], error: null },
    ])
    if (activadores.error || activaciones.error) {
      jsonError(res, 500, 'No se pudo obtener los viajes.', (activadores.error ?? activaciones.error).message)
      return
    }
    const nombres = new Map((activadores.data ?? []).map((a) => [a.usuario_id, a.nombre]))
    const conteo = new Map()
    for (const { viaje_id } of activaciones.data ?? []) conteo.set(viaje_id, (conteo.get(viaje_id) ?? 0) + 1)
    const ahora = new Date()
    res.json({
      viajes: lista.map((viaje) => ({
        ...viaje,
        activador: nombres.get(viaje.activador_id) ?? null,
        destino: destinos.get(viaje.municipio_id) ?? null,
        estado: estadoViaje(viaje, ahora),
        activaciones: conteo.get(viaje.id) ?? 0,
      })),
    })
  }))

  app.post('/admin/viajes', asyncRoute(async (req, res) => {
    const validacion = validarNuevoViaje(req.body)
    if ('error' in validacion) { jsonError(res, 400, validacion.error); return }
    const { activadorIds, municipioId, inicio, fin, nota } = validacion.viaje
    const { data: activadores, error: activadoresError } = await adminSupabase.from('activadores')
      .select('usuario_id,estado').in('usuario_id', activadorIds)
    if (activadoresError) { jsonError(res, 500, 'No se pudo validar a los activadores.', activadoresError.message); return }
    const activos = new Set((activadores ?? []).filter((a) => (a.estado ?? 'activo') === 'activo').map((a) => a.usuario_id))
    if (activadorIds.some((id) => !activos.has(id))) { jsonError(res, 400, 'Solo se puede asignar viajes a usuarios activos.'); return }

    // One insert statement, so either every trip is created or none is.
    const filas = activadorIds.map((activadorId) => ({
      activador_id: activadorId, municipio_id: municipioId, inicio, fin, nota, creado_por: req.user.usuario_id,
    }))
    const { data, error } = await adminSupabase.from('viajes').insert(filas).select('id')
    if (error) {
      const solapa = error.code === '23P01'
      jsonError(res, solapa ? 409 : 500, solapa ? 'Uno de los activadores ya tiene un viaje en esas fechas.' : 'No se pudo crear el viaje.', error.message)
      return
    }
    res.status(201).json({ viajes: data ?? [] })
  }))

  app.post('/admin/viajes/:viajeId/cancelar', asyncRoute(async (req, res) => {
    const viajeId = String(req.params.viajeId ?? '')
    if (!UUID.test(viajeId)) { jsonError(res, 400, 'Viaje invalido.'); return }
    const { data, error } = await adminSupabase.from('viajes')
      .update({ cancelado_at: new Date().toISOString() }).eq('id', viajeId).is('cancelado_at', null).select('id')
    if (error) { jsonError(res, 500, 'No se pudo cancelar el viaje.', error.message); return }
    if (!data?.length) { jsonError(res, 404, 'El viaje no existe o ya estaba cancelado.'); return }
    res.json({ ok: true })
  }))
}
