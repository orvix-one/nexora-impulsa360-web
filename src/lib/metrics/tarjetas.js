// @ts-check

import {
  formatDiaSemana,
  formatMesLargo,
  formatNumber,
  formatPorcentaje,
  formatPromedio,
  formatShortDate,
} from './formato.js'

/**
 * @typedef {object} Tarjeta
 * @property {string} key
 * @property {string} icon
 * @property {string} label
 * @property {string} value
 * @property {string} note
 */

/**
 * @param {ReturnType<typeof import('./agregados.js').calcularDashboard>} dashboard
 * @param {import('./tipos.js').Hoy} hoy
 * @returns {{ key: string, label: string, tarjetas: Tarjeta[] }[]}
 */
export function gruposTarjetas(dashboard, hoy) {
  const { kpis, promedios } = dashboard
  const rango = `Del ${formatShortDate(promedios.periodoDesde)} al ${formatShortDate(promedios.periodoHasta)}`
  return [
    {
      key: 'volumen',
      label: 'Volumen',
      tarjetas: [
        {
          key: 'total',
          icon: 'Σ',
          label: 'Total',
          value: formatNumber(kpis.total),
          note: 'En el filtro actual',
        },
        {
          key: 'hoy',
          icon: '◷',
          label: 'Hoy',
          value: formatNumber(kpis.hoy),
          note: formatDiaSemana(hoy.todayKey),
        },
        {
          key: 'semana',
          icon: '▦',
          label: 'Esta semana',
          value: formatNumber(kpis.semana),
          note: `Desde ${formatDiaSemana(hoy.weekStartKey)}`,
        },
        {
          key: 'mes',
          icon: '▣',
          label: 'Este mes',
          value: formatNumber(kpis.mes),
          note: formatMesLargo(hoy.monthKey),
        },
      ],
    },
    {
      key: 'ritmo',
      label: 'Ritmo',
      tarjetas: [
        {
          key: 'promedio-diario',
          icon: '↗',
          label: 'Promedio por día',
          value: formatPromedio(promedios.calendarioDiario),
          note: rango,
        },
        {
          key: 'promedio-semanal',
          icon: '⇗',
          label: 'Promedio por semana',
          value: formatPromedio(promedios.calendarioSemanal),
          note: rango,
        },
        {
          key: 'errores',
          icon: '!',
          label: 'Tasa de error',
          value: formatPorcentaje(kpis.errores, kpis.total),
          note: `${formatNumber(kpis.errores)} registros con error`,
        },
      ],
    },
    {
      key: 'lugar',
      label: 'Lugar',
      tarjetas: [
        {
          key: 'comercios',
          icon: '◫',
          label: 'Comercios',
          value: formatNumber(kpis.comercios),
          note: 'Registros con tipo comercio',
        },
        {
          key: 'tiendas',
          icon: '⌂',
          label: 'Tiendas',
          value: formatNumber(kpis.tiendas),
          note: 'Clasificación barrio',
        },
      ],
    },
  ]
}
