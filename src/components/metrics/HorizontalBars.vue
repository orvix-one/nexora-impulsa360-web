<script setup>
import { computed } from 'vue'
import { formatNumber, formatPorcentaje } from '../../lib/metrics/formato'
import { anchoBarra, maximo } from '../../lib/metrics/graficos'

const props = defineProps({
  items: { type: Array, required: true },
  porcentaje: { type: Boolean, default: false },
})

const total = computed(() => props.items.reduce((suma, item) => suma + item.value, 0))
</script>

<template>
  <div class="dashboard-bars compact-bars">
    <div
      v-for="item in items"
      :key="item.label"
      class="dashboard-bar-row"
      :title="`${item.label}: ${formatNumber(item.value)} activaciones`"
    >
      <span>{{ item.label }}</span>
      <div class="metric-track">
        <div class="metric-fill" :style="{ width: anchoBarra(item.value, maximo(items)) }"></div>
      </div>
      <strong>
        {{ formatNumber(item.value) }}
        <small v-if="porcentaje">{{ formatPorcentaje(item.value, total) }}</small>
      </strong>
    </div>
  </div>
</template>

<style scoped>
.compact-bars {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 0.2rem;
}

.dashboard-bar-row {
  grid-template-columns: minmax(90px, 11rem) minmax(0, 1fr) auto;
}

.dashboard-bar-row small {
  margin-left: 0.35rem;
  color: #55728e;
  font-weight: 700;
}
</style>
