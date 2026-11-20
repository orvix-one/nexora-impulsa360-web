<script setup>
import { computed } from 'vue'
import { PERIODOS } from '../../lib/metrics/filtros'
import { formatNumber } from '../../lib/metrics/formato'
import { chipsSeleccion, resumenPeriodo, resumenSeleccion } from '../../lib/metrics/resumenFiltros'
import { useMetricas } from '../../lib/metrics/useMetricas'
import ListaSeleccion from './ListaSeleccion.vue'
import PopoverFiltro from './PopoverFiltro.vue'
import SelectorTerritorio from './SelectorTerritorio.vue'

const { filtros, opciones, dashboard, datos, hayFiltros, limpiarFiltros } = useMetricas()

const gruposActivadores = computed(() => [{ nombre: '', opciones: opciones.value.activadores }])

const resumen = computed(() => ({
  periodo: resumenPeriodo(filtros),
  territorio: resumenSeleccion(filtros.territorio, opciones.value.territorios, 'Todo el país', 'territorios'),
  personas: resumenPersonas(),
}))

function resumenPersonas() {
  const partes = []
  if (filtros.activador.length) partes.push(resumenSeleccion(filtros.activador, opciones.value.activadores, '', 'activadores'))
  if (filtros.equipo) partes.push(opciones.value.equipos.find((o) => o.key === filtros.equipo)?.nombre ?? 'Equipo')
  if (filtros.lider) partes.push(opciones.value.lideres.find((o) => o.key === filtros.lider)?.nombre ?? 'Líder')
  return partes.join(' · ') || 'Todos'
}

const chips = computed(() => {
  const lista = []
  if (filtros.periodo || filtros.desde || filtros.hasta) {
    lista.push({ id: 'periodo', texto: resumen.value.periodo, quitar: () => elegirPeriodo('') })
  }
  for (const chip of chipsSeleccion(filtros.territorio, opciones.value.territorios, 'territorios')) {
    lista.push({ ...chip, quitar: () => quitar('territorio', chip.keys) })
  }
  for (const chip of chipsSeleccion(filtros.activador, opciones.value.activadores, 'activadores')) {
    lista.push({ ...chip, quitar: () => quitar('activador', chip.keys) })
  }
  for (const key of ['equipo', 'lider']) {
    if (!filtros[key]) continue
    const fuente = key === 'equipo' ? opciones.value.equipos : opciones.value.lideres
    const texto = fuente.find((o) => o.key === filtros[key])?.nombre ?? filtros[key]
    lista.push({ id: key, texto, quitar: () => { filtros[key] = '' } })
  }
  return lista
})

function quitar(key, keys) {
  filtros[key] = filtros[key].filter((k) => !keys.includes(k))
}

function elegirPeriodo(valor) {
  Object.assign(filtros, { periodo: valor, desde: '', hasta: '' })
}

function cambiarFecha(campo, valor) {
  Object.assign(filtros, { periodo: '', [campo]: valor })
}
</script>

<template>
  <section class="metrics-filter-card barra-filtros" aria-label="Filtros globales">
    <div class="barra-filtros-controles">
      <PopoverFiltro etiqueta="Período" :resumen="resumen.periodo" :activo="Boolean(filtros.periodo || filtros.desde || filtros.hasta)">
        <template #default="{ cerrar }">
          <div class="periodo-presets">
            <button
              type="button"
              class="periodo-preset"
              :class="{ elegido: !filtros.periodo && !filtros.desde && !filtros.hasta }"
              @click="elegirPeriodo(''); cerrar()"
            >
              Todo el historial
            </button>
            <button
              v-for="preset in PERIODOS"
              :key="preset.value"
              type="button"
              class="periodo-preset"
              :class="{ elegido: filtros.periodo === preset.value }"
              @click="elegirPeriodo(preset.value); cerrar()"
            >
              {{ preset.label }}
            </button>
          </div>
          <p class="field-label">Personalizado</p>
          <div class="periodo-rango">
            <label>
              <span class="field-label">Desde</span>
              <input :value="filtros.desde" type="date" class="input-texto" @change="cambiarFecha('desde', $event.target.value)">
            </label>
            <label>
              <span class="field-label">Hasta</span>
              <input :value="filtros.hasta" type="date" class="input-texto" @change="cambiarFecha('hasta', $event.target.value)">
            </label>
          </div>
        </template>
      </PopoverFiltro>

      <PopoverFiltro etiqueta="Territorio" :resumen="resumen.territorio" :activo="filtros.territorio.length > 0" ancho="380px">
        <SelectorTerritorio v-model="filtros.territorio" :opciones="opciones.territorios" />
      </PopoverFiltro>

      <PopoverFiltro
        etiqueta="Personas"
        :resumen="resumen.personas"
        :activo="Boolean(filtros.activador.length || filtros.equipo || filtros.lider)"
        ancho="380px"
      >
        <span class="field-label">Activadores</span>
        <ListaSeleccion v-model="filtros.activador" :grupos="gruposActivadores" placeholder="Buscar activador por nombre" />
        <div class="periodo-rango">
          <label>
            <span class="field-label">Equipo</span>
            <select v-model="filtros.equipo" class="input-texto">
              <option value="">Todos</option>
              <option v-for="opcion in opciones.equipos" :key="opcion.key" :value="opcion.key">{{ opcion.nombre }}</option>
            </select>
          </label>
          <label v-if="opciones.lideres.length">
            <span class="field-label">Líder de registro</span>
            <select v-model="filtros.lider" class="input-texto">
              <option value="">Todos</option>
              <option v-for="opcion in opciones.lideres" :key="opcion.key" :value="opcion.key">{{ opcion.nombre }}</option>
            </select>
          </label>
        </div>
      </PopoverFiltro>

      <div class="barra-filtros-cuenta">
        <p>
          <strong>{{ formatNumber(dashboard.rows.length) }}</strong>
          de {{ formatNumber(datos.activaciones.length) }} registros
        </p>
        <button class="boton" :disabled="!hayFiltros" @click="limpiarFiltros('global')">Limpiar</button>
      </div>
    </div>
    <ul v-if="chips.length" class="barra-filtros-chips" aria-label="Filtros activos">
      <li v-for="chip in chips" :key="chip.id">
        <button type="button" class="chip-filtro" :title="`Quitar ${chip.texto}`" @click="chip.quitar()">
          {{ chip.texto }} <span aria-hidden="true">✕</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.barra-filtros {
  position: sticky;
  top: 0.5rem;
  z-index: 30;
  gap: 0.7rem;
  padding: 0.75rem;
}

.barra-filtros-controles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  align-items: center;
  gap: 0.6rem;
}

.barra-filtros-cuenta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-left: 0.4rem;
}

.barra-filtros-cuenta p {
  margin: 0;
  color: var(--ru-ink-soft);
  font-size: 0.78rem;
  white-space: nowrap;
}

.barra-filtros-cuenta strong {
  color: var(--ru-ink);
  font-size: 0.95rem;
}

.barra-filtros-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chip-filtro {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.65rem;
  border: 1px solid #bcd7ff;
  border-radius: 999px;
  background: #eef5ff;
  color: #143b5e;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
}

.chip-filtro:hover {
  border-color: var(--ru-primary);
}

.chip-filtro span {
  color: var(--ru-ink-soft);
  font-size: 0.7rem;
}

.periodo-presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.periodo-preset {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--ru-border);
  border-radius: 10px;
  background: #ffffff;
  color: var(--ru-ink);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

.periodo-preset.elegido {
  border-color: var(--ru-primary);
  background: var(--ru-primary);
  color: #ffffff;
}

.periodo-presets .periodo-preset:first-child {
  grid-column: 1 / -1;
}

.periodo-rango {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.periodo-rango label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

p.field-label {
  margin: 0;
}

@media (max-width: 900px) {
  .barra-filtros {
    position: static;
  }

  .barra-filtros-controles {
    grid-template-columns: 1fr;
  }

  .barra-filtros-cuenta {
    justify-content: space-between;
    padding-left: 0;
  }
}
</style>
