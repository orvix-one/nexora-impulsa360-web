<script setup>
import { computed, ref } from 'vue'
import { containsNormalized } from '../../lib/textUtils'

const props = defineProps({
  opciones: { type: Array, required: true },
})
const seleccion = defineModel({ type: Array, default: () => [] })

const AGRUPACIONES = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'plaza', label: 'Plaza' },
]
const agrupacion = ref('departamento')
const busqueda = ref('')
const abiertos = ref(new Set())
const elegidas = computed(() => new Set(seleccion.value))

const grupos = computed(() => {
  const municipios = props.opciones.filter((o) => o.nivel === 'municipio')
  const lista = props.opciones
    .filter((o) => o.nivel === agrupacion.value)
    .map((grupo) => ({ ...grupo, municipios: municipios.filter((m) => m.grupos?.includes(grupo.key)) }))
    .filter((grupo) => grupo.municipios.length)
  const sueltos = municipios.filter((m) => !m.grupos?.some((k) => k.startsWith(agrupacion.value === 'plaza' ? 'pla:' : 'dep:')))
  if (sueltos.length) lista.push({ key: '', nombre: 'Sin ubicar', municipios: sueltos })
  return lista
    .map((grupo) => ({
      ...grupo,
      municipios: containsNormalized(grupo.nombre, busqueda.value)
        ? grupo.municipios
        : grupo.municipios.filter((m) => containsNormalized(m.nombre, busqueda.value)),
    }))
    .filter((grupo) => grupo.municipios.length)
})

function abierto(grupo) {
  return Boolean(busqueda.value) || !grupo.key || abiertos.value.has(grupo.key)
}

function plegar(key) {
  const copia = new Set(abiertos.value)
  if (copia.has(key)) copia.delete(key)
  else copia.add(key)
  abiertos.value = copia
}

function alternarGrupo(grupo, marcado) {
  const hijos = new Set(grupo.municipios.map((m) => m.key))
  const resto = seleccion.value.filter((k) => k !== grupo.key && !hijos.has(k))
  seleccion.value = marcado ? [...resto, grupo.key] : resto
}

function alternarMunicipio(key, marcado) {
  seleccion.value = marcado ? [...seleccion.value, key] : seleccion.value.filter((k) => k !== key)
}

function marcadosEn(grupo) {
  return grupo.municipios.filter((m) => elegidas.value.has(m.key)).length
}
</script>

<template>
  <div class="selector-territorio">
    <div class="segmentado" role="group" aria-label="Agrupar por">
      <button
        v-for="opcion in AGRUPACIONES"
        :key="opcion.value"
        type="button"
        :class="{ elegido: agrupacion === opcion.value }"
        @click="agrupacion = opcion.value"
      >
        {{ opcion.label }}
      </button>
    </div>
    <input v-model="busqueda" class="input-texto" type="search" placeholder="Buscar municipio o departamento">
    <ul class="selector-territorio-lista">
      <li v-for="grupo in grupos" :key="grupo.key || 'sueltos'">
        <div class="fila-grupo">
          <button
            v-if="grupo.key"
            type="button"
            class="plegar"
            :aria-expanded="abierto(grupo)"
            :aria-label="`${abierto(grupo) ? 'Ocultar' : 'Ver'} municipios de ${grupo.nombre}`"
            @click="plegar(grupo.key)"
          >
            {{ abierto(grupo) ? '▾' : '▸' }}
          </button>
          <label v-if="grupo.key">
            <input type="checkbox" :checked="elegidas.has(grupo.key)" @change="alternarGrupo(grupo, $event.target.checked)">
            <span>{{ grupo.nombre }}</span>
          </label>
          <span v-else class="sin-grupo">{{ grupo.nombre }}</span>
          <small v-if="!elegidas.has(grupo.key) && marcadosEn(grupo)">{{ marcadosEn(grupo) }} elegidos</small>
        </div>
        <ul v-if="abierto(grupo)" class="municipios">
          <li v-for="municipio in grupo.municipios" :key="municipio.key">
            <label :class="{ incluido: elegidas.has(grupo.key) }" :title="elegidas.has(grupo.key) ? `Incluido en ${grupo.nombre}` : ''">
              <input
                type="checkbox"
                :checked="elegidas.has(grupo.key) || elegidas.has(municipio.key)"
                :disabled="elegidas.has(grupo.key)"
                @change="alternarMunicipio(municipio.key, $event.target.checked)"
              >
              <span>{{ municipio.nombre }}</span>
            </label>
          </li>
        </ul>
      </li>
      <li v-if="!grupos.length" class="panel-empty">Sin resultados</li>
    </ul>
    <button type="button" class="enlace" :disabled="!seleccion.length" @click="seleccion = []">Todo el país</button>
  </div>
</template>

<style scoped>
.selector-territorio {
  display: grid;
  gap: 0.55rem;
}

.segmentado {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.3rem;
}

.segmentado button {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--ru-border);
  border-radius: 10px;
  background: #ffffff;
  color: var(--ru-ink);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.segmentado button.elegido {
  border-color: var(--ru-primary);
  background: var(--ru-primary);
  color: #ffffff;
}

.selector-territorio-lista {
  max-height: 340px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--ru-border);
  border-radius: 12px;
}

.fila-grupo {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid rgba(184, 207, 229, 0.45);
  background: var(--ru-surface-soft);
}

.fila-grupo label,
.municipios label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  color: var(--ru-ink);
  font-size: 0.86rem;
  cursor: pointer;
}

.fila-grupo label {
  font-weight: 700;
}

.fila-grupo small {
  color: var(--ru-ink-soft);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}

.sin-grupo {
  flex: 1;
  padding-left: 1.6rem;
  color: var(--ru-ink-soft);
  font-size: 0.82rem;
  font-weight: 700;
}

.plegar {
  width: 1.3rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ru-ink-soft);
  font-size: 0.8rem;
  cursor: pointer;
}

.municipios {
  margin: 0;
  padding: 0;
  list-style: none;
}

.municipios label {
  padding: 0.4rem 0.75rem 0.4rem 2.3rem;
  border-bottom: 1px solid rgba(184, 207, 229, 0.3);
}

.municipios label:hover {
  background: #f4f8fd;
}

.municipios label.incluido {
  color: var(--ru-ink-soft);
  cursor: default;
}

.enlace {
  justify-self: start;
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

/* The global checkbox is styled for dark surfaces; these lists sit on white. */
.selector-territorio input[type='checkbox'] {
  border-color: #9fb6cc;
  background: #ffffff;
}

.selector-territorio input[type='checkbox']:checked {
  border-color: var(--ru-primary);
  background: var(--ru-primary);
}

.selector-territorio input[type='checkbox']:indeterminate {
  border-color: var(--ru-primary);
  background: #ffffff;
}

.selector-territorio input[type='checkbox']:indeterminate::after {
  content: '';
  width: 0.55rem;
  height: 2px;
  background: var(--ru-primary);
}

.selector-territorio input[type='checkbox']:disabled:checked {
  border-color: #a9c5f5;
  background: #a9c5f5;
}
</style>
