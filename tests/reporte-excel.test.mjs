import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { COLUMNAS_EVENTOS, COLUMNAS_EXCEL, COLUMNAS_VIAJES, generarExcel } from '../src/lib/reportes/excel.js'
import { diasViaje } from '../src/lib/reportes/resumenes.js'
import { SELECT_EXPORTACION } from '../server/activacionesExportacion.js'

const urlEvidencia = (ruta) => `https://portal.test${ruta}`

async function leer(filas) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await generarExcel(ExcelJS, filas, { urlEvidencia }))
  const hoja = workbook.getWorksheet('Activaciones')
  const celda = (header, fila = 2) => {
    const columna = COLUMNAS_EXCEL.findIndex(([h]) => h === header) + 1
    return hoja.getRow(fila).getCell(columna)
  }
  return { hoja, celda }
}

test('el Excel incluye las columnas internas de plaza, equipo, líder y GPS', () => {
  const headers = COLUMNAS_EXCEL.map(([header]) => header)
  for (const header of ['Plaza Base', 'Equipo', 'Facturador', 'Líder Vigente', 'Latitud', 'Longitud', 'Usuario ID']) {
    assert.ok(headers.includes(header), `falta ${header}`)
  }
})

test('fecha en hora de La Paz, enlaces a fotos solo si existen y equipo con número', async () => {
  const { celda } = await leer([{
    created_at: '2026-10-31T03:30:00Z',
    foto_url_evidencia: '/evidencia/1/principal/abc',
    equipo_numero_registro: 4,
    plaza_base_registro: 'La Paz',
  }])
  assert.equal(celda('Fecha de la Activación').value.toISOString(), '2026-10-30T23:30:00.000Z')
  assert.deepEqual(celda('Foto de la Activación').value, { text: 'Ver foto', hyperlink: 'https://portal.test/evidencia/1/principal/abc' })
  assert.ok(!celda('Foto Cash-In / Reporte').value)
  assert.equal(celda('Equipo').value, 'Equipo #4')
  assert.equal(celda('Plaza Base').value, 'La Paz')
})

test('el Excel neutraliza fórmulas en texto libre', async () => {
  const { celda } = await leer([{ nombres_cliente: '=1+1', created_at: '2026-10-31T03:30:00Z' }])
  assert.equal(celda('Nombre').value, "'=1+1")
})

const conTerritorioEventoYViaje = {
  id: 'a1',
  usuario_id: 'u1',
  impulsador: 'Ana',
  categoria: 'comercio',
  created_at: '2026-11-20T14:00:00Z',
  cash_in: true,
  zona_fuente: 'gps',
  distancia_lugar_m: 42.6,
  municipio: { nombre: 'Nuestra Señora de La Paz', nombre_comun: 'La Paz', provincia: { departamento: { nombre: 'La Paz' } } },
  evento: { id: 'e1', nombre: 'Feria 16 de Julio' },
  lugar: { nombre: 'Mercado 16 de Julio' },
  viaje: { id: 'v1', inicio: '2026-11-19T12:00:00Z', fin: '2026-11-22T12:00:00Z', municipio: { nombre: 'Sacaba', nombre_comun: null } },
}

test('la hoja Activaciones agrega departamento, origen del barrio, evento, lugar y viaje', async () => {
  const headers = COLUMNAS_EXCEL.map(([header]) => header)
  assert.equal(headers.indexOf('Departamento'), headers.indexOf('Ciudad') + 1)
  assert.equal(headers.indexOf('Origen del Barrio'), headers.indexOf('Zona de Activación') + 1)
  assert.deepEqual(
    headers.slice(headers.indexOf('Observaciones') + 1, headers.indexOf('Latitud')),
    ['Evento', 'Lugar de Interés', 'Distancia al Lugar (m)', 'Viaje - Destino', 'Viaje - Desde', 'Viaje - Hasta'],
  )

  const { celda } = await leer([conTerritorioEventoYViaje, { id: 'a2', created_at: '2026-11-20T15:00:00Z' }])
  assert.equal(celda('Departamento').value, 'La Paz')
  assert.equal(celda('Origen del Barrio').value, 'GPS')
  assert.equal(celda('Evento').value, 'Feria 16 de Julio')
  assert.equal(celda('Lugar de Interés').value, 'Mercado 16 de Julio')
  assert.equal(celda('Distancia al Lugar (m)').value, 43)
  assert.equal(celda('Viaje - Destino').value, 'Sacaba')
  assert.equal(celda('Viaje - Desde').value.toISOString(), '2026-11-19T08:00:00.000Z')
  for (const header of ['Departamento', 'Origen del Barrio', 'Evento', 'Lugar de Interés', 'Distancia al Lugar (m)', 'Viaje - Destino', 'Viaje - Desde']) {
    assert.ok(!celda(header, 3).value, `${header} vacío sin datos`)
  }
})

test('hojas Eventos y Viajes resumen las activaciones exportadas y se omiten si no hay', async () => {
  const otra = { ...conTerritorioEventoYViaje, id: 'a3', usuario_id: 'u2', categoria: 'transeunte', cash_in: false, created_at: '2026-11-21T14:00:00Z' }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await generarExcel(ExcelJS, [conTerritorioEventoYViaje, otra], { urlEvidencia }))
  const eventos = workbook.getWorksheet('Eventos')
  const fila = Object.fromEntries(COLUMNAS_EVENTOS.map(([h], i) => [h, eventos.getRow(2).getCell(i + 1).value]))
  assert.equal(fila.Evento, 'Feria 16 de Julio')
  assert.equal(fila['Lugar de Interés'], 'Mercado 16 de Julio')
  assert.equal(fila.Activaciones, 2)
  assert.equal(fila.Activadores, 2)
  assert.equal(fila.Comercios, 1)
  assert.equal(fila['Transeúntes'], 1)
  assert.equal(fila['Cash-In'], 1)
  assert.equal(fila['Última Activación'].toISOString(), '2026-11-21T10:00:00.000Z')

  const viajes = workbook.getWorksheet('Viajes')
  const viaje = Object.fromEntries(COLUMNAS_VIAJES.map(([h], i) => [h, viajes.getRow(2).getCell(i + 1).value]))
  assert.equal(viaje.Destino, 'Sacaba')
  assert.equal(viaje['Días'], 3)
  assert.equal(viaje.Activaciones, 2)
  assert.equal(viaje['Activaciones por Día'], 0.7)

  const vacio = new ExcelJS.Workbook()
  await vacio.xlsx.load(await generarExcel(ExcelJS, [{ id: 'a9' }], { urlEvidencia }))
  assert.deepEqual(vacio.worksheets.map((h) => h.name), ['Activaciones'])
})

test('diasViaje redondea hacia arriba y no cuenta rangos inválidos', () => {
  assert.equal(diasViaje('2026-11-19T12:00:00Z', '2026-11-19T18:00:00Z'), 1)
  assert.equal(diasViaje('2026-11-19T00:00:00Z', '2026-11-21T00:00:00Z'), 2)
  assert.equal(diasViaje('2026-11-19T00:00:00Z', null), 0)
})

test('el export trae municipio con departamento, evento, lugar y viaje por sus FK', () => {
  for (const embed of ['municipio:municipio_id(', 'departamento:departamento_id(nombre)', 'evento:evento_id(id, nombre)', 'lugar:lugar_id(nombre)', 'viaje:viaje_id(id, inicio, fin']) {
    assert.ok(SELECT_EXPORTACION.includes(embed), `falta ${embed}`)
  }
  assert.ok(SELECT_EXPORTACION.startsWith('*, '))
})
