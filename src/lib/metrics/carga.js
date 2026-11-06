// @ts-check

/**
 * @param {{
 *   fetchActivaciones: () => Promise<import('./tipos.js').Activacion[]>,
 *   solicitar: (path: string) => Promise<any>,
 *   registrarError: (contexto: string, error: unknown) => void,
 * }} deps
 * A users catalog failure rejects so partial leader metrics are never published; plazas are optional.
 */
export async function cargarDatosMetricas({ fetchActivaciones, solicitar, registrarError }) {
  const [activaciones, usuariosPayload, plazasPayload] = await Promise.all([
    fetchActivaciones(),
    solicitar('/portal/users'),
    Promise.resolve()
      .then(() => solicitar('/portal/plazas'))
      .catch((error) => {
        registrarError('metricas.plazas', error)
        return null
      }),
  ])
  return {
    activaciones,
    usuarios: /** @type {import('./tipos.js').Usuario[]} */ (usuariosPayload?.users ?? []),
    plazas: /** @type {{ nombre?: string }[]} */ (plazasPayload?.plazas ?? []),
  }
}
