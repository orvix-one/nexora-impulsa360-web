<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiRequest } from '../lib/api'
import { notifyError, notifySuccess, notifyWarning, requestConfirmation } from '../lib/feedback'
import { cuandoEvento, etiquetaEstadoEvento, momentoEvento } from '../lib/eventos'
import { activadoresElegibles } from '../lib/viajes'
import MapaLugar from '../components/MapaLugar.vue'
import SelectorActivadores from '../components/SelectorActivadores.vue'

const route = useRoute()
const evento = ref(null)
const resumen = ref(null)
const activadores = ref([])
const cargando = ref(false)
const guardando = ref(false)
const sumando = ref(null)

const cuando = computed(() => (evento.value ? cuandoEvento(evento.value) : null))
const disponibles = computed(() => {
  const actuales = new Set(evento.value?.activadores.map((a) => a.id) ?? [])
  return activadores.value.filter((a) => !actuales.has(a.id))
})
const mensaje = (error) => (error instanceof Error ? error.message : 'Error inesperado.')

async function cargar() {
  cargando.value = true
  try {
    const datos = await apiRequest(`/admin/eventos/${route.params.id}`)
    evento.value = datos.evento
    resumen.value = datos.resumen
  } catch (error) { notifyError(mensaje(error)) }
  finally { cargando.value = false }
}

function desdeMiembro(activadorId) {
  const miembro = evento.value.activadores.find((a) => a.id === activadorId)
  if (!miembro || evento.value.estado === 'programado' || new Date(miembro.desde) <= new Date(evento.value.inicio)) return ''
  return momentoEvento(miembro.desde)
}

async function abrirSuma() {
  sumando.value = []
  if (activadores.value.length) return
  try { activadores.value = activadoresElegibles((await apiRequest('/admin/users')).users ?? []) }
  catch (error) { notifyError(mensaje(error)) }
}

async function anadirActivadores() {
  if (!sumando.value?.length) { notifyWarning('Elige a quién añadir.'); return }
  guardando.value = true
  try {
    await apiRequest(`/admin/eventos/${evento.value.id}/activadores`, { method: 'POST', body: { activador_ids: sumando.value } })
    notifySuccess(sumando.value.length === 1 ? 'Activador añadido.' : `${sumando.value.length} activadores añadidos.`)
    sumando.value = null
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

async function accion(tipo) {
  const textos = {
    finalizar: { title: 'Finalizar evento', message: `${evento.value.nombre} termina ahora. Las activaciones que se registren después ya no cuentan para el evento.`, confirmLabel: 'Finalizar', tone: 'primary' },
    cancelar: { title: 'Cancelar evento', message: `${evento.value.nombre} queda como no realizado.`, confirmLabel: 'Cancelar evento', tone: 'danger' },
  }
  if (!(await requestConfirmation(textos[tipo]))) return
  guardando.value = true
  try {
    await apiRequest(`/admin/eventos/${evento.value.id}/${tipo}`, { method: 'POST' })
    notifySuccess(tipo === 'finalizar' ? 'Evento finalizado.' : 'Evento cancelado.')
    await cargar()
  } catch (error) { notifyError(mensaje(error)) }
  finally { guardando.value = false }
}

watch(() => route.params.id, cargar, { immediate: true })
</script>

<template>
  <section class="view-page">
    <router-link to="/eventos" class="boton-enlace volver-enlace">← Eventos</router-link>
    <p v-if="cargando && !evento">Cargando evento...</p>
    <template v-else-if="evento">
      <header class="view-header evento-cabecera">
        <div>
          <p class="view-kicker">Evento · <span class="estado-etiqueta" :class="`viaje-${evento.estado}`">{{ etiquetaEstadoEvento(evento.estado) }}</span></p>
          <h1 class="view-title">{{ evento.nombre }}</h1>
        </div>
        <div v-if="evento.acciones.finalizar || evento.acciones.cancelar" class="toolbar-actions">
          <button v-if="evento.acciones.cancelar" type="button" class="boton boton-eliminar" :disabled="guardando" @click="accion('cancelar')">Cancelar evento</button>
          <button v-if="evento.acciones.finalizar" type="button" class="boton boton-guardar" :disabled="guardando" @click="accion('finalizar')">Finalizar ahora</button>
        </div>
      </header>

      <div class="evento-pagina">
        <section class="panel-card">
          <dl class="evento-datos">
            <div><dt>Cuándo</dt><dd>{{ cuando.texto }}</dd></div>
            <div><dt>Duración</dt><dd>{{ cuando.duracion }}</dd></div>
            <div><dt>Lugar</dt><dd>{{ evento.lugar ? `${evento.lugar} · ${evento.radio_m} m` : 'Sin lugar' }}</dd></div>
            <div><dt>Activaciones</dt><dd>{{ evento.activaciones }}</dd></div>
          </dl>
          <p v-if="evento.acciones.finalizar && !evento.acciones.cancelar" class="viaje-nota">Ya tiene activaciones, así que no se puede cancelar: finalízalo.</p>
        </section>
        <section v-if="evento.punto" class="panel-card evento-mapa">
          <MapaLugar :key="evento.id" :model-value="evento.punto" :radio="evento.radio_m" solo-lectura />
        </section>
      </div>

      <section class="panel-card tabla-contenedor">
        <div class="toolbar-line">
          <h2 class="seccion-titulo">Activadores ({{ evento.activadores.length }})</h2>
          <button v-if="evento.acciones.anadir && !sumando" type="button" class="boton boton-primario" @click="abrirSuma">Añadir activadores</button>
        </div>
        <template v-if="sumando">
          <SelectorActivadores v-model="sumando" :opciones="disponibles" />
          <p class="viaje-nota">Cuentan sus activaciones desde que se suman.</p>
          <div class="confirm-actions">
            <button type="button" class="boton boton-cancelar" :disabled="guardando" @click="sumando = null">Cancelar</button>
            <button type="button" class="boton boton-guardar" :disabled="guardando" @click="anadirActivadores">Añadir</button>
          </div>
        </template>
        <div class="table-wrap modulo-table-wrap">
          <table class="tabla-usuarios tabla-resumen-evento">
            <thead><tr><th>Activador</th><th>Total</th><th>Comercios</th><th>Transeúntes</th><th>Cash-In</th><th>Créditos</th><th>Remesas</th><th>Última</th></tr></thead>
            <tbody>
              <tr v-for="fila in resumen.filas" :key="fila.id" :class="{ 'fila-inactiva': !fila.total }">
                <td>{{ fila.nombre }}<small v-if="desdeMiembro(fila.id)" class="viaje-nota">desde {{ desdeMiembro(fila.id) }}</small></td>
                <td>{{ fila.total }}</td><td>{{ fila.comercios }}</td><td>{{ fila.transeuntes }}</td>
                <td>{{ fila.cashIn }}</td><td>{{ fila.creditos }}</td><td>{{ fila.remesas }}</td><td>{{ fila.ultima ? momentoEvento(fila.ultima) : '—' }}</td>
              </tr>
            </tbody>
            <tfoot v-if="resumen.filas.length > 1">
              <tr><th>Total</th><th>{{ resumen.total.total }}</th><th>{{ resumen.total.comercios }}</th><th>{{ resumen.total.transeuntes }}</th><th>{{ resumen.total.cashIn }}</th><th>{{ resumen.total.creditos }}</th><th>{{ resumen.total.remesas }}</th><th></th></tr>
            </tfoot>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>
