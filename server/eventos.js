// Admin API for events: one or more activators assigned to an optional place over a date or hour range.
import { accionesEvento, estadoEvento } from '../src/lib/eventos.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** @param {any} valor */
export function idsActivadores(valor) {
  const ids = Array.isArray(valor) ? [...new Set(valor)] : []
  if (!ids.length || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) return null
  return ids
}

/**
 * @param {any} body
 * @returns {{ error: string } | { evento: { nombre: string, inicio: string, fin: string | null, lugar_id: string | null, radio_m: number | null }, activadorIds: string[] }}
 */
export function validarEvento(body) {
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
  if (!nombre) return { error: 'El nombre del evento es obligatorio.' }
  const inicio = new Date(body?.inicio)
  if (Number.isNaN(inicio.getTime())) return { error: 'La fecha de inicio es obligatoria.' }
  const fin = body?.fin ? new Date(body.fin) : null
  if (fin && (Number.isNaN(fin.getTime()) || fin <= inicio)) return { error: 'El fin debe ser posterior al inicio.' }
  const lugarId = body?.lugar_id ? String(body.lugar_id) : null
  if (lugarId && !UUID.test(lugarId)) return { error: 'Lugar invalido.' }
  let radio = null
  if (lugarId) {
    radio = Number(body?.radio_m)
    if (!Number.isInteger(radio) || radio < 20 || radio > 5000) return { error: 'El radio debe estar entre 20 y 5000 metros.' }
  }
  const activadorIds = idsActivadores(body?.activador_ids)
  if (!activadorIds) return { error: 'Selecciona al menos un activador.' }
  return {
    evento: { nombre, inicio: inicio.toISOString(), fin: fin?.toISOString() ?? null, lugar_id: lugarId, radio_m: radio },
    activadorIds,
  }
}

async function soloActivos(supabase, ids) {
  const { data, error } = await supabase.from('activadores').select('usuario_id,estado').in('usuario_id', ids)
  if (error) throw error
  const activos = new Set((data ?? []).filter((a) => (a.estado ?? 'activo') === 'activo').map((a) => a.usuario_id))
  return ids.every((id) => activos.has(id))
}

/** @returns {Promise<Map<number, string>>} */
async function departamentosDeMunicipios(supabase, ids) {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (!unicos.length) return new Map()
  const { data, error } = await supabase.from('municipios').select('id,provincias(departamentos(nombre))').in('id', unicos)
  if (error) throw error
  return new Map((data ?? []).map((m) => [m.id, m.provincias?.departamentos?.nombre ?? null]))
}

async function cargarEvento(supabase, eventoId) {
  const [evento, activaciones] = await Promise.all([
    supabase.from('eventos').select('id,inicio,fin,cancelado_at').eq('id', eventoId).maybeSingle(),
    supabase.from('activaciones').select('id', { count: 'exact', head: true }).eq('evento_id', eventoId),
  ])
  if (evento.error) throw evento.error
  if (activaciones.error) throw activaciones.error
  if (!evento.data) return null
  const estado = estadoEvento(evento.data)
  return { ...evento.data, estado, acciones: accionesEvento(estado, activaciones.count ?? 0) }
}

export function registrarRutasEventos(app, { adminSupabase, asyncRoute, jsonError }) {
  app.get('/admin/eventos', asyncRoute(async (_req, res) => {
    const { data: eventos, error } = await adminSupabase.from('eventos')
      .select('id,nombre,lugar_id,radio_m,inicio,fin,cancelado_at,created_at').order('inicio', { ascending: false })
    if (error) { jsonError(res, 500, 'No se pudo obtener los eventos.', error.message); return }
    const lista = eventos ?? []
    const ids = lista.map((e) => e.id)
    const lugarIds = [...new Set(lista.map((e) => e.lugar_id).filter(Boolean))]
    const [miembros, lugares, activaciones] = await Promise.all([
      ids.length ? adminSupabase.from('evento_activadores').select('evento_id,activador_id,created_at').in('evento_id', ids) : { data: [], error: null },
      lugarIds.length ? adminSupabase.from('lugares').select('id,nombre,latitud,longitud,municipio_id').in('id', lugarIds) : { data: [], error: null },
      ids.length ? adminSupabase.from('activaciones').select('evento_id').in('evento_id', ids) : { data: [], error: null },
    ])
    const fallo = [miembros, lugares, activaciones].find((r) => r.error)
    if (fallo) { jsonError(res, 500, 'No se pudo obtener los eventos.', fallo.error.message); return }
    const activadorIds = [...new Set((miembros.data ?? []).map((m) => m.activador_id))]
    const activadores = activadorIds.length
      ? await adminSupabase.from('activadores').select('usuario_id,nombre').in('usuario_id', activadorIds)
      : { data: [], error: null }
    if (activadores.error) { jsonError(res, 500, 'No se pudo obtener los eventos.', activadores.error.message); return }

    const departamentos = await departamentosDeMunicipios(adminSupabase, (lugares.data ?? []).map((l) => l.municipio_id))
    const nombrePorId = new Map((activadores.data ?? []).map((a) => [a.usuario_id, a.nombre]))
    const lugarPorId = new Map((lugares.data ?? []).map((l) => [l.id, l]))
    const miembrosPorEvento = new Map()
    for (const m of miembros.data ?? []) {
      const lista = miembrosPorEvento.get(m.evento_id) ?? []
      lista.push({ id: m.activador_id, nombre: nombrePorId.get(m.activador_id) ?? 'Sin nombre', desde: m.created_at })
      miembrosPorEvento.set(m.evento_id, lista)
    }
    const conteo = new Map()
    for (const { evento_id } of activaciones.data ?? []) conteo.set(evento_id, (conteo.get(evento_id) ?? 0) + 1)
    const ahora = new Date()
    res.json({
      eventos: lista.map((evento) => {
        const estado = estadoEvento(evento, ahora)
        const total = conteo.get(evento.id) ?? 0
        const lugar = lugarPorId.get(evento.lugar_id)
        return {
          ...evento,
          lugar: lugar?.nombre ?? null,
          punto: lugar ? { latitud: lugar.latitud, longitud: lugar.longitud } : null,
          departamento: lugar ? departamentos.get(lugar.municipio_id) ?? null : null,
          activadores: (miembrosPorEvento.get(evento.id) ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
          activaciones: total,
          estado,
          acciones: accionesEvento(estado, total),
        }
      }),
    })
  }))

  app.post('/admin/eventos', asyncRoute(async (req, res) => {
    const validacion = validarEvento(req.body)
    if ('error' in validacion) { jsonError(res, 400, validacion.error); return }
    if (!(await soloActivos(adminSupabase, validacion.activadorIds))) { jsonError(res, 400, 'Solo se puede asignar a usuarios activos.'); return }
    const { data: evento, error } = await adminSupabase.from('eventos')
      .insert({ ...validacion.evento, creado_por: req.user.usuario_id }).select('id').single()
    if (error) { jsonError(res, 500, 'No se pudo crear el evento.', error.message); return }
    const filas = validacion.activadorIds.map((activadorId) => ({ evento_id: evento.id, activador_id: activadorId, agregado_por: req.user.usuario_id }))
    const { error: miembrosError } = await adminSupabase.from('evento_activadores').insert(filas)
    if (miembrosError) {
      await adminSupabase.from('eventos').delete().eq('id', evento.id)
      jsonError(res, 500, 'No se pudo crear el evento.', miembrosError.message)
      return
    }
    res.status(201).json({ evento })
  }))

  app.post('/admin/eventos/:eventoId/activadores', asyncRoute(async (req, res) => {
    const eventoId = String(req.params.eventoId ?? '')
    if (!UUID.test(eventoId)) { jsonError(res, 400, 'Evento invalido.'); return }
    const activadorIds = idsActivadores(req.body?.activador_ids)
    if (!activadorIds) { jsonError(res, 400, 'Selecciona al menos un activador.'); return }
    const evento = await cargarEvento(adminSupabase, eventoId)
    if (!evento) { jsonError(res, 404, 'Evento no encontrado.'); return }
    if (!evento.acciones.anadir) { jsonError(res, 409, 'Solo se puede añadir activadores a eventos programados o en curso.'); return }
    if (!(await soloActivos(adminSupabase, activadorIds))) { jsonError(res, 400, 'Solo se puede asignar a usuarios activos.'); return }
    const filas = activadorIds.map((activadorId) => ({ evento_id: eventoId, activador_id: activadorId, agregado_por: req.user.usuario_id }))
    const { error } = await adminSupabase.from('evento_activadores')
      .upsert(filas, { onConflict: 'evento_id,activador_id', ignoreDuplicates: true })
    if (error) { jsonError(res, 500, 'No se pudo añadir a los activadores.', error.message); return }
    res.json({ ok: true })
  }))

  app.post('/admin/eventos/:eventoId/finalizar', asyncRoute(async (req, res) => {
    const eventoId = String(req.params.eventoId ?? '')
    if (!UUID.test(eventoId)) { jsonError(res, 400, 'Evento invalido.'); return }
    const evento = await cargarEvento(adminSupabase, eventoId)
    if (!evento) { jsonError(res, 404, 'Evento no encontrado.'); return }
    if (!evento.acciones.finalizar) { jsonError(res, 409, 'Solo se puede finalizar un evento en curso.'); return }
    const fin = new Date().toISOString()
    const { error } = await adminSupabase.from('eventos').update({ fin }).eq('id', eventoId).is('cancelado_at', null)
    if (error) { jsonError(res, 500, 'No se pudo finalizar el evento.', error.message); return }
    res.json({ fin })
  }))

  app.post('/admin/eventos/:eventoId/cancelar', asyncRoute(async (req, res) => {
    const eventoId = String(req.params.eventoId ?? '')
    if (!UUID.test(eventoId)) { jsonError(res, 400, 'Evento invalido.'); return }
    const evento = await cargarEvento(adminSupabase, eventoId)
    if (!evento) { jsonError(res, 404, 'Evento no encontrado.'); return }
    if (!evento.acciones.cancelar) {
      jsonError(res, 409, evento.acciones.finalizar ? 'El evento ya tiene activaciones: finalízalo en lugar de cancelarlo.' : 'Este evento ya no se puede cancelar.')
      return
    }
    const { error } = await adminSupabase.from('eventos').update({ cancelado_at: new Date().toISOString() }).eq('id', eventoId).is('cancelado_at', null)
    if (error) { jsonError(res, 500, 'No se pudo cancelar el evento.', error.message); return }
    res.json({ ok: true })
  }))
}
