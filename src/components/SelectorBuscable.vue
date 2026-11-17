<script setup>
import { computed, ref } from 'vue'
import { containsNormalized } from '../lib/textUtils'

const props = defineProps({
  opciones: { type: Array, required: true },
  placeholder: { type: String, default: 'Buscar' },
  maxVisibles: { type: Number, default: 50 },
})
const seleccion = defineModel({ type: [String, Number, null], default: null })
const texto = ref('')

const elegida = computed(() => props.opciones.find((opcion) => opcion.id === seleccion.value) ?? null)
const visibles = computed(() => props.opciones
  .filter((opcion) => containsNormalized(opcion.nombre, texto.value) || containsNormalized(opcion.detalle, texto.value))
  .slice(0, props.maxVisibles))

function elegir(opcion) {
  seleccion.value = opcion.id
  texto.value = ''
}
</script>

<template>
  <div class="selector-buscable">
    <div v-if="elegida" class="selector-elegida">
      <span><strong>{{ elegida.nombre }}</strong><small v-if="elegida.detalle"> · {{ elegida.detalle }}</small></span>
      <button type="button" class="boton boton-pequeno" @click="seleccion = null">Cambiar</button>
    </div>
    <template v-else>
      <input v-model="texto" class="input-texto" :placeholder="placeholder">
      <ul class="selector-lista" role="listbox">
        <li v-for="opcion in visibles" :key="opcion.id">
          <button type="button" class="selector-opcion" @click="elegir(opcion)">{{ opcion.nombre }}<small v-if="opcion.detalle">{{ opcion.detalle }}</small></button>
        </li>
        <li v-if="!visibles.length" class="panel-empty">Sin resultados</li>
      </ul>
    </template>
  </div>
</template>
