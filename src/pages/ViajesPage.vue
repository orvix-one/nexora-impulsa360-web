<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { notifyError, notifySuccess, notifyWarning, requestConfirmation } from '../lib/feedback'
import {
  activadoresElegibles, ESTADOS_VIAJE, etiquetaEstadoViaje, fechaHoraBolivia, filtrarViajes, opcionesMunicipio,
} from '../lib/viajes'
import { contarRegistros } from '../lib/textUtils'
import SelectorActivadores from '../components/SelectorActivadores.vue'
import SelectorBuscable from '../components/SelectorBuscable.vue'

const viajes = ref([])
const activadores = ref([])
const municipios = ref([])
const cargando = ref(false)
const guardando = ref(false)
const filtroEstado = ref('')
const filtroTexto = ref('')
const panelAbierto = ref(false)
const formulario = ref(formularioVacio())

const visibles = computed(() => filtrarViajes(viajes.value, { estado: filtroEstado.value, texto: filtroTexto.value }))

function formularioVacio() { return { activador_ids: [], municipio_id: null, inicio: '', fin: '', nota: '' } }
function mensaje(error) { return error instanceof Error ? error.message : 'Error inesperado.' }

async function cargarViajes() {
  cargando.value = true
  try { viajes.value = (await apiRequest('/admin/viajes')).viajes ?? [] }
  catch (error) { notifyError(mensaje(error)) }
  finally { cargando.value = false }
}

async function abrirNuevo() {
  formulario.value = formularioVacio()
  panelAbierto.value = true
  if (activadores.value.length && municipios.value.length) return
  try {
    const [usuarios, catalogo] = await Promise.all([apiRequest('/admin/users'), apiRequest('/admin/municipios')])
    activadores.value = activadoresElegibles(usuarios.users ?? [])
    municipios.value = opcionesMunicipio(catalogo.municipios ?? [])
  } catch (error) { notifyError(mensaje(error)) }
}

async function guardar() {
  const form = formulario.value
  if (!form.activador_ids.length || !form.municipio_id || !form.inicio || !form.fin) {
    notifyWarning('Elige activadores, destino, inicio y fin.')
    return
  }
  guardando.value = true
  try {
    await apiRequest('/admin/viajes', {
      method: 'POST',
      body: { ...form, inicio: new Date(form.inicio).toISOString(), fin: new Date(form.fin).toISOString() },
    })
    panelAbierto.value = false
    notifySuccess(form.activador_ids.length === 1 ? 'Viaje creado.' : `${form.activador_ids.length} viajes creados.`)
    await cargarViajes()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

async function cancelar(viaje) {
  const ok = await requestConfirmation({
    title: 'Cancelar viaje',
    message: `${viaje.activador} deja de estar de viaje en ${viaje.destino}. Sus activaciones ya registradas no cambian.`,
    confirmLabel: 'Cancelar viaje',
    tone: 'danger',
  })
  if (!ok) return
  try {
    await apiRequest(`/admin/viajes/${viaje.id}/cancelar`, { method: 'POST' })
    notifySuccess('Viaje cancelado.')
    await cargarViajes()
  } catch (error) { notifyError(mensaje(error)) }
}

onMounted(cargarViajes)
</script>

<template>
  <section class="view-page">
    <header class="view-header">
      <p class="view-kicker">Organizacion</p>
      <h1 class="view-title">Viajes</h1>
      <p class="view-description">Activadores que trabajan unos días en otro municipio. Sus activaciones quedan vinculadas al viaje.</p>
    </header>

    <div class="panel-card tabla-contenedor">
      <div class="toolbar-line">
        <h2 class="subtitulo subtitulo-inline">Viajes</h2>
        <div class="toolbar-actions">
          <span class="meta-pill">{{ contarRegistros(visibles.length) }}</span>
          <button class="boton boton-primario" @click="abrirNuevo">Nuevo viaje</button>
        </div>
      </div>
      <div class="filtros filtros-grid">
        <label><span class="field-label">Activador o destino</span><input v-model="filtroTexto" class="input-texto" placeholder="Buscar"></label>
        <label><span class="field-label">Estado</span><select v-model="filtroEstado" class="input-texto"><option value="">Todos</option><option v-for="estado in ESTADOS_VIAJE" :key="estado.value" :value="estado.value">{{ estado.label }}</option></select></label>
      </div>
      <p v-if="cargando">Cargando viajes...</p>
      <p v-else-if="!visibles.length" class="panel-empty">No hay viajes para los filtros seleccionados.</p>
      <div v-else class="table-wrap modulo-table-wrap">
        <table class="tabla-usuarios">
          <thead><tr><th>Activador</th><th>Destino</th><th>Desde</th><th>Hasta</th><th>Estado</th><th>Activaciones</th><th></th></tr></thead>
          <tbody>
            <tr v-for="viaje in visibles" :key="viaje.id">
              <td>{{ viaje.activador || 'Sin nombre' }}<small v-if="viaje.nota" class="viaje-nota">{{ viaje.nota }}</small></td>
              <td>{{ viaje.destino }}</td>
              <td>{{ fechaHoraBolivia(viaje.inicio) }}</td>
              <td>{{ fechaHoraBolivia(viaje.fin) }}</td>
              <td><span class="estado-etiqueta" :class="`viaje-${viaje.estado}`">{{ etiquetaEstadoViaje(viaje.estado) }}</span></td>
              <td>{{ viaje.activaciones }}</td>
              <td><button v-if="viaje.estado === 'en_curso' || viaje.estado === 'programado'" class="boton boton-eliminar boton-pequeno" @click="cancelar(viaje)">Cancelar</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="panelAbierto" class="detalle-overlay" @click.self="panelAbierto = false">
      <aside class="detalle-activacion" role="dialog" aria-modal="true" aria-label="Nuevo viaje">
        <header class="detalle-header">
          <div><p class="view-kicker">Viajes</p><h3 class="detalle-title">Nuevo viaje</h3></div>
          <button type="button" class="detalle-close" aria-label="Cerrar" @click="panelAbierto = false">×</button>
        </header>
        <form class="detalle-body" @submit.prevent="guardar">
          <section class="detalle-section">
            <h4>Activadores</h4>
            <SelectorActivadores v-model="formulario.activador_ids" :opciones="activadores" />
          </section>
          <section class="detalle-section">
            <h4>Destino</h4>
            <SelectorBuscable v-model="formulario.municipio_id" :opciones="municipios" placeholder="Buscar municipio" />
          </section>
          <section class="detalle-section viaje-fechas">
            <label><span class="field-label">Desde</span><input v-model="formulario.inicio" type="datetime-local" class="input-texto"></label>
            <label><span class="field-label">Hasta</span><input v-model="formulario.fin" type="datetime-local" class="input-texto"></label>
            <label class="edicion-field-wide"><span class="field-label">Nota (opcional)</span><input v-model="formulario.nota" class="input-texto" placeholder="Ej. apoyo feria regional"></label>
          </section>
          <div class="confirm-actions">
            <button type="button" class="boton boton-cancelar" :disabled="guardando" @click="panelAbierto = false">Cancelar</button>
            <button type="submit" class="boton boton-guardar" :disabled="guardando">{{ guardando ? 'Guardando...' : 'Crear viaje' }}</button>
          </div>
        </form>
      </aside>
    </div>
  </section>
</template>
