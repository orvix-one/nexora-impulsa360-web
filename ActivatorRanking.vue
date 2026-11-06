<script setup>
import { computed } from 'vue'
import { formatNumber, formatPorcentaje } from '../../lib/metrics/formato'
import { anchoBarra } from '../../lib/metrics/graficos'
import { RANKING_COLUMNAS } from '../../lib/metrics/ranking'
import TableScroll from './TableScroll.vue'

const props = defineProps({
  filas: { type: Array, required: true },
  total: { type: Number, required: true },
})

const maximoFilas = computed(() => Math.max(1, ...props.filas.map((fila) => fila.value)))
</script>

<template>
  <TableScroll>
    <table class="tabla-activaciones metrics-ranking-table">
      <thead>
        <tr>
          <th>#</th>
          <th v-for="columna in RANKING_COLUMNAS" :key="columna.key">{{ columna.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(fila, index) in filas"
          :key="fila.key"
          :title="`${fila.label}: ${formatNumber(fila.value)} activaciones · ${formatPorcentaje(fila.value, total)}`"
        >
          <td>{{ index + 1 }}</td>
          <td
            v-for="columna in RANKING_COLUMNAS"
            :key="columna.key"
            :class="{ 'ranking-number': columna.tipo !== 'texto' && columna.tipo !== 'barra' }"
          >
            <div v-if="columna.tipo === 'barra'" class="ranking-activation-cell">
              <span
                class="ranking-fill"
                :style="{ width: columna.valor(fila) ? anchoBarra(columna.valor(fila), maximoFilas) : '0%' }"
              ></span>
              <strong>{{ formatNumber(columna.valor(fila)) }}</strong>
            </div>
            <template v-else-if="columna.tipo === 'porcentaje'">
              {{ formatPorcentaje(columna.valor(fila), total) }}
            </template>
            <template v-else-if="columna.tipo === 'numero'">
              {{ formatNumber(columna.valor(fila)) }}
            </template>
            <template v-else>{{ columna.valor(fila) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </TableScroll>
</template>

<style scoped>
.metrics-ranking-table {
  min-width: 640px;
}

.metrics-ranking-table th:first-child,
.metrics-ranking-table td:first-child {
  width: 52px;
  text-align: center;
}

.ranking-number {
  color: #143b5e;
  font-weight: 800;
  text-align: right;
  white-space: nowrap;
}

.ranking-activation-cell {
  position: relative;
  min-width: 116px;
  overflow: hidden;
  border-radius: 10px;
  background: #eef5fb;
  color: #143b5e;
}

.ranking-activation-cell strong {
  position: relative;
  z-index: 1;
  display: block;
  padding: 0.35rem 0.55rem;
  text-align: right;
}

.ranking-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(23, 105, 255, 0.36), rgba(15, 141, 245, 0.62));
}
</style>
