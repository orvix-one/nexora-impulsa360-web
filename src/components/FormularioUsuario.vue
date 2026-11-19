<script setup>
import { computed, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { notifyError, notifySuccess, notifyWarning } from '../lib/feedback'
import {
  ajustarRoles,
  esRol,
  estaActivo,
  etiqueta,
  formularioDesdeUsuario,
  formularioVacio,
  payloadUsuario,
  ROLES,
  validarFormulario,
} from '../lib/usuarios'
import SelectorActivadores from './SelectorActivadores.vue'

const props = defineProps({
  usuario: { type: Object, default: null },
  organizacion: { type: Object, required: true },
  plazas: { type: Array, required: true },
  lideres: { type: Array, required: true },
  liderPorEquipo: { type: Function, required: true },
  ocupado: { type: Boolean, default: false },
})
const emit = defineEmits(['cerrar', 'guardado', 'inhabilitar', 'activar', 'eliminar'])

const esNuevo = !props.usuario
const form = ref(
  esNuevo ? formularioVacio() : formularioDesdeUsuario(props.usuario, props.organizacion.equipos),
)
const guardando = ref(false)
const bloqueado = computed(() => guardando.value || props.ocupado)
const conOrganizacion = computed(() => props.organizacion.available)
const opcionesEquipo = computed(() =>
  props.organizacion.equipos
    .filter((equipo) => equipo.activo)
    .map((equipo) => ({
      id: equipo.id,
      nombre: `#${equipo.numero}`,
      detalle: props.plazas.find((p) => p.id === equipo.plaza_id)?.nombre ?? 'Sin plaza',
    })),
)

function elegirPlaza() {
  form.value.equipo_id = ''
  form.value.plaza = props.plazas.find((item) => item.id === form.value.plaza_id)?.nombre ?? ''
}

async function guardar() {
  const mensaje = validarFormulario(form.value, { esNuevo })
  if (mensaje) {
    notifyWarning(mensaje)
    return
  }
  guardando.value = true
  try {
    const body = payloadUsuario(form.value, {
      organizacionDisponible: conOrganizacion.value,
      esNuevo,
    })
    if (esNuevo) await apiRequest('/admin/users', { method: 'POST', body })
    else await apiRequest(`/admin/users/${props.usuario.usuario_id}`, { method: 'PATCH', body })
    notifySuccess(esNuevo ? 'Usuario registrado.' : 'Usuario actualizado.')
    emit('guardado')
  } catch (error) {
    notifyError(
      error instanceof Error && error.message ? error.message : 'Se produjo un error inesperado.',
    )
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="detalle-overlay" @click.self="emit('cerrar')">
    <aside
      class="detalle-activacion"
      role="dialog"
      aria-modal="true"
      :aria-label="esNuevo ? 'Nuevo usuario' : 'Editar usuario'"
    >
      <header class="detalle-header">
        <div>
          <p class="view-kicker">Usuarios</p>
          <h3 class="detalle-title">
            {{ esNuevo ? 'Nuevo usuario' : usuario.nombre || 'Sin nombre' }}
          </h3>
          <small v-if="!esNuevo && !estaActivo(usuario)" class="nota-inhabilitado"
            >Inhabilitado{{
              usuario.motivo_inhabilitacion ? ` · ${usuario.motivo_inhabilitacion}` : ''
            }}</small
          >
        </div>
        <button type="button" class="detalle-close" aria-label="Cerrar" @click="emit('cerrar')">
          ×
        </button>
      </header>
      <form class="detalle-body" @submit.prevent="guardar">
        <p v-if="organizacion.message" class="panel-empty">
          {{ organizacion.message }}
        </p>
        <section class="detalle-section formulario-campos">
          <label>
            <span class="field-label">Nombre completo</span>
            <input v-model="form.nombre" class="input-texto" />
          </label>
          <label>
            <span class="field-label">Correo electrónico</span>
            <input v-model="form.email" type="email" class="input-texto" />
          </label>
          <label v-if="esNuevo">
            <span class="field-label">Contraseña</span>
            <input
              v-model="form.password"
              type="password"
              class="input-texto"
              autocomplete="new-password"
            />
            <small class="viaje-nota"
              >Mínimo 10 caracteres con mayúscula, minúscula, número y símbolo.</small
            >
          </label>
        </section>
        <section class="detalle-section">
          <h4>Roles</h4>
          <div role="group" aria-label="Roles" class="meta-row">
            <label v-for="rol in ROLES" :key="rol" class="scope-pill selector-rol">
              <input
                v-model="form.roles"
                type="checkbox"
                :value="rol"
                @change="ajustarRoles(form)"
              />
              {{ etiqueta(rol) }}
            </label>
          </div>
        </section>
        <section v-if="esRol(form, 'activador')" class="detalle-section formulario-campos">
          <h4>Activador</h4>
          <template v-if="conOrganizacion">
            <label>
              <span class="field-label">Plaza base</span>
              <select v-model="form.plaza_id" class="input-texto" @change="elegirPlaza">
                <option value="">Sin plaza</option>
                <option v-for="plaza in plazas" :key="plaza.id" :value="plaza.id">
                  {{ plaza.nombre }}
                </option>
              </select>
            </label>
            <label>
              <span class="field-label">Equipo</span>
              <select v-model="form.equipo_id" class="input-texto">
                <option value="">Sin equipo (asignar después)</option>
                <option v-for="equipo in opcionesEquipo" :key="equipo.id" :value="equipo.id">
                  {{ equipo.nombre }} · {{ equipo.detalle }}
                </option>
              </select>
              <small class="viaje-nota">Líder: {{ liderPorEquipo(form.equipo_id) }}</small>
            </label>
          </template>
          <template v-else>
            <label>
              <span class="field-label">Plaza base</span>
              <input v-model="form.plaza" class="input-texto" />
            </label>
            <label>
              <span class="field-label">Líder</span>
              <select v-model="form.lider_id" class="input-texto">
                <option value="">Sin líder</option>
                <option v-for="lider in lideres" :key="lider.usuario_id" :value="lider.usuario_id">
                  {{ lider.nombre }}
                </option>
              </select>
            </label>
          </template>
        </section>
        <section v-if="esRol(form, 'lider')" class="detalle-section formulario-campos">
          <div class="toolbar-line">
            <h4>Líder</h4>
            <label class="interruptor">
              <input v-model="form.puede_activar" type="checkbox" role="switch" />
              Puede activar
            </label>
          </div>
          <template v-if="conOrganizacion">
            <span class="field-label">Equipos liderados (opcional)</span>
            <SelectorActivadores
              v-model="form.equipo_ids"
              :opciones="opcionesEquipo"
              placeholder="Buscar equipo"
            />
          </template>
        </section>
        <section
          v-if="esRol(form, 'facturador') && conOrganizacion"
          class="detalle-section formulario-campos"
        >
          <h4>Equipos facturados (opcional)</h4>
          <SelectorActivadores
            v-model="form.facturador_equipo_ids"
            :opciones="opcionesEquipo"
            placeholder="Buscar equipo"
          />
        </section>
        <div class="confirm-actions">
          <template v-if="!esNuevo">
            <button
              v-if="estaActivo(usuario)"
              type="button"
              class="boton boton-eliminar accion-izquierda"
              :disabled="bloqueado"
              @click="emit('inhabilitar', usuario)"
            >
              Inhabilitar
            </button>
            <template v-else>
              <button
                type="button"
                class="boton accion-izquierda"
                :disabled="bloqueado"
                @click="emit('activar', usuario)"
              >
                Activar
              </button>
              <button
                v-if="!usuario.cuenta_acceso_eliminada"
                type="button"
                class="boton boton-eliminar"
                :disabled="bloqueado"
                @click="emit('eliminar', usuario)"
              >
                Eliminar cuenta
              </button>
            </template>
          </template>
          <button
            type="button"
            class="boton boton-cancelar"
            :disabled="bloqueado"
            @click="emit('cerrar')"
          >
            Cancelar
          </button>
          <button type="submit" class="boton boton-guardar" :disabled="bloqueado">
            {{ guardando ? 'Guardando...' : esNuevo ? 'Registrar usuario' : 'Guardar cambios' }}
          </button>
        </div>
      </form>
    </aside>
  </div>
</template>
