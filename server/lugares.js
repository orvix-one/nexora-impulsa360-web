// Admin API for saved places: a named point with a default radius that events can use, plus an OSM search to find them.
import { accionesLugar, RADIO_INICIAL } from '../src/lib/eventos.js'
import { nombresMunicipios } from './viajes.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BOLIVIA_BBOX = '-69.7,-22.95,-57.4,-9.6'
const PHOTON_URL = 'https://photon.komoot.io/api/'

/** @param {any} body @param {{ parcial?: boolean }} [opciones] */
export function validarLugar(body, { parcial = false } = {}) {
  const lugar = {}
  if (!parcial || body?.nombre !== undefined) {
    const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
    if (!nombre) return { error: 'El nombre del lugar es obligatorio.' }
    lugar.nombre = nombre
  }
  if (!parcial || body?.latitud !== undefined || body?.longitud !== undefined) {
    const latitud = Number(body?.latitud)
    const longitud = Number(body?.longitud)
    if (body?.latitud == null || body?.longitud == null || body.latitud === '' || body.longitud === '') return { error: 'Marca el punto en el mapa.' }
    if (!Number.isFinite(latitud) || !Number.isFinite(longitud) || Math.abs(latitud) > 90 || Math.abs(longitud) > 180) {
      return { error: 'Coordenadas invalidas.' }
    }
    lugar.latitud = latitud
    lugar.longitud = longitud
  }
  if (!parcial || body?.radio_m !== undefined) {
    const radio = body?.radio_m == null || body.radio_m === '' ? RADIO_INICIAL : Number(body.radio_m)
    if (!Number.isInteger(radio) || radio < 20 || radio > 5000) return { error: 'El radio debe estar entre 20 y 5000 metros.' }
    lugar.radio_m = radio
  }
  return { lugar }
}

/** @param {any} feature */
export function resultadoPhoton(feature) {
  const p = feature?.properties ?? {}
  const [longitud, latitud] = feature?.geometry?.coordinates ?? []
  return {
    nombre: p.name || p.street || 'Sin nombre',
    detalle: [p.street, p.district, p.city || p.county, p.state].filter(Boolean).join(', '),
    latitud,
    longitud,
    osm: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : null,
  }
}

/** Photon asks for at most one request per second and caching; both are enforced here, per server instance. */
export function crearBuscadorLugares({ fetch: fetchImpl = fetch, ahora = Date.now } = {}) {
  const cache = new Map()
  let ultimo = 0
  return async function buscar(texto) {
    const q = String(texto ?? '').trim().slice(0, 120)
    if (q.length < 3) return []
    if (cache.has(q.toLowerCase())) return cache.get(q.toLowerCase())
    const espera = ultimo + 1000 - ahora()
    if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera))
    ultimo = ahora()
    const url = `${PHOTON_URL}?${new URLSearchParams({ q, bbox: BOLIVIA_BBOX, limit: '8' })}`
    const respuesta = await fetchImpl(url, { headers: { 'User-Agent': 'impulsa360-portal' } })
    if (!respuesta.ok) throw new Error(`Photon respondio ${respuesta.status}`)
    const resultados = ((await respuesta.json()).features ?? []).map(resultadoPhoton)
    cache.set(q.toLowerCase(), resultados)
    if (cache.size > 500) cache.delete(cache.keys().next().value)
    return resultados
  }
}

export function registrarRutasLugares(app, { adminSupabase, asyncRoute, jsonError, buscarLugares = crearBuscadorLugares() }) {
  app.get('/admin/lugares/buscar', asyncRoute(async (req, res) => {
    try {
      res.json({ resultados: await buscarLugares(req.query.q) })
    } catch (error) {
      jsonError(res, 502, 'El buscador de mapas no respondio. Marca el punto a mano.', error?.message)
    }
  }))

  async function usosDeLugares(ids) {
    if (!ids.length) return { activaciones: new Map(), eventos: new Map() }
    const [activaciones, eventos] = await Promise.all([
      adminSupabase.from('activaciones').select('lugar_id').in('lugar_id', ids),
      adminSupabase.from('eventos').select('lugar_id').in('lugar_id', ids),
    ])
    const fallo = activaciones.error ?? eventos.error
    if (fallo) throw fallo
    const contar = (filas) => {
      const conteo = new Map()
      for (const { lugar_id } of filas ?? []) conteo.set(lugar_id, (conteo.get(lugar_id) ?? 0) + 1)
      return conteo
    }
    return { activaciones: contar(activaciones.data), eventos: contar(eventos.data) }
  }

  async function lugarConUsos(lugarId) {
    const { data, error } = await adminSupabase.from('lugares').select('id,nombre,latitud,longitud').eq('id', lugarId).maybeSingle()
    if (error) throw error
    if (!data) return null
    const usos = await usosDeLugares([lugarId])
    const conteo = { activaciones: usos.activaciones.get(lugarId) ?? 0, eventos: usos.eventos.get(lugarId) ?? 0 }
    return { ...data, ...conteo, acciones: accionesLugar(conteo) }
  }

  app.get('/admin/lugares', asyncRoute(async (_req, res) => {
    const { data: lugares, error } = await adminSupabase.from('lugares')
      .select('id,nombre,latitud,longitud,radio_m,municipio_id,created_at').order('nombre')
    if (error) { jsonError(res, 500, 'No se pudo obtener los lugares.', error.message); return }
    const lista = lugares ?? []
    const [municipios, usos] = await Promise.all([
      nombresMunicipios(adminSupabase, lista.map((l) => l.municipio_id)),
      usosDeLugares(lista.map((l) => l.id)),
    ])
    res.json({
      lugares: lista.map((l) => {
        const conteo = { activaciones: usos.activaciones.get(l.id) ?? 0, eventos: usos.eventos.get(l.id) ?? 0 }
        return { ...l, municipio: municipios.get(l.municipio_id) ?? null, ...conteo, acciones: accionesLugar(conteo) }
      }),
    })
  }))

  app.post('/admin/lugares', asyncRoute(async (req, res) => {
    const validacion = validarLugar(req.body)
    if ('error' in validacion) { jsonError(res, 400, validacion.error); return }
    const { data, error } = await adminSupabase.from('lugares')
      .insert({ ...validacion.lugar, creado_por: req.user.usuario_id }).select('id').single()
    if (error) { jsonError(res, 500, 'No se pudo crear el lugar.', error.message); return }
    res.status(201).json({ lugar: data })
  }))

  app.patch('/admin/lugares/:lugarId', asyncRoute(async (req, res) => {
    const lugarId = String(req.params.lugarId ?? '')
    if (!UUID.test(lugarId)) { jsonError(res, 400, 'Lugar invalido.'); return }
    const validacion = validarLugar(req.body, { parcial: true })
    if ('error' in validacion) { jsonError(res, 400, validacion.error); return }
    if (!Object.keys(validacion.lugar).length) { jsonError(res, 400, 'Nada que actualizar.'); return }
    const actual = await lugarConUsos(lugarId)
    if (!actual) { jsonError(res, 404, 'Lugar no encontrado.'); return }
    const mueve = 'latitud' in validacion.lugar && (validacion.lugar.latitud !== actual.latitud || validacion.lugar.longitud !== actual.longitud)
    if (mueve && !actual.acciones.moverPunto) { jsonError(res, 409, 'El lugar ya tiene activaciones: su punto no se puede mover.'); return }
    const { error } = await adminSupabase.from('lugares').update(validacion.lugar).eq('id', lugarId)
    if (error) { jsonError(res, 500, 'No se pudo actualizar el lugar.', error.message); return }
    res.json({ ok: true })
  }))

  app.delete('/admin/lugares/:lugarId', asyncRoute(async (req, res) => {
    const lugarId = String(req.params.lugarId ?? '')
    if (!UUID.test(lugarId)) { jsonError(res, 400, 'Lugar invalido.'); return }
    const actual = await lugarConUsos(lugarId)
    if (!actual) { jsonError(res, 404, 'Lugar no encontrado.'); return }
    if (!actual.acciones.eliminar) { jsonError(res, 409, 'Un lugar usado por eventos o activaciones no se puede eliminar.'); return }
    const { error } = await adminSupabase.from('lugares').delete().eq('id', lugarId)
    if (error) { jsonError(res, 500, 'No se pudo eliminar el lugar.', error.message); return }
    res.json({ ok: true })
  }))
}
