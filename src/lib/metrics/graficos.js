// @ts-check

import { esDiaNoLaboral } from '../feriadosBolivia.js'

const PASOS_EJE_Y = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

/** @param {number} maximo */
export function escalaEjeY(maximo) {
  const paso =
    PASOS_EJE_Y.find((candidato) => Math.ceil(maximo / candidato) <= 8) ??
    Math.pow(10, Math.ceil(Math.log10(maximo / 8)))
  return { paso, tope: Math.max(paso, Math.ceil(maximo / paso) * paso) }
}

/** @param {{ label: string, value: number }[]} porDia */
export function serieDiariaContinua(porDia) {
  const conFecha = porDia.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.label))
  if (!conFecha.length) return []
  const valores = new Map(conFecha.map((item) => [item.label, item.value]))
  const serie = []
  const cursor = new Date(`${conFecha[0].label}T12:00:00Z`)
  const fin = conFecha[conFecha.length - 1].label
  for (
    let fecha = conFecha[0].label;
    fecha <= fin;
    cursor.setUTCDate(cursor.getUTCDate() + 1), fecha = cursor.toISOString().slice(0, 10)
  ) {
    serie.push({ label: fecha, value: valores.get(fecha) ?? 0 })
  }
  return serie
}

/** @param {{ label: string, value: number }[]} porDia */
export function geometriaLinea(porDia) {
  const data = serieDiariaContinua(porDia)
  const width = 920,
    height = 300,
    padX = 42,
    padTop = 30,
    padBottom = 56
  const plotBottom = height - padBottom
  const { tope: max, paso } = escalaEjeY(Math.max(1, ...data.map((item) => item.value)))
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0
  const yDe = (/** @type {number} */ value) => plotBottom - (value / max) * (plotBottom - padTop)
  const points = data.map((item, index) => {
    const x = data.length > 1 ? padX + index * step : width / 2
    const y = yDe(item.value)
    const anterior = data[index - 1]?.value ?? item.value
    const siguiente = data[index + 1]?.value ?? item.value
    const esPico = item.value >= anterior && item.value >= siguiente
    const conFecha = index % 2 === 0 || index === data.length - 1
    return {
      ...item,
      x,
      y,
      conFecha,
      noLaboral: esDiaNoLaboral(item.label),
      valorY: esPico ? y - 9 : y + 16,
    }
  })
  // Only from the 7th day on, so incomplete windows are never averaged.
  const promedioMovil = points.slice(6).map((point, i) => {
    const valor = points.slice(i, i + 7).reduce((suma, p) => suma + p.value, 0) / 7
    return { x: point.x, y: yDe(valor), valor }
  })
  const ultimoPromedio = promedioMovil[promedioMovil.length - 1] ?? null
  const ejeY = Array.from({ length: max / paso + 1 }, (_, i) => max - i * paso).map((value) => ({
    value,
    y: yDe(value),
  }))
  return {
    width,
    height,
    plotBottom,
    padTop,
    padX,
    anchoBanda: step || 24,
    ejeY,
    points,
    max,
    ultimoPromedio,
    promedioMovil: promedioMovil.map((p) => `${p.x},${p.y}`).join(' '),
    polyline: points.map((point) => `${point.x},${point.y}`).join(' '),
  }
}

/** @param {{ equipo: string, mes: string, total: number }[]} resumenEquipoMes */
export function matrizEquipoMes(resumenEquipoMes) {
  const meses = [...new Set(resumenEquipoMes.map((item) => item.mes))].sort((a, b) =>
    a.localeCompare(b),
  )
  /** @type {Map<string, { equipo: string, byMonth: Record<string, number>, total: number }>} */
  const equipos = new Map()
  const totals = Object.fromEntries(meses.map((mes) => [mes, 0]))
  let grandTotal = 0
  let max = 0
  for (const item of resumenEquipoMes) {
    const equipo = equipos.get(item.equipo) ?? {
      equipo: item.equipo,
      byMonth: Object.fromEntries(meses.map((mes) => [mes, 0])),
      total: 0,
    }
    equipo.byMonth[item.mes] = (equipo.byMonth[item.mes] ?? 0) + item.total
    equipo.total += item.total
    totals[item.mes] = (totals[item.mes] ?? 0) + item.total
    grandTotal += item.total
    max = Math.max(max, equipo.byMonth[item.mes])
    equipos.set(item.equipo, equipo)
  }
  const rows = [...equipos.values()]
    .map((item) => ({
      equipo: item.equipo,
      values: meses.map((mes) => ({ mes, value: item.byMonth[mes] ?? 0 })),
      total: item.total,
    }))
    .sort((a, b) => b.total - a.total || a.equipo.localeCompare(b.equipo, 'es'))
  return { meses, rows, totals, grandTotal, max }
}

/** @param {number} value @param {number} max */
export function estiloCeldaCalor(value, max) {
  const ratio = Number(value) > 0 ? Number(value) / Math.max(1, max) : 0
  const opacity = ratio ? 0.16 + ratio * 0.64 : 0.04
  return {
    background: `rgba(23, 105, 255, ${opacity})`,
    color: ratio > 0.55 ? '#ffffff' : '#143b5e',
  }
}

/** @param {{ value: number }[]} items */
export function maximo(items) {
  return Math.max(1, ...items.map((item) => item.value))
}

/** @param {number} value @param {number} max */
export function anchoBarra(value, max) {
  return `${Math.max(3, (value / max) * 100)}%`
}

/** @param {number} value @param {number} max */
export function alturaBarra(value, max) {
  return `${Math.max(8, (value / max) * 100)}%`
}
