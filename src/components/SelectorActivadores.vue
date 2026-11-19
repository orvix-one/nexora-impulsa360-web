<script setup>
import { computed, ref } from 'vue'
import { containsNormalized } from '../lib/textUtils'

const props = defineProps({
  opciones: { type: Array, required: true },
  placeholder: { type: String, default: 'Buscar activador' },
})
const seleccion = defineModel({ type: Array, default: () => [] })
const texto = ref('')

const visibles = computed(() => props.opciones
  .filter((opcion) => containsNormalized(opcion.nombre, texto.value) || containsNormalized(opcion.detalle, texto.value)))

function alternar(id, marcado) {
  seleccion.value = marcado ? [...seleccion.value, id] : seleccion.value.filter((item) => item !== id)
}
</script>

<template>
  <div class="selector-buscable">
    <div class="selector-cabecera">
      <input v-model="texto" class="input-texto" :placeholder="placeholder">
      <span class="meta-pill">{{ seleccion.length }} seleccionados</span>
    </div>
    <ul class="selector-lista">
      <li v-for="opcion in visibles" :key="opcion.id">
        <label class="selector-opcion">
          <input type="checkbox" :checked="seleccion.includes(opcion.id)" @change="alternar(opcion.id, $event.target.checked)">
          {{ opcion.nombre }}<small v-if="opcion.detalle">{{ opcion.detalle }}</small>
        </label>
      </li>
      <li v-if="!visibles.length" class="panel-empty">Sin resultados</li>
    </ul>
  </div>
</template>
