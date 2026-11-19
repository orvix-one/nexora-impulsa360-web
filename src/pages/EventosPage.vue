<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { notifyError, notifySuccess, notifyWarning, requestConfirmation } from '../lib/feedback'
import {
  ESTADOS_EVENTO, etiquetaEstadoEvento, fechaFinEvento, fechaInicioEvento, filtrarEventos, opcionesLugar, RADIO_INICIAL, rangoEvento, SIN_LUGAR,
} from '../lib/eventos'
import { activadoresElegibles } from '../lib/viajes'
import { containsNormalized, contarRegistros } from '../lib/textUtils'
import EditorLugar from '../components/EditorLugar.vue'
import MapaLugar from '../components/MapaLugar.vue'
import SelectorActivadores from '../components/SelectorActivadores.vue'
import SelectorBuscable from '../components/SelectorBuscable.vue'
import SelectorRadio from '../components/SelectorRadio.vue'

const pestana = ref('eventos')
const eventos = ref([])
const lugares = ref([])
const activadores = ref([])
const cargando = ref(false)
const guardando = ref(false)
const filtroEstado = ref('')
const filtroTexto = ref('')
const filtroLugar = ref('')
const filtroDepartamento = ref('')

const nuevo = ref(null)
const detalleId = ref(null)
const sumando = ref(null)
const edicionLugar = ref(null)

const eventosVisibles = computed(() => filtrarEventos(eventos.value, { estado: filtroEstado.value, texto: filtroTexto.value, departamento: filtroDepartamento.value }))
const departamentos = computed(() => [...new Set(eventos.value.map((e) => e.departamento).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')))
const lugaresVisibles = computed(() => lugares.value.filter((l) => containsNormalized(l.nombre, filtroLugar.value)))
const detalle = computed(() => eventos.value.find((e) => e.id === detalleId.value) ?? null)
const lugarElegido = computed(() => lugares.value.find((l) => l.id === nuevo.value?.lugar_id) ?? null)
const disponibles = computed(() => {
  const actuales = new Set(detalle.value?.activadores.map((a) => a.id) ?? [])
  return activadores.value.filter((a) => !actuales.has(a.id))
})
const mensaje = (error) => (error instanceof Error ? error.message : 'Error inesperado.')

async function cargar() {
  cargando.value = true
  try {
    const [e, l] = await Promise.all([apiRequest('/admin/eventos'), apiRequest('/admin/lugares')])
    eventos.value = e.eventos ?? []
    lugares.value = l.lugares ?? []
  } catch (error) { notifyError(mensaje(error)) }
  finally { cargando.value = false }
}

async function cargarActivadores() {
  if (activadores.value.length) return
  try { activadores.value = activadoresElegibles((await apiRequest('/admin/users')).users ?? []) }
  catch (error) { notifyError(mensaje(error)) }
}

function abrirNuevo() {
  nuevo.value = {
    nombre: '', desde: '', horaDesde: '', hasta: '', horaHasta: '',
    sinLugar: true, creandoLugar: false, lugar_id: null, radio_m: RADIO_INICIAL, lugarNuevo: { nombre: '', punto: null }, activador_ids: [],
  }
  cargarActivadores()
}

function elegirLugar(id) {
  nuevo.value.lugar_id = id
  nuevo.value.radio_m = lugares.value.find((l) => l.id === id)?.radio_m ?? RADIO_INICIAL
}

async function lugarDelEvento(form) {
  if (form.sinLugar) return null
  if (!form.creandoLugar) return form.lugar_id
  const { lugar } = await apiRequest('/admin/lugares', {
    method: 'POST',
    body: { nombre: form.lugarNuevo.nombre, latitud: form.lugarNuevo.punto.latitud, longitud: form.lugarNuevo.punto.longitud, radio_m: Number(form.radio_m) },
  })
  return lugar.id
}

async function crearEvento() {
  const form = nuevo.value
  const rango = rangoEvento(form)
  if (!form.nombre.trim()) { notifyWarning('Ponle nombre al evento.'); return }
  if ('error' in rango) { notifyWarning(rango.error); return }
  if (!form.sinLugar && !form.creandoLugar && !form.lugar_id) { notifyWarning('Elige un lugar o crea uno nuevo.'); return }
  if (!form.sinLugar && form.creandoLugar && (!form.lugarNuevo.nombre.trim() || !form.lugarNuevo.punto)) { notifyWarning('El lugar nuevo necesita nombre y punto en el mapa.'); return }
  if (!form.activador_ids.length) { notifyWarning('Elige al menos un activador.'); return }
  guardando.value = true
  try {
    const lugarId = await lugarDelEvento(form)
    await apiRequest('/admin/eventos', {
      method: 'POST',
      body: { nombre: form.nombre, ...rango, lugar_id: lugarId, radio_m: lugarId ? Number(form.radio_m) : null, activador_ids: form.activador_ids },
    })
    nuevo.value = null
    notifySuccess('Evento creado.')
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

function abrirDetalle(evento) {
  detalleId.value = evento.id
  sumando.value = null
}

async function abrirSuma() {
  sumando.value = []
  await cargarActivadores()
}

async function anadirActivadores() {
  if (!sumando.value?.length) { notifyWarning('Elige a quién añadir.'); return }
  guardando.value = true
  try {
    await apiRequest(`/admin/eventos/${detalle.value.id}/activadores`, { method: 'POST', body: { activador_ids: sumando.value } })
    notifySuccess(sumando.value.length === 1 ? 'Activador añadido.' : `${sumando.value.length} activadores añadidos.`)
    sumando.value = null
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

async function accion(tipo) {
  const evento = detalle.value
  const textos = {
    finalizar: { title: 'Finalizar evento', message: `${evento.nombre} termina ahora. Las activaciones que se registren después ya no cuentan para el evento.`, confirmLabel: 'Finalizar', tone: 'primary' },
    cancelar: { title: 'Cancelar evento', message: `${evento.nombre} queda como no realizado.`, confirmLabel: 'Cancelar evento', tone: 'danger' },
  }
  if (!(await requestConfirmation(textos[tipo]))) return
  guardando.value = true
  try {
    await apiRequest(`/admin/eventos/${evento.id}/${tipo}`, { method: 'POST' })
    notifySuccess(tipo === 'finalizar' ? 'Evento finalizado.' : 'Evento cancelado.')
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

function editarLugar(lugar) {
  edicionLugar.value = { id: lugar.id, nombre: lugar.nombre, punto: { latitud: lugar.latitud, longitud: lugar.longitud }, radio_m: lugar.radio_m, puntoFijo: !lugar.acciones.moverPunto, eliminable: lugar.acciones.eliminar }
}

async function guardarLugar() {
  const form = edicionLugar.value
  if (!form.nombre.trim() || !form.punto) { notifyWarning('El lugar necesita nombre y punto en el mapa.'); return }
  guardando.value = true
  try {
    await apiRequest(`/admin/lugares/${form.id}`, {
      method: 'PATCH',
      body: { nombre: form.nombre, radio_m: form.radio_m, ...(form.puntoFijo ? {} : { latitud: form.punto.latitud, longitud: form.punto.longitud }) },
    })
    edicionLugar.value = null
    notifySuccess('Lugar guardado.')
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

async function eliminarLugar(lugar) {
  const ok = await requestConfirmation({ title: 'Eliminar lugar', message: `${lugar.nombre} deja de estar en Lugares guardados.`, confirmLabel: 'Eliminar', tone: 'danger' })
  if (!ok) return
  try {
    await apiRequest(`/admin/lugares/${lugar.id}`, { method: 'DELETE' })
    edicionLugar.value = null
    notifySuccess('Lugar eliminado.')
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
}

onMounted(cargar)
</script>

<template>
  <section class="view-page">
    <header class="view-header">
      <p class="view-kicker">Organizacion</p>
      <h1 class="view-title">Eventos</h1>
      <p class="view-description">Activadores asignados a un evento con lugar opcional.</p>
    </header>

    <div class="panel-card tabla-contenedor">
      <div class="toolbar-line">
        <div class="lugares-pestanas" role="tablist">
          <button class="boton" :class="{ 'boton-primario': pestana === 'eventos' }" role="tab" @click="pestana = 'eventos'">Eventos</button>
          <button class="boton" :class="{ 'boton-primario': pestana === 'lugares' }" role="tab" @click="pestana = 'lugares'">Lugares guardados</button>
        </div>
        <div class="toolbar-actions">
          <span class="meta-pill">{{ contarRegistros(pestana === 'eventos' ? eventosVisibles.length : lugaresVisibles.length) }}</span>
          <button v-if="pestana === 'eventos'" class="boton boton-primario" @click="abrirNuevo">Nuevo evento</button>
        </div>
      </div>

      <template v-if="pestana === 'eventos'">
        <div class="filtros filtros-grid">
          <label><span class="field-label">Evento, lugar o activador</span><input v-model="filtroTexto" class="input-texto" placeholder="Buscar"></label>
          <label><span class="field-label">Estado</span><select v-model="filtroEstado" class="input-texto"><option value="">Todos</option><option v-for="estado in ESTADOS_EVENTO" :key="estado.value" :value="estado.value">{{ estado.label }}</option></select></label>
          <label><span class="field-label">Departamento</span><select v-model="filtroDepartamento" class="input-texto"><option value="">Todos</option><option v-for="d in departamentos" :key="d" :value="d">{{ d }}</option><option :value="SIN_LUGAR">Sin lugar</option></select></label>
        </div>
        <p v-if="cargando">Cargando eventos...</p>
        <p v-else-if="!eventosVisibles.length" class="panel-empty">No hay eventos para los filtros seleccionados.</p>
        <div v-else class="table-wrap modulo-table-wrap">
          <table class="tabla-usuarios">
            <thead><tr><th>Estado</th><th>Evento</th><th>Lugar</th><th>Desde</th><th>Hasta</th><th>Activadores</th></tr></thead>
            <tbody>
              <tr v-for="evento in eventosVisibles" :key="evento.id" class="fila-clic" :class="`fila-evento-${evento.estado}`" @click="abrirDetalle(evento)">
                <td><span class="estado-etiqueta" :class="`viaje-${evento.estado}`">{{ etiquetaEstadoEvento(evento.estado) }}</span></td>
                <td>{{ evento.nombre }}<small class="viaje-nota">{{ evento.activaciones === 1 ? '1 activación' : `${evento.activaciones} activaciones` }}</small></td>
                <td>{{ evento.lugar || 'Sin lugar' }}<small v-if="evento.lugar" class="viaje-nota">{{ evento.radio_m }} m</small></td>
                <td>{{ fechaInicioEvento(evento.inicio) }}</td>
                <td>{{ fechaFinEvento(evento.fin) }}</td>
                <td :title="evento.activadores.map((a) => a.nombre).join(', ')">{{ evento.activadores.length === 1 ? evento.activadores[0].nombre : evento.activadores.length }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <div class="filtros filtros-grid">
          <label><span class="field-label">Lugar</span><input v-model="filtroLugar" class="input-texto" placeholder="Buscar"></label>
        </div>
        <p v-if="cargando">Cargando lugares...</p>
        <p v-else-if="!lugaresVisibles.length" class="panel-empty">No hay lugares guardados. Se crean al armar un evento.</p>
        <div v-else class="table-wrap modulo-table-wrap">
          <table class="tabla-usuarios">
            <thead><tr><th>Lugar</th><th>Municipio</th><th>Radio</th><th>Eventos</th><th>Activaciones</th></tr></thead>
            <tbody>
              <tr v-for="l in lugaresVisibles" :key="l.id" class="fila-clic" @click="editarLugar(l)">
                <td>{{ l.nombre }}</td>
                <td>{{ l.municipio || '—' }}</td>
                <td>{{ l.radio_m }} m</td>
                <td>{{ l.eventos }}</td>
                <td>{{ l.activaciones }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <div v-if="nuevo" class="detalle-overlay" @click.self="nuevo = null">
      <aside class="detalle-activacion" role="dialog" aria-modal="true" aria-label="Nuevo evento">
        <header class="detalle-header">
          <div><p class="view-kicker">Eventos</p><h3 class="detalle-title">Nuevo evento</h3></div>
          <button type="button" class="detalle-close" aria-label="Cerrar" @click="nuevo = null">×</button>
        </header>
        <form class="detalle-body" @submit.prevent="crearEvento">
          <section class="detalle-section">
            <label><span class="field-label">Nombre</span><input v-model="nuevo.nombre" class="input-texto" placeholder="Ej. Feria Joven Emprendedor"></label>
          </section>
          <section class="detalle-section">
            <h4>Cuándo</h4>
            <div class="fechas-evento">
              <span class="field-label">Desde</span>
              <input v-model="nuevo.desde" type="date" class="input-texto" aria-label="Fecha de inicio">
              <input v-model="nuevo.horaDesde" type="time" class="input-texto" aria-label="Hora de inicio (opcional)">
              <span class="field-label">Hasta</span>
              <input v-model="nuevo.hasta" type="date" class="input-texto" aria-label="Fecha de fin (opcional)">
              <input v-model="nuevo.horaHasta" type="time" class="input-texto" aria-label="Hora de fin (opcional)" :disabled="!nuevo.hasta">
            </div>
            <p class="viaje-nota">Las horas son opcionales. Sin fecha de fin, el evento sigue abierto hasta que lo finalices.</p>
          </section>
          <section class="detalle-section">
            <div class="toolbar-line">
              <h4>Lugar</h4>
              <label class="interruptor"><input v-model="nuevo.sinLugar" type="checkbox" role="switch"> Sin lugar</label>
            </div>
            <p v-if="nuevo.sinLugar" class="viaje-nota">Cuentan todas las activaciones de los activadores durante el evento, estén donde estén.</p>
            <template v-else-if="nuevo.creandoLugar">
              <EditorLugar v-model="nuevo.lugarNuevo" v-model:radio="nuevo.radio_m" etiqueta-radio="Radio del evento" />
              <button type="button" class="boton-enlace" @click="nuevo.creandoLugar = false">Elegir un lugar guardado</button>
            </template>
            <template v-else>
              <div class="lugar-elegir">
                <SelectorBuscable :model-value="nuevo.lugar_id" :opciones="opcionesLugar(lugares)" placeholder="Buscar lugar" @update:model-value="elegirLugar" />
                <button type="button" class="boton boton-pequeno" @click="nuevo.creandoLugar = true; nuevo.lugar_id = null">+ Nuevo</button>
              </div>
              <template v-if="lugarElegido">
                <SelectorRadio v-model="nuevo.radio_m" etiqueta="Radio del evento" />
                <MapaLugar :key="lugarElegido.id" :model-value="{ latitud: lugarElegido.latitud, longitud: lugarElegido.longitud }" :radio="nuevo.radio_m" solo-lectura />
              </template>
            </template>
            <p v-if="!nuevo.sinLugar" class="viaje-nota">Solo cuentan las activaciones registradas dentro del radio.</p>
          </section>
          <section class="detalle-section">
            <h4>Activadores</h4>
            <SelectorActivadores v-model="nuevo.activador_ids" :opciones="activadores" />
          </section>
          <div class="confirm-actions">
            <button type="button" class="boton boton-cancelar" :disabled="guardando" @click="nuevo = null">Cancelar</button>
            <button type="submit" class="boton boton-guardar" :disabled="guardando">{{ guardando ? 'Guardando...' : 'Crear evento' }}</button>
          </div>
        </form>
      </aside>
    </div>

    <div v-if="detalle" class="detalle-overlay" @click.self="detalleId = null">
      <aside class="detalle-activacion" role="dialog" aria-modal="true" :aria-label="detalle.nombre">
        <header class="detalle-header">
          <div>
            <p class="view-kicker">Evento · <span class="estado-etiqueta" :class="`viaje-${detalle.estado}`">{{ etiquetaEstadoEvento(detalle.estado) }}</span></p>
            <h3 class="detalle-title">{{ detalle.nombre }}</h3>
          </div>
          <button type="button" class="detalle-close" aria-label="Cerrar" @click="detalleId = null">×</button>
        </header>
        <div class="detalle-body">
          <section class="detalle-section">
            <dl class="evento-datos">
              <div><dt>Desde</dt><dd>{{ fechaInicioEvento(detalle.inicio) }}</dd></div>
              <div><dt>Hasta</dt><dd>{{ fechaFinEvento(detalle.fin) }}</dd></div>
              <div><dt>Lugar</dt><dd>{{ detalle.lugar ? `${detalle.lugar} · ${detalle.radio_m} m` : 'Sin lugar' }}</dd></div>
              <div><dt>Activaciones</dt><dd>{{ detalle.activaciones }}</dd></div>
            </dl>
            <MapaLugar v-if="detalle.punto" :key="detalle.id" :model-value="detalle.punto" :radio="detalle.radio_m" solo-lectura />
          </section>
          <section class="detalle-section">
            <div class="toolbar-line">
              <h4>Activadores ({{ detalle.activadores.length }})</h4>
              <button v-if="detalle.acciones.anadir && !sumando" type="button" class="boton boton-pequeno" @click="abrirSuma">Añadir activadores</button>
            </div>
            <template v-if="sumando">
              <SelectorActivadores v-model="sumando" :opciones="disponibles" />
              <p class="viaje-nota">Cuentan sus activaciones desde que se suman.</p>
              <div class="confirm-actions">
                <button type="button" class="boton boton-cancelar" :disabled="guardando" @click="sumando = null">Cancelar</button>
                <button type="button" class="boton boton-guardar" :disabled="guardando" @click="anadirActivadores">Añadir</button>
              </div>
            </template>
            <ul class="evento-activadores">
              <li v-for="a in detalle.activadores" :key="a.id">{{ a.nombre }}<small v-if="new Date(a.desde) > new Date(detalle.inicio) && detalle.estado !== 'programado'" class="viaje-nota">desde {{ fechaInicioEvento(a.desde) }}</small></li>
            </ul>
          </section>
          <div v-if="detalle.acciones.finalizar || detalle.acciones.cancelar" class="confirm-actions">
            <button v-if="detalle.acciones.cancelar" type="button" class="boton boton-eliminar" :disabled="guardando" @click="accion('cancelar')">Cancelar evento</button>
            <button v-if="detalle.acciones.finalizar" type="button" class="boton boton-guardar" :disabled="guardando" @click="accion('finalizar')">Finalizar ahora</button>
          </div>
          <p v-if="detalle.acciones.finalizar && !detalle.acciones.cancelar" class="viaje-nota">Ya tiene activaciones, así que no se puede cancelar: finalízalo.</p>
        </div>
      </aside>
    </div>

    <div v-if="edicionLugar" class="detalle-overlay" @click.self="edicionLugar = null">
      <aside class="detalle-activacion" role="dialog" aria-modal="true" aria-label="Lugar guardado">
        <header class="detalle-header">
          <div><p class="view-kicker">Lugar</p><h3 class="detalle-title">{{ edicionLugar.nombre || 'Lugar' }}</h3></div>
          <button type="button" class="detalle-close" aria-label="Cerrar" @click="edicionLugar = null">×</button>
        </header>
        <form class="detalle-body" @submit.prevent="guardarLugar">
          <section class="detalle-section">
            <EditorLugar v-model="edicionLugar" v-model:radio="edicionLugar.radio_m" :punto-fijo="edicionLugar.puntoFijo" />
          </section>
          <div class="confirm-actions">
            <button v-if="edicionLugar.eliminable" type="button" class="boton boton-eliminar accion-izquierda" :disabled="guardando" @click="eliminarLugar(edicionLugar)">Eliminar</button>
            <button type="button" class="boton boton-cancelar" :disabled="guardando" @click="edicionLugar = null">Cancelar</button>
            <button type="submit" class="boton boton-guardar" :disabled="guardando">{{ guardando ? 'Guardando...' : 'Guardar lugar' }}</button>
          </div>
        </form>
      </aside>
    </div>
  </section>
</template>
