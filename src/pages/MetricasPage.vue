<script setup>
import MetricsFilters from '../components/metrics/MetricsFilters.vue'
import MetricsTabs from '../components/metrics/MetricsTabs.vue'
import { proveerMetricas } from '../lib/metrics/useMetricas'

const { cargando, error, dashboard, exportar } = proveerMetricas()
</script>

<template>
  <section class="view-page metrics-saas">
    <header class="metrics-saas-header">
      <div class="metrics-heading">
        <p class="view-kicker">Inteligencia Operativa</p>
        <h1 class="view-title">Dashboard de Activaciones</h1>
      </div>
      <button
        class="boton boton-primario"
        :disabled="cargando || !dashboard.rows.length"
        @click="exportar"
      >
        Exportar
      </button>
    </header>
    <MetricsFilters />
    <MetricsTabs />
    <p v-if="cargando" class="panel-empty">Cargando indicadores...</p>
    <p v-else-if="error" class="mensaje-error">{{ error }}</p>
    <p v-else-if="!dashboard.rows.length && !dashboard.topActivadores.length" class="panel-empty">
      No hay activaciones para los filtros seleccionados.
    </p>
    <div v-else class="metrics-saas-content"><router-view /></div>
  </section>
</template>
