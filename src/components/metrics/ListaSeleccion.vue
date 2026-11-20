<script setup>
import { computed, ref } from 'vue'
import { containsNormalized } from '../../lib/textUtils'

const props = defineProps({
  grupos: { type: Array, required: true },
  placeholder: { type: String, default: 'Buscar' },
})
const seleccion = defineModel({ type: Array, default: () => [] })
const busqueda = ref('')

const visibles = computed(() =>
  props.grupos
    .map((grupo) => ({
      ...grupo,
      opciones: grupo.opciones.filter(
        (o) => containsNormalized(o.nombre, busqueda.value) || containsNormalized(grupo.nombre, busqueda.value),
      ),
    }))
    .filter((grupo) => grupo.opciones.length),
)
const elegidas = computed(() => new Set(seleccion.value))

function estado(grupo) {
  const marcadas = grupo.opciones.filter((o) => elegidas.value.has(o.key)).length
  return marcadas === 0 ? 'nada' : marcadas === grupo.opciones.length ? 'todo' : 'parcial'
}

function alternar(keys, marcado) {
  const resto = seleccion.value.filter((k) => !keys.includes(k))
  seleccion.value = marcado ? [...resto, ...keys] : resto
}

const keysVisibles = computed(() => visibles.value.flatMap((g) => g.opciones.map((o) => o.key)))
</script>

<template>
  <div class="lista-seleccion">
    <div class="lista-seleccion-cabecera">
      <input v-model="busqueda" class="input-texto" type="search" :placeholder="placeholder">
      <span class="lista-seleccion-cuenta">{{ seleccion.length }} elegidos</span>
    </div>
    <div class="lista-seleccion-acciones">
      <button type="button" class="enlace" :disabled="!keysVisibles.length" @click="alternar(keysVisibles, true)">
        {{ busqueda ? 'Elegir resultados' : 'Elegir todos' }}
      </button>
      <button type="button" class="enlace" :disabled="!seleccion.length" @click="seleccion = []">Ninguno</button>
    </div>
    <ul class="lista-seleccion-lista">
      <template v-for="grupo in visibles" :key="grupo.nombre">
        <li v-if="grupo.nombre" class="lista-seleccion-grupo">
          <label>
            <input
              type="checkbox"
              :checked="estado(grupo) === 'todo'"
              :indeterminate="estado(grupo) === 'parcial'"
              @change="alternar(grupo.opciones.map((o) => o.key), $event.target.checked)"
            >
            <span>{{ grupo.nombre }}</span>
            <small>{{ grupo.opciones.length }}</small>
          </label>
        </li>
        <li v-for="opcion in grupo.opciones" :key="opcion.key" :class="{ anidada: grupo.nombre }">
          <label>
            <input
              type="checkbox"
              :checked="elegidas.has(opcion.key)"
              @change="alternar([opcion.key], $event.target.checked)"
            >
            <span>{{ opcion.nombre }}</span>
          </label>
        </li>
      </template>
      <li v-if="!visibles.length" class="panel-empty">Sin resultados</li>
    </ul>
  </div>
</template>

<style scoped>
.lista-seleccion {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.lista-seleccion-cabecera {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.lista-seleccion-cuenta {
  flex: none;
  color: var(--ru-ink-soft);
  font-size: 0.74rem;
  font-weight: 600;
}

.lista-seleccion-acciones {
  display: flex;
  gap: 1rem;
}

.enlace {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ru-primary);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}

.enlace:disabled {
  color: var(--ru-ink-soft);
  cursor: default;
  filter: none;
}

.lista-seleccion-lista {
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--ru-border);
  border-radius: 12px;
}

.lista-seleccion-lista label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid rgba(184, 207, 229, 0.45);
  color: var(--ru-ink);
  font-size: 0.86rem;
  cursor: pointer;
}

.lista-seleccion-lista label:hover {
  background: #f4f8fd;
}

.lista-seleccion-grupo label {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--ru-surface-soft);
  font-weight: 700;
}

.lista-seleccion-grupo small {
  margin-left: auto;
  color: var(--ru-ink-soft);
  font-weight: 600;
}

.anidada label {
  padding-left: 1.9rem;
}

/* The global checkbox is styled for dark surfaces; these lists sit on white. */
.lista-seleccion input[type='checkbox'] {
  border-color: #9fb6cc;
  background: #ffffff;
}

.lista-seleccion input[type='checkbox']:checked {
  border-color: var(--ru-primary);
  background: var(--ru-primary);
}

.lista-seleccion input[type='checkbox']:indeterminate {
  border-color: var(--ru-primary);
  background: #ffffff;
}

.lista-seleccion input[type='checkbox']:indeterminate::after {
  content: '';
  width: 0.55rem;
  height: 2px;
  background: var(--ru-primary);
}

.lista-seleccion input[type='checkbox']:disabled:checked {
  border-color: #a9c5f5;
  background: #a9c5f5;
}
</style>
