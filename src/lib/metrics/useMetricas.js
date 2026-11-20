// @ts-check

import { computed, inject, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchMetricasActivaciones } from '../activacionesService.js'
import { apiRequest } from '../api.js'
import { logClientError } from '../logging.js'
import { calcularDashboard } from './agregados.js'
import { cargarDatosMetricas } from './carga.js'
import { dashboardCsv } from './exportCsv.js'
import { calendarioHoy } from './fechas.js'
import {
  construirOpciones,
  filtrosAQuery,
  filtrosDesdeQuery,
  hayFiltros,
  limpiarAmbito,
  sanearFiltros,
} from './filtros.js'
import { crearContexto } from './identidad.js'
import { municipioEnSeleccion } from './territorio.js'

const CLAVE = Symbol('metricas')

/** @param {Record<string, string>} a @param {Record<string, string>} b */
const mismaQuery = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function proveerMetricas() {
  const route = useRoute()
  const router = useRouter()
  const cargando = ref(true)
  const error = ref(/** @type {string | null} */ (null))
  const datos = shallowRef(
    /** @type {{ activaciones: import('./tipos.js').Activacion[], usuarios: import('./tipos.js').Usuario[], municipios: import('./tipos.js').Municipio[], eventos: import('./tipos.js').Evento[] }} */ ({
      activaciones: [],
      usuarios: [],
      municipios: [],
      eventos: [],
    }),
  )
  const hoy = ref(calendarioHoy())
  const actualizadoEn = ref(/** @type {Date | null} */ (null))
  const actualizando = ref(false)
  const filtros = reactive(filtrosDesdeQuery(route.query))
  const tab = computed(() => route.path.split('/').filter(Boolean).at(-1) ?? '')

  const ctx = computed(() => crearContexto(datos.value))
  const opciones = computed(() => construirOpciones(ctx.value))
  const dashboard = computed(() =>
    calcularDashboard({ activaciones: datos.value.activaciones, ctx: ctx.value, filtros, hoy: hoy.value, tab: tab.value }),
  )
  const hayFiltrosActivos = computed(() => hayFiltros(filtros, 'global'))

  watch(
    () => filtros.territorio,
    (territorio) => {
      const ciudad = opciones.value.zonas.find((o) => o.key === filtros.zona)?.ciudad
      if (filtros.zona && ciudad && !municipioEnSeleccion(ciudad, territorio, ctx.value)) filtros.zona = ''
    },
  )
  watch(filtros, () => {
    const query = filtrosAQuery(filtros)
    if (!mismaQuery(query, filtrosAQuery(filtrosDesdeQuery(route.query)))) router.replace({ query })
  })
  watch(
    () => route.query,
    (query) => {
      const desdeUrl = filtrosDesdeQuery(query)
      if (!mismaQuery(filtrosAQuery(desdeUrl), filtrosAQuery(filtros)))
        Object.assign(filtros, desdeUrl)
    },
  )

  async function cargar() {
    datos.value = await cargarDatosMetricas({
      fetchActivaciones: fetchMetricasActivaciones,
      solicitar: apiRequest,
      registrarError: logClientError,
    })
    hoy.value = calendarioHoy()
    actualizadoEn.value = new Date()
  }

  onMounted(async () => {
    try {
      await cargar()
      Object.assign(filtros, sanearFiltros({ ...filtros }, opciones.value))
    } catch (causa) {
      logClientError('metricas.fetch', causa)
      error.value = 'No fue posible obtener las activaciones.'
    } finally {
      cargando.value = false
    }
  })

  // A failed refresh keeps the data already on screen.
  async function actualizar() {
    if (actualizando.value || cargando.value) return
    actualizando.value = true
    try {
      await cargar()
    } catch (causa) {
      logClientError('metricas.refresh', causa)
    } finally {
      actualizando.value = false
    }
  }

  /** @param {'global' | 'resumen' | 'campo'} ambito */
  function limpiarFiltros(ambito = 'global') {
    limpiarAmbito(filtros, ambito)
  }

  function exportar() {
    if (!dashboard.value.rows.length) return
    const blob = new Blob([dashboardCsv(dashboard.value.rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'dashboard-activaciones.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const metricas = {
    cargando,
    error,
    datos,
    hoy,
    tab,
    ctx,
    filtros,
    actualizadoEn,
    actualizando,
    actualizar,
    opciones,
    dashboard,
    hayFiltros: hayFiltrosActivos,
    limpiarFiltros,
    exportar,
  }
  provide(CLAVE, metricas)
  return metricas
}

/** @returns {ReturnType<typeof proveerMetricas>} */
export function useMetricas() {
  const metricas = inject(CLAVE, null)
  if (!metricas) throw new Error('useMetricas() requiere proveerMetricas() en la página Métricas.')
  return metricas
}
