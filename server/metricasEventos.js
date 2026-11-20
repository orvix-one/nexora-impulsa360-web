// Catalog of events for the Metrics Eventos tab, limited to what the user's scope can see.
import { estadoEvento } from '../src/lib/eventos.js'
import { aplicarAlcanceLider } from './alcanceLider.js'

const PAGINA = 1000

async function idsEventosConActivacionesEnAlcance(supabase, alcance, candidatos) {
  const encontrados = new Set()
  if (!candidatos.length) return encontrados
  for (let desde = 0; ; desde += PAGINA) {
    const consulta = aplicarAlcanceLider(
      supabase.from('activaciones').select('evento_id').in('evento_id', candidatos).order('id').range(desde, desde + PAGINA - 1),
      alcance,
    )
    if (!consulta) return encontrados
    const { data, error } = await consulta
    if (error) throw error
    for (const { evento_id } of data ?? []) encontrados.add(evento_id)
    if ((data ?? []).length < PAGINA) return encontrados
  }
}

// A leader sees an event when someone on the team is assigned to it or one of the activations in scope landed in it.
export async function cargarEventosMetricas(supabase, alcance, ahora = new Date()) {
  const { data: eventos, error } = await supabase.from('eventos')
    .select('id,nombre,lugar_id,radio_m,inicio,fin,cancelado_at').order('inicio', { ascending: false })
  if (error) throw error
  const lista = eventos ?? []
  const ids = lista.map((e) => e.id)
  const miembros = ids.length
    ? await supabase.from('evento_activadores').select('evento_id,activador_id,created_at').in('evento_id', ids)
    : { data: [], error: null }
  if (miembros.error) throw miembros.error

  const miembrosPorEvento = new Map()
  for (const m of miembros.data ?? []) miembrosPorEvento.set(m.evento_id, [...(miembrosPorEvento.get(m.evento_id) ?? []), m])

  let visibles = lista
  if (alcance) {
    const equipo = new Set(alcance.userIds)
    const conEquipo = new Set(lista.filter((e) => (miembrosPorEvento.get(e.id) ?? []).some((m) => equipo.has(m.activador_id))).map((e) => e.id))
    const porActivaciones = await idsEventosConActivacionesEnAlcance(supabase, alcance, ids.filter((id) => !conEquipo.has(id)))
    visibles = lista.filter((e) => conEquipo.has(e.id) || porActivaciones.has(e.id))
  }

  const activadorIds = [...new Set(visibles.flatMap((e) => (miembrosPorEvento.get(e.id) ?? []).map((m) => m.activador_id)))]
  const lugarIds = [...new Set(visibles.map((e) => e.lugar_id).filter(Boolean))]
  const [activadores, lugares] = await Promise.all([
    activadorIds.length ? supabase.from('activadores').select('usuario_id,nombre').in('usuario_id', activadorIds) : { data: [], error: null },
    lugarIds.length ? supabase.from('lugares').select('id,nombre').in('id', lugarIds) : { data: [], error: null },
  ])
  if (activadores.error) throw activadores.error
  if (lugares.error) throw lugares.error
  const nombreActivador = new Map((activadores.data ?? []).map((a) => [a.usuario_id, a.nombre]))
  const nombreLugar = new Map((lugares.data ?? []).map((l) => [l.id, l.nombre]))

  return visibles.map((evento) => ({
    id: evento.id,
    nombre: evento.nombre,
    inicio: evento.inicio,
    fin: evento.fin,
    estado: estadoEvento(evento, ahora),
    lugar: nombreLugar.get(evento.lugar_id) ?? null,
    radio_m: evento.radio_m,
    activadores: (miembrosPorEvento.get(evento.id) ?? []).map((m) => ({
      id: m.activador_id,
      nombre: nombreActivador.get(m.activador_id) ?? 'Sin nombre',
      desde: m.created_at,
    })),
  }))
}
