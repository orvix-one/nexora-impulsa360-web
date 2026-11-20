<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FiltrosLocales from '../components/metrics/FiltrosLocales.vue'
import MetricsFilters from '../components/metrics/MetricsFilters.vue'
import MetricsTabs from '../components/metrics/MetricsTabs.vue'
import { FILTROS } from '../lib/metrics/filtros'
import { haceCuanto } from '../lib/metrics/formato'
import { proveerMetricas } from '../lib/metrics/useMetricas'

const { cargando, error, dashboard, exportar, tab, actualizadoEn, actualizando, actualizar } = proveerMetricas()

const tieneLocales = computed(() => FILTROS.some((f) => f.ambito === tab.value))
const siempreVisible = computed(() => tab.value === 'eventos')

const ahora = ref(Date.now())
let reloj = null
onMounted(() => { reloj = setInterval(() => { ahora.value = Date.now() }, 30000) })
onBeforeUnmount(() => clearInterval(reloj))
const etiquetaActualizado = computed(() => actualizadoEn.value ? haceCuanto(actualizadoEn.value, new Date(ahora.value)) : '')
</script>

<template>
  <section class="view-page metrics-saas">
    <header class="metrics-saas-header">
      <div class="metrics-heading">
        <p class="view-kicker">Inteligencia Operativa</p>
        <h1 class="view-title">Dashboard de Activaciones</h1>
      </div>
      <div class="metrics-acciones">
        <button
          v-if="actualizadoEn"
          class="boton metrics-actualizar"
          :disabled="actualizando"
          :title="`Datos cargados ${etiquetaActualizado}`"
          @click="actualizar"
        >
          {{ actualizando ? 'Actualizando…' : `Actualizar · ${etiquetaActualizado}` }}
        </button>
        <button
          class="boton boton-primario"
          :disabled="cargando || !dashboard.rows.length"
          @click="exportar"
        >
          Exportar
        </button>
      </div>
    </header>
    <MetricsFilters />
    <MetricsTabs />
    <FiltrosLocales v-if="tieneLocales && !cargando && !error" :ambito="tab" />
    <p v-if="cargando" class="panel-empty">Cargando indicadores...</p>
    <p v-else-if="error" class="mensaje-error">{{ error }}</p>
    <p v-else-if="!siempreVisible && !dashboard.rows.length && !dashboard.topActivadores.length" class="panel-empty">
      No hay activaciones para los filtros seleccionados.
    </p>
    <div v-else class="metrics-saas-content"><router-view /></div>
  </section>
</template>

<style scoped>
.metrics-acciones {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.metrics-actualizar {
  font-size: 0.8rem;
}
</style>
