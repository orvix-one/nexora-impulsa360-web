<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import ChartCard from '../../components/metrics/ChartCard.vue'
import TableScroll from '../../components/metrics/TableScroll.vue'
import { ESTADOS_EVENTO } from '../../lib/eventos'
import { resolverPeriodo } from '../../lib/metrics/filtros'
import { formatDecimal, formatNumber, haceCuanto } from '../../lib/metrics/formato'
import { agruparPorEstado, calcularEventos } from '../../lib/metrics/rendimientoEventos'
import { useMetricas } from '../../lib/metrics/useMetricas'
import { containsNormalized } from '../../lib/textUtils'

const { dashboard, datos, hoy, filtros, actualizar } = useMetricas()

const REFRESCO_MS = 3 * 60 * 1000
const COLUMNAS = [
  { key: 'nombre', label: 'Evento' },
  { key: 'total', label: 'Activaciones', numero: true },
  { key: 'activos', label: 'Activadores', numero: true },
  { key: 'porActivadorDia', label: 'Act. / activador-día', numero: true, titulo: 'Activaciones por cada día que un activador trabajó en el evento' },
  { key: 'pctComercios', label: 'Comercios nuevos', numero: true },
  { key: 'pctErrores', label: 'Con error', numero: true },
  { key: 'lugar', label: 'Lugar' },
]

const busqueda = ref('')
const estado = ref('sin_cancelados')
const orden = ref({ key: 'porActivadorDia', asc: false })
const ahora = ref(new Date())

const filas = computed(() => calcularEventos({
  eventos: datos.value.eventos,
  filas: dashboard.value.rows,
  hoy: hoy.value,
  periodo: resolverPeriodo(filtros, hoy.value),
  soloConActividad: Boolean(filtros.territorio.length || filtros.activador.length || filtros.equipo || filtros.lider),
}))

const enCurso = computed(() => filas.value.filter((f) => f.estado === 'en_curso').sort((a, b) => b.hoy - a.hoy || b.total - a.total))

const visibles = computed(() => filas.value.filter((f) => {
  if (estado.value === 'sin_cancelados' ? f.estado === 'cancelado' : estado.value && f.estado !== estado.value) return false
  return containsNormalized(f.nombre, busqueda.value) || containsNormalized(f.lugar ?? '', busqueda.value)
}))

const grupos = computed(() => {
  const { key, asc } = orden.value
  const comparar = (a, b) => {
    const va = a[key] ?? ''
    const vb = b[key] ?? ''
    const base = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')
    return (asc ? base : -base) || b.inicio.localeCompare(a.inicio)
  }
  return agruparPorEstado([...visibles.value].sort(comparar))
})

function ordenarPor(key) {
  orden.value = orden.value.key === key ? { key, asc: !orden.value.asc } : { key, asc: key === 'nombre' || key === 'lugar' }
}

function celda(fila, columna) {
  const valor = fila[columna.key]
  if (columna.key === 'activos') return `${formatNumber(valor)} / ${formatNumber(fila.asignados)}`
  if (columna.key === 'porActivadorDia') return fila.total ? formatDecimal(valor) : '—'
  if (columna.key.startsWith('pct')) return fila.total ? `${Math.round(valor * 100)}%` : '—'
  if (columna.numero) return formatNumber(valor)
  return valor ?? '—'
}

function barras(porHora) {
  const max = Math.max(1, ...porHora)
  return porHora.map((n, hora) => ({ hora, n, alto: Math.max(n ? 3 : 1, Math.round((n / max) * 22)) }))
}

const UNA_HORA_MS = 60 * 60 * 1000

function sinMovimiento(evento) {
  return !evento.ultima || ahora.value.getTime() - new Date(evento.ultima).getTime() > UNA_HORA_MS
}

const temporizadores = []
onMounted(() => {
  temporizadores.push(setInterval(() => { ahora.value = new Date() }, 30000))
  temporizadores.push(setInterval(() => {
    if (enCurso.value.length && document.visibilityState === 'visible') actualizar()
  }, REFRESCO_MS))
})
onBeforeUnmount(() => temporizadores.forEach(clearInterval))
</script>

<template>
  <ChartCard titulo="En curso ahora" :descripcion="enCurso.length ? 'Actividad de hoy en cada evento abierto.' : ''">
    <template v-if="enCurso.length" #aside>
      <span class="eventos-cuenta">{{ enCurso.length }}</span>
    </template>
    <p v-if="!enCurso.length" class="panel-empty">No hay eventos en curso para este corte.</p>
    <ul v-else class="en-vivo" role="list">
      <li class="en-vivo-cabecera" aria-hidden="true">
        <span>Evento</span>
        <span class="numero">Hoy</span>
        <span>Por hora, hoy</span>
        <span>Activadores hoy</span>
        <span>Última</span>
      </li>
      <li v-for="evento in enCurso" :key="evento.id" class="en-vivo-fila">
        <div class="en-vivo-evento">
          <strong>{{ evento.nombre }}</strong>
          <small>{{ evento.rango }}<template v-if="evento.lugar"> · {{ evento.lugar }}</template></small>
        </div>
        <strong class="en-vivo-hoy numero" :title="`${formatNumber(evento.total)} en total`">{{ formatNumber(evento.hoy) }}</strong>
        <svg class="en-vivo-horas" viewBox="0 0 96 24" preserveAspectRatio="none" role="img" :aria-label="`Activaciones por hora hoy en ${evento.nombre}`">
          <rect
            v-for="barra in barras(evento.porHoraHoy)"
            :key="barra.hora"
            :x="barra.hora * 4"
            :y="24 - barra.alto"
            width="3"
            :height="barra.alto"
            :class="{ vacia: !barra.n }"
          >
            <title>{{ barra.hora }}:00 · {{ barra.n }}</title>
          </rect>
        </svg>
        <div class="en-vivo-activadores" :title="`${evento.activosHoy} de ${evento.asignados} activadores asignados registraron hoy`">
          <span>{{ evento.activosHoy }} de {{ evento.asignados }} activadores</span>
          <span class="pista"><span :style="{ width: `${evento.asignados ? (evento.activosHoy / evento.asignados) * 100 : 0}%` }"></span></span>
        </div>
        <span class="en-vivo-ultima" :class="{ quieto: sinMovimiento(evento) }">
          {{ evento.ultima ? haceCuanto(new Date(evento.ultima), ahora) : 'Sin activaciones' }}
        </span>
      </li>
    </ul>
  </ChartCard>

  <ChartCard titulo="Rendimiento por evento" descripcion="Solo cuentan las activaciones del período y filtros elegidos arriba.">
    <template #aside>
      <div class="eventos-controles">
        <input v-model="busqueda" class="input-texto" type="search" placeholder="Buscar evento o lugar">
        <select v-model="estado" class="input-texto">
          <option value="sin_cancelados">Sin cancelados</option>
          <option value="">Todos</option>
          <option v-for="e in ESTADOS_EVENTO" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
      </div>
    </template>
    <p v-if="!grupos.length" class="panel-empty">No hay eventos para este corte.</p>
    <TableScroll v-else class="eventos-tabla">
      <table class="tabla-usuarios tabla-eventos">
        <thead>
          <tr>
            <th v-for="columna in COLUMNAS" :key="columna.key" :class="{ numero: columna.numero }" :title="columna.titulo">
              <button type="button" class="orden" @click="ordenarPor(columna.key)">
                {{ columna.label }}
                <span v-if="orden.key === columna.key" aria-hidden="true">{{ orden.asc ? '▲' : '▼' }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody v-for="grupo in grupos" :key="grupo.estado">
          <tr class="fila-grupo">
            <td :colspan="COLUMNAS.length">
              <span class="estado-etiqueta" :class="`viaje-${grupo.estado}`">{{ grupo.label }}</span>
              <small>{{ grupo.filas.length }}</small>
            </td>
          </tr>
          <tr v-for="fila in grupo.filas" :key="fila.id">
            <td v-for="columna in COLUMNAS" :key="columna.key" :class="{ numero: columna.numero }">
              <template v-if="columna.key === 'nombre'">
                <strong>{{ fila.nombre }}</strong>
                <small class="evento-rango">{{ fila.rango }}</small>
              </template>
              <template v-else>{{ celda(fila, columna) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </TableScroll>
  </ChartCard>
</template>

<style scoped>
.eventos-cuenta {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--ru-primary);
  color: #ffffff;
  font-size: 0.78rem;
  font-weight: 700;
}

.en-vivo {
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.en-vivo-cabecera,
.en-vivo-fila {
  display: grid;
  grid-template-columns: minmax(180px, 2fr) 70px minmax(110px, 1.2fr) minmax(120px, 1fr) 110px;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0.4rem;
}

.en-vivo-cabecera {
  color: var(--ru-ink-soft);
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.en-vivo-fila {
  border-top: 1px solid #dce8f4;
}

.numero {
  text-align: right;
}

.en-vivo-evento {
  display: grid;
  min-width: 0;
}

.en-vivo-evento strong,
.en-vivo-evento small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.en-vivo-evento strong {
  color: #102f4c;
}

.en-vivo-evento small {
  color: var(--ru-ink-soft);
  font-size: 0.74rem;
}

.en-vivo-hoy {
  color: #102f4c;
  font-family: 'Space Grotesk', 'Sora', sans-serif;
  font-size: 1.5rem;
  line-height: 1;
}

.en-vivo-horas {
  width: 100%;
  height: 26px;
}

.en-vivo-horas rect {
  fill: var(--ru-primary);
}

.en-vivo-horas rect.vacia {
  fill: #dbe7f5;
}

.en-vivo-activadores {
  display: grid;
  gap: 0.3rem;
  color: var(--ru-ink);
  font-size: 0.82rem;
}

.pista {
  height: 6px;
  border-radius: 999px;
  background: #dbe7f5;
  overflow: hidden;
}

.pista span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ru-primary);
}

.en-vivo-ultima {
  color: var(--ru-ink-soft);
  font-size: 0.8rem;
}

.en-vivo-ultima.quieto {
  color: #a35a00;
  font-weight: 700;
}

.eventos-controles {
  display: flex;
  gap: 0.5rem;
}

.eventos-controles .input-texto {
  min-width: 170px;
}

.eventos-tabla {
  max-height: 600px;
}

.tabla-eventos {
  width: 100%;
}

.tabla-eventos th.numero,
.tabla-eventos td.numero {
  text-align: right;
}

.orden {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.fila-grupo td {
  background: var(--ru-surface) !important;
}

.fila-grupo small {
  margin-left: 0.5rem;
  color: var(--ru-ink-soft);
  font-weight: 700;
}

.evento-rango {
  display: block;
  color: var(--ru-ink-soft);
}

@media (max-width: 760px) {
  .eventos-controles {
    flex-direction: column;
  }

  .en-vivo-cabecera {
    display: none;
  }

  .en-vivo-fila {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem 1rem;
  }

  .en-vivo-horas,
  .en-vivo-activadores {
    grid-column: 1 / -1;
  }
}
</style>
