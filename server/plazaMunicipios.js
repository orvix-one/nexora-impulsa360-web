// Admin API for the client's plazas over real geography: a plaza groups a department's municipios until one of them is promoted to its own plaza.

/** @param {unknown} valor */
export function municipioIdValido(valor) {
  const id = Number(valor)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * @param {{ plaza_id: string, municipio_id: number }[]} vinculos
 * @param {Map<number, string>} departamentoPorMunicipio
 */
export function resumirPlazas(vinculos, departamentoPorMunicipio) {
  /** @type {Map<string, { municipios: number, departamentos: Set<string> }>} */
  const porPlaza = new Map()
  for (const { plaza_id, municipio_id } of vinculos) {
    const actual = porPlaza.get(plaza_id) ?? { municipios: 0, departamentos: new Set() }
    actual.municipios += 1
    const departamento = departamentoPorMunicipio.get(municipio_id)
    if (departamento) actual.departamentos.add(departamento)
    porPlaza.set(plaza_id, actual)
  }
  return porPlaza
}

export function registrarRutasPlazaMunicipios(app, { adminSupabase, asyncRoute, jsonError, requireAdminReauthentication }) {
  app.get('/admin/plaza-municipios', asyncRoute(async (_req, res) => {
    const { data, error } = await adminSupabase.from('plaza_municipios').select('plaza_id,municipio_id')
    if (error) { jsonError(res, 500, 'No se pudo obtener los municipios de cada plaza.', error.message); return }
    res.json({ vinculos: data ?? [] })
  }))

  app.get('/admin/municipios/:municipioId/conversion', asyncRoute(async (req, res) => {
    const municipioId = municipioIdValido(req.params.municipioId)
    if (!municipioId) { jsonError(res, 400, 'Municipio invalido.'); return }
    const { count, error } = await adminSupabase.from('activaciones')
      .select('id', { count: 'exact', head: true }).eq('municipio_id', municipioId)
    if (error) { jsonError(res, 500, 'No se pudo contar las activaciones del municipio.', error.message); return }
    res.json({ activaciones: count ?? 0 })
  }))

  app.post('/admin/municipios/:municipioId/convertir-en-plaza', requireAdminReauthentication, asyncRoute(async (req, res) => {
    const municipioId = municipioIdValido(req.params.municipioId)
    if (!municipioId) { jsonError(res, 400, 'Municipio invalido.'); return }
    const { data, error } = await adminSupabase.rpc('convertir_municipio_en_plaza', { p_municipio_id: municipioId })
    if (error) {
      const esRegla = error.code === 'P0001'
      jsonError(res, esRegla ? 409 : 500, esRegla ? error.message : 'No se pudo convertir el municipio en plaza.', error.message)
      return
    }
    res.json({ ok: true, ...data })
  }))
}
