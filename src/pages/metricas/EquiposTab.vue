<script setup>
import { computed } from 'vue'
import ActivatorRanking from '../../components/metrics/ActivatorRanking.vue'
import ChartCard from '../../components/metrics/ChartCard.vue'
import HorizontalBars from '../../components/metrics/HorizontalBars.vue'
import TeamMonthHeatTable from '../../components/metrics/TeamMonthHeatTable.vue'
import { useMetricas } from '../../lib/metrics/useMetricas'

const { dashboard } = useMetricas()
const equipos = computed(() =>
  dashboard.value.porEquipo.slice(0, 8).map((team) => ({ label: team.nombre, value: team.total })),
)
const lideres = computed(() => dashboard.value.topLideres.slice(0, 8))
</script>

<template>
  <section class="equipos-grid">
    <ChartCard class="ranking-card" variante="relleno" titulo="Ranking Activadores">
      <ActivatorRanking :filas="dashboard.topActivadores" :total="dashboard.kpis.total" />
    </ChartCard>
    <ChartCard variante="pequena" titulo="Equipos" descripcion="Top 8">
      <HorizontalBars :items="equipos" />
    </ChartCard>
    <ChartCard variante="pequena" titulo="Líderes" descripcion="Top 8">
      <HorizontalBars v-if="lideres.length" :items="lideres" />
      <p v-else class="metrics-empty-small">Sin líderes resolubles.</p>
    </ChartCard>
  </section>
  <ChartCard variante="tabla" titulo="Resumen Equipo y Activadores">
    <TeamMonthHeatTable :resumen-equipo-mes="dashboard.resumenEquipoMes" />
  </ChartCard>
</template>

<style scoped>
.equipos-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  grid-template-rows: repeat(2, 300px);
  gap: 1rem;
  min-width: 0;
}

.equipos-grid .ranking-card {
  grid-row: span 2;
}

@media (max-width: 1100px) {
  .equipos-grid {
    grid-template-columns: 1fr;
    grid-template-rows: 520px 300px 300px;
  }

  .equipos-grid .ranking-card {
    grid-row: auto;
  }
}
</style>
