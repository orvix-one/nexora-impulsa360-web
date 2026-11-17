import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { COLUMNAS_EXCEL, generarExcel } from '../src/lib/reportes/excel.js'

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
