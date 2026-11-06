<script setup>
import { FILTROS } from '../../lib/metrics/filtros'
import { formatNumber } from '../../lib/metrics/formato'
import { useMetricas } from '../../lib/metrics/useMetricas'

const { filtros, opciones, dashboard, datos, hayFiltros, limpiarFiltros } = useMetricas()

function visible(filtro) {
  return !filtro.ocultarSinOpciones || opciones.value[filtro.opciones].length > 0
}
</script>

<template>
  <section class="metrics-filter-card">
    <div class="metrics-filter-head">
      <div>
        <h2>Filtros</h2>
        <p>
          {{ formatNumber(dashboard.rows.length) }} de
          {{ formatNumber(datos.activaciones.length) }} registros
        </p>
      </div>
      <button class="boton" :disabled="!hayFiltros" @click="limpiarFiltros">Limpiar</button>
    </div>
    <div class="filtros metrics-filter-grid">
      <template v-for="filtro in FILTROS" :key="filtro.key">
        <label v-if="visible(filtro)">
          <span class="field-label">{{ filtro.label }}</span>
          <input
            v-if="filtro.tipo === 'fecha'"
            v-model="filtros[filtro.key]"
            type="date"
            class="input-texto"
          />
          <select v-else v-model="filtros[filtro.key]" class="input-texto">
            <option value="">{{ filtro.vacio }}</option>
            <option
              v-for="opcion in opciones[filtro.opciones]"
              :key="opcion.key"
              :value="opcion.key"
            >
              {{ opcion.nombre }}
            </option>
          </select>
        </label>
      </template>
    </div>
  </section>
</template>

<style scoped>
.metrics-filter-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
</style>
