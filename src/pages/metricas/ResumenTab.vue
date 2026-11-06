<script setup>
import { computed } from 'vue'
import CardGrid from '../../components/metrics/CardGrid.vue'
import ChartCard from '../../components/metrics/ChartCard.vue'
import DailyLineChart from '../../components/metrics/DailyLineChart.vue'
import HorizontalBars from '../../components/metrics/HorizontalBars.vue'
import KpiGroups from '../../components/metrics/KpiGroups.vue'
import VerticalBars from '../../components/metrics/VerticalBars.vue'
import { geometriaLinea } from '../../lib/metrics/graficos'
import { gruposTarjetas } from '../../lib/metrics/tarjetas'
import { useMetricas } from '../../lib/metrics/useMetricas'

const { dashboard, hoy } = useMetricas()
const grupos = computed(() => gruposTarjetas(dashboard.value, hoy))
const grafico = computed(() => geometriaLinea(dashboard.value.porDia))
const leyendaLinea = computed(() => [
  { marca: 'punto', texto: 'Activaciones' },
  ...(grafico.value.ultimoPromedio ? [{ marca: 'linea', texto: 'Promedio 7 días' }] : []),
  { marca: 'franja', texto: 'Fin de semana / feriado' },
])
</script>

<template>
  <KpiGroups :grupos="grupos" />
  <ChartCard variante="linea" titulo="Activaciones por Fecha" :leyenda="leyendaLinea">
    <DailyLineChart :grafico="grafico" />
  </ChartCard>
  <CardGrid columnas="2fr 1fr">
    <ChartCard variante="grande" titulo="Activaciones por Tipo">
      <VerticalBars :items="dashboard.porTipo" porcentaje />
    </ChartCard>
    <ChartCard variante="grande" titulo="Errores">
      <HorizontalBars :items="dashboard.porErrores" porcentaje />
    </ChartCard>
  </CardGrid>
</template>
