<script setup>
import { computed } from 'vue'

const props = defineProps({
  titulo: { type: String, required: true },
  descripcion: { type: String, default: '' },
  variante: { type: String, default: '' },
  leyenda: { type: Array, default: () => [] },
})

const CLASES = {
  linea: 'metrics-line-card',
  pequena: 'metrics-small-chart',
  grande: 'metrics-large-chart',
  tabla: 'metrics-table-card',
  relleno: 'metrics-fill-card',
  mapa: 'metrics-map-card',
}
const MARCAS = { punto: 'legend-dot', linea: 'legend-line-avg', franja: 'legend-swatch-off' }
const clase = computed(() => CLASES[props.variante] ?? '')
</script>

<template>
  <article :class="['metrics-chart-card', clase]">
    <div v-if="$slots.aside" class="metrics-card-heading">
      <div>
        <h3>{{ titulo }}</h3>
        <p v-if="descripcion">{{ descripcion }}</p>
      </div>
      <slot name="aside" />
    </div>
    <template v-else>
      <h3>{{ titulo }}</h3>
      <p v-if="descripcion">{{ descripcion }}</p>
    </template>
    <div v-if="leyenda.length" class="chart-legend">
      <template v-for="item in leyenda" :key="item.texto">
        <span :class="MARCAS[item.marca]"></span>
        <span>{{ item.texto }}</span>
      </template>
    </div>
    <slot />
  </article>
</template>

<style scoped>
.metrics-chart-card {
  display: flex;
  flex-direction: column;
  padding: 1rem;
  border-radius: 14px;
}

.metrics-chart-card h3 {
  margin: 0;
  color: #143b5e;
  font-size: 1rem;
  font-weight: 900;
  line-height: 1.2;
}

.metrics-chart-card > p,
.metrics-card-heading p {
  margin: 0.25rem 0 0;
  color: #55728e;
  font-size: 0.78rem;
  line-height: 1.3;
}

.metrics-line-card {
  min-height: 360px;
}

.metrics-small-chart {
  height: 300px;
}

.metrics-large-chart {
  min-height: 400px;
}

.metrics-table-card {
  height: 430px;
}

.metrics-fill-card {
  min-height: 0;
}

.chart-legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.65rem;
  color: #55728e;
  font-size: 0.72rem;
  font-weight: 700;
}

.legend-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  background: var(--ru-primary);
}

.legend-line-avg {
  width: 0.9rem;
  height: 2px;
  margin-left: 0.6rem;
  border-radius: 2px;
  background: var(--ru-accent);
}

.legend-swatch-off {
  width: 0.8rem;
  height: 0.65rem;
  margin-left: 0.6rem;
  border-radius: 3px;
  background: #e6edf5;
}

@media (max-width: 720px) {
  .metrics-line-card,
  .metrics-small-chart,
  .metrics-large-chart {
    min-height: auto;
  }

  .metrics-table-card {
    height: 360px;
  }
}
</style>
