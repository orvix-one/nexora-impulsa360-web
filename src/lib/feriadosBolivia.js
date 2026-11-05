// Feriados nacionales de Bolivia (YYYY-MM-DD), con el traslado a lunes cuando caen en domingo.
// Lista estática: agregar el año siguiente cuando se publique el calendario oficial.
const FERIADOS_BOLIVIA = new Set([
  '2025-01-01', '2025-01-22', '2025-03-03', '2025-03-04', '2025-04-18', '2025-05-01',
  '2025-06-19', '2025-06-21', '2025-08-06', '2025-11-03', '2025-12-25',
  '2026-01-01', '2026-01-22', '2026-02-16', '2026-02-17', '2026-04-03', '2026-05-01',
  '2026-06-04', '2026-06-22', '2026-08-06', '2026-11-02', '2026-12-25',
])

export function esFeriadoBolivia(fecha) {
  return FERIADOS_BOLIVIA.has(fecha)
}

export function esDiaNoLaboral(fecha) {
  if (esFeriadoBolivia(fecha)) return true
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  return dia === 0 || dia === 6
}
