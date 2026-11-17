import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { ACTIVATION_TYPES_BY_CATEGORY } from '../src/lib/activationEditing.js'
import { aFilaYolopago } from '../src/lib/reportes/yolopago/adaptador.js'
import { COLUMNAS_YOLOPAGO } from '../src/lib/reportes/yolopago/columnas.js'
import { nombreArchivoExcel } from '../src/lib/reportes/excel.js'
import { HOJA_YOLOPAGO, generarReporteYolopago, nombreArchivoYolopago } from '../src/lib/reportes/yolopago/generar.js'
import { etiquetaSubtipo } from '../src/lib/reportes/yolopago/vocabulario.js'

const urlEvidencia = (ruta) => `https://portal.test${ruta}`

const base = {
  created_at: '2026-10-23T16:22:05.524Z',
  fecha_activacion: '2026-10-23',
  tipo_activacion: 'comercio',
  ciudad_activacion: 'Santa Cruz de la Sierra',
  zona_activacion: 'San Jose',
  impulsador: 'Francia Semizo',
  nombres_cliente: 'Eddy Luis',
  apellidos_cliente: 'Huarachi Ramos',
  ci_cliente: '1878684',
  telefono_cliente: '67378866',
  hubo_error: false,
  creditos: true,
  remesas: false,
  foto_url_evidencia: '/evidencia/1/principal/abc',
  foto_cash_in_evidencia: '',
}

test('los encabezados son los de las columnas visibles del reporte del banco', () => {
  assert.deepEqual(COLUMNAS_YOLOPAGO.map((c) => c.header), [
    'Marca temporal', 'Tipo de Activación', 'Tamaño de la tienda', 'Tipo de Activación Tienda de Barrio',
    'Tipo de Activación Mercados', 'Tipo de Comercio', 'Ciudad de la activación', 'Zona Activacion Final',
    'Nombre Activador Final', 'Fecha de la activación', 'Nombre (s)*', 'Apellidos', 'Cédula de Identidad',
    'Teléfono celular ', '¿Hubo algún error?', 'Especifique que tipo de error ', 'Fotografía',
    'Comprobante Cash In', 'Creditos', 'Remesas',
  ])
})

test('todo tipo de activación interno tiene etiqueta YoloPago', () => {
  const claves = new Set(Object.values(ACTIVATION_TYPES_BY_CATEGORY).flat().map((tipo) => tipo.key))
  for (const clave of claves) {
    assert.notEqual(etiquetaSubtipo(clave), clave, `sin etiqueta para ${clave}`)
  }
})

test('mercados usa la columna E y la ciudad se abrevia', () => {
  const fila = aFilaYolopago(base, { urlEvidencia })
  assert.equal(fila.tipoActivacion, 'Mercados')
  assert.equal(fila.tipoMercados, 'Comercio')
  assert.equal(fila.tipoTienda, '')
  assert.equal(fila.tamanoTienda, '')
  assert.equal(fila.ciudad, 'Santa Cruz')
  assert.equal(fila.huboError, 'No')
  assert.equal(fila.creditos, 'Si')
  assert.equal(fila.remesas, 'No')
})

test('tienda de barrio usa la columna D y el tamaño', () => {
  const fila = aFilaYolopago(
    { ...base, categoria: 'tienda_barrio', tamano_tienda: 'Mediana', tipo_activacion: 'reimpresion_qr', ciudad_activacion: 'La Paz' },
    { urlEvidencia },
  )
  assert.equal(fila.tipoActivacion, 'Tiendas de barrio (Santa Cruz, La Paz, El Alto)')
  assert.equal(fila.tamanoTienda, 'Mediana')
  assert.equal(fila.tipoTienda, 'Reimpresion QR')
  assert.equal(fila.tipoMercados, '')
  assert.equal(fila.ciudad, 'La Paz')
})

test('fechas en hora de La Paz y cédula con cero inicial queda como texto', () => {
  const fila = aFilaYolopago({ ...base, ci_cliente: '0000', created_at: '2026-10-31T03:30:00Z' }, { urlEvidencia })
  assert.equal(fila.marcaTemporal.toISOString(), '2026-10-30T23:30:00.000Z')
  assert.equal(fila.fecha.toISOString(), '2026-10-23T00:00:00.000Z')
  assert.equal(fila.cedula, '0000')
  assert.equal(fila.telefono, 67378866)
})

test('enlaces de evidencia solo cuando hay foto y error combina tipo y descripción', () => {
  const fila = aFilaYolopago(
    { ...base, hubo_error: true, tipo_error: 'Otro', descripcion_error: 'Bloqueo facial' },
    { urlEvidencia },
  )
  assert.deepEqual(fila.fotografia, { text: 'https://portal.test/evidencia/1/principal/abc', hyperlink: 'https://portal.test/evidencia/1/principal/abc' })
  assert.equal(fila.comprobanteCashIn, '')
  assert.equal(fila.huboError, 'Si')
  assert.equal(fila.detalleError, 'Otro - Bloqueo facial')
})

test('el libro generado tiene la hoja, los encabezados y neutraliza fórmulas', async () => {
  const buffer = await generarReporteYolopago(ExcelJS, [{ ...base, nombres_cliente: '=HYPERLINK("x")' }], { urlEvidencia })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const hoja = workbook.getWorksheet(HOJA_YOLOPAGO)
  assert.equal(hoja.rowCount, 2)
  assert.equal(hoja.getRow(1).getCell(14).value, 'Teléfono celular ')
  assert.equal(hoja.getRow(2).getCell(11).value, `'=HYPERLINK("x")`)
  assert.equal(hoja.getRow(2).getCell(17).value.hyperlink, 'https://portal.test/evidencia/1/principal/abc')
  assert.equal(hoja.getRow(2).getCell(1).numFmt, 'm/d/yyyy h:mm:ss')
})

test('nombre de archivo por quincena o rango', () => {
  assert.equal(nombreArchivoYolopago({ fechaDesde: '2026-10-16', fechaHasta: '2026-10-31' }), 'activaciones_yolopago_2026-10-16_2026-10-31.xlsx')
  assert.equal(nombreArchivoYolopago({}), 'activaciones_yolopago.xlsx')
  assert.equal(nombreArchivoExcel({ fechaDesde: '2026-10-16', fechaHasta: '2026-10-31' }), 'activaciones_2026-10-16_2026-10-31.xlsx')
})
