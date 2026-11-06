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
  filtrosVacios,
  hayFiltros,
  sanearFiltros,
} from './filtros.js'
import { crearContexto } from './identidad.js'

const CLAVE = Symbol('metricas')

/** @param {Record<string, string>} a @param {Record<string, string>} b */
const mismaQuery = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function proveerMetricas() {
  const route = useRoute()
  const router = useRouter()
  const cargando = ref(true)
  const error = ref(/** @type {string | null} */ (null))
  const datos = shallowRef(
    /** @type {{ activaciones: import('./tipos.js').Activacion[], usuarios: import('./tipos.js').Usuario[], plazas: { nombre?: string }[] }} */ ({
      activaciones: [],
      usuarios: [],
      plazas: [],
    }),
  )
  const hoy = calendarioHoy()
  const filtros = reactive(filtrosDesdeQuery(route.query))

  const ctx = computed(() => crearContexto(datos.value))
  const opciones = computed(() => construirOpciones(ctx.value))
  const dashboard = computed(() =>
    calcularDashboard({ activaciones: datos.value.activaciones, ctx: ctx.value, filtros, hoy }),
  )
  const hayFiltrosActivos = computed(() => hayFiltros(filtros))

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

  onMounted(async () => {
    try {
      datos.value = await cargarDatosMetricas({
        fetchActivaciones: fetchMetricasActivaciones,
        solicitar: apiRequest,
        registrarError: logClientError,
      })
      Object.assign(filtros, sanearFiltros({ ...filtros }, opciones.value))
    } catch (causa) {
      logClientError('metricas.fetch', causa)
      error.value = 'No fue posible obtener las activaciones.'
    } finally {
      cargando.value = false
    }
  })

  function limpiarFiltros() {
    Object.assign(filtros, filtrosVacios())
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
    filtros,
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
