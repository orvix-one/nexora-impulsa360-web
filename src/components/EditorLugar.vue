<script setup>
import { ref } from 'vue'
import { apiRequest } from '../lib/api'
import { notifyError } from '../lib/feedback'
import MapaLugar from './MapaLugar.vue'
import SelectorRadio from './SelectorRadio.vue'

defineProps({ puntoFijo: { type: Boolean, default: false }, etiquetaRadio: { type: String, default: 'Radio' } })
const lugar = defineModel({ type: Object, required: true })
const radio = defineModel('radio', { type: Number, required: true })
const busqueda = ref('')
const resultados = ref([])
const buscando = ref(false)

async function buscar() {
  if (busqueda.value.trim().length < 3) return
  buscando.value = true
  try { resultados.value = (await apiRequest(`/admin/lugares/buscar?q=${encodeURIComponent(busqueda.value.trim())}`)).resultados ?? [] }
  catch (error) { notifyError(error instanceof Error ? error.message : 'Error inesperado.') }
  finally { buscando.value = false }
}

function usar(resultado) {
  lugar.value = { ...lugar.value, punto: { latitud: resultado.latitud, longitud: resultado.longitud }, nombre: lugar.value.nombre.trim() || resultado.nombre }
  resultados.value = []
}
</script>

<template>
  <div class="editor-lugar">
    <label><span class="field-label">Nombre</span><input v-model="lugar.nombre" class="input-texto" placeholder="Ej. UAGRM, Mercado Mutualista"></label>
    <template v-if="!puntoFijo">
      <div class="selector-cabecera">
        <input v-model="busqueda" class="input-texto" placeholder="Buscar en el mapa" @keydown.enter.prevent="buscar">
        <button type="button" class="boton" :disabled="buscando" @click="buscar">{{ buscando ? 'Buscando...' : 'Buscar' }}</button>
      </div>
      <ul v-if="resultados.length" class="selector-lista">
        <li v-for="r in resultados" :key="`${r.osm}-${r.latitud}`"><button type="button" class="selector-opcion" @click="usar(r)">{{ r.nombre }}<small>{{ r.detalle }}</small></button></li>
      </ul>
    </template>
    <p class="viaje-nota">
      {{ puntoFijo ? 'Ya tiene activaciones: el punto queda fijo.' : lugar.punto ? 'Toca el mapa para mover el punto.' : 'Busca el lugar o toca el mapa para marcar el punto.' }}
    </p>
    <SelectorRadio v-model="radio" :etiqueta="etiquetaRadio" />
    <MapaLugar v-model="lugar.punto" :radio="radio" :solo-lectura="puntoFijo" />
  </div>
</template>
