<script setup>
import { computed, ref, onBeforeUnmount, watch } from 'vue'
import { apiRequest, apiUrl } from '../lib/api'
import { fetchActivacionDetalle, fetchActivacionesExportacion } from '../lib/activacionesService'
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
  requestPasswordConfirmation,
} from '../lib/feedback'
import { isValidEmail, normalizeEmail, normalizeText } from '../lib/textUtils'
import { useAuth } from '../lib/authStore'
import { etiquetaCiudadActivacion } from '../lib/plazas'
import { logClientError } from '../lib/logging'
import { MIME_XLSX, descargarArchivo } from '../lib/reportes/descarga'
import { generarExcel, nombreArchivoExcel } from '../lib/reportes/excel'
import { generarReporteYolopago, nombreArchivoYolopago } from '../lib/reportes/yolopago/generar'
import {
  ACTIVATION_CATEGORIES,
  ACTIVATION_ERROR_TYPES,
  ACTIVATION_TYPES_BY_CATEGORY,
  COMMERCE_CATEGORIES,
  STORE_SIZES,
  inferActivationCategory,
  isCreditosEligible,
  isGeneralCommerce,
  isRemesasEligible,
  normalizeActivationClassification,
  secondaryPhotoLabel,
  validateActivationEdit,
  validateActivationTextLengths,
} from '../lib/activationEditing'

const props = defineProps({
  activaciones: {
    type: Array,
    default: () => [],
  },
  total: { type: Number, default: 0 },
  page: { type: Number, default: 1 },
  pageSize: { type: Number, default: 50 },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['activacion-eliminada', 'activacion-actualizada', 'filtrar', 'cambiar-pagina'])

const boliviaDateTimeFormatter = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/La_Paz',
})
const boliviaTimeFormatter = new Intl.DateTimeFormat('es-BO', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'America/La_Paz',
})

const filtroPlaza = ref('')
const filtroDistrito = ref('')
const filtroImpulsador = ref('')
const filtroFechaDesde = ref('')
const filtroFechaHasta = ref('')
const exportandoExcel = ref(false)
const deletingActivationId = ref(null)
const activacionSeleccionada = ref(null)
const editandoActivacion = ref(false)
const guardandoEdicion = ref(false)
const reemplazandoFoto = ref('')
const fotoPrincipalArchivo = ref(null)
const fotoCashInArchivo = ref(null)
const inputFotoPrincipal = ref(null)
const inputFotoCashIn = ref(null)
const formularioEdicion = ref({})
const formularioEdicionInicial = ref({})
const motivoEdicion = ref('')
const { isAdmin } = useAuth()

function getCiudadActivacion(activacion) {
  return etiquetaCiudadActivacion(activacion)
}

function normalizeDateOnly(value) {
  const normalized = normalizeText(value)
  if (!normalized) {
    return ''
  }

  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

const filas = computed(() => props.activaciones)
const totalPaginas = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const rangoVisible = computed(() => {
  if (!props.total) return '0'
  const desde = (props.page - 1) * props.pageSize + 1
  return `${desde}-${Math.min(props.total, desde + props.activaciones.length - 1)}`
})

function filtrosActuales() {
  return {
    plaza: filtroPlaza.value.trim(),
    distrito: filtroDistrito.value.trim(),
    impulsador: filtroImpulsador.value.trim(),
    fechaDesde: filtroFechaDesde.value,
    fechaHasta: filtroFechaHasta.value,
  }
}

let temporizadorFiltros = null
watch([filtroPlaza, filtroDistrito, filtroImpulsador, filtroFechaDesde, filtroFechaHasta], () => {
  clearTimeout(temporizadorFiltros)
  temporizadorFiltros = setTimeout(() => emit('filtrar', filtrosActuales()), 300)
})
onBeforeUnmount(() => clearTimeout(temporizadorFiltros))

function getFotoUrl(fotoUrl, signedUrl = '') {
  if (signedUrl) {
    return signedUrl
  }

  if (!fotoUrl || !/^https?:\/\//i.test(fotoUrl)) {
    return ''
  }

  return fotoUrl
}


function getRowKey(activacion, index) {
  return (
    activacion.id ??
    `${activacion.usuario_id ?? 'sin-usuario'}-${activacion.created_at ?? 'sin-fecha'}-${index}`
  )
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Se produjo un error inesperado.'
}

function formatCreatedAtBolivia(value, { emptyValue = '-' } = {}) {
  if (!value) {
    return emptyValue
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return boliviaDateTimeFormatter.format(date)
}

function formatHoraRegistro(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : boliviaTimeFormatter.format(date)
}

function tieneValor(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function esUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function etiquetaCampo(key, row = {}) {
  if (key === 'foto_cash_in') return `Foto ${secondaryPhotoLabel(row)}`
  const especiales = {
    id: 'ID del registro', usuario_id: 'ID del usuario', usuario_email: 'Correo del activador',
    created_at: 'Fecha de registro',
    fecha_activacion: 'Fecha de activacion', nombres_cliente: 'Nombres del cliente',
    apellidos_cliente: 'Apellidos del cliente', ci_cliente: 'CI del cliente',
    telefono_cliente: 'Telefono del cliente', email_cliente: 'Correo del cliente',
    ciudad_activacion: 'Ciudad de activacion', zona_activacion: 'Barrio / zona', zona_fuente: 'Origen del barrio',
    plaza_base_registro: 'Plaza organizacional (base)',
    tipo_activacion: 'Subtipo', tipo_comercio: 'Tipo de comercio',
    tamano_tienda: 'Tamano de tienda', foto_url: 'Fotografia', descargo_app: 'Descargo la app',
    cash_in: 'Cash-In', cash_out: 'Cash-Out', qr_fisico: 'QR fisico', p2p: 'P2P',
    hubo_error: 'Hubo error', descripcion_error: 'Descripcion del error',
    creditos: 'Créditos', remesas: 'Remesas',
  }
  return especiales[key] ?? key.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}

const ORIGEN_ZONA = { gps: 'GPS', elegida: 'Elegida por el activador', escrita: 'Escrita por el activador' }

function formatearValor(value, key) {
  if (key === 'zona_fuente') return ORIGEN_ZONA[value] ?? String(value)
  if (typeof value === 'boolean') return value ? 'Si' : 'No'
  if ((key.includes('fecha') || key.endsWith('_at')) && value) {
    if (key.endsWith('_at')) return formatCreatedAtBolivia(value)
    const dateOnly = normalizeDateOnly(value)
    if (dateOnly) {
      const [year, month, day] = dateOnly.split('-')
      return `${day}/${month}/${year}`
    }
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const seccionesDetalleConfig = [
  { title: 'Datos generales', keys: ['fecha_activacion', 'impulsador', 'ciudad_activacion', 'plaza', 'zona_activacion', 'zona_fuente'] },
  { title: 'Plaza organizacional', keys: ['plaza_base_registro'] },
  { title: 'Datos del cliente', keys: ['nombres_cliente', 'apellidos_cliente', 'ci_cliente', 'telefono_cliente', 'email_cliente'] },
  { title: 'Informacion de la activacion', keys: ['tipo_activacion', 'descargo_app', 'registro', 'cash_in', 'cash_out', 'p2p', 'qr_fisico', 'respaldo', 'creditos', 'remesas'] },
  { title: 'Informacion del comercio o tienda', keys: ['nombre_comercio', 'comercio', 'cliente', 'tipo_comercio', 'tamano_tienda', 'tipo_tienda', 'rubro_comercio', 'rubro_comercio_otro', 'comercio_fuera_mercado'] },
  { title: 'Evidencias y fotografias', keys: ['foto_url', 'foto_cash_in'] },
  { title: 'Ubicacion', keys: ['latitud', 'longitud', 'direccion', 'ubicacion'] },
  { title: 'Errores u observaciones', keys: ['hubo_error', 'tipo_error', 'descripcion_error', 'observaciones'] },
  { title: 'Informacion tecnica del registro', keys: ['id', 'usuario_email', 'created_at', 'updated_at'] },
]

const seccionesDetalle = computed(() => {
  const row = activacionSeleccionada.value
  if (!row) return []
  const usedKeys = new Set(seccionesDetalleConfig.flatMap((section) => section.keys))
  const siempreVisibles = new Set(['creditos', 'remesas'])
  const sections = seccionesDetalleConfig.map((section) => ({
    title: section.title,
    fields: section.keys
      .filter((key) => key === 'ciudad_activacion' || tieneValor(row[key]) || siempreVisibles.has(key))
      .map((key) => ({
        key,
        label: etiquetaCampo(key, row),
        value: key === 'ciudad_activacion'
          ? etiquetaCiudadActivacion(row)
          : (siempreVisibles.has(key) ? row[key] === true : row[key]),
        signedUrl: getFotoSignedUrl(row, key),
        image: key.toLowerCase().includes('foto'),
      })),
  }))
  const ocultos = tieneValor(row.usuario_email) ? new Set(['usuario_id']) : new Set()
  const extras = Object.entries(row)
    .filter(([key, value]) => !usedKeys.has(key) && !ocultos.has(key) && tieneValor(value))
    .map(([key, value]) => ({ key, label: etiquetaCampo(key, row), value, signedUrl: getFotoSignedUrl(row, key), image: key.toLowerCase().includes('foto') }))
  sections.at(-1).fields.push(...extras)
  return sections.filter((section) => section.fields.length)
})

function getClienteComercio(activacion) {
  return activacion.nombre_comercio ?? activacion.comercio ?? activacion.cliente ??
    ([activacion.nombres_cliente, activacion.apellidos_cliente].filter(Boolean).join(' ') || '-')
}

function getFotoSignedUrl(row, key) {
  if (key === 'foto_url') return row.foto_url_signed ?? ''
  if (key === 'foto_cash_in') return row.foto_cash_in_signed ?? ''
  return ''
}

function getResultado(activacion) {
  if (activacion.hubo_error === true) return 'Con error'
  return activacion.resultado ?? activacion.estado ?? 'Registrada'
}

const cargandoDetalle = ref(false)
let solicitudDetalle = 0
async function abrirDetalle(activacion) {
  activacionSeleccionada.value = activacion
  if (!activacion?.id) return
  const solicitud = ++solicitudDetalle
  cargandoDetalle.value = true
  try {
    const completa = await fetchActivacionDetalle(activacion.id)
    if (solicitud === solicitudDetalle && completa) activacionSeleccionada.value = completa
  } catch (error) {
    if (solicitud !== solicitudDetalle) return
    logClientError('activaciones.detalle', error)
    notifyError(getErrorMessage(error))
  } finally {
    if (solicitud === solicitudDetalle) cargandoDetalle.value = false
  }
}
function limpiarFotosSeleccionadas() {
  fotoPrincipalArchivo.value = null
  fotoCashInArchivo.value = null
  if (inputFotoPrincipal.value) inputFotoPrincipal.value.value = ''
  if (inputFotoCashIn.value) inputFotoCashIn.value.value = ''
}
function cerrarDetalle() {
  if (guardandoEdicion.value || reemplazandoFoto.value) return
  solicitudDetalle += 1
  cargandoDetalle.value = false
  activacionSeleccionada.value = null
  editandoActivacion.value = false
  limpiarFotosSeleccionadas()
}

function tieneCampo(row, key) {
  return Object.prototype.hasOwnProperty.call(row ?? {}, key)
}

const nombreComercialKey = computed(() => {
  const row = activacionSeleccionada.value
  const columns = ['nombre_comercio', 'comercio', 'cliente']
  return columns.find((key) => tieneValor(row?.[key])) ??
    columns.find((key) => tieneCampo(row, key)) ?? null
})
const esCategoriaPersona = computed(() => ['transeunte', 'cliente_antiguo'].includes(formularioEdicion.value.tipo_grupo))
const nombresVisible = computed(() => esCategoriaPersona.value || tieneValor(activacionSeleccionada.value?.nombres_cliente))
const nombreComercialVisible = computed(() => Boolean(nombreComercialKey.value) &&
  (!esCategoriaPersona.value || tieneValor(activacionSeleccionada.value?.[nombreComercialKey.value])))
const plazaEditableKey = computed(() => tieneCampo(activacionSeleccionada.value, 'ciudad_activacion') ? 'ciudad_activacion' : 'plaza')
const resultadoEditableKey = computed(() => ['resultado', 'estado'].find((key) => tieneCampo(activacionSeleccionada.value, key)) ?? null)
const tiposActivacionDisponibles = computed(() => ACTIVATION_TYPES_BY_CATEGORY[formularioEdicion.value.tipo_grupo] ?? [])
const esActivacionComercio = computed(() => isGeneralCommerce(
  formularioEdicion.value.tipo_grupo,
  formularioEdicion.value.tipo_activacion,
))
const esTiendaBarrio = computed(() => formularioEdicion.value.tipo_grupo === 'tienda_barrio')
const etiquetaFotoSecundaria = computed(() => secondaryPhotoLabel(activacionSeleccionada.value ?? {}))
const mostrarCreditos = computed(() => isCreditosEligible(formularioEdicion.value) || formularioEdicion.value.creditos === true)
const mostrarRemesas = computed(() => isRemesasEligible(formularioEdicion.value) || formularioEdicion.value.remesas === true)
const motivoEdicionFaltante = computed(() => !motivoEdicion.value.trim())

function iniciarEdicion() {
  const row = activacionSeleccionada.value
  if (!row) return
  formularioEdicion.value = {
    nombre_comercial: nombreComercialKey.value ? row[nombreComercialKey.value] ?? '' : '',
    nombres_cliente: row.nombres_cliente ?? '',
    apellidos_cliente: row.apellidos_cliente ?? '',
    ci_cliente: row.ci_cliente ?? '',
    telefono_cliente: row.telefono_cliente ?? '',
    email_cliente: row.email_cliente ?? '',
    plaza: row[plazaEditableKey.value] ?? '',
    zona_activacion: row.zona_activacion ?? '',
    tipo_grupo: inferActivationCategory(row),
    tipo_activacion: row.tipo_activacion ?? '',
    resultado: resultadoEditableKey.value ? row[resultadoEditableKey.value] ?? '' : '',
    tamano_tienda: row.tamano_tienda ?? row.tipo_tienda ?? '',
    tipo_tienda: row.tipo_tienda ?? null,
    tipo_comercio: row.tipo_comercio ?? null,
    rubro_comercio: row.rubro_comercio ?? '',
    rubro_comercio_otro: row.rubro_comercio_otro ?? '',
    comercio_fuera_mercado: typeof row.comercio_fuera_mercado === 'boolean' ? row.comercio_fuera_mercado : null,
    observaciones: row.observaciones ?? '',
    tipo_error: row.tipo_error ?? '',
    descripcion_error: row.descripcion_error ?? '',
    creditos: row.creditos === true,
    remesas: row.remesas === true,
    descargo_app: row.descargo_app === true,
    registro: row.registro === true,
    cash_in: row.cash_in === true,
    cash_out: row.cash_out === true,
    p2p: row.p2p === true,
    qr_fisico: row.qr_fisico === true,
    respaldo: row.respaldo === true,
    hubo_error: row.hubo_error === true,
  }
  formularioEdicionInicial.value = { ...formularioEdicion.value }
  motivoEdicion.value = ''
  limpiarFotosSeleccionadas()
  editandoActivacion.value = true
}

function confirmarCambioClasificacion(mensaje) {
  return typeof window === 'undefined' || window.confirm(mensaje)
}

function cambiarCategoria(event) {
  const categoria = event.target.value
  const actual = formularioEdicion.value.tipo_grupo
  if (categoria === actual) return
  if (!confirmarCambioClasificacion('Cambiar la categoría limpiará únicamente los campos incompatibles. ¿Continuar?')) {
    event.target.value = actual
    return
  }
  formularioEdicion.value = normalizeActivationClassification({
    ...formularioEdicion.value,
    tipo_grupo: categoria,
    tipo_activacion: '',
  })
}

function cambiarTipoActivacion(event) {
  const tipo = event.target.value
  const actual = formularioEdicion.value.tipo_activacion
  if (tipo === actual) return
  const limpiaComercio = esActivacionComercio.value &&
    !isGeneralCommerce(formularioEdicion.value.tipo_grupo, tipo)
  if (limpiaComercio && !confirmarCambioClasificacion('Este tipo no utiliza datos de rubro comercial. ¿Cambiar y limpiar esos campos?')) {
    event.target.value = actual
    return
  }
  formularioEdicion.value = normalizeActivationClassification({
    ...formularioEdicion.value,
    tipo_activacion: tipo,
  })
}

function cancelarEdicion() {
  if (guardandoEdicion.value || reemplazandoFoto.value) return
  editandoActivacion.value = false
  formularioEdicion.value = {}
  formularioEdicionInicial.value = {}
  motivoEdicion.value = ''
  limpiarFotosSeleccionadas()
}

function seleccionarFoto(tipo, event) {
  const file = event.target.files?.[0] ?? null
  const target = tipo === 'principal' ? fotoPrincipalArchivo : fotoCashInArchivo
  if (!file) { target.value = null; return }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    event.target.value = ''
    target.value = null
    notifyWarning('La foto debe ser JPEG, PNG o WebP.')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    event.target.value = ''
    target.value = null
    notifyWarning('La foto no puede superar 10 MB.')
    return
  }
  target.value = file
}

async function reemplazarFoto(tipo) {
  if (!isAdmin.value) {
    notifyWarning('Sesion administrativa requerida.')
    return
  }
  const activationId = normalizeText(activacionSeleccionada.value?.id)
  const file = tipo === 'principal' ? fotoPrincipalArchivo.value : fotoCashInArchivo.value
  if (!activationId || !file) {
    notifyWarning(!activationId ? 'La activacion no tiene ID.' : 'Selecciona una foto valida.')
    return
  }

  reemplazandoFoto.value = tipo
  try {
    const payload = await apiRequest(`/admin/activaciones/${encodeURIComponent(activationId)}/fotos/${tipo}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    activacionSeleccionada.value = payload.activation
    emit('activacion-actualizada', { activation: payload.activation })
    limpiarFotosSeleccionadas()
    if (payload.warning) notifyWarning(payload.warning)
    else notifySuccess(tipo === 'principal' ? 'Evidencia principal reemplazada.' : `Evidencia ${etiquetaFotoSecundaria.value} reemplazada.`)
  } catch (error) {
    notifyError(getErrorMessage(error))
  } finally {
    reemplazandoFoto.value = ''
  }
}

function validarEdicion() {
  const form = formularioEdicion.value
  const classificationError = validateActivationEdit(form, motivoEdicion.value, activacionSeleccionada.value)
  if (classificationError) return classificationError
  const textLengthError = validateActivationTextLengths(form)
  if (textLengthError) return textLengthError
  if (form.email_cliente && !isValidEmail(normalizeEmail(form.email_cliente))) return 'Ingresa un correo valido.'
  if (form.telefono_cliente && !/^\+?[0-9\s()-]{6,20}$/.test(form.telefono_cliente.trim())) return 'Ingresa un telefono valido.'
  if (form.hubo_error && !form.tipo_error) return 'Selecciona el tipo de error.'
  if (form.hubo_error && form.tipo_error === 'Otro' && !form.descripcion_error.trim()) return 'Describe el error.'
  return null
}

function construirCambiosEdicion() {
  const form = normalizeActivationClassification(formularioEdicion.value, activacionSeleccionada.value)
  const initial = normalizeActivationClassification(formularioEdicionInicial.value, activacionSeleccionada.value)
  const sizeChanged = form.tamano_tienda !== initial.tamano_tienda
  if (form.tipo_grupo === 'tienda_barrio' && sizeChanged) form.tipo_tienda = form.tamano_tienda
  const changes = {}
  const setIfChanged = (key, value) => {
    if (value !== initial[key]) changes[key] = value
  }
  if (nombreComercialKey.value) setIfChanged(nombreComercialKey.value, form.nombre_comercial)
  setIfChanged('nombres_cliente', form.nombres_cliente)
  setIfChanged('apellidos_cliente', form.apellidos_cliente)
  setIfChanged('ci_cliente', form.ci_cliente)
  setIfChanged('telefono_cliente', form.telefono_cliente)
  setIfChanged('email_cliente', form.email_cliente)
  setIfChanged('zona_activacion', form.zona_activacion)
  setIfChanged('observaciones', form.observaciones)
  setIfChanged('tipo_error', form.tipo_error)
  setIfChanged('descripcion_error', form.descripcion_error)
  const classificationFields = [
    'tipo_activacion', 'tamano_tienda', 'tipo_tienda', 'tipo_comercio',
    'rubro_comercio', 'rubro_comercio_otro', 'comercio_fuera_mercado',
  ]
  if (form.tipo_grupo !== initial.tipo_grupo || classificationFields.some((key) => form[key] !== initial[key])) {
    classificationFields.forEach((key) => { changes[key] = form[key] })
    if (!sizeChanged) {
      delete changes.tipo_tienda
      delete changes.tamano_tienda
    }
  }
  for (const key of ['descargo_app', 'registro', 'cash_in', 'cash_out', 'p2p', 'qr_fisico', 'respaldo', 'creditos', 'remesas', 'hubo_error']) {
    if (form[key] !== initial[key]) changes[key] = form[key]
  }
  if (resultadoEditableKey.value) setIfChanged(resultadoEditableKey.value, form.resultado)
  return changes
}

async function guardarEdicion() {
  const validationError = validarEdicion()
  if (validationError) { notifyWarning(validationError); return }
  const activationId = normalizeText(activacionSeleccionada.value?.id)
  if (!activationId || !isAdmin.value) {
    notifyWarning(!activationId ? 'La activacion no tiene ID.' : 'Sesion administrativa requerida.')
    return
  }
  guardandoEdicion.value = true
  try {
    const result = await apiRequest(`/admin/activaciones/${encodeURIComponent(activationId)}`, {
      method: 'PATCH',
      body: {
        changes: construirCambiosEdicion(),
        motivoEdicion: motivoEdicion.value.trim(),
        categoriaActivacion: formularioEdicion.value.tipo_grupo,
      },
    })
    activacionSeleccionada.value = result.activation
    emit('activacion-actualizada', { activation: result.activation })
    editandoActivacion.value = false
    formularioEdicion.value = {}
    formularioEdicionInicial.value = {}
    motivoEdicion.value = ''
    notifySuccess('Activacion actualizada correctamente.')
  } catch (error) { notifyError(getErrorMessage(error)) }
  finally { guardandoEdicion.value = false }
}

async function eliminarActivacion(activacion) {
  if (!isAdmin.value) {
    notifyWarning('Sesion administrativa requerida.')
    return
  }

  const activacionId = normalizeText(activacion?.id)
  if (!activacionId) {
    notifyWarning('Esta activacion no tiene ID y no se puede eliminar de forma segura.')
    return
  }

  const password = await requestPasswordConfirmation({
    title: 'Eliminar activacion',
    message: 'Ingresa tu contraseña actual para eliminar el registro y sus fotos de forma permanente.',
    confirmLabel: 'Eliminar definitivamente',
  })
  if (!password) return

  deletingActivationId.value = activacionId

  try {
    const result = await apiRequest(`/admin/activaciones/${encodeURIComponent(activacionId)}`, {
      method: 'DELETE',
      body: { password },
    })

    emit('activacion-eliminada', { id: activacionId })
    activacionSeleccionada.value = null

    if (result?.photoDelete?.ok === false) {
      notifyWarning(
        'Activacion eliminada, pero no fue posible borrar la foto en Storage. Revisa limpieza manual.'
      )
    } else if (result?.photoDelete?.attempted) {
      notifySuccess('Activacion y foto eliminadas correctamente.')
    } else {
      notifySuccess('Activacion eliminada correctamente.')
    }
  } catch (error) {
    notifyError(getErrorMessage(error))
  } finally {
    deletingActivationId.value = null
  }
}

async function exportar(contexto, generar) {
  exportandoExcel.value = true
  try {
    const filtros = filtrosActuales()
    const datos = await fetchActivacionesExportacion(filtros)
    if (!datos.length) {
      notifyInfo('No hay datos para exportar con los filtros actuales.')
      return
    }

    const ExcelJS = await import('exceljs')
    const { content, filename } = await generar(ExcelJS, datos, filtros)
    descargarArchivo({ filename, content, mimeType: MIME_XLSX })
    notifySuccess(`Excel exportado con ${datos.length} registros.`)
  } catch (error) {
    logClientError(`activaciones.export.${contexto}`, error)
    notifyError(getErrorMessage(error))
  } finally {
    exportandoExcel.value = false
  }
}

const exportarExcel = () => exportar('excel', async (ExcelJS, datos, filtros) => ({
  filename: nombreArchivoExcel(filtros),
  content: await generarExcel(ExcelJS, datos, { urlEvidencia: apiUrl }),
}))

const exportarExcelYolopago = () => exportar('yolopago', async (ExcelJS, datos, filtros) => ({
  filename: nombreArchivoYolopago(filtros),
  content: await generarReporteYolopago(ExcelJS, datos, { urlEvidencia: apiUrl }),
}))

</script>

<template>
  <div class="activaciones-container section-block">
    <div class="section-head">
      <h2 class="section-title">Bitacora Completa</h2>
      <p class="section-caption">
        Filtra la base por rango de fechas, impulsador, plaza o distrito y exporta los resultados.
      </p>
    </div>
    <div class="filtros filtros-grid filtros-activaciones">
      <label>
        <span class="field-label">Fecha desde</span>
        <input v-model="filtroFechaDesde" type="date" class="input-texto" />
      </label>

      <label>
        <span class="field-label">Fecha hasta</span>
        <input v-model="filtroFechaHasta" type="date" class="input-texto" />
      </label>

      <label>
        <span class="field-label">Impulsador</span>
        <input
          v-model="filtroImpulsador"
          type="text"
          placeholder="Buscar impulsador"
          class="input-texto"
        />
      </label>

      <label>
        <span class="field-label">Ciudad</span>
        <input
          v-model="filtroPlaza"
          type="text"
          placeholder="Buscar ciudad"
          class="input-texto"
        />
      </label>

      <label>
        <span class="field-label">Distrito</span>
        <input
          v-model="filtroDistrito"
          type="text"
          placeholder="Buscar distrito"
          class="input-texto"
        />
      </label>
    </div>

    <div class="toolbar-line">
      <div class="toolbar-actions">
        <button type="button" class="boton-exportar boton-exportar-excel" :disabled="exportandoExcel || deletingActivationId || !total" @click="exportarExcel">Exportar Excel</button>
        <button type="button" class="boton-exportar boton-exportar-yolopago" :disabled="exportandoExcel || deletingActivationId || !total" @click="exportarExcelYolopago">Exportar Excel Yolopago</button>
      </div>
      <span class="meta-pill">{{ loading ? 'Cargando...' : `${total} registros` }}</span>
    </div>

    <p v-if="loading && filas.length === 0" class="panel-empty">Cargando activaciones...</p>
    <p v-else-if="filas.length === 0" class="panel-empty">
      No hay registros para los filtros seleccionados.
    </p>

    <div v-else class="table-wrap activaciones-table-wrap activaciones-resumen-wrap" :class="{ 'tabla-cargando': loading }">
      <table class="tabla-activaciones">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Activador o impulsador</th>
            <th>Cliente o comercio</th>
            <th>Subtipo</th>
            <th>Ciudad</th>
            <th>Estado o resultado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(activacion, index) in filas" :key="getRowKey(activacion, index)" class="activacion-row" tabindex="0" @click="abrirDetalle(activacion)" @keydown.enter="abrirDetalle(activacion)">
            <td>{{ activacion.fecha_activacion || formatCreatedAtBolivia(activacion.created_at) }}</td>
            <td>{{ formatHoraRegistro(activacion.created_at) }}</td>
            <td>{{ activacion.impulsador || '-' }}</td>
            <td>{{ getClienteComercio(activacion) }}</td>
            <td>{{ activacion.tipo_activacion || '-' }}</td>
            <td>{{ getCiudadActivacion(activacion) }}</td>
            <td><span class="resultado-etiqueta" :class="{ 'resultado-error': activacion.hubo_error === true }">{{ getResultado(activacion) }}</span></td>
            <td>
              <div class="acciones">
                <button class="boton boton-editar" @click.stop="abrirDetalle(activacion)">Ver detalle</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > pageSize" class="activaciones-paginacion">
      <button type="button" class="boton boton-pequeno" :disabled="loading || page <= 1" @click="emit('cambiar-pagina', page - 1)">Anterior</button>
      <span>{{ rangoVisible }} de {{ total }}</span>
      <button type="button" class="boton boton-pequeno" :disabled="loading || page >= totalPaginas" @click="emit('cambiar-pagina', page + 1)">Siguiente</button>
    </div>

    <teleport to="body">
      <div v-if="activacionSeleccionada" class="detalle-overlay" @click.self="cerrarDetalle">
        <aside class="detalle-activacion" role="dialog" aria-modal="true" aria-label="Detalle de activacion">
          <header class="detalle-header">
            <div><p class="view-kicker">Registro de activacion</p><h3 class="detalle-title">{{ getClienteComercio(activacionSeleccionada) }}</h3></div>
            <button v-if="isAdmin && !editandoActivacion" type="button" class="boton boton-editar" :disabled="!activacionSeleccionada.id || cargandoDetalle" @click="iniciarEdicion">Editar</button>
            <button type="button" class="detalle-close" aria-label="Cerrar detalle" @click="cerrarDetalle">×</button>
          </header>
          <p v-if="cargandoDetalle" class="panel-empty">Cargando detalle completo...</p>
          <form v-if="editandoActivacion" class="detalle-body" @submit.prevent="guardarEdicion">
            <fieldset class="edicion-activacion" :disabled="guardandoEdicion || Boolean(reemplazandoFoto)">
              <label v-if="nombreComercialVisible"><span class="field-label">Nombre del cliente o comercio</span><input v-model="formularioEdicion.nombre_comercial" class="input-texto"></label>
              <label v-if="nombresVisible"><span class="field-label">Nombres</span><input v-model="formularioEdicion.nombres_cliente" class="input-texto"></label>
              <label v-if="nombresVisible"><span class="field-label">Apellidos</span><input v-model="formularioEdicion.apellidos_cliente" class="input-texto"></label>
              <label v-if="nombresVisible"><span class="field-label">Cédula de identidad</span><input v-model="formularioEdicion.ci_cliente" class="input-texto"></label>
              <label><span class="field-label">Telefono</span><input v-model="formularioEdicion.telefono_cliente" class="input-texto" inputmode="tel"></label>
              <label><span class="field-label">Correo</span><input v-model="formularioEdicion.email_cliente" type="email" class="input-texto"></label>
              <label><span class="field-label">Ciudad de activación (por GPS)</span><input :value="formularioEdicion.plaza" class="input-texto" disabled></label>
              <label><span class="field-label">Barrio / zona</span><input v-model="formularioEdicion.zona_activacion" class="input-texto"></label>
              <label><span class="field-label">Categoría</span><select :value="formularioEdicion.tipo_grupo" class="input-texto" @change="cambiarCategoria"><option value="">Selecciona categoría</option><option v-for="categoria in ACTIVATION_CATEGORIES" :key="categoria.key" :value="categoria.key">{{ categoria.label }}</option></select></label>
              <label><span class="field-label">Subtipo</span><select :value="formularioEdicion.tipo_activacion" class="input-texto" :disabled="!formularioEdicion.tipo_grupo" @change="cambiarTipoActivacion"><option value="">Selecciona subtipo</option><option v-if="formularioEdicion.tipo_activacion && !tiposActivacionDisponibles.some((item) => item.key === formularioEdicion.tipo_activacion)" :value="formularioEdicion.tipo_activacion">Histórico: {{ formularioEdicion.tipo_activacion }}</option><option v-for="tipo in tiposActivacionDisponibles" :key="tipo.key" :value="tipo.key">{{ tipo.label }}</option></select></label>
              <label v-if="esTiendaBarrio"><span class="field-label">Tamaño de tienda</span><select v-model="formularioEdicion.tamano_tienda" class="input-texto"><option value="">Selecciona tamaño</option><option v-if="formularioEdicion.tamano_tienda && !STORE_SIZES.includes(formularioEdicion.tamano_tienda)" :value="formularioEdicion.tamano_tienda">Histórico: {{ formularioEdicion.tamano_tienda }}</option><option v-for="tamano in STORE_SIZES" :key="tamano" :value="tamano">{{ tamano }}</option></select></label>
              <label v-if="resultadoEditableKey"><span class="field-label">Resultado o estado</span><input v-model="formularioEdicion.resultado" class="input-texto"></label>
              <template v-if="esActivacionComercio">
                <label><span class="field-label">Rubro del comercio</span><select v-model="formularioEdicion.rubro_comercio" class="input-texto"><option value="">Selecciona rubro</option><option v-if="formularioEdicion.rubro_comercio && !COMMERCE_CATEGORIES.includes(formularioEdicion.rubro_comercio)" :value="formularioEdicion.rubro_comercio">Histórico: {{ formularioEdicion.rubro_comercio }}</option><option v-for="rubro in COMMERCE_CATEGORIES" :key="rubro" :value="rubro">{{ rubro }}</option></select></label>
                <label v-if="formularioEdicion.rubro_comercio === 'Otro'"><span class="field-label">Otro rubro</span><input v-model="formularioEdicion.rubro_comercio_otro" class="input-texto"></label>
                <label><span class="field-label">Comercio fuera de mercado</span><select v-model="formularioEdicion.comercio_fuera_mercado" class="input-texto"><option :value="null">Selecciona</option><option :value="false">No</option><option :value="true">Si</option></select></label>
              </template>
              <label v-if="mostrarCreditos"><span class="field-label">Créditos</span><select v-model="formularioEdicion.creditos" class="input-texto"><option :value="false">No</option><option :value="true">Sí</option></select></label>
              <label v-if="mostrarRemesas"><span class="field-label">Remesas</span><select v-model="formularioEdicion.remesas" class="input-texto"><option :value="false">No</option><option :value="true">Sí</option></select></label>
              <label v-for="campo in [{ key: 'descargo_app', label: 'Descargó la app' }, { key: 'registro', label: 'Registro' }, { key: 'cash_in', label: 'Cash-In' }, { key: 'cash_out', label: 'Cash-Out' }, { key: 'p2p', label: 'P2P' }, { key: 'qr_fisico', label: 'QR físico' }, { key: 'respaldo', label: 'Respaldo' }]" :key="campo.key"><span class="field-label">{{ campo.label }}</span><select v-model="formularioEdicion[campo.key]" class="input-texto"><option :value="false">No</option><option :value="true">Sí</option></select></label>
              <label class="edicion-field-wide"><span class="field-label">Observaciones</span><textarea v-model="formularioEdicion.observaciones" class="input-texto" rows="3"></textarea></label>
              <label><span class="field-label">Hubo error</span><select v-model="formularioEdicion.hubo_error" class="input-texto"><option :value="false">No</option><option :value="true">Sí</option></select></label>
              <label v-if="formularioEdicion.hubo_error"><span class="field-label">Tipo de error</span><select v-model="formularioEdicion.tipo_error" class="input-texto"><option value="">Selecciona tipo</option><option v-if="formularioEdicion.tipo_error && !ACTIVATION_ERROR_TYPES.includes(formularioEdicion.tipo_error)" :value="formularioEdicion.tipo_error">Histórico: {{ formularioEdicion.tipo_error }}</option><option v-for="tipoError in ACTIVATION_ERROR_TYPES" :key="tipoError" :value="tipoError">{{ tipoError }}</option></select></label>
              <label v-if="formularioEdicion.hubo_error && formularioEdicion.tipo_error === 'Otro'" class="edicion-field-wide"><span class="field-label">Descripcion del error</span><textarea v-model="formularioEdicion.descripcion_error" class="input-texto" rows="3"></textarea></label>
              <label v-if="isAdmin"><span class="field-label">Evidencia principal</span><input ref="inputFotoPrincipal" type="file" accept="image/jpeg,image/png,image/webp" class="input-texto" @change="seleccionarFoto('principal', $event)"><button type="button" class="boton boton-editar" :disabled="!fotoPrincipalArchivo" @click="reemplazarFoto('principal')">{{ reemplazandoFoto === 'principal' ? 'Reemplazando...' : 'Reemplazar evidencia' }}</button></label>
              <label v-if="isAdmin"><span class="field-label">Evidencia {{ etiquetaFotoSecundaria }}</span><input ref="inputFotoCashIn" type="file" accept="image/jpeg,image/png,image/webp" class="input-texto" @change="seleccionarFoto('cash-in', $event)"><button type="button" class="boton boton-editar" :disabled="!fotoCashInArchivo" @click="reemplazarFoto('cash-in')">{{ reemplazandoFoto === 'cash-in' ? 'Reemplazando...' : `Reemplazar ${etiquetaFotoSecundaria}` }}</button></label>
              <label class="edicion-field-wide"><span class="field-label">Motivo de edicion</span><textarea v-model="motivoEdicion" class="input-texto" rows="3" placeholder="Obligatorio"></textarea></label>
              <p v-if="motivoEdicionFaltante" class="inline-warning edicion-field-wide">Guardar se habilitará cuando ingreses el motivo de edición.</p>
            </fieldset>
            <div class="confirm-actions"><button type="button" class="boton boton-cancelar" :disabled="guardandoEdicion" @click="cancelarEdicion">Cancelar</button><button type="submit" class="boton boton-guardar" :disabled="guardandoEdicion || motivoEdicionFaltante" :title="motivoEdicionFaltante ? 'Ingresa el motivo de edición para guardar.' : ''">{{ guardandoEdicion ? 'Guardando...' : 'Guardar cambios' }}</button></div>
          </form>
          <div v-else class="detalle-body">
            <section v-for="section in seccionesDetalle" :key="section.title" class="detalle-section">
              <h4>{{ section.title }}</h4>
              <dl class="detalle-grid">
                <div v-for="field in section.fields" :key="field.key" class="detalle-field" :class="{ 'detalle-field-wide': field.image || typeof field.value === 'object' }">
                  <dt>{{ field.label }}</dt>
                  <dd v-if="field.image">
                    <a v-if="getFotoUrl(field.value, field.signedUrl)" :href="getFotoUrl(field.value, field.signedUrl)" target="_blank" rel="noreferrer"><img :src="getFotoUrl(field.value, field.signedUrl)" :alt="field.label" class="detalle-thumbnail"></a>
                    <span v-else>No disponible</span>
                  </dd>
                  <dd v-else-if="esUrl(field.value)"><a :href="field.value" target="_blank" rel="noreferrer" class="link-foto">Abrir enlace</a></dd>
                  <dd v-else>{{ formatearValor(field.value, field.key) }}</dd>
                </div>
              </dl>
            </section>
            <div v-if="isAdmin" class="confirm-actions"><button type="button" class="boton boton-eliminar" :disabled="deletingActivationId === activacionSeleccionada.id || !activacionSeleccionada.id" @click="eliminarActivacion(activacionSeleccionada)">{{ deletingActivationId === activacionSeleccionada.id ? 'Eliminando...' : 'Eliminar activacion' }}</button></div>
          </div>
        </aside>
      </div>
    </teleport>
  </div>
</template>
