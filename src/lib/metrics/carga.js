// @ts-check

/**
 * @param {{
 *   fetchActivaciones: () => Promise<import('./tipos.js').Activacion[]>,
 *   solicitar: (path: string) => Promise<any>,
 *   registrarError: (contexto: string, error: unknown) => void,
 * }} deps
 * A users catalog failure rejects so partial leader metrics are never published; the city grouping is optional.
 */
export async function cargarDatosMetricas({ fetchActivaciones, solicitar, registrarError }) {
  const [activaciones, usuariosPayload, agrupacionPayload] = await Promise.all([
    fetchActivaciones(),
    solicitar('/portal/users'),
    Promise.resolve()
      .then(() => solicitar('/portal/ciudades-por-plaza'))
      .catch((error) => {
        registrarError('metricas.ciudades-por-plaza', error)
        return null
      }),
  ])
  return {
    activaciones,
    usuarios: /** @type {import('./tipos.js').Usuario[]} */ (usuariosPayload?.users ?? []),
    ciudadesPorPlaza: /** @type {{ ciudad: string, plaza: string }[]} */ (agrupacionPayload?.ciudades ?? []),
  }
}
