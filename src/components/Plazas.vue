<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { notifyError, notifySuccess, notifyWarning, requestPasswordConfirmation } from '../lib/feedback'
import { filasPlazas, municipiosConvertibles } from '../lib/plazasYolopago'
import SelectorBuscable from './SelectorBuscable.vue'

const plazas = ref([])
const municipios = ref([])
const vinculos = ref([])
const cargando = ref(false)
const procesando = ref(false)
const editandoId = ref(null)
const nombreEdicion = ref('')
const conversion = ref(null)

const filas = computed(() => filasPlazas(plazas.value, vinculos.value, municipios.value))
const convertibles = computed(() => municipiosConvertibles(filas.value, vinculos.value, municipios.value))
const elegido = computed(() => convertibles.value.find((m) => m.id === conversion.value?.municipio_id) ?? null)
const mensaje = (error) => (error instanceof Error ? error.message : 'Error inesperado.')

async function cargar() {
  cargando.value = true
  try {
    const [p, m, v] = await Promise.all([apiRequest('/admin/plazas'), apiRequest('/admin/municipios'), apiRequest('/admin/plaza-municipios')])
    plazas.value = p.plazas ?? []
    municipios.value = m.municipios ?? []
    vinculos.value = v.vinculos ?? []
  } catch (error) { notifyError(mensaje(error)) }
  finally { cargando.value = false }
}

function editar(fila) { editandoId.value = fila.id; nombreEdicion.value = fila.nombre }

async function guardarNombre(fila) {
  if (!nombreEdicion.value.trim()) { notifyWarning('El nombre es obligatorio.'); return }
  procesando.value = true
  try {
    await apiRequest(`/admin/plazas/${fila.id}`, { method: 'PATCH', body: { nombre: nombreEdicion.value.trim() } })
    editandoId.value = null
    await cargar(); notifySuccess('Plaza renombrada.')
  } catch (error) { notifyError(mensaje(error)) }
  finally { procesando.value = false }
}

async function cambiarEstado(fila) {
  procesando.value = true
  try {
    await apiRequest(`/admin/plazas/${fila.id}`, { method: 'PATCH', body: { activa: !fila.activa } })
    await cargar(); notifySuccess(fila.activa ? 'Plaza desactivada.' : 'Plaza activada.')
  } catch (error) { notifyError(mensaje(error)) }
  finally { procesando.value = false }
}

function abrirConversion() { conversion.value = { municipio_id: null, activaciones: null } }

async function elegirMunicipio(id) {
  conversion.value = { municipio_id: id, activaciones: null }
  if (!id) return
  try {
    const { activaciones } = await apiRequest(`/admin/municipios/${id}/conversion`)
    if (conversion.value?.municipio_id === id) conversion.value.activaciones = activaciones
  } catch (error) { notifyError(mensaje(error)) }
}

async function convertir() {
  const municipio = elegido.value
  if (!municipio) { notifyWarning('Elige el municipio que se convierte en plaza.'); return }
  const password = await requestPasswordConfirmation({
    title: `Extraer la plaza ${municipio.nombre}`,
    message: `Todas las activaciones hechas en ${municipio.nombre} pasan de ${municipio.plaza} a la nueva plaza, incluido el historial. Ingresa tu contraseña para confirmar.`,
    confirmLabel: 'Extraer plaza',
  })
  if (!password) return
  procesando.value = true
  try {
    const resultado = await apiRequest(`/admin/municipios/${municipio.id}/convertir-en-plaza`, { method: 'POST', body: { password } })
    conversion.value = null
    await cargar()
    notifySuccess(`${resultado.plaza} ya es una plaza: ${resultado.activaciones} activaciones movidas.`)
  } catch (error) { notifyError(mensaje(error)) }
  finally { procesando.value = false }
}

onMounted(cargar)
</script>

<template>
  <div class="tabla-contenedor">
    <div class="toolbar-line plazas-toolbar">
      <h2 class="subtitulo subtitulo-inline">Plazas</h2>
      <div class="toolbar-actions">
        <button class="boton boton-primario" @click="abrirConversion">Extraer plaza</button>
      </div>
    </div>
    <p v-if="cargando">Cargando plazas...</p>
    <div v-else class="table-wrap modulo-table-wrap">
      <table class="tabla-usuarios">
        <thead><tr><th>Plaza</th><th>Tipo</th><th>Departamento</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          <tr v-for="fila in filas" :key="fila.id" :class="{ 'fila-inactiva': !fila.activa }">
            <td>
              <input v-if="editandoId === fila.id" v-model="nombreEdicion" class="input-editar" @keydown.enter="guardarNombre(fila)">
              <template v-else>{{ fila.nombre }}</template>
            </td>
            <td>{{ fila.tipo }}</td>
            <td>{{ fila.departamento || '—' }}</td>
            <td><span class="scope-pill" :class="fila.activa ? 'scope-pill-all' : 'scope-pill-user'">{{ fila.activa ? 'Activa' : 'Inactiva' }}</span></td>
            <td class="acciones">
              <template v-if="editandoId === fila.id">
                <button class="boton boton-guardar boton-pequeno" :disabled="procesando" @click="guardarNombre(fila)">Guardar</button>
                <button class="boton boton-cancelar boton-pequeno" @click="editandoId = null">Cancelar</button>
              </template>
              <template v-else>
                <button class="boton boton-editar boton-pequeno" @click="editar(fila)">Renombrar</button>
                <button class="boton boton-pequeno" :disabled="procesando" @click="cambiarEstado(fila)">{{ fila.activa ? 'Desactivar' : 'Activar' }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="conversion" class="detalle-overlay" @click.self="conversion = null">
      <aside class="detalle-activacion" role="dialog" aria-modal="true" aria-label="Extraer plaza">
        <header class="detalle-header">
          <div><p class="view-kicker">Yolopago</p><h3 class="detalle-title">Extraer plaza de un municipio</h3></div>
          <button type="button" class="detalle-close" aria-label="Cerrar" @click="conversion = null">×</button>
        </header>
        <form class="detalle-body" @submit.prevent="convertir">
          <section class="detalle-section">
            <h4>Municipio</h4>
            <SelectorBuscable :model-value="conversion.municipio_id" :opciones="convertibles" placeholder="Buscar municipio (ej. Montero, Yacuiba)" @update:model-value="elegirMunicipio" />
          </section>
          <section v-if="elegido" class="detalle-section">
            <h4>Qué va a pasar</h4>
            <ul class="conversion-resumen">
              <li>Se crea la plaza <strong>{{ elegido.nombre }}</strong>.</li>
              <li>{{ elegido.nombre }} deja de agruparse en <strong>{{ elegido.plaza }}</strong>.</li>
              <li v-if="conversion.activaciones === null">Contando activaciones...</li>
              <li v-else><strong>{{ conversion.activaciones }}</strong> activaciones hechas en {{ elegido.nombre }} pasan a la nueva plaza, incluido el historial.</li>
              <li>Las activaciones futuras en {{ elegido.nombre }} salen con la nueva plaza, sea cual sea el equipo.</li>
              <li>Equipos y activadores no cambian de plaza base.</li>
            </ul>
          </section>
          <div class="confirm-actions">
            <button type="button" class="boton boton-cancelar" :disabled="procesando" @click="conversion = null">Cancelar</button>
            <button type="submit" class="boton boton-guardar" :disabled="procesando || !elegido">Extraer plaza</button>
          </div>
        </form>
      </aside>
    </div>
  </div>
</template>
