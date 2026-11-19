<script setup>
import { computed } from 'vue'
import { indicePasoRadio, PASOS_RADIO } from '../lib/eventos'

defineProps({ etiqueta: { type: String, default: 'Radio' } })
const radio = defineModel({ type: Number, required: true })
const indice = computed(() => indicePasoRadio(radio.value))
</script>

<template>
  <label class="selector-radio">
    <span class="selector-radio-cabecera"><span class="field-label">{{ etiqueta }}</span><strong>{{ radio }} m</strong></span>
    <input type="range" min="0" :max="PASOS_RADIO.length - 1" step="1" :value="indice" :aria-valuetext="`${radio} metros`" @input="radio = PASOS_RADIO[Number($event.target.value)]">
  </label>
</template>
