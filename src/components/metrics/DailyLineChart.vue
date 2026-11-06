<script setup>
import {
  formatDate,
  formatNumber,
  formatPromedio,
  formatShortDate,
} from '../../lib/metrics/formato'

defineProps({ grafico: { type: Object, required: true } })
</script>

<template>
  <div class="metrics-line-wrap">
    <svg
      class="metrics-line-svg"
      :viewBox="`0 0 ${grafico.width} ${grafico.height}`"
      role="img"
      aria-label="Activaciones por fecha"
    >
      <g class="line-off-days">
        <rect
          v-for="point in grafico.points.filter((p) => p.noLaboral)"
          :key="`off-${point.label}`"
          :x="point.x - grafico.anchoBanda / 2"
          :y="grafico.padTop"
          :width="grafico.anchoBanda"
          :height="grafico.plotBottom - grafico.padTop"
        ></rect>
      </g>
      <g class="line-grid">
        <line
          v-for="tick in grafico.ejeY"
          :key="`grid-${tick.value}`"
          :x1="grafico.padX"
          :y1="tick.y"
          :x2="grafico.width - grafico.padX"
          :y2="tick.y"
        ></line>
      </g>
      <g class="line-axis">
        <text
          v-for="tick in grafico.ejeY"
          :key="`tick-${tick.value}`"
          :x="grafico.padX - 8"
          :y="tick.y + 3"
          text-anchor="end"
        >
          {{ formatNumber(tick.value) }}
        </text>
      </g>
      <polyline
        v-if="grafico.points.length"
        :points="grafico.polyline"
        fill="none"
        stroke="var(--ru-primary)"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      ></polyline>
      <g v-if="grafico.ultimoPromedio" class="line-avg">
        <polyline
          :points="grafico.promedioMovil"
          fill="none"
          stroke="var(--ru-accent)"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        ></polyline>
        <text
          :x="grafico.ultimoPromedio.x + 6"
          :y="grafico.ultimoPromedio.y + 3"
          text-anchor="start"
        >
          {{ formatPromedio(grafico.ultimoPromedio.valor) }}
        </text>
      </g>
      <g v-for="point in grafico.points" :key="point.label">
        <title>{{ formatDate(point.label) }}: {{ formatNumber(point.value) }} activaciones</title>
        <circle :cx="point.x" :cy="point.y" r="3.5" fill="var(--ru-primary)"></circle>
        <text class="line-value" :x="point.x" :y="point.valorY" text-anchor="middle">
          {{ point.value }}
        </text>
        <text
          v-if="point.conFecha"
          class="line-date"
          :x="point.x"
          :y="grafico.plotBottom + 12"
          text-anchor="end"
          :transform="`rotate(-40 ${point.x} ${grafico.plotBottom + 12})`"
        >
          {{ formatShortDate(point.label) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.metrics-line-wrap {
  flex: 1;
  min-height: 250px;
  margin-top: 1rem;
  overflow-x: auto;
  border: 1px solid #d8e4ef;
  border-radius: 12px;
  background: #fbfdff;
}

.metrics-line-svg {
  display: block;
  width: 100%;
  min-width: 720px;
  height: 100%;
  min-height: 250px;
}

.metrics-line-svg text {
  fill: var(--ru-primary);
  font-size: 9px;
  font-weight: 700;
}

.metrics-line-svg .line-date {
  fill: #55728e;
  font-size: 8px;
  font-weight: 600;
}

.metrics-line-svg .line-value {
  paint-order: stroke;
  stroke: #fbfdff;
  stroke-width: 2px;
  stroke-linejoin: round;
}

.metrics-line-svg .line-avg text {
  fill: var(--ru-accent);
  font-size: 9px;
  font-weight: 700;
}

.metrics-line-svg .line-axis text {
  fill: #7a90a6;
  font-size: 9px;
  font-weight: 600;
}

.line-off-days rect {
  fill: #e6edf5;
}

.line-grid line {
  stroke: #c7d3df;
  stroke-width: 1;
}

@media (max-width: 1100px) {
  .metrics-line-wrap,
  .metrics-line-svg {
    min-height: 240px;
  }
}

@media (max-width: 720px) {
  .metrics-line-wrap,
  .metrics-line-svg {
    min-height: 280px;
  }
}
</style>
