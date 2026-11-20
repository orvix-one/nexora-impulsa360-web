<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  etiqueta: { type: String, required: true },
  resumen: { type: String, required: true },
  activo: { type: Boolean, default: false },
  ancho: { type: String, default: '320px' },
})
const abierto = ref(false)
const raiz = ref(null)

function cerrarFuera(event) {
  if (abierto.value && !raiz.value?.contains(event.target)) abierto.value = false
}
onMounted(() => document.addEventListener('pointerdown', cerrarFuera))
onBeforeUnmount(() => document.removeEventListener('pointerdown', cerrarFuera))
</script>

<template>
  <div ref="raiz" class="popover-filtro" @keydown.esc="abierto = false">
    <button
      type="button"
      class="popover-filtro-boton"
      :class="{ activo, abierto }"
      :aria-expanded="abierto"
      @click="abierto = !abierto"
    >
      <span class="popover-filtro-etiqueta">{{ etiqueta }}</span>
      <span class="popover-filtro-resumen">{{ resumen }}</span>
      <span class="popover-filtro-flecha" aria-hidden="true">▾</span>
    </button>
    <div v-if="abierto" class="popover-filtro-panel" :style="{ width: ancho }">
      <slot :cerrar="() => (abierto = false)" />
    </div>
  </div>
</template>

<style scoped>
.popover-filtro {
  position: relative;
  min-width: 0;
}

.popover-filtro-boton {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 0.6rem;
  width: 100%;
  min-height: 52px;
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--ru-border);
  border-radius: 14px;
  background: #ffffff;
  color: var(--ru-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.popover-filtro-boton:hover,
.popover-filtro-boton.abierto {
  border-color: rgba(23, 105, 255, 0.52);
  box-shadow: 0 0 0 3px rgba(23, 105, 255, 0.12);
}

.popover-filtro-boton.activo {
  border-color: rgba(23, 105, 255, 0.45);
  background: #f2f7ff;
}

.popover-filtro-etiqueta {
  color: var(--ru-ink-soft);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.popover-filtro-resumen {
  grid-row: 2;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.popover-filtro-boton.activo .popover-filtro-resumen {
  color: var(--ru-primary);
}

.popover-filtro-flecha {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  color: var(--ru-ink-soft);
}

.popover-filtro-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  max-width: min(92vw, 520px);
  display: grid;
  gap: 0.75rem;
  padding: 0.85rem;
  border: 1px solid var(--ru-border);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 18px 40px rgba(5, 13, 22, 0.18);
}
</style>
