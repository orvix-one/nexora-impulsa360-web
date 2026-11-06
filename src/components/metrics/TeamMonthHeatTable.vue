<script setup>
import { computed } from 'vue'
import { formatMonth, formatNumber } from '../../lib/metrics/formato'
import { estiloCeldaCalor, matrizEquipoMes } from '../../lib/metrics/graficos'
import TableScroll from './TableScroll.vue'

const props = defineProps({ resumenEquipoMes: { type: Array, required: true } })
const matriz = computed(() => matrizEquipoMes(props.resumenEquipoMes))
</script>

<template>
  <TableScroll class="heatmap-table-wrap">
    <table class="tabla-activaciones metrics-heat-table">
      <thead>
        <tr>
          <th class="sticky-col">Equipo</th>
          <th v-for="mes in matriz.meses" :key="mes">{{ formatMonth(mes) }}</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in matriz.rows" :key="row.equipo">
          <td class="sticky-col heat-team-name">{{ row.equipo }}</td>
          <td
            v-for="cell in row.values"
            :key="`${row.equipo}-${cell.mes}`"
            class="heat-cell"
            :style="estiloCeldaCalor(cell.value, matriz.max)"
            :title="`${row.equipo} · ${formatMonth(cell.mes)}: ${formatNumber(cell.value)} activaciones`"
          >
            {{ formatNumber(cell.value) }}
          </td>
          <td class="heat-total">{{ formatNumber(row.total) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <th class="sticky-col">Total</th>
          <td v-for="mes in matriz.meses" :key="`total-${mes}`" class="heat-total">
            {{ formatNumber(matriz.totals[mes]) }}
          </td>
          <td class="heat-grand-total">{{ formatNumber(matriz.grandTotal) }}</td>
        </tr>
      </tfoot>
    </table>
  </TableScroll>
</template>

<style scoped>
.heatmap-table-wrap {
  overflow: auto;
}

.metrics-heat-table {
  min-width: 760px;
  border-collapse: separate;
  border-spacing: 0;
}

.metrics-heat-table th,
.metrics-heat-table td {
  min-width: 96px;
  text-align: center;
  white-space: nowrap;
}

.metrics-heat-table .sticky-col {
  position: sticky;
  left: 0;
  z-index: 2;
  min-width: 150px;
  text-align: left;
  background: #f7fbff;
  box-shadow: 1px 0 0 #d8e4ef;
}

.metrics-heat-table thead .sticky-col {
  z-index: 3;
  background: var(--ru-bg-700);
  color: #dbe9f7;
  box-shadow: none;
}

.metrics-heat-table tfoot .sticky-col {
  color: #143b5e;
}

.heat-team-name {
  color: #143b5e;
  font-weight: 800;
}

.heat-cell {
  border-radius: 8px;
  font-weight: 800;
}

.heat-total,
.heat-grand-total {
  color: #143b5e;
  font-weight: 900;
  background: #eaf3fb;
}

.metrics-heat-table tfoot th,
.metrics-heat-table tfoot td {
  position: sticky;
  bottom: 0;
  z-index: 1;
  border-top: 2px solid var(--ru-primary);
}
</style>
