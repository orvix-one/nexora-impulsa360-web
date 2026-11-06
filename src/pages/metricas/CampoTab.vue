<script setup>
import CardGrid from '../../components/metrics/CardGrid.vue'
import ChartCard from '../../components/metrics/ChartCard.vue'
import HorizontalBars from '../../components/metrics/HorizontalBars.vue'
import MetricsHeatMap from '../../components/metrics/MetricsHeatMap.vue'
import { formatNumber } from '../../lib/metrics/formato'
import { useMetricas } from '../../lib/metrics/useMetricas'

const { dashboard } = useMetricas()
</script>

<template>
  <CardGrid columnas="1fr 2fr">
    <ChartCard titulo="Ciudades">
      <HorizontalBars :items="dashboard.porPlaza" porcentaje />
    </ChartCard>
    <ChartCard variante="mapa" titulo="Mapa de calor">
      <template #aside>
        <span class="meta-pill">{{ formatNumber(dashboard.points.length) }} puntos</span>
      </template>
      <MetricsHeatMap v-if="dashboard.points.length" :points="dashboard.points" />
      <p v-else class="panel-empty">No hay coordenadas válidas para este corte.</p>
    </ChartCard>
  </CardGrid>
</template>

<style scoped>
.meta-pill {
  border-color: #bcd7ff;
  background: transparent;
  color: #143b5e;
}
</style>
