// @ts-check

/**
 * @param {{
 *   fetchActivaciones: () => Promise<import('./tipos.js').Activacion[]>,
 *   solicitar: (path: string) => Promise<any>,
 *   registrarError: (contexto: string, error: unknown) => void,
 * }} deps
 * A users catalog failure rejects so partial leader metrics are never published; without the municipios
 * catalog territories fall back to the activation's city name.
 */
export async function cargarDatosMetricas({ fetchActivaciones, solicitar, registrarError }) {
  const opcional = (/** @type {string} */ path, /** @type {string} */ contexto) =>
    Promise.resolve()
      .then(() => solicitar(path))
      .catch((error) => {
        registrarError(contexto, error)
        return null
      })
  const [activaciones, usuariosPayload, municipiosPayload, eventosPayload] = await Promise.all([
    fetchActivaciones(),
    solicitar('/portal/users'),
    opcional('/portal/municipios', 'metricas.municipios'),
    opcional('/portal/metrics/eventos', 'metricas.eventos'),
  ])
  return {
    activaciones,
    usuarios: /** @type {import('./tipos.js').Usuario[]} */ (usuariosPayload?.users ?? []),
    municipios: /** @type {import('./tipos.js').Municipio[]} */ (municipiosPayload?.municipios ?? []),
    eventos: /** @type {import('./tipos.js').Evento[]} */ (eventosPayload?.eventos ?? []),
  }
}
