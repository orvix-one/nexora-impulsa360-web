<script setup>
import { computed, onMounted, ref } from 'vue'
import { apiRequest } from '../lib/api'
import { useAuth } from '../lib/authStore'
import { notifyError } from '../lib/feedback'
import InfoTip from './InfoTip.vue'

const { isAdmin } = useAuth()
const accessError = ref(null)
const loadingSummary = ref(false)
const summary = ref(null)
const lastUpdated = ref(null)

const hasSummary = computed(() => Boolean(summary.value))
const hasDatabaseExact = computed(() => {
  const value = summary.value?.database_size_bytes
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0
})

const databaseEstimate = computed(() => summary.value?.database_estimation ?? null)
const combinedCapacityEstimate = computed(() => summary.value?.combined_capacity_estimation ?? null)

const storageUsageLabel = computed(() => formatPercent(summary.value?.storage_usage_percent))
const hasR2Usage = computed(() => Number.isFinite(Number(summary.value?.r2_used_bytes ?? NaN)))
const r2RemainingLabel = computed(() => (hasR2Usage.value
  ? formatBytes(Math.max(0, summary.value.r2_limit_bytes - summary.value.r2_used_bytes))
  : 'N/D'))
const databaseUsageLabel = computed(() => formatPercent(summary.value?.database_usage_percent))

const databaseUsedLabel = computed(() => {
  if (hasDatabaseExact.value) {
    return formatBytes(summary.value?.database_size_bytes)
  }

  const estimated = databaseEstimate.value?.estimated_database_used_bytes
  if (estimated === null || estimated === undefined) {
    return 'N/D'
  }

  return `~${formatBytes(estimated)}`
})

const databaseRemainingLabel = computed(() => {
  const remaining = summary.value?.database_remaining_bytes
  if (remaining === null || remaining === undefined) {
    const estimated = databaseEstimate.value?.estimated_database_remaining_bytes
    if (estimated === null || estimated === undefined) {
      return 'N/D'
    }
    return `~${formatBytes(estimated)}`
  }

  if (!hasDatabaseExact.value) {
    return `~${formatBytes(remaining)}`
  }

  return formatBytes(remaining)
})

const perActivationEstimatedLabel = computed(() => {
  const perActivation = databaseEstimate.value?.per_activation_estimated_bytes
  return perActivation ? formatBytes(perActivation) : 'N/D'
})

const remainingActivacionesEstimatedLabel = computed(() => {
  const remaining = databaseEstimate.value?.estimated_activaciones_capacity_remaining
  if (remaining === null || remaining === undefined) {
    return 'N/D'
  }

  return formatNumber(remaining)
})

const remainingActivacionesWithPhotoLabel = computed(() => {
  const remaining = combinedCapacityEstimate.value?.estimated_activaciones_with_photo_remaining
  if (remaining === null || remaining === undefined) {
    return 'N/D'
  }

  return formatNumber(remaining)
})

const averagePhotoBytesLabel = computed(() => {
  const averagePhotoBytes = combinedCapacityEstimate.value?.average_photo_bytes
  if (averagePhotoBytes === null || averagePhotoBytes === undefined) {
    return 'N/D'
  }

  return formatBytes(averagePhotoBytes)
})

const averagePhotoSampleLabel = computed(() => {
  const sampleCount = combinedCapacityEstimate.value?.sample_photos_count
  if (sampleCount === null || sampleCount === undefined) {
    return 'N/D'
  }

  return formatNumber(sampleCount)
})

const averagePhotoCoverageLabel = computed(() => {
  const coverage = combinedCapacityEstimate.value?.photo_coverage_percent
  if (coverage === null || coverage === undefined) {
    return 'Cobertura: N/D'
  }

  return `Cobertura: ${formatPercent(coverage)}`
})

const limitingFactorLabel = computed(() => {
  const limitingFactor = combinedCapacityEstimate.value?.limiting_factor
  if (limitingFactor === 'storage') {
    return hasR2Usage.value ? 'Limite actual: archivo de fotos (Cloudflare)' : 'Limite actual: fotos en Supabase'
  }

  if (limitingFactor === 'database') {
    return 'Limite actual: Base de datos'
  }

  return 'Limite actual: N/D'
})

const combinedEstimateHint = computed(() => {
  const reason = combinedCapacityEstimate.value?.unavailable_reason
  if (reason) {
    return reason
  }

  return `Calculado con ${averagePhotoBytesLabel.value} de fotos por activacion.`
})

const estimateHint = computed(() => {
  if (hasDatabaseExact.value) {
    return 'Medicion real de base de datos activa.'
  }

  if (databaseEstimate.value) {
    const sampleSize = databaseEstimate.value.sample_size
    return `Estimado por promedio de activaciones (muestra ${formatNumber(sampleSize)}).`
  }

  return 'Sin datos suficientes para estimar el uso de base de datos.'
})

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) {
    return 'N/D'
  }

  if (value === 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const normalized = value / 1024 ** unitIndex

  if (unitIndex === 0) {
    return `${Math.round(normalized)} ${units[unitIndex]}`
  }

  return `${normalized.toFixed(1)} ${units[unitIndex]}`
}

function formatPercent(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 'N/D'
  }

  return `${parsed.toFixed(1)}%`
}

function formatNumber(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 'N/D'
  }

  return new Intl.NumberFormat('es-BO').format(parsed)
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Se produjo un error inesperado.'
}

async function cargarResumen() {
  if (!isAdmin.value || loadingSummary.value) {
    return
  }

  loadingSummary.value = true
  accessError.value = null

  try {
    const result = await apiRequest('/admin/storage/summary')
    summary.value = result.summary ?? null
    lastUpdated.value = new Date()
  } catch (error) {
    accessError.value = getErrorMessage(error)
    notifyError(accessError.value)
  } finally {
    loadingSummary.value = false
  }
}

function usageStatus(value) {
  const percent = Number(value)
  if (!Number.isFinite(percent) || percent < 70) return 'normal'
  if (percent <= 85) return 'warning'
  return 'critical'
}

function usageWidth(value) {
  const percent = Number(value)
  return `${Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0))}%`
}

function formatUpdatedAt(value) {
  return value ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'medium' }).format(value) : 'Sin actualizar'
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
        El sistema usa dos servicios: Supabase guarda los datos y recibe las fotos, y Cloudflare guarda el archivo de fotos.
      </p>
      <div class="meta-row">
        <span class="meta-pill" :class="{ 'meta-pill-ok': isAdmin }">Sesion administrativa</span>
        <span class="meta-pill">Ultima actualizacion: {{ formatUpdatedAt(lastUpdated) }}</span>
      </div>
    </header>

    <div class="forms-grid">
      <div class="formulario-registro">
        <div class="toolbar-line">
          <h2 class="subtitulo subtitulo-inline">Resumen</h2>
          <button class="boton" :disabled="!isAdmin || loadingSummary" @click="cargarResumen">
            {{ loadingSummary ? 'Actualizando...' : 'Actualizar' }}
          </button>
        </div>
        <p v-if="accessError" class="mensaje-error">{{ accessError }}</p>
        <p v-else-if="hasSummary" class="capacity-detail">{{ estimateHint }}</p>
        <p v-else class="panel-empty">{{ loadingSummary ? 'Cargando resumen...' : 'No hay datos de capacidad disponibles.' }}</p>
      </div>
    </div>

    <template v-if="hasSummary">
      <section class="panel-card capacity-provider capacity-provider-supabase">
        <header class="capacity-provider-header">
          <span class="capacity-provider-mark">Supabase</span>
          <div>
            <h2 class="capacity-provider-title">
              Base de datos y bandeja de fotos
              <InfoTip text="Supabase es el servicio donde viven las activaciones, los usuarios y el inicio de sesion. Tambien recibe las fotos nuevas antes de archivarlas. Usamos su plan gratuito." />
            </h2>
            <p class="capacity-detail">Plan gratuito · si un limite se llena, la app deja de funcionar con normalidad.</p>
          </div>
        </header>

        <div class="capacity-grid">
          <div class="capacity-card">
            <p class="capacity-label">
              Base de datos usada
              <InfoTip text="Espacio que ocupan los registros: activaciones, usuarios, equipos e historial. No incluye fotos." />
            </p>
            <p class="capacity-value">{{ databaseUsedLabel }}</p>
            <span class="capacity-source-badge" :class="{ 'capacity-source-estimated': !hasDatabaseExact }">
              {{ hasDatabaseExact ? 'Medido' : 'Estimado' }}
            </span>
            <div class="capacity-progress" :class="`capacity-progress-${usageStatus(summary.database_usage_percent)}`">
              <span :style="{ width: usageWidth(summary.database_usage_percent) }"></span>
            </div>
            <p class="capacity-detail">{{ databaseUsageLabel }} del limite</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">Base de datos disponible</p>
            <p class="capacity-value">{{ databaseRemainingLabel }}</p>
            <p class="capacity-detail">de {{ formatBytes(summary.database_limit_bytes) }}</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">
              Peso por activacion
              <InfoTip text="Espacio promedio que ocupa el registro de una activacion en la base de datos, sin contar fotos. Incluye un margen de seguridad." />
            </p>
            <p class="capacity-value">{{ perActivationEstimatedLabel }}</p>
            <p class="capacity-detail">Solo datos, sin fotos.</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">Activaciones que aun caben</p>
            <p class="capacity-value">{{ remainingActivacionesEstimatedLabel }}</p>
            <p class="capacity-detail">Antes de llenar la base de datos.</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">
              Bandeja de fotos
              <InfoTip
:text="summary.r2_bucket
                ? `Las fotos llegan aqui primero desde la app. Cada noche, las que tienen mas de ${summary.archive_retention_days} dias se mueven al archivo de Cloudflare, asi que este espacio debe mantenerse casi vacio. Si sube mucho, revisar el archivado nocturno.`
                : 'Espacio de Supabase donde se guardan las fotos de las activaciones.'" />
            </p>
            <p class="capacity-value">{{ formatBytes(summary.storage_used_bytes) }}</p>
            <span class="capacity-source-badge">Medido</span>
            <div class="capacity-progress" :class="`capacity-progress-${usageStatus(summary.storage_usage_percent)}`">
              <span :style="{ width: usageWidth(summary.storage_usage_percent) }"></span>
            </div>
            <p class="capacity-detail">{{ storageUsageLabel }} · {{ formatNumber(summary.storage_objects_count) }} archivos</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">Bandeja disponible</p>
            <p class="capacity-value">{{ formatBytes(summary.storage_remaining_bytes) }}</p>
            <p class="capacity-detail">de {{ formatBytes(summary.storage_limit_bytes) }}</p>
          </div>
        </div>

        <div v-if="summary.plan_reference" class="capacity-chips">
          <span class="capacity-chip">{{ summary.plan_reference.name }}</span>
          <span class="capacity-chip">
            {{ formatNumber(summary.plan_reference.monthly_active_users_limit) }} usuarios/mes
            <InfoTip text="Cantidad de personas distintas que pueden iniciar sesion en un mes sin costo." />
          </span>
          <span class="capacity-chip">Base de datos {{ formatBytes(summary.plan_reference.database_limit_bytes) }}</span>
          <span class="capacity-chip">Bandeja {{ formatBytes(summary.plan_reference.file_storage_limit_bytes) }}</span>
          <span class="capacity-chip">
            Descargas {{ formatBytes(summary.plan_reference.egress_limit_bytes) }}/mes
            <InfoTip text="Datos que salen de Supabase cada mes: ver fotos, descargar reportes, sincronizar la app. Tambien cuenta el traslado nocturno de fotos a Cloudflare." />
          </span>
        </div>
      </section>

      <section class="panel-card capacity-provider capacity-provider-cloudflare">
        <header class="capacity-provider-header">
          <span class="capacity-provider-mark">Cloudflare</span>
          <div>
            <h2 class="capacity-provider-title">
              Archivo de fotos (R2)
              <InfoTip text="Cloudflare R2 guarda todas las fotos de las activaciones de forma permanente. Los primeros 10 GB son gratis y ver o descargar fotos no tiene costo." />
            </h2>
            <p class="capacity-detail">10 GB gratis · despues aprox. USD 0,015 por GB al mes.</p>
          </div>
        </header>

        <div class="capacity-grid">
          <div class="capacity-card">
            <p class="capacity-label">Fotos archivadas</p>
            <p class="capacity-value">{{ hasR2Usage ? formatBytes(summary.r2_used_bytes) : 'N/D' }}</p>
            <template v-if="hasR2Usage">
              <span class="capacity-source-badge">Medido</span>
              <div class="capacity-progress" :class="`capacity-progress-${usageStatus(summary.r2_usage_percent)}`">
                <span :style="{ width: usageWidth(summary.r2_usage_percent) }"></span>
              </div>
              <p class="capacity-detail">{{ formatPercent(summary.r2_usage_percent) }} · {{ formatNumber(summary.r2_objects_count) }} archivos</p>
            </template>
            <p v-else class="capacity-detail">{{ summary.r2_unavailable_reason || 'Sin datos de Cloudflare.' }}</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">
              Espacio gratis disponible
              <InfoTip text="Si se supera, Cloudflare no bloquea nada: solo empieza a cobrar el excedente, centavos de dolar por mes." />
            </p>
            <p class="capacity-value">{{ r2RemainingLabel }}</p>
            <p class="capacity-detail">de {{ formatBytes(summary.r2_limit_bytes) }}</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">
              Subida directa desde la app
              <InfoTip text="Activa: la app actualizada envia las fotos directo a Cloudflare. Inactiva: todas las fotos pasan primero por la bandeja de Supabase." />
            </p>
            <p class="capacity-value">{{ summary.r2_uploads_enabled ? 'Activa' : 'Inactiva' }}</p>
            <p class="capacity-detail">Versiones antiguas de la app siempre usan la bandeja.</p>
          </div>
        </div>
      </section>

      <section class="panel-card capacity-provider">
        <header class="capacity-provider-header">
          <div>
            <h2 class="capacity-provider-title">Proyeccion</h2>
            <p class="capacity-detail">Combina ambos servicios con el ritmo actual de activaciones.</p>
          </div>
        </header>

        <div class="capacity-grid">
          <div class="capacity-card">
            <p class="capacity-label">
              Fotos por activacion
              <InfoTip text="Peso promedio de las fotos de una activacion (foto principal y comprobante), sumando ambos servicios." />
            </p>
            <p class="capacity-value">{{ averagePhotoBytesLabel }}</p>
            <p class="capacity-detail">Muestra: {{ averagePhotoSampleLabel }} activaciones · {{ averagePhotoCoverageLabel }}</p>
          </div>

          <div class="capacity-card">
            <p class="capacity-label">
              Activaciones con foto que aun caben
              <InfoTip text="Cuantas activaciones mas se pueden registrar antes de llenar el primer limite gratuito, sea la base de datos o el archivo de fotos." />
            </p>
            <p class="capacity-value">{{ remainingActivacionesWithPhotoLabel }}</p>
            <p class="capacity-detail">{{ limitingFactorLabel }}</p>
            <p class="capacity-detail">{{ combinedEstimateHint }}</p>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.capacity-provider {
  display: grid;
  gap: 0.75rem;
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
</style>
