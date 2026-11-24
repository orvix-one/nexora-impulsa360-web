<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { useAuth } from '../lib/authStore'
import {
  notifyError,
  notifySuccess,
  notifyWarning,
  requestConfirmation,
  requestPasswordConfirmation,
} from '../lib/feedback'
import { containsNormalized, contarRegistros } from '../lib/textUtils'
import { deduplicarPlazas, deduplicarPlazasCatalogo, mismaPlaza } from '../lib/plazas'
import {
  esRol,
  estaActivo,
  ESTADOS,
  etiqueta,
  participaEnEquipo,
  rolesConEquipos,
  ROLES,
} from '../lib/usuarios'
import FormularioUsuario from '../components/FormularioUsuario.vue'

const { isAdmin } = useAuth()
const usuarios = ref([])
const loading = ref(false)
const procesando = ref(false)
const errorMsg = ref(null)
const busqueda = ref('')
const filtroRol = ref('')
const filtroEstado = ref('')
const filtroPlaza = ref('')
const filtroEquipoId = ref('')
const organizacion = ref({
  available: false,
  message: '',
  plazas: [],
  equipos: [],
  facturadores: [],
})

const formulario = ref(null)
const modalInhabilitar = ref(false)
const usuarioAInhabilitar = ref(null)
const motivoInhabilitar = ref('')

const lideresActivos = computed(() =>
  usuarios.value.filter((u) => esRol(u, 'lider') && estaActivo(u)),
)
const plazasCatalogo = computed(() => deduplicarPlazasCatalogo(organizacion.value.plazas))
const plazas = computed(() =>
  organizacion.value.available
    ? plazasCatalogo.value.map((p) => ({ value: p.nombre, nombre: p.nombre }))
    : deduplicarPlazas(usuarios.value.map(plazaDe)),
)
const equiposFiltro = computed(() =>
  organizacion.value.equipos
    .filter((equipo) => equipo.activo)
    .map((equipo) => ({
      id: equipo.id,
      etiqueta: `#${equipo.numero} · ${plazasCatalogo.value.find((p) => p.id === equipo.plaza_id)?.nombre ?? 'Sin plaza'}`,
    })),
)
const usuariosPorId = computed(() =>
  Object.fromEntries(usuarios.value.map((u) => [u.usuario_id, u])),
)
const usuariosFiltrados = computed(() =>
  usuarios.value.filter((u) => {
    const coincideBusqueda =
      containsNormalized(u.nombre, busqueda.value) || containsNormalized(u.email, busqueda.value)
    const coincideEquipo = !filtroEquipoId.value || participaEnEquipo(u, filtroEquipoId.value)
    const coincidePlaza =
      !filtroPlaza.value ||
      mismaPlaza(plazaDe(u), filtroPlaza.value) ||
      (u.equipos ?? []).some((equipo) => mismaPlaza(equipo.plaza, filtroPlaza.value))
    return (
      coincideBusqueda &&
      (!filtroRol.value || esRol(u, filtroRol.value)) &&
      (!filtroEstado.value || (u.estado ?? 'activo') === filtroEstado.value) &&
      coincidePlaza &&
      coincideEquipo
    )
  }),
)

function getErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Se produjo un error inesperado.'
}
function plazaDe(usuario) {
  return usuario.plaza_nombre || usuario.plaza_base || usuario.plaza
}
function detalleEquipo(equipo) {
  return [equipo.plaza, equipo.lider_nombre ? `Líder: ${equipo.lider_nombre}` : 'Sin líder']
    .filter(Boolean)
    .join(' · ')
}
function liderPorEquipo(equipoId) {
  const equipo = organizacion.value.equipos.find((item) => item.id === equipoId)
  return equipo?.lider_actual_id
    ? (usuariosPorId.value[equipo.lider_actual_id]?.nombre ?? 'Líder asignado')
    : 'Sin líder vigente'
}
function fechaCorta(valor) {
  return new Date(valor).toLocaleDateString('es-BO', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/La_Paz',
  })
}

async function cargarUsuarios() {
  if (!isAdmin.value) {
    errorMsg.value = 'Esta seccion requiere una sesion de administrador activo.'
    return
  }
  loading.value = true
  errorMsg.value = null
  try {
    const [result, org] = await Promise.all([
      apiRequest('/admin/users'),
      apiRequest('/admin/organization-options'),
    ])
    usuarios.value = result.users ?? []
    organizacion.value = org
  } catch (error) {
    errorMsg.value = getErrorMessage(error)
    notifyError(errorMsg.value)
  } finally {
    loading.value = false
  }
}

function abrirFormulario(usuario = null) {
  formulario.value = { usuario }
}
async function trasGuardar() {
  formulario.value = null
  await cargarUsuarios()
}

function abrirInhabilitacion(usuario) {
  usuarioAInhabilitar.value = usuario
  motivoInhabilitar.value = ''
  modalInhabilitar.value = true
}
function cerrarInhabilitacion() {
  if (!procesando.value) {
    modalInhabilitar.value = false
    usuarioAInhabilitar.value = null
    motivoInhabilitar.value = ''
  }
}
async function confirmarInhabilitacion() {
  const motivo = motivoInhabilitar.value.trim()
  if (!motivo) {
    notifyWarning('El motivo de inhabilitacion es obligatorio.')
    return
  }
  procesando.value = true
  try {
    await apiRequest(`/admin/users/${usuarioAInhabilitar.value.usuario_id}/status`, {
      method: 'PATCH',
      body: { estado: 'inhabilitado', motivo_inhabilitacion: motivo },
    })
    modalInhabilitar.value = false
    usuarioAInhabilitar.value = null
    motivoInhabilitar.value = ''
    formulario.value = null
    await cargarUsuarios()
    notifySuccess('Usuario inhabilitado correctamente.')
  } catch (error) {
    notifyError(getErrorMessage(error))
  } finally {
    procesando.value = false
  }
}
async function activarUsuario(usuario) {
  const aceptado = await requestConfirmation({
    title: 'Activar usuario',
    message: `Se activara a ${usuario.nombre ?? 'este usuario'}.`,
    confirmLabel: 'Activar',
  })
  if (!aceptado) return
  procesando.value = true
  try {
    await apiRequest(`/admin/users/${usuario.usuario_id}/status`, {
      method: 'PATCH',
      body: { estado: 'activo' },
    })
    formulario.value = null
    await cargarUsuarios()
    notifySuccess('Usuario activado correctamente.')
  } catch (error) {
    notifyError(getErrorMessage(error))
  } finally {
    procesando.value = false
  }
}
async function eliminarUsuario(usuario) {
  const password = await requestPasswordConfirmation({
    title: 'Eliminar usuario',
    message:
      'Se eliminara permanentemente este usuario y su cuenta de acceso. Solo es posible porque no tiene historial. Ingresa tu contrasena actual para confirmar.',
    confirmLabel: 'Eliminar usuario',
  })
  if (!password) return
  procesando.value = true
  try {
    const result = await apiRequest(`/admin/users/${usuario.usuario_id}`, {
      method: 'DELETE',
      body: { password },
    })
    formulario.value = null
    await cargarUsuarios()
    notifySuccess(result.message ?? 'Usuario eliminado.')
  } catch (error) {
    notifyError(
      error?.status === 409 && error.message && !error.message.startsWith('Error HTTP')
        ? error.message
        : getErrorMessage(error),
    )
  } finally {
    procesando.value = false
  }
}

onMounted(cargarUsuarios)
</script>

<template>
  <section class="view-page contenedor-usuarios">
    <header class="view-header">
      <p class="view-kicker">Control de Accesos</p>
      <h1 class="view-title">Gestion de Usuarios</h1>
      <p class="view-description">
        Administra el equipo operativo conectado a la base principal de activaciones.
      </p>
    </header>

    <div class="panel-card tabla-contenedor">
      <div class="toolbar-line">
        <h2 class="subtitulo subtitulo-inline">Usuarios</h2>
        <div class="toolbar-actions">
          <span class="meta-pill">{{ contarRegistros(usuariosFiltrados.length) }}</span>
          <button class="boton boton-primario" :disabled="loading" @click="abrirFormulario()">
            Nuevo usuario
          </button>
        </div>
      </div>
      <div class="filtros filtros-grid filtros-usuarios">
        <label
          ><span class="field-label">Nombre o correo</span
          ><input v-model="busqueda" class="input-texto" placeholder="Buscar usuario"
        /></label>
        <label
          ><span class="field-label">Rol</span
          ><select v-model="filtroRol" class="input-texto">
            <option value="">Todos</option>
            <option v-for="rol in ROLES" :key="rol" :value="rol">{{ etiqueta(rol) }}</option>
          </select></label
        >
        <label
          ><span class="field-label">Estado</span
          ><select v-model="filtroEstado" class="input-texto">
            <option value="">Todos</option>
            <option v-for="estado in ESTADOS" :key="estado" :value="estado">
              {{ etiqueta(estado) }}
            </option>
          </select></label
        >
        <label
          ><span class="field-label">Plaza</span
          ><select v-model="filtroPlaza" class="input-texto">
            <option value="">Todas</option>
            <option v-for="item in plazas" :key="item.value" :value="item.value">
              {{ item.nombre }}
            </option>
          </select></label
        >
        <label v-if="organizacion.available"
          ><span class="field-label">Equipo</span
          ><select v-model="filtroEquipoId" class="input-texto">
            <option value="">Todos</option>
            <option v-for="equipo in equiposFiltro" :key="equipo.id" :value="equipo.id">
              {{ equipo.etiqueta }}
            </option>
          </select></label
        >
      </div>

      <p v-if="loading">Cargando usuarios...</p>
      <p v-else-if="errorMsg" class="mensaje-error">
        {{ errorMsg }}
      </p>
      <p v-else-if="!usuariosFiltrados.length" class="panel-empty">
        No hay usuarios para los filtros seleccionados.
      </p>
      <div v-else class="table-wrap modulo-table-wrap">
        <table class="tabla-usuarios">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Roles</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="usuario in usuariosFiltrados"
              :key="usuario.usuario_id"
              class="fila-clic"
              :class="{ 'fila-usuario-inactivo': !estaActivo(usuario) }"
              @click="abrirFormulario(usuario)"
            >
              <td>
                {{ usuario.nombre || 'Sin nombre' }}
                <span v-if="usuario.organizacion_pendiente" class="scope-pill scope-pill-user"
                  >Organización pendiente</span
                >
                <small class="viaje-nota">{{ usuario.email || 'Sin correo' }}</small>
                <router-link
                  v-if="usuario.viaje_vigente"
                  to="/viajes"
                  class="scope-pill scope-pill-user"
                  @click.stop
                >
                  De viaje · {{ usuario.viaje_vigente.destino }} hasta
                  {{ fechaCorta(usuario.viaje_vigente.fin) }}
                </router-link>
                <small
                  v-if="!estaActivo(usuario)"
                  class="nota-inhabilitado"
                  :title="usuario.motivo_inhabilitacion || undefined"
                  >Inhabilitado</small
                >
              </td>
              <td>
                <ul class="roles-equipos">
                  <li v-for="grupo in rolesConEquipos(usuario)" :key="grupo.rol">
                    <span class="roles-equipos-rol">{{ etiqueta(grupo.rol) }}</span>
                    <template v-if="grupo.equipos">
                      <span
                        v-for="equipo in grupo.equipos"
                        :key="equipo.id"
                        class="chip-equipo"
                        :class="{ 'chip-equipo-principal': grupo.rol === 'activador' && equipo.principal }"
                        :title="detalleEquipo(equipo)"
                        >#{{ equipo.numero }}</span
                      >
                      <span v-if="!grupo.equipos.length" class="viaje-nota">Sin equipo</span>
                    </template>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <FormularioUsuario
      v-if="formulario"
      :key="formulario.usuario?.usuario_id ?? 'nuevo'"
      :usuario="formulario.usuario"
      :organizacion="organizacion"
      :plazas="plazasCatalogo"
      :lideres="lideresActivos"
      :lider-por-equipo="liderPorEquipo"
      :ocupado="procesando"
      @cerrar="formulario = null"
      @guardado="trasGuardar"
      @inhabilitar="abrirInhabilitacion"
      @activar="activarUsuario"
      @eliminar="eliminarUsuario"
    />

    <teleport to="body">
      <div v-if="modalInhabilitar" class="confirm-overlay" @click.self="cerrarInhabilitacion">
        <section
          class="confirm-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Inhabilitar usuario"
        >
          <h3 class="confirm-title">Inhabilitar usuario</h3>
          <p class="confirm-message">
            Indica por que se inhabilitara a {{ usuarioAInhabilitar?.nombre ?? 'este usuario' }}.
          </p>
          <textarea
            v-model="motivoInhabilitar"
            class="input-texto"
            placeholder="Motivo obligatorio"
            rows="4"
          />
          <div class="confirm-actions">
            <button
              class="boton boton-cancelar"
              :disabled="procesando"
              @click="cerrarInhabilitacion"
            >
              Cancelar
            </button>
            <button
              class="boton boton-eliminar"
              :disabled="procesando || !motivoInhabilitar.trim()"
              @click="confirmarInhabilitacion"
            >
              {{ procesando ? 'Guardando...' : 'Inhabilitar' }}
            </button>
          </div>
        </section>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.fila-usuario-inactivo td:not(:first-child) {
  color: var(--ru-ink-soft);
}
</style>
