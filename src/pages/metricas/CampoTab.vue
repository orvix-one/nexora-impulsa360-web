<script setup>
import { computed, ref } from 'vue'
import CardGrid from '../../components/metrics/CardGrid.vue'
import ChartCard from '../../components/metrics/ChartCard.vue'
import HorizontalBars from '../../components/metrics/HorizontalBars.vue'
import MetricsGeoMap from '../../components/metrics/MetricsGeoMap.vue'
import MetricsHeatMap from '../../components/metrics/MetricsHeatMap.vue'
import { formatNumber } from '../../lib/metrics/formato'
import { codigosElegidos, conteoPorPoligono, indicePoligonos } from '../../lib/metrics/geo'
import { useMetricas } from '../../lib/metrics/useMetricas'

const { dashboard, ctx, filtros } = useMetricas()

const NIVELES_MAPA = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'municipio', label: 'Municipio' },
]
const NIVELES_RANKING = [
  { value: 'porDepartamento', label: 'Departamento' },
  { value: 'porPlazaCliente', label: 'Plaza' },
  { value: 'porMunicipio', label: 'Municipio' },
]
const nivelMapa = ref(filtros.territorio.length ? 'municipio' : 'departamento')
const nivelRanking = ref('porMunicipio')

const geo = computed(() => conteoPorPoligono(dashboard.value.rows, ctx.value, nivelMapa.value))
const indice = computed(() => indicePoligonos(ctx.value, nivelMapa.value))
const elegidos = computed(() => codigosElegidos(filtros.territorio, ctx.value, nivelMapa.value))

function alternarTerritorio(key) {
  filtros.territorio = filtros.territorio.includes(key)
    ? filtros.territorio.filter((k) => k !== key)
    : [...filtros.territorio, key]
}
</script>

<template>
  <CardGrid columnas="1fr 1fr">
    <ChartCard
      variante="mapa"
      titulo="Activaciones por territorio"
      descripcion="Click en un polígono para filtrar por él."
    >
      <template #aside>
        <div class="segmentado-tab" role="group" aria-label="Nivel del mapa">
          <button
            v-for="nivel in NIVELES_MAPA"
            :key="nivel.value"
            type="button"
            :class="{ elegido: nivelMapa === nivel.value }"
            @click="nivelMapa = nivel.value"
          >
            {{ nivel.label }}
          </button>
        </div>
      </template>
      <MetricsGeoMap
        :nivel="nivelMapa"
        :conteo="geo.conteo"
        :indice="indice"
        :elegidos="elegidos"
        @alternar="alternarTerritorio"
      />
      <p v-if="geo.sinUbicar" class="nota-mapa">
        {{ formatNumber(geo.sinUbicar) }} activaciones sin municipio (sin GPS) no aparecen en el mapa.
      </p>
    </ChartCard>
    <ChartCard variante="mapa" titulo="Mapa de calor">
      <template #aside>
        <span class="meta-pill">{{ formatNumber(dashboard.points.length) }} puntos</span>
      </template>
      <MetricsHeatMap v-if="dashboard.points.length" :points="dashboard.points" />
      <p v-else class="panel-empty">No hay coordenadas válidas para este corte.</p>
    </ChartCard>
  </CardGrid>
  <ChartCard titulo="Ranking territorial">
    <template #aside>
      <div class="segmentado-tab" role="group" aria-label="Nivel del ranking">
        <button
          v-for="nivel in NIVELES_RANKING"
          :key="nivel.value"
          type="button"
          :class="{ elegido: nivelRanking === nivel.value }"
          @click="nivelRanking = nivel.value"
        >
          {{ nivel.label }}
        </button>
      </div>
    </template>
    <div class="ranking-scroll"><HorizontalBars :items="dashboard[nivelRanking]" porcentaje /></div>
  </ChartCard>
</template>

<style scoped>
.meta-pill {
  border-color: #bcd7ff;
  background: transparent;
  color: #143b5e;
}

.segmentado-tab {
  display: inline-flex;
  padding: 0.2rem;
  border: 1px solid var(--ru-border);
  border-radius: 999px;
  background: var(--ru-surface-soft);
}

.segmentado-tab button {
  padding: 0.3rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ru-ink-soft);
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}

.segmentado-tab button.elegido {
  background: var(--ru-primary);
  color: #ffffff;
}

.ranking-scroll {
  max-height: 420px;
  overflow-y: auto;
  margin-top: 0.75rem;
}

.nota-mapa {
  margin: 0.5rem 0 0;
  color: var(--ru-ink-soft);
  font-size: 0.76rem;
}
</style>
