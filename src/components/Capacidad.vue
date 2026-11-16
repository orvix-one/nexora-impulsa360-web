<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { useAuth } from '../lib/authStore'
import { notifyError } from '../lib/feedback'
import InfoTip from './InfoTip.vue'

const RESPALDO_VENCIDO_MS = 36 * 60 * 60 * 1000

const { isAdmin } = useAuth()
const accessError = ref(null)
const loadingSummary = ref(false)
const summary = ref(null)
const lastUpdated = ref(null)

const hasDatabaseExact = computed(() => isNonNegative(summary.value?.database_size_bytes))
const databaseUsedBytes = computed(() => (hasDatabaseExact.value
  ? Number(summary.value.database_size_bytes)
  : summary.value?.database_estimation?.estimated_database_used_bytes ?? null))
const hasR2Usage = computed(() => isNonNegative(summary.value?.r2_used_bytes))
const combinedEstimate = computed(() => summary.value?.combined_capacity_estimation ?? null)
const r2UsedBytes = computed(() => sumBytes([summary.value?.r2_used_bytes, summary.value?.r2_backup_bytes]))

const capacityLabel = computed(() => {
  const remaining = combinedEstimate.value?.estimated_activaciones_with_photo_remaining
  return remaining === null || remaining === undefined ? 'N/D' : formatNumber(remaining)
})
const limitingFactorLabel = computed(() => {
  const factor = combinedEstimate.value?.limiting_factor
  if (factor === 'storage') return hasR2Usage.value ? 'Primer limite: archivo de fotos' : 'Primer limite: bandeja de fotos'
  if (factor === 'database') return 'Primer limite: base de datos'
  return combinedEstimate.value?.unavailable_reason ?? 'Sin datos suficientes.'
})

const respaldo = computed(() => summary.value?.respaldo ?? null)
const respaldoEstado = computed(() => {
  const creado = Date.parse(respaldo.value?.creado ?? '')
  if (!respaldo.value || !Number.isFinite(creado)) return { label: 'Sin respaldo', alerta: true }
  if (!respaldo.value.ok) return { label: 'Fallido', alerta: true }
  if (Date.now() - creado > RESPALDO_VENCIDO_MS) return { label: 'Atrasado', alerta: true }
  return { label: 'Al dia', alerta: false }
})

function isNonNegative(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
}

function sumBytes(values) {
  return values.reduce((sum, value) => sum + (isNonNegative(value) ? Number(value) : 0), 0)
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return 'N/D'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const normalized = value / 1024 ** unitIndex
  return unitIndex === 0 ? `${Math.round(normalized)} B` : `${normalized.toFixed(1)} ${units[unitIndex]}`
}

function formatFree(used, limit) {
  return `${formatBytes(Math.max(0, Number(limit) - (Number(used) || 0)))} libres de ${formatBytes(limit)}`
}

function formatNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? new Intl.NumberFormat('es-BO').format(parsed) : 'N/D'
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

function percentOf(bytes, limit) {
  const value = (Number(bytes) / Number(limit)) * 100
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
}

function meterTone(bytes, limit) {
  const percent = percentOf(bytes, limit)
  if (percent < 70) return 'normal'
  return percent <= 85 ? 'warning' : 'critical'
}

async function cargarResumen() {
  if (!isAdmin.value || loadingSummary.value) return
  loadingSummary.value = true
  accessError.value = null
  try {
    const result = await apiRequest('/admin/storage/summary')
    summary.value = result.summary ?? null
    lastUpdated.value = new Date()
  } catch (error) {
    accessError.value = error instanceof Error && error.message ? error.message : 'Se produjo un error inesperado.'
    notifyError(accessError.value)
  } finally {
    loadingSummary.value = false
  }
}

onMounted(() => {
  if (!isAdmin.value) {
    accessError.value = 'Este modulo esta disponible solo para administradores activos.'
    return
  }
  cargarResumen()
})
</script>

<template>
  <section class="view-page">
    <header class="view-header">
      <p class="view-kicker">Capacidad y Consumo</p>
      <h1 class="view-title">Espacio del Proyecto</h1>
      <p class="view-description">
        Supabase guarda los datos y recibe las fotos nuevas. Cloudflare guarda el archivo de fotos y los respaldos diarios.
      </p>
      <div class="capacity-toolbar">
        <button class="boton" :disabled="!isAdmin || loadingSummary" @click="cargarResumen">
          {{ loadingSummary ? 'Actualizando...' : 'Actualizar' }}
        </button>
        <span v-if="lastUpdated" class="capacity-detail">Datos consultados: {{ formatDateTime(lastUpdated) }}</span>
      </div>
    </header>

    <p v-if="accessError" class="mensaje-error">{{ accessError }}</p>
    <p v-else-if="!summary" class="panel-empty">{{ loadingSummary ? 'Cargando...' : 'No hay datos de capacidad disponibles.' }}</p>

    <template v-if="summary">
      <div class="capacity-grid capacity-kpis">
        <div class="capacity-card">
          <p class="capacity-label">
            Activaciones que aun caben
            <InfoTip text="Cuantas activaciones con foto se pueden registrar antes de llenar el primer limite gratuito, al ritmo actual." />
          </p>
          <p class="capacity-value">{{ capacityLabel }}</p>
          <p class="capacity-detail">{{ limitingFactorLabel }}</p>
        </div>

        <div class="capacity-card">
          <p class="capacity-label">
            Ultimo respaldo
            <InfoTip text="Cada madrugada se guarda una copia de la base de datos en Cloudflare y se conservan los ultimos 30 dias. Si dice Atrasado o Fallido, avisar a soporte." />
          </p>
          <p class="capacity-value">{{ respaldo?.creado ? formatDateTime(new Date(respaldo.creado)) : 'N/D' }}</p>
          <span class="capacity-source-badge" :class="{ 'capacity-source-alert': respaldoEstado.alerta }">{{ respaldoEstado.label }}</span>
          <p v-if="!respaldo?.ok && respaldo?.error" class="capacity-detail">{{ respaldo.error }}</p>
        </div>

        <div class="capacity-card">
          <p class="capacity-label">
            Subida directa a Cloudflare
            <InfoTip text="Activa: la app actualizada envia las fotos directo al archivo. Las versiones antiguas siempre usan la bandeja de Supabase." />
          </p>
          <p class="capacity-value">{{ summary.r2_uploads_enabled ? 'Activa' : 'Inactiva' }}</p>
          <p class="capacity-detail">Fotos por activacion: {{ formatBytes(combinedEstimate?.average_photo_bytes) }}</p>
        </div>
      </div>

      <section class="panel-card capacity-provider capacity-provider-supabase">
        <header class="capacity-provider-header">
          <span class="capacity-provider-mark">Supabase</span>
          <h2 class="capacity-provider-title">
            Datos y bandeja de fotos
            <InfoTip text="Activaciones, usuarios e inicio de sesion, mas la bandeja donde llegan las fotos de versiones antiguas de la app. Plan gratuito: si un limite se llena, la app deja de funcionar con normalidad." />
          </h2>
        </header>

        <div class="capacity-meter-block">
          <div class="capacity-meter-head">
            <p class="capacity-label">Base de datos</p>
            <span class="capacity-source-badge" :class="{ 'capacity-source-estimated': !hasDatabaseExact }">
              {{ hasDatabaseExact ? 'Medido' : 'Estimado' }}
            </span>
          </div>
          <div class="capacity-meter">
            <span
              :class="`capacity-meter-${meterTone(databaseUsedBytes, summary.database_limit_bytes)}`"
              :style="{ width: `${percentOf(databaseUsedBytes, summary.database_limit_bytes)}%` }"
            ></span>
          </div>
          <p class="capacity-detail">
            {{ hasDatabaseExact ? '' : '~' }}{{ formatBytes(databaseUsedBytes) }} usados ·
            {{ formatFree(databaseUsedBytes, summary.database_limit_bytes) }}
          </p>
        </div>

        <div class="capacity-meter-block">
          <div class="capacity-meter-head">
            <p class="capacity-label">
              Bandeja de fotos
              <InfoTip :text="`Cada noche, las fotos con mas de ${summary.archive_retention_days} dias pasan al archivo de Cloudflare. Debe bajar a medida que los usuarios actualizan la app.`" />
            </p>
          </div>
          <div class="capacity-meter">
            <span
              :class="`capacity-meter-${meterTone(summary.storage_used_bytes, summary.storage_limit_bytes)}`"
              :style="{ width: `${percentOf(summary.storage_used_bytes, summary.storage_limit_bytes)}%` }"
            ></span>
          </div>
          <p class="capacity-detail">
            {{ formatBytes(summary.storage_used_bytes) }} · {{ formatNumber(summary.storage_objects_count) }} archivos ·
            {{ formatFree(summary.storage_used_bytes, summary.storage_limit_bytes) }}
          </p>
        </div>
      </section>

      <section class="panel-card capacity-provider capacity-provider-cloudflare">
        <header class="capacity-provider-header">
          <span class="capacity-provider-mark">Cloudflare R2</span>
          <h2 class="capacity-provider-title">
            Archivo de fotos y respaldos
            <InfoTip text="Los primeros 10 GB son gratis y ver o descargar fotos no tiene costo. Si se supera, no se bloquea nada: solo se cobran centavos de dolar por GB al mes." />
          </h2>
        </header>

        <div class="capacity-meter-block">
          <div class="capacity-meter">
            <span class="capacity-meter-photos" :style="{ width: `${percentOf(summary.r2_used_bytes, summary.r2_limit_bytes)}%` }"></span>
            <span class="capacity-meter-backups" :style="{ width: `${percentOf(summary.r2_backup_bytes, summary.r2_limit_bytes)}%` }"></span>
          </div>
          <p v-if="hasR2Usage" class="capacity-legend">
            <span class="capacity-legend-item capacity-legend-photos">Fotos {{ formatBytes(summary.r2_used_bytes) }} · {{ formatNumber(summary.r2_objects_count) }} archivos</span>
            <span class="capacity-legend-item capacity-legend-backups">Respaldos {{ formatBytes(summary.r2_backup_bytes) }}</span>
            <span class="capacity-legend-item">{{ formatFree(r2UsedBytes, summary.r2_limit_bytes) }}</span>
          </p>
          <p v-if="summary.r2_measured_at" class="capacity-detail">Medido cada madrugada · ultima medicion {{ formatDateTime(new Date(summary.r2_measured_at)) }}</p>
          <p v-else class="capacity-detail">{{ summary.r2_unavailable_reason || 'Sin datos de Cloudflare.' }}</p>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.capacity-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.capacity-kpis {
  margin-bottom: 0.85rem;
}

.capacity-provider {
  display: grid;
  gap: 0.9rem;
  border-left: 4px solid var(--provider-color, var(--ru-border));
}

.capacity-provider-supabase { --provider-color: #3ecf8e; }
.capacity-provider-cloudflare { --provider-color: #f38020; }

.capacity-provider-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.capacity-provider-mark {
  border-radius: 8px;
  padding: 0.3rem 0.6rem;
  background: var(--provider-color);
  color: #0d1b2a;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.capacity-provider-title {
  margin: 0;
  color: var(--ru-ink);
  font-size: 1rem;
  font-weight: 700;
}

.capacity-provider + .capacity-provider {
  margin-top: 0.85rem;
}

.capacity-meter-block {
  display: grid;
  gap: 0.35rem;
}

.capacity-meter-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.capacity-meter {
  display: flex;
  height: 0.7rem;
  overflow: hidden;
  border-radius: 999px;
  background: #dce6ef;
}

.capacity-meter span {
  height: 100%;
  transition: width 180ms ease;
}

.capacity-meter-normal { background: #2a9d62; }
.capacity-meter-warning { background: #d99a16; }
.capacity-meter-critical { background: #cf3f45; }
.capacity-meter-photos { background: #f38020; }
.capacity-meter-backups { background: #24496d; }

.capacity-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin: 0;
  color: #45617c;
  font-size: 0.72rem;
}

.capacity-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.capacity-legend-item::before {
  content: '';
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
  background: #dce6ef;
}

.capacity-legend-photos::before { background: #f38020; }
.capacity-legend-backups::before { background: #24496d; }
</style>
