<script setup>
import { computed } from 'vue'
import { FILTROS, hayFiltros } from '../../lib/metrics/filtros'
import { municipioEnSeleccion } from '../../lib/metrics/territorio'
import { useMetricas } from '../../lib/metrics/useMetricas'

const props = defineProps({
  ambito: { type: String, required: true },
})
const { filtros, opciones, ctx, limpiarFiltros } = useMetricas()

const definiciones = computed(() => FILTROS.filter((f) => f.ambito === props.ambito))
const nombreTerritorio = computed(() => new Map(opciones.value.territorios.map((o) => [o.key, o.nombre])))

const zonas = computed(() => {
  if (!filtros.territorio.length) return []
  const lista = opciones.value.zonas.filter((o) => municipioEnSeleccion(o.ciudad, filtros.territorio, ctx.value))
  const municipios = new Set(lista.map((o) => o.ciudad))
  if (municipios.size < 2) return lista
  return lista.map((o) => ({ ...o, nombre: `${o.nombre} · ${nombreTerritorio.value.get(o.ciudad)}` }))
})

function opcionesDe(filtro) {
  return filtro.opciones === 'zonas' ? zonas.value : opciones.value[filtro.opciones]
}

function pista(filtro) {
  if (filtro.opciones !== 'zonas' || zonas.value.length) return ''
  return filtros.territorio.length ? 'Sin barrios registrados en el territorio elegido' : 'Elige un territorio para filtrar por barrio'
}
</script>

<template>
  <div class="filtros-locales">
    <label v-for="filtro in definiciones" :key="filtro.key" class="filtro-local">
      <span class="field-label">{{ filtro.label }}</span>
      <select v-model="filtros[filtro.key]" class="input-texto" :disabled="Boolean(pista(filtro))" :title="pista(filtro)">
        <option value="">{{ pista(filtro) || filtro.vacio }}</option>
        <option v-for="opcion in opcionesDe(filtro)" :key="opcion.key" :value="opcion.key">{{ opcion.nombre }}</option>
      </select>
    </label>
    <slot />
    <button v-if="definiciones.length" type="button" class="boton" :disabled="!hayFiltros(filtros, ambito)" @click="limpiarFiltros(ambito)">
      Limpiar
    </button>
  </div>
</template>

<style scoped>
.filtros-locales {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  padding: 0.75rem 0.9rem;
  border: 1px dashed rgba(184, 207, 229, 0.55);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
}

.filtro-local {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 220px;
}

.filtros-locales .field-label {
  color: #bfd4ea;
}
</style>
