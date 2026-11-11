// @ts-check
// Shared download filename for both activation reports: `<prefijo>_<desde>_<hasta>.xlsx` (ISO dates).

/**
 * @param {string} prefijo
 * @param {{ fechaDesde?: string, fechaHasta?: string }} [filtros]
 */
export function nombreArchivoReporte(prefijo, { fechaDesde, fechaHasta } = {}) {
  const rango = [fechaDesde, fechaHasta].filter(Boolean)
  return `${[prefijo, ...rango].join('_')}.xlsx`
}
