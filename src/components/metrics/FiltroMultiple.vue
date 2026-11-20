<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  grupos: { type: Array, required: true },
  vacio: { type: String, default: 'Todas' },
})
const seleccion = defineModel({ type: Array, default: () => [] })
const raiz = ref(null)
const abierto = ref(false)

const nombres = computed(() => new Map(props.grupos.flatMap((g) => g.opciones.map((o) => [o.key, o.nombre]))))

const resumen = computed(() => {
  if (!seleccion.value.length) return props.vacio
  const completo = props.grupos.find((g) => g.opciones.length === seleccion.value.length && estado(g) === 'todo')
  if (completo) return completo.nombre
  if (seleccion.value.length === 1) return nombres.value.get(seleccion.value[0]) ?? props.vacio
  return `${seleccion.value.length} seleccionados`
})

function estado(grupo) {
  const marcadas = grupo.opciones.filter((o) => seleccion.value.includes(o.key)).length
  return marcadas === 0 ? 'nada' : marcadas === grupo.opciones.length ? 'todo' : 'parcial'
}

function alternar(key, marcado) {
  seleccion.value = marcado ? [...seleccion.value, key] : seleccion.value.filter((k) => k !== key)
}

function alternarGrupo(grupo, marcado) {
  const keys = grupo.opciones.map((o) => o.key)
  const resto = seleccion.value.filter((k) => !keys.includes(k))
  seleccion.value = marcado ? [...resto, ...keys] : resto
}

function cerrarFuera(event) {
  if (abierto.value && !raiz.value?.contains(event.target)) abierto.value = false
}
onMounted(() => document.addEventListener('click', cerrarFuera))
onBeforeUnmount(() => document.removeEventListener('click', cerrarFuera))
</script>

<template>
  <div ref="raiz" class="filtro-multiple" @keydown.esc="abierto = false">
    <button type="button" class="input-texto filtro-multiple-boton" :aria-expanded="abierto" @click="abierto = !abierto">
      {{ resumen }}
    </button>
    <div v-if="abierto" class="selector-lista filtro-multiple-panel">
      <button v-if="seleccion.length" type="button" class="selector-opcion" @click="seleccion = []">
        {{ vacio }}
      </button>
      <template v-for="grupo in grupos" :key="grupo.nombre">
        <label class="selector-opcion filtro-multiple-grupo">
          <input
            type="checkbox"
            :checked="estado(grupo) === 'todo'"
            :indeterminate="estado(grupo) === 'parcial'"
            @change="alternarGrupo(grupo, $event.target.checked)"
          >
          {{ grupo.nombre }}
        </label>
        <label v-for="opcion in grupo.opciones" :key="opcion.key" class="selector-opcion filtro-multiple-opcion">
          <input
            type="checkbox"
            :checked="seleccion.includes(opcion.key)"
            @change="alternar(opcion.key, $event.target.checked)"
          >
          {{ opcion.nombre }}
        </label>
      </template>
    </div>
  </div>
</template>

<style scoped>
.filtro-multiple {
  position: relative;
}

.filtro-multiple-boton {
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.filtro-multiple-panel {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  min-width: 240px;
  max-height: 320px;
  box-shadow: 0 8px 24px rgba(5, 13, 22, 0.12);
}

.filtro-multiple .selector-opcion {
  flex-direction: row;
  gap: 0.5rem;
}

.filtro-multiple-grupo {
  font-weight: 700;
  background: var(--ru-surface-soft);
}

.filtro-multiple-opcion {
  padding-left: 1.75rem;
}
</style>
