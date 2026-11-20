<script setup>
import { computed, watch } from 'vue'
import { agruparOpciones, FILTROS } from '../../lib/metrics/filtros'
import { formatNumber } from '../../lib/metrics/formato'
import { useMetricas } from '../../lib/metrics/useMetricas'
import FiltroMultiple from './FiltroMultiple.vue'

const { filtros, opciones, dashboard, datos, hayFiltros, limpiarFiltros } = useMetricas()

const gruposCiudad = computed(() => agruparOpciones(opciones.value.plazas))

const nombrePlaza = computed(() => new Map(opciones.value.plazas.map((opcion) => [opcion.key, opcion.nombre])))

const zonasCiudad = computed(() => {
  const zonas = opciones.value.zonas.filter((opcion) => filtros.plaza.includes(opcion.ciudad))
  if (filtros.plaza.length < 2) return zonas
  return zonas.map((opcion) => ({ ...opcion, nombre: `${opcion.nombre} · ${nombrePlaza.value.get(opcion.ciudad)}` }))
})

watch(() => filtros.plaza, (plazas) => {
  const ciudad = opciones.value.zonas.find((opcion) => opcion.key === filtros.zona)?.ciudad
  if (filtros.zona && !plazas.includes(ciudad)) filtros.zona = ''
})

function visible(filtro) {
  if (filtro.opciones === 'zonas') return filtros.plaza.length > 0 && zonasCiudad.value.length > 0
  return !filtro.ocultarSinOpciones || opciones.value[filtro.opciones].length > 0
}

function opcionesDe(filtro) {
  return filtro.opciones === 'zonas' ? zonasCiudad.value : opciones.value[filtro.opciones]
}

function gruposDe(filtro) {
  return agruparOpciones(opcionesDe(filtro).filter((opcion) => opcion.grupo))
}

function sueltasDe(filtro) {
  return opcionesDe(filtro).filter((opcion) => !opcion.grupo)
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
        <div v-if="filtro.multiple && visible(filtro)">
          <span class="field-label">{{ filtro.label }}</span>
          <FiltroMultiple v-model="filtros[filtro.key]" :grupos="gruposCiudad" :vacio="filtro.vacio" />
        </div>
        <label v-else-if="visible(filtro)">
          <span class="field-label">{{ filtro.label }}</span>
          <input
            v-if="filtro.tipo === 'fecha'"
            v-model="filtros[filtro.key]"
            type="date"
            class="input-texto"
          />
          <select v-else v-model="filtros[filtro.key]" class="input-texto">
            <option value="">{{ filtro.vacio }}</option>
            <optgroup v-for="grupo in gruposDe(filtro)" :key="grupo.nombre" :label="grupo.nombre">
              <option v-for="opcion in grupo.opciones" :key="opcion.key" :value="opcion.key">{{ opcion.nombre }}</option>
            </optgroup>
            <option
              v-for="opcion in sueltasDe(filtro)"
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

.metrics-filter-grid > div {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}
</style>
