import crypto from 'node:crypto'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { fetchActivaciones } from './activacionesExportacion.js'
import { aplicarAlcanceLider, esUuid, resolverAlcanceLider } from './alcanceLider.js'
import { resolveMovilUser, resolvePortalUser } from './portalAuth.js'
import { resolveStorageLocation, resolveStorageObjectPathFromFotoUrl, toR2StoredValue } from './storagePaths.js'
import { createR2BackupStorage, createR2Storage, R2_USO_KEY, registrarUsoR2 } from './r2.js'
import { createFotoStorage } from './fotoStorage.js'
import { archivarFotos } from './archivarFotos.js'
import { abrirFuentePostgres, respaldarDb, RESPALDO_ESTADO_KEY } from './respaldoDb.js'
import { aplicarFiltrosActivaciones, crearCatalogoCiudades, normalizarFiltros, resolverCiudadesFiltro } from './activacionesFiltros.js'
import { SELECT_LISTADO_ACTIVACIONES, parsearPagina } from './activacionesListado.js'
import { cargarActivacionesMetricas } from './metricasActivaciones.js'
import { cargarEventosMetricas } from './metricasEventos.js'
import { cargarMunicipios, nombresMunicipios, registrarRutasViajes } from './viajes.js'
import { registrarRutasLugares } from './lugares.js'
import { registrarRutasEventos } from './eventos.js'
import { registrarRutasPlazaMunicipios } from './plazaMunicipios.js'
import { cambiarAcceso, tieneHistorial } from './usuarios.js'
import {
  activationClassificationUpdate,
  isCreditosEligible,
  isRemesasEligible,
  normalizeActivationClassification,
  validateActivationClassification,
  validateActivationTextLengths,
} from '../src/lib/activationEditing.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACTIVATION_EDITABLE_FIELDS = new Set([
  'nombres_cliente',
  'apellidos_cliente',
  'ci_cliente',
  'nombre_comercio',
  'comercio',
  'cliente',
  'telefono_cliente',
  'email_cliente',
  'plaza',
  'zona_activacion',
  'tipo_activacion',
  'resultado',
  'estado',
  'tipo_tienda',
  'tamano_tienda',
  'tipo_comercio',
  'rubro_comercio',
  'rubro_comercio_otro',
  'comercio_fuera_mercado',
  'observaciones',
  'tipo_error',
  'descripcion_error',
  'descargo_app',
  'registro',
  'cash_in',
  'cash_out',
  'p2p',
  'qr_fisico',
  'respaldo',
  'creditos',
  'remesas',
  'hubo_error',
])
const ALLOWED_STORE_SIZES = new Set(['Pequeña', 'Mediana', 'Grande'])
const ALLOWED_USER_ROLES = new Set(['activador', 'lider', 'facturador', 'administrador', 'banco'])
const USER_ROLE_PRIORITY = ['administrador', 'lider', 'banco', 'facturador', 'activador']

function resolveUserRoles(body, previousRoles = [], previousRol = null) {
  const explicitRoles = Object.prototype.hasOwnProperty.call(body ?? {}, 'roles')
  const requestedRol = normalizeText(body?.rol)
  if (requestedRol && !ALLOWED_USER_ROLES.has(requestedRol)) throw new Error('rol invalido.')
  if (explicitRoles && (!Array.isArray(body.roles) || !body.roles.length ||
    body.roles.some((rol) => typeof rol !== 'string' || !ALLOWED_USER_ROLES.has(rol)))) {
    throw new Error('roles debe contener al menos un rol valido.')
  }
  const roles = explicitRoles ? [...new Set(body.roles)] : [...new Set([
    ...(previousRoles.length ? previousRoles : previousRol ? [previousRol] : [])
      .filter((rol) => !requestedRol || requestedRol === previousRol || rol !== previousRol),
    ...(requestedRol ? [requestedRol] : []),
  ])]
  if (!roles.length) roles.push('activador')
  if (requestedRol && !roles.includes(requestedRol)) throw new Error('rol debe pertenecer a roles.')
  return { roles, rol: requestedRol || (roles.includes(previousRol) ? previousRol : USER_ROLE_PRIORITY.find((rol) => roles.includes(rol))) }
}
const ALLOWED_USER_STATES = new Set(['activo', 'inhabilitado'])
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'EVIDENCE_LINK_SECRET',
]
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
]
const ADMIN_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 1000,
  maxRequests: 20,
})
const REQUEST_BODY_LIMIT = '1mb'
const ACTIVATION_PHOTO_MAX_BYTES = 10 * 1024 * 1024
const EVIDENCE_LINK_TYPES = Object.freeze({ principal: 'foto_url', 'cash-in': 'foto_cash_in' })
const EVIDENCE_LINK_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const EVIDENCE_LINK_SIGNED_TTL_SECONDS = 300
const EVIDENCE_LINK_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 1000,
  maxRequests: 60,
})
const MOVIL_RATE_LIMIT = Object.freeze({
  windowMs: 60 * 1000,
  maxRequests: 120,
})
const MOVIL_PHOTO_PATH_PATTERN = /^activaciones\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/(principal|cash-in)\.jpg$/
const MOVIL_PHOTO_MAX_BYTES = 6 * 1024 * 1024
const MOVIL_UPLOAD_URL_TTL_SECONDS = 15 * 60
const MOVIL_READ_URL_TTL_SECONDS = 60 * 60
const MOVIL_READ_MAX_VALUES = 20
const PHOTO_SIGNED_TTL_SECONDS = 60 * 60
const ARCHIVE_DEFAULT_RETENTION_DAYS = 2
const ARCHIVE_CRON_BUDGET_MS = 270 * 1000
const ARCHIVE_CRON_MAX_OBJECTS = 6000
const ARCHIVE_PAGE_SIZE = 200
const ARCHIVE_CONCURRENCY = 6

export function buildEvidenceToken(secret, activacionId, tipo, objectPath) {
  return crypto.createHmac('sha256', String(secret))
    .update(`${activacionId}|${tipo}|${objectPath}`, 'utf8')
    .digest('hex')
}

export function buildEvidencePath(activacionId, tipo, token) {
  return `/evidencia/${activacionId}/${tipo}/${token}`
}

export function verifyEvidenceToken(secret, activacionId, tipo, objectPath, token) {
  if (!EVIDENCE_LINK_TOKEN_PATTERN.test(String(token ?? ''))) {
    return false
  }

  return timingSafeEqualText(String(token), buildEvidenceToken(secret, activacionId, tipo, objectPath))
}

const ACTIVATION_PHOTO_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})
const MB = 1024 * 1024
const GB = 1024 * MB
const SUPABASE_FREE_PLAN_REFERENCE = Object.freeze({
  name: 'Supabase Free',
  api_requests: 'Unlimited API requests',
  monthly_active_users_limit: 50000,
  database_limit_bytes: 500 * MB,
  shared_ram_mb: 500,
  cpu_tier: 'shared',
  egress_limit_bytes: 5 * GB,
  cached_egress_limit_bytes: 5 * GB,
  file_storage_limit_bytes: 1 * GB,
  support: 'Community support',
})
const R2_FREE_PLAN_STORAGE_BYTES = 10 * GB
const INTERNAL_TEAM_NAME = 'Equipo administrativo'

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value) {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeOrganizationName(value) {
  return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return EMAIL_REGEX.test(normalizeEmail(value))
}

function isStrongPassword(value) {
  return typeof value === 'string' && value.length >= 10 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)
}

function isMissingOrganizationSchema(error) {
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? '').toLowerCase()
  return ['42P01', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code) ||
    message.includes('schema cache') || message.includes('does not exist') || message.includes('could not find the table')
}

export function resolvePort(rawValue) {
  const parsedPort = Number(rawValue ?? 8787)
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    return 8787
  }
  return parsedPort
}

function assertRequiredEnv(env) {
  for (const envName of REQUIRED_ENV) {
    if (!env[envName]) {
      throw new Error(`Falta variable de entorno requerida: ${envName}`)
    }
  }
}

function buildAllowedOrigins(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return DEFAULT_ALLOWED_ORIGINS
  }

  return rawValue
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildOriginMatcher(pattern) {
  if (pattern === '*') {
    return () => true
  }

  if (!pattern.includes('*')) {
    return (origin) => origin === pattern
  }

  const regexPattern = `^${escapeRegex(pattern).replace(/\\\*/g, '.*')}$`
  const matcherRegex = new RegExp(regexPattern)
  return (origin) => matcherRegex.test(origin)
}

function headerFirstValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  if (typeof value === 'string') {
    return value.split(',')[0].trim()
  }

  return ''
}

function getRequestOrigin(req) {
  const forwardedProto = headerFirstValue(req.headers['x-forwarded-proto'])
  const forwardedHost = headerFirstValue(req.headers['x-forwarded-host'])
  const host = forwardedHost || headerFirstValue(req.headers.host)

  if (!host) {
    return null
  }

  const protocol = forwardedProto || req.protocol || 'http'
  return `${protocol}://${host}`
}

function isOriginAllowed(origin, req, allowedOriginMatchers) {
  if (!origin) {
    return true
  }

  if (allowedOriginMatchers.some((matcher) => matcher(origin))) {
    return true
  }

  const requestOrigin = getRequestOrigin(req)
  return Boolean(requestOrigin && requestOrigin === origin)
}

function sinCache(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('CDN-Cache-Control', 'no-store')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
}

function jsonError(res, statusCode, message, details) {
  if (details) {
    console.error('[admin-api] Detalle interno:', sanitizeLogDetails(details))
  }

  const payload = { error: statusCode >= 500 ? 'Error interno del servidor.' : message }
  if (statusCode >= 500) {
    payload.requestId = crypto.randomUUID()
  }
  res.status(statusCode).json(payload)
}

function sanitizeLogDetails(details) {
  if (!details) return null
  if (typeof details === 'string') return { message: redactSensitiveLogText(details) }
  if (details instanceof Error) {
    return {
      name: details.name,
      message: typeof details.message === 'string' ? redactSensitiveLogText(details.message) : undefined,
      code: details.code,
      status: details.status,
    }
  }
  if (typeof details === 'object') {
    return {
      name: details.name,
      message: typeof details.message === 'string' ? redactSensitiveLogText(details.message) : undefined,
      code: details.code,
      status: details.status,
    }
  }
  return { type: typeof details }
}

function redactSensitiveLogText(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b\d{7,}\b/g, '[number]')
    .slice(0, 240)
}

function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  )

  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : ''
  if (req.secure || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }

  next()
}

function handleBodyParseError(error, _req, res, next) {
  if (!error) {
    next()
    return
  }

  const statusCode = error.type === 'entity.too.large' ? 413 : 400
  jsonError(
    res,
    statusCode,
    statusCode === 413 ? 'El cuerpo de la solicitud excede el limite permitido.' : 'Solicitud invalida.',
    error.message
  )
}

function parseActivationPhotoBody(req, res, next) {
  express.raw({ type: () => true, limit: ACTIVATION_PHOTO_MAX_BYTES })(req, res, (error) => {
    if (!error) {
      next()
      return
    }
    if (error?.type === 'entity.too.large') {
      jsonError(res, 413, 'La foto excede el limite de 10 MB.')
      return
    }
    jsonError(res, 400, 'No se pudo procesar la foto enviada.')
  })
}

function isValidActivationPhotoBuffer(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

function createRateLimiter({ windowMs, maxRequests }, keyOf = (req) => req.ip ?? 'unknown') {
  const attempts = new Map()

  return (req, res, next) => {
    const now = Date.now()
    const key = keyOf(req)
    const current = attempts.get(key)

    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    current.count += 1
    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      jsonError(res, 429, 'Demasiados intentos. Intenta nuevamente mas tarde.')
      return
    }

    next()
  }
}

function parseLimit(value, { fallback = 50, min = 1, max = 200 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10)

  if (!Number.isInteger(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsed))
}

function parseOptionalMegabytes(rawValue) {
  const parsed = Number.parseFloat(String(rawValue ?? ''))

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return Math.round(parsed * 1024 * 1024)
}

function resolveActivacionesBucket(env) {
  const adminBucket = normalizeText(env.ADMIN_STORAGE_BUCKET_ACTIVACIONES)
  if (adminBucket) {
    return adminBucket
  }

  const frontendBucket = normalizeText(env.VITE_STORAGE_BUCKET_ACTIVACIONES)
  if (frontendBucket) {
    return frontendBucket
  }

  return 'fotos-activaciones'
}

async function attachActivationSignedPhotos(fotoStorage, bucketName, rows, evidenceSecret = null) {
  const signed = await fotoStorage.signMany(rows.flatMap((row) => [row.foto_url, row.foto_cash_in]), PHOTO_SIGNED_TTL_SECONDS)
  return rows.map((row) => ({
    ...row,
    foto_url_signed: signed.get(row.foto_url) ?? null,
    foto_cash_in_signed: signed.get(row.foto_cash_in) ?? null,
    foto_url_evidencia: buildEvidenceLinkPath(evidenceSecret, row, 'principal', bucketName),
    foto_cash_in_evidencia: buildEvidenceLinkPath(evidenceSecret, row, 'cash-in', bucketName),
  }))
}

async function attachActivationCreatorEmail(adminSupabase, rows) {
  const ids = [...new Set(rows.map((row) => row?.usuario_id).filter(esUuid))]
  const correos = new Map()
  if (ids.length) {
    const { data, error } = await adminSupabase.from('activadores').select('usuario_id,email').in('usuario_id', ids)
    if (error) throw error
    for (const perfil of data ?? []) {
      const email = typeof perfil.email === 'string' ? perfil.email.trim() : ''
      correos.set(perfil.usuario_id, email || null)
    }
  }
  return rows.map((row) => ({ ...row, usuario_email: correos.get(row.usuario_id) ?? null }))
}

function buildEvidenceLinkPath(secret, row, tipo, bucketName) {
  if (!secret || !row?.id) {
    return null
  }

  const storedValue = tipo === 'principal' ? row.foto_url : row.foto_cash_in
  const objectPath = resolveStorageObjectPathFromFotoUrl(storedValue, bucketName)

  if (!objectPath) {
    return null
  }

  return buildEvidencePath(row.id, tipo, buildEvidenceToken(secret, row.id, tipo, objectPath))
}

async function calculateBucketUsageBytes(adminSupabase, bucketName) {
  const { data, error } = await adminSupabase
    .rpc('get_storage_usage_bytes', { p_bucket: bucketName })
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return {
    totalBytes: Number(data?.total_bytes ?? 0),
    totalObjects: Number(data?.total_objects ?? 0),
  }
}

async function estimateDatabaseUsageFromActivaciones(
  adminSupabase,
  {
    activacionesCount = 0,
    databaseLimitBytes = null,
    sampleLimit = 240,
    overheadFactor = 1.34,
  } = {}
) {
  const normalizedCount = Number(activacionesCount)
  if (!Number.isFinite(normalizedCount) || normalizedCount <= 0) {
    return {
      sample_size: 0,
      overhead_factor: overheadFactor,
      per_activation_estimated_bytes: 0,
      estimated_database_used_bytes: 0,
      estimated_database_remaining_bytes:
        databaseLimitBytes == null ? null : Math.max(0, databaseLimitBytes),
      estimated_database_usage_percent: databaseLimitBytes == null ? null : 0,
      estimated_activaciones_capacity_total: null,
      estimated_activaciones_capacity_remaining: null,
    }
  }

  const safeSampleLimit = Math.max(40, Math.min(500, Number(sampleLimit) || 240))
  const { data: sampleRows, error: sampleErr } = await adminSupabase
    .from('activaciones')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeSampleLimit)

  if (sampleErr) {
    throw new Error(sampleErr.message)
  }

  const rows = sampleRows ?? []
  if (!rows.length) {
    return {
      sample_size: 0,
      overhead_factor: overheadFactor,
      per_activation_estimated_bytes: 0,
      estimated_database_used_bytes: 0,
      estimated_database_remaining_bytes:
        databaseLimitBytes == null ? null : Math.max(0, databaseLimitBytes),
      estimated_database_usage_percent: databaseLimitBytes == null ? null : 0,
      estimated_activaciones_capacity_total: null,
      estimated_activaciones_capacity_remaining: null,
    }
  }

  const totalJsonPayloadBytes = rows.reduce((accumulator, row) => {
    try {
      return accumulator + Buffer.byteLength(JSON.stringify(row), 'utf8')
    } catch {
      return accumulator
    }
  }, 0)

  const averageJsonPayloadBytes = totalJsonPayloadBytes / rows.length
  const perActivationEstimatedBytes = Math.max(1, Math.round(averageJsonPayloadBytes * overheadFactor))
  const estimatedDatabaseUsedBytes = Math.round(perActivationEstimatedBytes * normalizedCount)
  const estimatedDatabaseRemainingBytes =
    databaseLimitBytes == null
      ? null
      : Math.max(0, Math.round(databaseLimitBytes - estimatedDatabaseUsedBytes))
  const estimatedDatabaseUsagePercent =
    databaseLimitBytes == null || databaseLimitBytes <= 0
      ? null
      : Number(((estimatedDatabaseUsedBytes / databaseLimitBytes) * 100).toFixed(2))
  const estimatedActivacionesCapacityTotal =
    databaseLimitBytes == null || databaseLimitBytes <= 0
      ? null
      : Math.max(0, Math.floor(databaseLimitBytes / perActivationEstimatedBytes))
  const estimatedActivacionesCapacityRemaining =
    estimatedActivacionesCapacityTotal == null
      ? null
      : Math.max(0, estimatedActivacionesCapacityTotal - normalizedCount)

  return {
    sample_size: rows.length,
    overhead_factor: overheadFactor,
    per_activation_estimated_bytes: perActivationEstimatedBytes,
    estimated_database_used_bytes: estimatedDatabaseUsedBytes,
    estimated_database_remaining_bytes: estimatedDatabaseRemainingBytes,
    estimated_database_usage_percent: estimatedDatabaseUsagePercent,
    estimated_activaciones_capacity_total: estimatedActivacionesCapacityTotal,
    estimated_activaciones_capacity_remaining: estimatedActivacionesCapacityRemaining,
  }
}

function estimateCombinedActivationCapacity({
  activacionesCount = 0,
  activacionesWithPhotoCount = 0,
  storageObjectsCount = 0,
  storageUsedBytes = null,
  storageRemainingBytes = null,
  databaseRemainingBytes = null,
  perActivationDatabaseBytes = null,
} = {}) {
  const normalizedActivacionesCount = Math.max(0, Number(activacionesCount) || 0)
  const normalizedActivacionesWithPhotoCount = Math.max(0, Number(activacionesWithPhotoCount) || 0)
  const normalizedStorageObjectsCount = Math.max(0, Number(storageObjectsCount) || 0)
  const normalizedStorageUsedBytes = Number.isFinite(Number(storageUsedBytes))
    ? Math.max(0, Number(storageUsedBytes))
    : null
  const normalizedStorageRemainingBytes = Number.isFinite(Number(storageRemainingBytes))
    ? Math.max(0, Number(storageRemainingBytes))
    : null
  const normalizedDatabaseRemainingBytes = Number.isFinite(Number(databaseRemainingBytes))
    ? Math.max(0, Number(databaseRemainingBytes))
    : null
  const normalizedPerActivationDatabaseBytes =
    Number.isFinite(Number(perActivationDatabaseBytes)) && Number(perActivationDatabaseBytes) > 0
      ? Math.round(Number(perActivationDatabaseBytes))
      : null

  const photoSampleCount =
    normalizedActivacionesWithPhotoCount > 0
      ? normalizedActivacionesWithPhotoCount
      : normalizedStorageObjectsCount > 0
        ? normalizedStorageObjectsCount
        : 0

  const averagePhotoBytes =
    normalizedStorageUsedBytes != null && photoSampleCount > 0
      ? Math.max(1, Math.round(normalizedStorageUsedBytes / photoSampleCount))
      : null

  const remainingByDatabase =
    normalizedDatabaseRemainingBytes != null && normalizedPerActivationDatabaseBytes != null
      ? Math.max(0, Math.floor(normalizedDatabaseRemainingBytes / normalizedPerActivationDatabaseBytes))
      : null
  const remainingByStorage =
    normalizedStorageRemainingBytes != null && averagePhotoBytes != null
      ? Math.max(0, Math.floor(normalizedStorageRemainingBytes / averagePhotoBytes))
      : null

  const estimatedRemaining =
    remainingByDatabase != null && remainingByStorage != null
      ? Math.min(remainingByDatabase, remainingByStorage)
      : remainingByDatabase ?? remainingByStorage

  const limitingFactor =
    remainingByDatabase != null && remainingByStorage != null
      ? remainingByStorage <= remainingByDatabase
        ? 'storage'
        : 'database'
      : remainingByStorage != null
        ? 'storage'
        : remainingByDatabase != null
          ? 'database'
          : null

  const unavailableReasons = []
  if (averagePhotoBytes == null) {
    unavailableReasons.push('Sin muestra de fotos para calcular promedio.')
  }
  if (normalizedPerActivationDatabaseBytes == null) {
    unavailableReasons.push('Sin muestra suficiente para calcular peso de activacion en base de datos.')
  }

  const estimatedTotal =
    estimatedRemaining == null ? null : Math.max(normalizedActivacionesCount, normalizedActivacionesCount + estimatedRemaining)
  const perActivationTotalEstimatedBytes =
    normalizedPerActivationDatabaseBytes != null && averagePhotoBytes != null
      ? normalizedPerActivationDatabaseBytes + averagePhotoBytes
      : null
  const photoCoveragePercent =
    normalizedActivacionesCount > 0
      ? Number(
          (
            (Math.min(normalizedActivacionesWithPhotoCount, normalizedActivacionesCount) /
              normalizedActivacionesCount) *
            100
          ).toFixed(2)
        )
      : null

  return {
    one_photo_per_activation_assumed: true,
    activaciones_with_photo_count: normalizedActivacionesWithPhotoCount,
    photo_coverage_percent: photoCoveragePercent,
    sample_photos_count: photoSampleCount,
    average_photo_bytes: averagePhotoBytes,
    per_activation_database_estimated_bytes: normalizedPerActivationDatabaseBytes,
    per_activation_total_estimated_bytes: perActivationTotalEstimatedBytes,
    estimated_activaciones_with_photo_total: estimatedTotal,
    estimated_activaciones_with_photo_remaining: estimatedRemaining,
    estimated_remaining_by_database: remainingByDatabase,
    estimated_remaining_by_storage: remainingByStorage,
    limiting_factor: limitingFactor,
    unavailable_reason: unavailableReasons.length ? unavailableReasons.join(' ') : null,
  }
}

export function createAdminApiApp({
  env = process.env,
  adminSupabase: injectedSupabase = null,
  r2: injectedR2,
  r2Respaldos: injectedR2Respaldos,
  createUserSupabase: injectedCreateUserSupabase = null,
  abrirFuenteRespaldo = () => abrirFuentePostgres(env.DB_URL),
  metricsPageSize = 1000,
} = {}) {
  assertRequiredEnv(env)

  const allowedOrigins = buildAllowedOrigins(env.ADMIN_API_CORS_ORIGIN)
  const allowedOriginMatchers = allowedOrigins.map(buildOriginMatcher)
  const activacionesBucket = resolveActivacionesBucket(env)
  const configuredStorageLimitBytes = parseOptionalMegabytes(env.ADMIN_STORAGE_LIMIT_MB)
  const configuredDatabaseLimitBytes = parseOptionalMegabytes(env.ADMIN_DATABASE_LIMIT_MB)
  const storageLimitBytes =
    configuredStorageLimitBytes ?? SUPABASE_FREE_PLAN_REFERENCE.file_storage_limit_bytes
  const databaseLimitBytes =
    configuredDatabaseLimitBytes ?? SUPABASE_FREE_PLAN_REFERENCE.database_limit_bytes
  const storageLimitSource =
    configuredStorageLimitBytes == null ? 'supabase_free_default' : 'env_admin_storage_limit_mb'
  const databaseLimitSource =
    configuredDatabaseLimitBytes == null ? 'supabase_free_default' : 'env_admin_database_limit_mb'
  const adminSupabase = injectedSupabase ?? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const r2 = injectedR2 === undefined ? createR2Storage(env) : injectedR2
  const r2Respaldos = injectedR2Respaldos === undefined ? createR2BackupStorage(env) : injectedR2Respaldos
  const fotoStorage = createFotoStorage({ adminSupabase, bucketName: activacionesBucket, r2 })
  const r2UploadsEnabled = Boolean(r2) && normalizeText(env.R2_UPLOADS_ENABLED).toLowerCase() !== 'false'
  const configuredRetentionDays = Number.parseFloat(String(env.FOTOS_RETENCION_SUPABASE_DIAS ?? ''))
  const archiveRetentionDays = Number.isFinite(configuredRetentionDays) && configuredRetentionDays >= 0
    ? configuredRetentionDays
    : ARCHIVE_DEFAULT_RETENTION_DAYS
  // auth.uid()-based SQL helpers (e.g. puede_leer_foto_activacion_equipo) must run with the caller's JWT, not the service role.
  const createUserSupabase = injectedCreateUserSupabase ?? ((token) => createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }))

  async function attachUserRoles(users) {
    if (!users.length) return users
    const { data, error } = await adminSupabase.from('activador_roles')
      .select('usuario_id,rol').in('usuario_id', users.map((user) => user.usuario_id))
    if (error) throw error
    return users.map((user) => {
      const roles = (data ?? []).filter((row) => row.usuario_id === user.usuario_id).map((row) => row.rol)
      return { ...user, roles: roles.length ? roles : [user.rol] }
    })
  }

  async function syncUserRoles(userId, roles) {
    if (roles.length) {
      const { error } = await adminSupabase.from('activador_roles')
        .upsert(roles.map((rol) => ({ usuario_id: userId, rol })), { onConflict: 'usuario_id,rol' })
      if (error) throw error
    }
    let query = adminSupabase.from('activador_roles').delete().eq('usuario_id', userId)
    if (roles.length) query = query.not('rol', 'in', `(${roles.join(',')})`)
    const { error } = await query
    if (error) throw error
  }

  async function syncFacturadorTeams(userId, nombre, teamIds, hasFacturadorRole) {
    const normalizedIds = [...new Set((teamIds ?? []).map(normalizeText).filter(Boolean))]
    const { data: linkedBiller, error: linkedError } = await adminSupabase.from('facturadores')
      .select('id').eq('usuario_id', userId).maybeSingle()
    if (linkedError) throw linkedError

    if (!hasFacturadorRole) {
      if (linkedBiller) {
        const { error } = await adminSupabase.from('facturadores')
          .update({ usuario_id: null }).eq('id', linkedBiller.id).eq('usuario_id', userId)
        if (error) throw error
      }
      return
    }

    const { data: role, error: roleError } = await adminSupabase.from('activador_roles')
      .select('usuario_id').eq('usuario_id', userId).eq('rol', 'facturador').maybeSingle()
    if (roleError) throw roleError
    if (!role) throw new Error('El usuario debe tener rol facturador para asignar equipos facturados.')

    let biller = linkedBiller
    if (!biller) {
      const { data: selectedTeams, error: selectedTeamsError } = normalizedIds.length
        ? await adminSupabase.from('equipos').select('facturador_id').in('id', normalizedIds)
        : { data: [], error: null }
      if (selectedTeamsError) throw selectedTeamsError
      const existingBillerIds = [...new Set((selectedTeams ?? []).map((team) => team.facturador_id).filter(Boolean))]
      if (existingBillerIds.length === 1) {
        const { data: availableBiller, error: availableError } = await adminSupabase.from('facturadores')
          .select('id').eq('id', existingBillerIds[0]).is('usuario_id', null).maybeSingle()
        if (availableError) throw availableError
        if (availableBiller) {
          const { data: linked, error: linkError } = await adminSupabase.from('facturadores')
            .update({ usuario_id: userId, nombre }).eq('id', availableBiller.id).is('usuario_id', null)
            .select('id').single()
          if (linkError) throw linkError
          biller = linked
        }
      }
    }
    if (!biller) {
      const codigo = `USR-${userId}`
      const { data: reusable, error: reusableError } = await adminSupabase.from('facturadores')
        .select('id').eq('codigo', codigo).is('usuario_id', null).maybeSingle()
      if (reusableError) throw reusableError
      if (reusable) {
        const { data: linked, error: linkError } = await adminSupabase.from('facturadores')
          .update({ usuario_id: userId, nombre }).eq('id', reusable.id).is('usuario_id', null)
          .select('id').single()
        if (linkError) throw linkError
        biller = linked
      } else {
        const { data: created, error: createError } = await adminSupabase.from('facturadores').insert({
          codigo,
          nombre,
          usuario_id: userId,
        }).select('id').single()
        if (createError) throw createError
        biller = created
      }
    } else {
      const { error: nameError } = await adminSupabase.from('facturadores')
        .update({ nombre }).eq('id', biller.id)
      if (nameError) throw nameError
    }

    const { data: currentTeams, error: currentError } = await adminSupabase.from('equipos')
      .select('id').eq('facturador_id', biller.id)
    if (currentError) throw currentError
    const removedIds = (currentTeams ?? []).map((team) => team.id).filter((id) => !normalizedIds.includes(id))

    if (removedIds.length) {
      const { error } = await adminSupabase.from('equipos')
        .update({ facturador_id: null }).in('id', removedIds).eq('facturador_id', biller.id)
      if (error) throw error
    }
    if (normalizedIds.length) {
      const { error } = await adminSupabase.from('equipos')
        .update({ facturador_id: biller.id }).in('id', normalizedIds)
      if (error) throw error
    }
  }

  async function enrichUsersWithOrganization(users) {
    if (!users.length) return users
    const userIds = users.map((user) => user.usuario_id).filter(Boolean)

    try {
      const { data: memberships, error: membershipsError } = userIds.length
        ? await adminSupabase.from('activador_equipo_historial').select('activador_id,equipo_id')
          .in('activador_id', userIds).is('fin', null)
        : { data: [], error: null }
      if (membershipsError) return users
      const memberTeamsByUser = new Map()
      for (const user of users) if (user.equipo_id) memberTeamsByUser.set(user.usuario_id, new Set([user.equipo_id]))
      for (const row of memberships ?? []) {
        if (!memberTeamsByUser.has(row.activador_id)) memberTeamsByUser.set(row.activador_id, new Set())
        memberTeamsByUser.get(row.activador_id).add(row.equipo_id)
      }
      const teamIds = [...new Set([...memberTeamsByUser.values()].flatMap((ids) => [...ids]))]
      const now = new Date().toISOString()
      let [{ data: teams, error: teamsError }, { data: currentTrips, error: tripsError }] =
        await Promise.all([
          teamIds.length
            ? adminSupabase.from('equipos').select('id,numero,nombre,facturador_id,lider_actual_id,plaza_id,activo').in('id', teamIds)
            : Promise.resolve({ data: [], error: null }),
          userIds.length
            ? adminSupabase.from('viajes').select('id,activador_id,municipio_id,inicio,fin')
              .in('activador_id', userIds).lte('inicio', now).gt('fin', now).is('cancelado_at', null)
            : Promise.resolve({ data: [], error: null }),
        ])
      if (teamsError && teamIds.length) {
        const legacyTeams = await adminSupabase.from('equipos')
          .select('id,numero,nombre,facturador_id,lider_actual_id').in('id', teamIds)
        teams = legacyTeams.data
        teamsError = legacyTeams.error
      }
      if (teamsError || tripsError) return users

      let { data: ledTeams, error: ledTeamsError } = userIds.length
        ? await adminSupabase.from('equipos')
          .select('id,numero,nombre,facturador_id,lider_actual_id,plaza_id,activo').in('lider_actual_id', userIds)
        : { data: [], error: null }
      if (ledTeamsError && userIds.length) {
        const legacyLedTeams = await adminSupabase.from('equipos')
          .select('id,numero,nombre,facturador_id,lider_actual_id,activo').in('lider_actual_id', userIds)
        ledTeams = legacyLedTeams.data
        ledTeamsError = legacyLedTeams.error
      }
      if (ledTeamsError) return users

      let linkedBillers = []
      if (userIds.length) {
        const linkedResult = await adminSupabase.from('facturadores')
          .select('id,codigo,nombre,usuario_id').in('usuario_id', userIds)
        if (!linkedResult.error) linkedBillers = linkedResult.data ?? []
      }
      const linkedBillerIds = linkedBillers.map((item) => item.id)
      const { data: billedTeams, error: billedTeamsError } = linkedBillerIds.length
        ? await adminSupabase.from('equipos')
          .select('id,numero,nombre,facturador_id,lider_actual_id,plaza_id,activo').in('facturador_id', linkedBillerIds)
        : { data: [], error: null }
      if (billedTeamsError) return users
      teams = [...new Map([...(teams ?? []), ...(ledTeams ?? []), ...(billedTeams ?? [])].map((team) => [team.id, team])).values()]

      const facturadorIds = [...new Set((teams ?? []).map((team) => team.facturador_id).filter(Boolean))]
      const plazaIds = [...new Set((teams ?? []).map((team) => team.plaza_id).filter(Boolean))]
      const leaderIds = [...new Set((teams ?? []).map((team) => team.lider_actual_id).filter(Boolean))]
      const [{ data: billers, error: billersError }, { data: plazas, error: plazasError }, { data: leaders, error: leadersError }] = await Promise.all([
        facturadorIds.length
          ? adminSupabase.from('facturadores').select('id,codigo,nombre').in('id', facturadorIds)
          : Promise.resolve({ data: [], error: null }),
        plazaIds.length
          ? adminSupabase.from('plazas').select('id,nombre').in('id', plazaIds)
          : Promise.resolve({ data: [], error: null }),
        leaderIds.length
          ? adminSupabase.from('activadores').select('usuario_id,nombre').in('usuario_id', leaderIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (billersError || plazasError || leadersError) return users
      const tripDestinations = await nombresMunicipios(adminSupabase, (currentTrips ?? []).map((trip) => trip.municipio_id))

      const teamsById = new Map((teams ?? []).map((team) => [team.id, team]))
      const billersById = new Map([...(billers ?? []), ...linkedBillers].map((biller) => [biller.id, biller]))
      const billerByUser = new Map(linkedBillers.map((biller) => [biller.usuario_id, biller]))
      const plazasById = new Map((plazas ?? []).map((plaza) => [plaza.id, plaza]))
      const leadersById = new Map((leaders ?? []).map((leader) => [leader.usuario_id, leader]))
      const tripByUser = new Map((currentTrips ?? []).map((trip) => [trip.activador_id, trip]))
      return users.map((user) => {
        const team = teamsById.get(user.equipo_id)
        const biller = billersById.get(team?.facturador_id)
        const trip = tripByUser.get(user.usuario_id)
        const teamPlaza = plazasById.get(team?.plaza_id)
        const assignedTeams = (teams ?? []).filter((item) => item.lider_actual_id === user.usuario_id)
        const userBiller = billerByUser.get(user.usuario_id)
        const billedUserTeams = userBiller
          ? (teams ?? []).filter((item) => item.facturador_id === userBiller.id)
          : []
        const assignedBiller = billersById.get(assignedTeams[0]?.facturador_id)
        const userTeams = new Map()
        const addTeam = (item, rol) => {
          if (!item) return
          const entry = userTeams.get(item.id) ?? {
            id: item.id,
            numero: item.numero,
            nombre: item.nombre,
            plaza: plazasById.get(item.plaza_id)?.nombre ?? null,
            activo: item.activo !== false,
            principal: item.id === user.equipo_id,
            lider_nombre: leadersById.get(item.lider_actual_id)?.nombre ?? null,
            roles: [],
          }
          if (!entry.roles.includes(rol)) entry.roles.push(rol)
          userTeams.set(item.id, entry)
        }
        for (const id of memberTeamsByUser.get(user.usuario_id) ?? []) addTeam(teamsById.get(id), 'activador')
        assignedTeams.forEach((item) => addTeam(item, 'lider'))
        billedUserTeams.forEach((item) => addTeam(item, 'facturador'))
        return {
          ...user,
          plaza_base: user.plaza_base ?? user.plaza ?? null,
          viaje_vigente: trip ? { id: trip.id, destino: tripDestinations.get(trip.municipio_id) ?? null, inicio: trip.inicio, fin: trip.fin } : null,
          plaza_id: team?.plaza_id ?? null,
          plaza_nombre: teamPlaza?.nombre ?? user.plaza_base ?? user.plaza ?? null,
          equipo_numero: team?.numero ?? null,
          equipo_nombre: team?.nombre ?? null,
          equipos_asignados: assignedTeams.map((item) => ({
            id: item.id,
            numero: item.numero,
            nombre: item.nombre,
            plaza: plazasById.get(item.plaza_id)?.nombre ?? null,
            facturador: billersById.get(item.facturador_id)?.nombre ?? null,
            activo: item.activo,
          })),
          equipos_facturados: billedUserTeams.map((item) => ({
            id: item.id,
            numero: item.numero,
            nombre: item.nombre,
            plaza: plazasById.get(item.plaza_id)?.nombre ?? null,
            activo: item.activo,
          })),
          equipos: [...userTeams.values()].sort((a, b) => Number(b.principal) - Number(a.principal) || Number(a.numero) - Number(b.numero)),
          lider_id: team?.lider_actual_id ?? user.lider_id ?? null,
          lider_nombre: leadersById.get(team?.lider_actual_id ?? user.lider_id)?.nombre ?? null,
          facturador_id: userBiller?.id ?? biller?.id ?? assignedBiller?.id ?? null,
          facturador_codigo: userBiller?.codigo ?? biller?.codigo ?? assignedBiller?.codigo ?? null,
          facturador_nombre: userBiller?.nombre ?? biller?.nombre ?? assignedBiller?.nombre ?? null,
        }
      })
    } catch {
      // Compatibilidad mientras la migracion organizacional aun no fue aplicada.
      return users
    }
  }

  async function resolveTeamIdForLeader(leaderId, plaza) {
    try {
      const normalizedPlaza = normalizeOrganizationName(plaza)
      if (!normalizedPlaza) return null
      const { data: plazaRow, error: plazaError } = await adminSupabase.from('plazas')
        .select('id').eq('nombre_normalizado', normalizedPlaza).maybeSingle()
      if (plazaError) {
        let legacyQuery = adminSupabase.from('equipos').select('id').eq('activo', true)
        legacyQuery = leaderId
          ? legacyQuery.eq('lider_actual_id', leaderId)
          : legacyQuery.eq('nombre', 'Equipo sin asignar')
        const { data: legacyTeam, error: legacyError } = await legacyQuery.order('numero').limit(1).maybeSingle()
        return legacyError ? null : legacyTeam?.id ?? null
      }
      if (!plazaRow) return null
      let query = adminSupabase.from('equipos').select('id').eq('activo', true).eq('plaza_id', plazaRow.id)
      query = leaderId ? query.eq('lider_actual_id', leaderId) : query.eq('nombre', 'Equipo sin asignar')
      const { data, error } = await query.order('numero').limit(1).maybeSingle()
      return error ? null : data?.id ?? null
    } catch {
      return null
    }
  }

  async function loadOrganizationOptions() {
    const [plazasResult, teamsResult, billersResult] = await Promise.all([
      adminSupabase.from('plazas').select('id,nombre,nombre_normalizado,activa').eq('activa', true).order('nombre'),
      adminSupabase.from('equipos').select('id,numero,nombre,facturador_id,plaza_id,lider_actual_id,activo').order('numero'),
      adminSupabase.from('facturadores').select('id,codigo,nombre,usuario_id,activo').eq('activo', true).order('nombre'),
    ])
    const firstError = plazasResult.error || teamsResult.error || billersResult.error
    if (firstError) {
      if (isMissingOrganizationSchema(firstError)) {
        return { available: false, message: 'El modelo organizacional aun no esta habilitado; se mantiene el esquema anterior.', plazas: [], equipos: [], facturadores: [] }
      }
      throw firstError
    }
    return {
      available: true,
      message: null,
      plazas: plazasResult.data ?? [],
      equipos: teamsResult.data ?? [],
      facturadores: billersResult.data ?? [],
    }
  }

  async function syncLeaderTeams(leaderId, teamIds) {
    const normalizedIds = [...new Set((teamIds ?? []).map(normalizeText).filter(Boolean))]
    const { error } = await adminSupabase.rpc('asignar_equipos_lider', {
      p_lider_id: leaderId,
      p_equipo_ids: normalizedIds,
      p_inicio: new Date().toISOString(),
      p_motivo: 'Actualizacion administrativa de usuario',
    })
    if (error) {
      if (isMissingOrganizationSchema(error)) return { available: false }
      throw error
    }
    return { available: true }
  }

  async function syncActivadorTeams(userId, teamIds) {
    const normalizedIds = [...new Set((teamIds ?? []).map(normalizeText).filter(Boolean))]
    const { error } = await adminSupabase.rpc('asignar_equipos_activador', {
      p_activador_id: userId,
      p_equipo_ids: normalizedIds,
      p_inicio: new Date().toISOString(),
      p_motivo: 'Actualizacion administrativa de usuario',
    })
    if (error) throw error
  }

  async function discardCreatedUser(userId) {
    await adminSupabase.from('activador_equipo_historial').delete().eq('activador_id', userId)
    await adminSupabase.from('activadores').delete().eq('usuario_id', userId)
    await adminSupabase.auth.admin.deleteUser(userId)
  }

  function activeTeamIdsOrNull(options, ids) {
    const unique = [...new Set(ids.map(normalizeText).filter(Boolean))]
    const valid = options.equipos.filter((team) => unique.includes(team.id) && team.activo)
    return valid.length === unique.length ? unique : null
  }

  const app = express()
  app.set('trust proxy', true)

  app.use(applySecurityHeaders)

  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''

    if (origin && !isOriginAllowed(origin, req, allowedOriginMatchers)) {
      jsonError(res, 403, `Origin no permitido: ${origin}`)
      return
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    next()
  })

  app.use(express.json({ limit: REQUEST_BODY_LIMIT }))
  app.use(handleBodyParseError)

  async function authenticate(req, res, next) {
    const user = await resolvePortalUser(adminSupabase, req.headers.authorization)
    if (!user) { jsonError(res, 401, 'Sesion invalida o usuario sin permisos.'); return }
    req.user = user
    next()
  }

  function requireAdmin(req, res, next) {
    if (!req.user.isAdmin) { jsonError(res, 403, 'Se requiere un administrador activo.'); return }
    next()
  }

  async function requireAdminReauthentication(req, res, next) {
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (req.body && typeof req.body === 'object') delete req.body.password
    if (!password) {
      jsonError(res, 400, 'La contraseña actual es obligatoria.')
      return
    }

    const authEmail = normalizeEmail(req.user.email)
    if (!authEmail) {
      jsonError(res, 401, 'No se pudo reautenticar al administrador.')
      return
    }

    const verificationClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await verificationClient.auth.signInWithPassword({
      email: authEmail,
      password,
    })
    if (error || data.user?.id !== req.user.auth_user_id) {
      jsonError(res, 401, 'Contraseña incorrecta.')
      return
    }

    next()
  }

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/evidencia/:activacionId/:tipo/:token', createRateLimiter(EVIDENCE_LINK_RATE_LIMIT), asyncRoute(async (req, res) => {
    const activacionId = normalizeText(req.params.activacionId)
    const tipo = normalizeText(req.params.tipo)
    const token = normalizeText(req.params.token)
    const column = EVIDENCE_LINK_TYPES[tipo]

    if (!activacionId || !column || !EVIDENCE_LINK_TOKEN_PATTERN.test(token)) {
      jsonError(res, 404, 'No encontrado.')
      return
    }

    const { data: row, error } = await adminSupabase.from('activaciones')
      .select('id,foto_url,foto_cash_in')
      .eq('id', activacionId)
      .maybeSingle()

    if (error || !row) {
      jsonError(res, 404, 'No encontrado.')
      return
    }

    const storedValue = tipo === 'principal' ? row.foto_url : row.foto_cash_in
    const objectPath = resolveStorageObjectPathFromFotoUrl(storedValue, activacionesBucket)

    if (!objectPath || !verifyEvidenceToken(env.EVIDENCE_LINK_SECRET, activacionId, tipo, objectPath, token)) {
      jsonError(res, 404, 'No encontrado.')
      return
    }

    let signedUrl = null
    let signError = null
    try {
      signedUrl = (await fotoStorage.signMany([storedValue], EVIDENCE_LINK_SIGNED_TTL_SECONDS)).get(storedValue) ?? null
    } catch (error) {
      signError = error
    }

    if (signError || !signedUrl) {
      console.error('[admin-api] No se pudo firmar una evidencia.', sanitizeLogDetails(signError))
      jsonError(res, 500, 'No se pudo resolver la evidencia.')
      return
    }

    sinCache(res)
    res.redirect(302, signedUrl)
  }))

  async function authenticateMovil(req, res, next) {
    const user = await resolveMovilUser(adminSupabase, req.headers.authorization)
    if (!user) { jsonError(res, 401, 'Sesion invalida o usuario inactivo.'); return }
    req.movilUser = user
    next()
  }

  app.use('/movil', authenticateMovil, createRateLimiter(MOVIL_RATE_LIMIT, (req) => req.movilUser.authUserId))

  app.post('/movil/fotos/subida', asyncRoute(async (req, res) => {
    const objectPath = normalizeText(req.body?.path)
    const size = Number(req.body?.size)
    const match = objectPath.match(MOVIL_PHOTO_PATH_PATTERN)

    if (!match || match[1] !== req.movilUser.authUserId.toLowerCase()) {
      jsonError(res, 403, 'Ruta de foto no permitida.')
      return
    }
    if (!Number.isInteger(size) || size <= 0 || size > MOVIL_PHOTO_MAX_BYTES) {
      jsonError(res, 400, 'Tamano de foto invalido (maximo 6 MB).')
      return
    }
    if (!r2UploadsEnabled) {
      res.status(409).json({ error: 'Subida directa deshabilitada.', fallback: 'supabase' })
      return
    }

    const url = await r2.signPut(objectPath, { contentType: 'image/jpeg', contentLength: size }, MOVIL_UPLOAD_URL_TTL_SECONDS)
    sinCache(res)
    res.json({
      url,
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      storedValue: toR2StoredValue(objectPath),
      expiresIn: MOVIL_UPLOAD_URL_TTL_SECONDS,
    })
  }))

  app.post('/movil/fotos/lectura', asyncRoute(async (req, res) => {
    const values = req.body?.values
    if (!Array.isArray(values) || !values.length || values.length > MOVIL_READ_MAX_VALUES ||
      values.some((value) => typeof value !== 'string')) {
      jsonError(res, 400, `values debe ser una lista de 1 a ${MOVIL_READ_MAX_VALUES} textos.`)
      return
    }

    const ownPrefix = `activaciones/${req.movilUser.authUserId}/`
    let userSupabase = null
    const allowed = []
    for (const value of new Set(values)) {
      const location = resolveStorageLocation(value, activacionesBucket)
      if (!location) continue
      if (location.objectPath.startsWith(ownPrefix)) {
        allowed.push(value)
        continue
      }
      userSupabase ??= createUserSupabase(req.movilUser.token)
      const { data: canRead, error } = await userSupabase.rpc('puede_leer_foto_activacion_equipo', { p_nombre: location.objectPath })
      if (!error && canRead === true) allowed.push(value)
    }

    const signed = allowed.length ? await fotoStorage.signMany(allowed, MOVIL_READ_URL_TTL_SECONDS) : new Map()
    sinCache(res)
    res.json({ urls: Object.fromEntries(values.map((value) => [value, signed.get(value) ?? null])) })
  }))

  function requireCronSecret(req, res, next) {
    const expected = normalizeText(env.CRON_SECRET)
    const provided = normalizeText(req.headers.authorization).replace(/^Bearer\s+/i, '')
    if (!expected || !provided || !timingSafeEqualText(provided, expected)) {
      jsonError(res, 401, 'No autorizado.')
      return
    }
    next()
  }

  app.get('/cron/respaldo-db', requireCronSecret, asyncRoute(async (_req, res) => {
    if (!r2Respaldos) {
      jsonError(res, 503, 'R2 no esta configurado.')
      return
    }
    const estado = await respaldarDb({ abrirFuente: abrirFuenteRespaldo, r2: r2Respaldos })
    if (!estado.ok) console.error('[respaldo-db] fallido', estado.error)
    else console.log('[respaldo-db]', JSON.stringify(estado))
    let uso = null
    if (r2) {
      try {
        uso = await registrarUsoR2({ fotos: r2, respaldos: r2Respaldos })
      } catch (error) {
        console.error('[respaldo-db] no se pudo medir uso de R2', error instanceof Error ? error.message : error)
      }
    }
    res.status(estado.ok ? 200 : 500).json({ ...estado, uso })
  }))

  app.get('/cron/archivar-fotos', requireCronSecret, asyncRoute(async (req, res) => {
    if (!r2) {
      jsonError(res, 503, 'R2 no esta configurado.')
      return
    }

    const deadline = Date.now() + ARCHIVE_CRON_BUDGET_MS
    const antesDe = new Date(Date.now() - archiveRetentionDays * 24 * 60 * 60 * 1000)
    const total = { candidatos: 0, movidas: 0, omitidas: 0, fallidas: 0, bytes: 0, pendientesPorTiempo: 0 }
    while (Date.now() < deadline && total.movidas + total.fallidas < ARCHIVE_CRON_MAX_OBJECTS) {
      const pagina = await archivarFotos({
        adminSupabase,
        r2,
        bucketName: activacionesBucket,
        antesDe,
        limite: ARCHIVE_PAGE_SIZE,
        concurrencia: ARCHIVE_CONCURRENCY,
        deadline,
        onItem: ({ candidato, estado, motivo }) => {
          if (estado === 'fallida') console.error('[archivar-fotos] fallida', candidato.name, motivo)
        },
      })
      for (const key of Object.keys(total)) total[key] += pagina[key]
      if (!pagina.movidas) break
    }
    console.log('[archivar-fotos]', JSON.stringify(total))
    res.json({ ok: total.fallidas === 0, ...total })
  }))

  function withAccessFlag(users) {
    return (users ?? []).map(({ auth_user_id, ...rest }) => ({ ...rest, tiene_acceso: auth_user_id != null }))
  }

  app.use('/portal', authenticate)
  app.get('/portal/me', asyncRoute(async (req, res) => {
    const profile = { ...req.user }
    delete profile.auth_user_id
    res.json({ profile })
  }))
  app.get('/portal/plazas', asyncRoute(async (_req, res) => {
    const { data, error } = await adminSupabase.from('plazas').select('id,nombre').eq('activa', true).order('nombre')
    if (error) {
      if (isMissingOrganizationSchema(error)) { res.json({ plazas: [] }); return }
      jsonError(res, 500, 'No se pudo obtener las plazas.', error.message)
      return
    }
    res.json({ plazas: data ?? [] })
  }))
  app.get('/portal/municipios', asyncRoute(async (_req, res) => {
    const municipios = await cargarMunicipios(adminSupabase)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.json({ municipios })
  }))
  app.get('/portal/users', asyncRoute(async (req, res) => {
    let query = adminSupabase.from('activadores').select('*').order('nombre')
    const { alcance, error: alcanceError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (alcanceError) { jsonError(res, 500, 'No se pudo resolver el alcance del lider.', alcanceError.message); return }
    if (alcance) query = query.in('usuario_id', alcance.userIds)
    if (!req.user.isAdmin && req.user.rol === 'banco') query = query.eq('rol', 'activador')
    const { data, error } = await query
    if (error) { jsonError(res, 500, 'No se pudo obtener usuarios.', error.message); return }
    const users = data ?? []
    const leaderIds = [...new Set(users.map((item) => item.lider_id).filter(Boolean))]
    let leaderNames = new Map()
    if (leaderIds.length) {
      const { data: leaders, error: leadersError } = await adminSupabase
        .from('activadores')
        .select('usuario_id,nombre')
        .in('usuario_id', leaderIds)
      if (leadersError) { jsonError(res, 500, 'No se pudo resolver los lideres.', leadersError.message); return }
      leaderNames = new Map((leaders ?? []).map((leader) => [leader.usuario_id, leader.nombre]))
    }
    const resolvedUsers = users.map((item) => ({ ...item, lider_nombre: leaderNames.get(item.lider_id) ?? null }))
    res.json({ users: withAccessFlag(await attachUserRoles(await enrichUsersWithOrganization(resolvedUsers))) })
  }))
  const obtenerCiudades = crearCatalogoCiudades(adminSupabase)
  app.get('/portal/activations/page', asyncRoute(async (req, res) => {
    const filtros = normalizarFiltros(req.query)
    const { page, pageSize } = parsearPagina(req.query)
    const { alcance, error: teamError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (teamError) { jsonError(res, 500, 'No se pudo resolver el equipo.', teamError.message); return }
    const ciudades = await resolverCiudadesFiltro(obtenerCiudades, filtros)
    const construir = (select, options) => {
      let query = adminSupabase.from('activaciones').select(select, options)
      query = aplicarFiltrosActivaciones(query, filtros, ciudades)
      return query && alcance ? aplicarAlcanceLider(query, alcance) : query
    }
    const base = construir(SELECT_LISTADO_ACTIVACIONES, { count: 'exact' })
    if (!base) { res.json({ activations: [], total: 0, page, pageSize }); return }
    const from = (page - 1) * pageSize
    const { data, count, error } = await base
      .order('fecha_activacion', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error?.code === 'PGRST103') {
      const { count: total } = await construir('id', { count: 'exact', head: true })
      res.json({ activations: [], total: total ?? 0, page, pageSize })
      return
    }
    if (error) { jsonError(res, 500, 'No se pudo obtener activaciones.', error.message); return }
    res.json({ activations: data ?? [], total: count ?? 0, page, pageSize })
  }))

  app.get('/portal/metrics/activations', asyncRoute(async (req, res) => {
    const { alcance, error: teamError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (teamError) { jsonError(res, 500, 'No se pudo resolver el equipo.', teamError.message); return }
    const construirConsulta = (select, options) => {
      const query = adminSupabase.from('activaciones').select(select, options)
      return alcance ? aplicarAlcanceLider(query, alcance) : query
    }
    let activations
    try {
      activations = await cargarActivacionesMetricas({ construirConsulta, pageSize: metricsPageSize })
    } catch (error) {
      jsonError(res, 500, 'No se pudo obtener activaciones.', error?.message)
      return
    }
    sinCache(res)
    res.json({ activations, generatedAt: new Date().toISOString() })
  }))

  app.get('/portal/metrics/eventos', asyncRoute(async (req, res) => {
    const { alcance, error: teamError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (teamError) { jsonError(res, 500, 'No se pudo resolver el equipo.', teamError.message); return }
    let eventos
    try {
      eventos = await cargarEventosMetricas(adminSupabase, alcance)
    } catch (error) {
      jsonError(res, 500, 'No se pudo obtener los eventos.', error?.message)
      return
    }
    sinCache(res)
    res.json({ eventos })
  }))

  app.get('/portal/activations/export-rows', asyncRoute(async (req, res) => {
    const { alcance, error: teamError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (teamError) { jsonError(res, 500, 'No se pudo resolver el equipo.', teamError.message); return }
    const rows = await fetchActivaciones(adminSupabase, normalizarFiltros(req.query), alcance)
    const conCorreo = await attachActivationCreatorEmail(adminSupabase, rows)
    sinCache(res)
    res.json({
      activations: conCorreo.map((row) => ({
        ...row,
        foto_url_evidencia: buildEvidenceLinkPath(env.EVIDENCE_LINK_SECRET, row, 'principal', activacionesBucket),
        foto_cash_in_evidencia: buildEvidenceLinkPath(env.EVIDENCE_LINK_SECRET, row, 'cash-in', activacionesBucket),
      })),
    })
  }))

  app.get('/portal/activations/:id', asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? '')
    if (!esUuid(id)) { jsonError(res, 400, 'Identificador de activacion invalido.'); return }
    const { alcance, error: teamError } = await resolverAlcanceLider(adminSupabase, req.user)
    if (teamError) { jsonError(res, 500, 'No se pudo resolver el equipo.', teamError.message); return }
    let query = adminSupabase.from('activaciones').select('*').eq('id', id)
    if (alcance) query = aplicarAlcanceLider(query, alcance)
    if (!query) { jsonError(res, 404, 'Activacion no encontrada.'); return }
    const { data, error } = await query.maybeSingle()
    if (error) { jsonError(res, 500, 'No se pudo obtener la activacion.', error.message); return }
    if (!data) { jsonError(res, 404, 'Activacion no encontrada.'); return }
    try {
      const conCorreo = await attachActivationCreatorEmail(adminSupabase, [data])
      const [activation] = await attachActivationSignedPhotos(fotoStorage, activacionesBucket, conCorreo, env.EVIDENCE_LINK_SECRET)
      res.json({ activation })
    } catch (photoError) {
      jsonError(res, 500, 'No se pudo preparar enlaces seguros de evidencias.', photoError?.message)
    }
  }))

  app.use('/admin', authenticate, requireAdmin, createRateLimiter(ADMIN_RATE_LIMIT, (req) => req.user.usuario_id))

  app.get('/admin/healthz', (_req, res) => {
    res.json({ ok: true })
  })

  registrarRutasViajes(app, { adminSupabase, asyncRoute, jsonError })
  registrarRutasLugares(app, { adminSupabase, asyncRoute, jsonError })
  registrarRutasEventos(app, { adminSupabase, asyncRoute, jsonError })
  registrarRutasPlazaMunicipios(app, { adminSupabase, asyncRoute, jsonError, requireAdminReauthentication })

  app.get(
    '/admin/users',
    asyncRoute(async (_req, res) => {
      const { data, error } = await adminSupabase
        .from('activadores')
        .select('*')
        .order('nombre', { ascending: true })

      if (error) {
        jsonError(res, 500, error.message)
        return
      }

      res.json({ users: withAccessFlag(await attachUserRoles(await enrichUsersWithOrganization(data ?? []))) })
    })
  )

  app.post(
    '/admin/users',
    asyncRoute(async (req, res) => {
      const rawEmail = req.body?.email
      const rawPassword = req.body?.password
      const requestedTeamId = normalizeNullableText(req.body?.equipo_id)
      const requestedTeamIds = Array.isArray(req.body?.equipo_ids) ? req.body.equipo_ids : []
      const requestedBillerTeamIds = Array.isArray(req.body?.facturador_equipo_ids) ? req.body.facturador_equipo_ids : []
      let memberTeamIds = Array.isArray(req.body?.equipos_activador) ? req.body.equipos_activador : []
      const rawNombre = req.body?.nombre
      const rawPlaza = req.body?.plaza
      let roleSelection
      try { roleSelection = resolveUserRoles(req.body) }
      catch (error) { jsonError(res, 400, error.message); return }
      const { rol, roles } = roleSelection
      const esLider = roles.includes('lider')
      const esActivador = roles.includes('activador')
      const esFacturador = roles.includes('facturador')
      let liderId = esActivador ? normalizeNullableText(req.body?.lider_id) : null

      const email = normalizeEmail(rawEmail)
      const password = typeof rawPassword === 'string' ? rawPassword : ''
      const nombre = normalizeText(rawNombre)
      let plaza = normalizeNullableText(rawPlaza)
      let teamId = null
      let teamPlazaId = null

      if (esActivador) {
        const options = await loadOrganizationOptions()
        if (options.available && requestedTeamId) {
          const selectedTeam = options.equipos.find((team) => team.id === requestedTeamId && team.activo)
          const selectedPlaza = options.plazas.find((item) => item.id === selectedTeam?.plaza_id)
          if (!selectedTeam || !selectedPlaza) {
            jsonError(res, 400, 'El equipo seleccionado debe estar activo y tener una plaza valida.')
            return
          }
          teamId = selectedTeam.id
          teamPlazaId = selectedTeam.plaza_id
          liderId = selectedTeam.lider_actual_id ?? null
          plaza = selectedPlaza.nombre
        }
        if (options.available) {
          memberTeamIds = activeTeamIdsOrNull(options, memberTeamIds)
          if (!memberTeamIds) {
            jsonError(res, 400, 'Uno o mas equipos del activador no existen o estan inactivos.')
            return
          }
        }
      }
      if (esActivador && !teamId && req.body?.equipo_id === undefined) teamId = await resolveTeamIdForLeader(liderId, plaza)

      let leaderOrganizationAvailable = false
      if (esLider) {
        const options = await loadOrganizationOptions()
        leaderOrganizationAvailable = options.available
        if (options.available) {

          const selectedTeams = options.equipos.filter((team) => requestedTeamIds.includes(team.id))
          if (selectedTeams.length !== new Set(requestedTeamIds).size) {
            jsonError(res, 400, 'Uno o mas equipos seleccionados no existen o estan inactivos.')
            return
          }
        }
      }

      let billerOrganizationAvailable = false
      if (esFacturador) {
        const options = await loadOrganizationOptions()
        billerOrganizationAvailable = options.available
        if (options.available) {
          const selectedTeams = options.equipos.filter((team) => requestedBillerTeamIds.includes(team.id) && team.activo)
          if (selectedTeams.length !== new Set(requestedBillerTeamIds).size) {
            jsonError(res, 400, 'Uno o mas equipos facturados no existen o estan inactivos.')
            return
          }
        }
      }

      if (!email || !password || !nombre) {
        jsonError(res, 400, 'email, password y nombre son obligatorios.')
        return
      }

      if (!isValidEmail(email)) {
        jsonError(res, 400, 'email invalido.')
        return
      }

      if (!isStrongPassword(password)) {
        jsonError(res, 400, 'La contrasena debe tener al menos 10 caracteres, mayuscula, minuscula, numero y simbolo.')
        return
      }

      if (!ALLOWED_USER_ROLES.has(rol)) {
        jsonError(res, 400, 'rol invalido.')
        return
      }

      if (liderId) {
        const { data: leader, error: leaderErr } = await adminSupabase.from('activadores')
          .select('usuario_id').eq('usuario_id', liderId).eq('estado', 'activo').maybeSingle()
        const { data: leaderRole, error: leaderRoleErr } = await adminSupabase.from('activador_roles')
          .select('usuario_id').eq('usuario_id', liderId).eq('rol', 'lider').maybeSingle()
        if (leaderErr || !leader || leaderRoleErr || !leaderRole) {
          jsonError(res, 400, 'lider_id debe corresponder a un lider activo.', leaderErr?.message ?? leaderRoleErr?.message)
          return
        }
      }

      const { data: created, error: createErr } = await adminSupabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre, plaza },
      })

      if (createErr || !created?.user) {
        jsonError(res, 400, createErr?.message ?? 'No se pudo crear el usuario en Auth.')
        return
      }

      const insertedUser = {
        usuario_id: created.user.id,
        auth_user_id: created.user.id,
        email,
        nombre,
        plaza,
        rol,
        estado: 'activo',
        lider_id: liderId,
      }
      if (esActivador && !teamId) insertedUser.organizacion_pendiente = true
      if (teamId) {
        insertedUser.equipo_id = teamId
        insertedUser.plaza_base = plaza
        if (teamPlazaId) {
          insertedUser.plaza_id = teamPlazaId
          insertedUser.organizacion_pendiente = false
        }
      }

      const { error: insertErr } = await adminSupabase.from('activadores').insert(insertedUser)

      if (insertErr) {
        await adminSupabase.auth.admin.deleteUser(created.user.id)
        jsonError(
          res,
          500,
          'No se pudo guardar el usuario en activadores. Se revirtio la creacion en Auth automaticamente.',
          insertErr.message
        )
        return
      }

      try {
        await syncUserRoles(created.user.id, roles)
      } catch (error) {
        const cleanupErrors = []
        try {
          const { error: cleanupError } = await adminSupabase.from('activadores').delete().eq('usuario_id', created.user.id)
          if (cleanupError) cleanupErrors.push(cleanupError.message)
        } catch (cleanupError) { cleanupErrors.push(cleanupError.message) }
        try {
          const { error: cleanupError } = await adminSupabase.auth.admin.deleteUser(created.user.id)
          if (cleanupError) cleanupErrors.push(cleanupError.message)
        } catch (cleanupError) { cleanupErrors.push(cleanupError.message) }
        jsonError(res, 500, cleanupErrors.length ? 'No se pudieron asignar roles; revisar limpieza del usuario.' : 'No se pudieron asignar roles; se elimino el usuario creado.',
          [error.message, ...cleanupErrors].join('; '))
        return
      }

      if (esActivador && teamId) {
        try {
          await syncActivadorTeams(created.user.id, memberTeamIds)
        } catch (error) {
          await discardCreatedUser(created.user.id)
          jsonError(res, 409, 'No se pudieron asignar los equipos al activador.', error?.message)
          return
        }
      }

      if (esLider && leaderOrganizationAvailable) {
        try {
          await syncLeaderTeams(created.user.id, requestedTeamIds)
        } catch (error) {
          await discardCreatedUser(created.user.id)
          jsonError(res, 409, 'No se pudieron asignar los equipos al lider.', error?.message)
          return
        }
      }

      if (esFacturador && billerOrganizationAvailable) {
        try {
          await syncFacturadorTeams(created.user.id, nombre, requestedBillerTeamIds, true)
        } catch (error) {
          await discardCreatedUser(created.user.id)
          jsonError(res, 409, 'No se pudieron asignar los equipos al facturador.', error?.message)
          return
        }
      }

      res.status(201).json({ user: { ...insertedUser, roles } })
    })
  )

  app.post(
    '/admin/users/:userId/reset-password',
    asyncRoute(async (req, res) => {
      const userId = normalizeText(req.params?.userId)
      const password = typeof req.body?.password === 'string' ? req.body.password : ''

      if (!userId) {
        jsonError(res, 400, 'Parametro userId requerido.')
        return
      }
      if (!isStrongPassword(password)) {
        jsonError(res, 400, 'La contrasena debe tener al menos 10 caracteres, mayuscula, minuscula, numero y simbolo.')
        return
      }

      const { data: targetProfile, error: targetProfileError } = await adminSupabase.from('activadores')
        .select('usuario_id,auth_user_id').eq('usuario_id', userId).maybeSingle()
      if (targetProfileError || !targetProfile) {
        jsonError(res, 404, 'No se encontro el usuario solicitado.')
        return
      }
      if (!targetProfile.auth_user_id) {
        jsonError(res, 409, 'El perfil no tiene cuenta de acceso para restablecer.')
        return
      }

      const { data: existingAuthUser, error: getUserError } = await adminSupabase.auth.admin.getUserById(targetProfile.auth_user_id)
      if (getUserError || !existingAuthUser?.user) {
        jsonError(res, 404, 'No se encontro el usuario solicitado.')
        return
      }

      const { error: updatePasswordError } = await adminSupabase.auth.admin.updateUserById(targetProfile.auth_user_id, { password })
      if (updatePasswordError) {
        jsonError(res, 500, 'No se pudo restablecer la contrasena.')
        return
      }

      res.json({ ok: true })
    })
  )

  app.get(
    '/admin/organization-options',
    asyncRoute(async (_req, res) => {
      try {
        res.json(await loadOrganizationOptions())
      } catch (error) {
        jsonError(res, 500, 'No se pudo cargar la estructura organizacional.', error?.message)
      }
    })
  )

  app.get('/admin/teams', asyncRoute(async (_req, res) => {
    const options = await loadOrganizationOptions()
    if (!options.available) { res.json(options); return }
    const { data: members, error } = await adminSupabase.from('activador_equipo_historial')
      .select('activador_id,equipo_id').is('fin', null)
    if (error && !isMissingOrganizationSchema(error)) {
      jsonError(res, 500, 'No se pudo contar los integrantes.', error.message)
      return
    }
    const memberCount = new Map()
    for (const member of members ?? []) memberCount.set(member.equipo_id, (memberCount.get(member.equipo_id) ?? 0) + 1)
    res.json({ ...options, equipos: options.equipos.map((team) => ({ ...team, integrantes: memberCount.get(team.id) ?? 0 })) })
  }))

  app.get('/admin/teams/:teamId', asyncRoute(async (req, res) => {
    const teamId = normalizeText(req.params.teamId)
    const [{ data: memberships, error: membershipsError }, { data: history, error: historyError }] = await Promise.all([
      adminSupabase.from('activador_equipo_historial').select('activador_id').eq('equipo_id', teamId).is('fin', null),
      adminSupabase.from('equipo_lider_historial').select('id,lider_id,inicio,fin,motivo').eq('equipo_id', teamId).order('inicio', { ascending: false }),
    ])
    const memberIds = (memberships ?? []).map((item) => item.activador_id)
    const { data: members, error: membersError } = memberIds.length && !membershipsError
      ? await adminSupabase.from('activadores').select('usuario_id,nombre,email,estado,plaza,plaza_base').in('usuario_id', memberIds).order('nombre')
      : { data: [], error: null }
    const schemaError = membershipsError || membersError || historyError
    if (schemaError) {
      if (isMissingOrganizationSchema(schemaError)) {
        res.json({ available: false, message: 'El detalle de equipos estara disponible despues de habilitar el modelo organizacional.', integrantes: [], historial: [] })
        return
      }
      jsonError(res, 500, 'No se pudo cargar el detalle del equipo.', schemaError.message)
      return
    }
    res.json({ available: true, integrantes: members ?? [], historial: history ?? [] })
  }))

  app.post('/admin/teams', asyncRoute(async (req, res) => {
    const numero = Number(req.body?.numero)
    const nombre = normalizeText(req.body?.nombre) || INTERNAL_TEAM_NAME
    const plazaId = normalizeNullableText(req.body?.plaza_id)
    const liderId = normalizeNullableText(req.body?.lider_id)
    if (!Number.isSafeInteger(numero) || numero <= 0) {
      jsonError(res, 400, 'Número de equipo es obligatorio.')
      return
    }
    if (!plazaId) {
      jsonError(res, 400, 'Plaza es obligatoria.')
      return
    }
    const { data: duplicateTeam, error: duplicateError } = await adminSupabase.from('equipos')
      .select('id').eq('numero', numero).limit(1)
    if (duplicateError && isMissingOrganizationSchema(duplicateError)) {
      jsonError(res, 409, 'La gestion de equipos estara disponible cuando se habilite el modelo organizacional.')
      return
    }
    if (duplicateError) { jsonError(res, 500, 'No se pudo validar el numero de equipo.', duplicateError.message); return }
    if (duplicateTeam?.length) { jsonError(res, 409, 'Ya existe un equipo con ese numero.'); return }
    const { data: team, error } = await adminSupabase.from('equipos').insert({
      numero, nombre, plaza_id: plazaId, lider_actual_id: null, activo: true,
    }).select('*').single()
    if (error) {
      if (isMissingOrganizationSchema(error)) { jsonError(res, 409, 'La gestion de equipos estara disponible cuando se habilite el modelo organizacional.'); return }
      jsonError(res, 500, 'No se pudo crear el equipo.', error.message); return
    }
    if (liderId) {
      const { error: leaderError } = await adminSupabase.rpc('asignar_lider_equipo', { p_equipo_id: team.id, p_lider_id: liderId, p_motivo: 'Creacion administrativa de equipo' })
      if (leaderError) {
        await adminSupabase.from('equipos').delete().eq('id', team.id)
        jsonError(res, 409, 'No se pudo asignar el lider.', leaderError.message)
        return
      }
    }
    res.status(201).json({ team: { ...team, lider_actual_id: liderId } })
  }))

  app.patch('/admin/teams/:teamId', asyncRoute(async (req, res) => {
    const teamId = normalizeText(req.params.teamId)
    const numero = Number(req.body?.numero)
    const nombre = normalizeText(req.body?.nombre)
    const plazaId = normalizeNullableText(req.body?.plaza_id)
    const facturadorId = normalizeNullableText(req.body?.facturador_id)
    const liderId = normalizeNullableText(req.body?.lider_id)
    const activo = req.body?.activo
    if (!teamId || !Number.isSafeInteger(numero) || numero <= 0 || !nombre || typeof activo !== 'boolean') {
      jsonError(res, 400, 'Numero, nombre y estado son obligatorios.')
      return
    }
    const { data: duplicateTeam, error: duplicateError } = await adminSupabase.from('equipos')
      .select('id').eq('numero', numero).neq('id', teamId).limit(1)
    if (duplicateError && isMissingOrganizationSchema(duplicateError)) {
      jsonError(res, 409, 'La gestion de equipos estara disponible cuando se habilite el modelo organizacional.')
      return
    }
    if (duplicateError) { jsonError(res, 500, 'No se pudo validar el numero de equipo.', duplicateError.message); return }
    if (duplicateTeam?.length) { jsonError(res, 409, 'Ya existe un equipo con ese numero.'); return }
    const { error } = await adminSupabase.rpc('actualizar_equipo_organizacion', {
      p_equipo_id: teamId, p_numero: numero, p_nombre: nombre, p_plaza_id: plazaId,
      p_facturador_id: facturadorId, p_lider_id: liderId, p_activo: activo, p_inicio: new Date().toISOString(),
      p_motivo: 'Edicion administrativa de equipo',
    })
    if (error) {
      if (isMissingOrganizationSchema(error)) { jsonError(res, 409, 'La gestion de equipos estara disponible cuando se habilite el modelo organizacional.'); return }
      jsonError(res, error.code === '23P01' || error.code === '23505' ? 409 : 500, 'No se pudo actualizar el equipo.', error.message)
      return
    }
    res.json({ ok: true })
  }))

  app.delete('/admin/teams/:teamId', requireAdminReauthentication, asyncRoute(async (req, res) => {
    const teamId = normalizeText(req.params.teamId)
    if (!teamId) { jsonError(res, 400, 'Parametro teamId requerido.'); return }

    const { data: team, error: teamError } = await adminSupabase.from('equipos').select('*').eq('id', teamId).maybeSingle()
    if (teamError) { jsonError(res, 500, 'No se pudo leer el equipo.', teamError.message); return }
    if (!team) { jsonError(res, 404, 'Equipo no encontrado.'); return }

    const checks = await Promise.all([
      adminSupabase.from('activadores').select('usuario_id', { count: 'exact', head: true }).eq('equipo_id', teamId),
      adminSupabase.from('equipo_lider_historial').select('id', { count: 'exact', head: true }).eq('equipo_id', teamId),
    ])
    const failed = checks.find((item) => item.error)
    if (failed) { jsonError(res, 500, 'No se pudo verificar relaciones del equipo.', failed.error.message); return }
    if (checks.some((item) => (item.count ?? 0) > 0)) { res.status(409).json({ ok: false, deleted: false, message: 'No se puede eliminar el equipo porque tiene integrantes o historial relacionado. Debe deshabilitarse.' }); return }

    // Siempre realizar baja lógica: inactivar el equipo para preservar historial y relaciones
    const { error: deleteErr } = await adminSupabase.from('equipos').delete().eq('id', teamId)
    if (deleteErr) { jsonError(res, deleteErr.code === '23503' ? 409 : 500, deleteErr.code === '23503' ? 'No se puede eliminar el equipo porque tiene información relacionada. Debe deshabilitarse.' : 'No se pudo eliminar el equipo.', deleteErr.message); return }
    res.json({ ok: true, deleted: true, message: 'Equipo eliminado correctamente.' })
  }))

  // Plazas: listar, editar (activar/desactivar)
  app.get('/admin/plazas', asyncRoute(async (_req, res) => {
    const { data, error } = await adminSupabase.from('plazas').select('id,nombre,nombre_normalizado,activa').order('nombre')
    if (error) {
      if (isMissingOrganizationSchema(error)) { jsonError(res, 409, 'El modelo organizacional no esta habilitado.', error.message); return }
      jsonError(res, 500, 'No se pudo obtener las plazas.', error.message); return
    }
    res.json({ plazas: data ?? [] })
  }))

  app.patch('/admin/plazas/:plazaId', asyncRoute(async (req, res) => {
    const plazaId = normalizeText(req.params.plazaId)
    if (!plazaId) { jsonError(res, 400, 'Parametro plazaId requerido.'); return }
    const nombre = normalizeNullableText(req.body?.nombre)
    const activa = req.body?.activa
    const updates = {}
    if (nombre != null) updates.nombre = nombre
    if (typeof activa === 'boolean') updates.activa = activa
    if (Object.keys(updates).length === 0) { jsonError(res, 400, 'Nada que actualizar.'); return }
    if (updates.nombre) updates.nombre_normalizado = normalizeOrganizationName(updates.nombre)
    const { error } = await adminSupabase.from('plazas').update(updates).eq('id', plazaId)
    if (error) { jsonError(res, 500, 'No se pudo actualizar la plaza.', error.message); return }
    res.json({ ok: true })
  }))

  app.patch(
    '/admin/users/:userId',
    asyncRoute(async (req, res) => {
      const { userId } = req.params

      const rawNombre = req.body?.nombre
      const rawPlaza = req.body?.plaza
      const rawEmail = req.body?.email
      const rawEmailConfirm = req.body?.emailConfirm
      const requestedTeamId = normalizeNullableText(req.body?.equipo_id)
      const requestedTeamIds = Array.isArray(req.body?.equipo_ids) ? req.body.equipo_ids : []
      const requestedBillerTeamIds = Array.isArray(req.body?.facturador_equipo_ids) ? req.body.facturador_equipo_ids : []
      let memberTeamIds = Array.isArray(req.body?.equipos_activador) ? req.body.equipos_activador : null
      const requestedRol = normalizeText(req.body?.rol)

      const nombre = normalizeText(rawNombre)
      let plaza = normalizeNullableText(rawPlaza)
      const shouldUpdateEmail = typeof rawEmail === 'string'
      const email = shouldUpdateEmail ? normalizeEmail(rawEmail) : null
      const emailConfirm = rawEmailConfirm === true

      if (!nombre) {
        jsonError(res, 400, 'nombre es obligatorio.')
        return
      }

      if (shouldUpdateEmail && !email) {
        jsonError(res, 400, 'email es obligatorio cuando se desea actualizar.')
        return
      }

      if (shouldUpdateEmail && !isValidEmail(email)) {
        jsonError(res, 400, 'email invalido.')
        return
      }

      if (requestedRol && !ALLOWED_USER_ROLES.has(requestedRol)) {
        jsonError(res, 400, 'rol invalido.')
        return
      }

      const { data: previousRow, error: previousRowErr } = await adminSupabase
        .from('activadores')
        .select('*')
        .eq('usuario_id', userId)
        .maybeSingle()

      if (previousRowErr) {
        jsonError(res, 500, previousRowErr.message)
        return
      }

      if (!previousRow) {
        jsonError(res, 404, 'No se encontro el usuario en la tabla activadores.')
        return
      }

      const previousEmail = normalizeEmail(previousRow.email) || null
      const emailChanged = shouldUpdateEmail && email !== previousEmail
      const authIdForUpdate = previousRow.auth_user_id ?? null
      if (!authIdForUpdate && emailChanged) {
        jsonError(res, 409, 'El perfil no tiene cuenta de acceso para actualizar credenciales.')
        return
      }

      const { data: previousRoleRows, error: previousRolesError } = await adminSupabase
        .from('activador_roles').select('rol').eq('usuario_id', userId)
      if (previousRolesError) { jsonError(res, 500, previousRolesError.message); return }
      const previousRoles = (previousRoleRows ?? []).map((row) => row.rol)
      let roleSelection
      try { roleSelection = resolveUserRoles(req.body, previousRoles, previousRow.rol) }
      catch (error) { jsonError(res, 400, error.message); return }
      const { rol, roles } = roleSelection
      const esLider = roles.includes('lider')
      const esActivador = roles.includes('activador')
      const esFacturador = roles.includes('facturador')
      let liderId = esActivador
        ? (req.body?.lider_id === undefined ? previousRow.lider_id : normalizeNullableText(req.body.lider_id))
        : null
      let teamId = null
      let teamPlazaId = null
      if (esActivador) {
        const options = await loadOrganizationOptions()
        if (options.available && requestedTeamId) {
          const selectedTeam = options.equipos.find((team) => team.id === requestedTeamId && team.activo)
          const selectedPlaza = options.plazas.find((item) => item.id === selectedTeam?.plaza_id)
          if (!selectedTeam || !selectedPlaza) {
            jsonError(res, 400, 'El equipo seleccionado debe estar activo y tener una plaza valida.')
            return
          }
          teamId = selectedTeam.id
          teamPlazaId = selectedTeam.plaza_id
          liderId = selectedTeam.lider_actual_id ?? null
          plaza = selectedPlaza.nombre
        }
        if (options.available && memberTeamIds) {
          memberTeamIds = activeTeamIdsOrNull(options, memberTeamIds)
          if (!memberTeamIds) {
            jsonError(res, 409, 'Uno o mas equipos del activador no existen o estan inactivos.')
            return
          }
        }
      }

      if (liderId && !teamId) {
        const { data: leader, error: leaderErr } = await adminSupabase
          .from('activadores')
          .select('usuario_id')
          .eq('usuario_id', liderId)
          .eq('estado', 'activo')
          .maybeSingle()
        const { data: leaderRole, error: leaderRoleErr } = await adminSupabase.from('activador_roles')
          .select('usuario_id').eq('usuario_id', liderId).eq('rol', 'lider').maybeSingle()
        if (leaderErr || !leader || leaderRoleErr || !leaderRole) {
          jsonError(res, 400, 'lider_id debe corresponder a un lider activo.', leaderErr?.message ?? leaderRoleErr?.message)
          return
        }
      }

      let leaderOrganizationAvailable = false
      const shouldSyncLeaderTeams = esLider || (previousRoles.length ? previousRoles.includes('lider') : previousRow.rol === 'lider')
      if (shouldSyncLeaderTeams) {
        const options = await loadOrganizationOptions()
        leaderOrganizationAvailable = options.available
        if (options.available) {
          const effectiveTeamIds = esLider ? requestedTeamIds : []

          const selectedTeams = options.equipos.filter((team) => effectiveTeamIds.includes(team.id))
          if (selectedTeams.length !== new Set(effectiveTeamIds).size) {
            jsonError(res, 409, 'La asignacion de equipos del lider no es valida.')
            return
          }
        }
      }

      const hadFacturadorRole = previousRoles.length
        ? previousRoles.includes('facturador')
        : previousRow.rol === 'facturador'
      const shouldSyncBillerTeams = esFacturador || hadFacturadorRole
      let billerOrganizationAvailable = false
      if (shouldSyncBillerTeams) {
        const options = await loadOrganizationOptions()
        billerOrganizationAvailable = options.available
        if (options.available && esFacturador) {
          const selectedTeams = options.equipos.filter((team) => requestedBillerTeamIds.includes(team.id) && team.activo)
          if (selectedTeams.length !== new Set(requestedBillerTeamIds).size) {
            jsonError(res, 409, 'La asignacion de equipos del facturador no es valida.')
            return
          }
        }
      }

      const tableUpdatePayload = {
        nombre,
        plaza,
        rol,
        lider_id: liderId,
      }
      if (esActivador && !teamId && req.body?.equipo_id === undefined) teamId = await resolveTeamIdForLeader(liderId, plaza)
      if (teamId) {
        tableUpdatePayload.equipo_id = teamId
        tableUpdatePayload.plaza_base = plaza
        if (teamPlazaId) {
          tableUpdatePayload.plaza_id = teamPlazaId
          tableUpdatePayload.organizacion_pendiente = false
        }
      }
      if (esActivador && !teamId && req.body?.equipo_id === undefined && previousRow.equipo_id) {
        teamId = previousRow.equipo_id
      }
      if ((!esActivador || !teamId) && Object.prototype.hasOwnProperty.call(previousRow, 'equipo_id')) {
        tableUpdatePayload.equipo_id = null
        if (Object.prototype.hasOwnProperty.call(previousRow, 'plaza_id')) tableUpdatePayload.plaza_id = null
        if (Object.prototype.hasOwnProperty.call(previousRow, 'organizacion_pendiente')) tableUpdatePayload.organizacion_pendiente = esActivador
      }
      if (shouldUpdateEmail) {
        tableUpdatePayload.email = email
      }

      const { error: updateTableErr } = await adminSupabase
        .from('activadores')
        .update(tableUpdatePayload)
        .eq('usuario_id', userId)

      if (updateTableErr) {
        jsonError(res, 500, updateTableErr.message)
        return
      }

      async function rollbackUserUpdate() {
        const rollbackPayload = {
            nombre: previousRow.nombre,
            plaza: previousRow.plaza,
            email: previousRow.email ?? null,
            rol: previousRow.rol,
            estado: previousRow.estado,
            lider_id: previousRow.lider_id,
            inhabilitado_at: previousRow.inhabilitado_at,
            motivo_inhabilitacion: previousRow.motivo_inhabilitacion,
          }
        if (Object.prototype.hasOwnProperty.call(previousRow, 'equipo_id')) rollbackPayload.equipo_id = previousRow.equipo_id
        if (Object.prototype.hasOwnProperty.call(previousRow, 'plaza_base')) rollbackPayload.plaza_base = previousRow.plaza_base
        if (Object.prototype.hasOwnProperty.call(previousRow, 'plaza_id')) rollbackPayload.plaza_id = previousRow.plaza_id
        if (Object.prototype.hasOwnProperty.call(previousRow, 'organizacion_pendiente')) rollbackPayload.organizacion_pendiente = previousRow.organizacion_pendiente
        const errors = []
        try {
          const { error: rollbackError } = await adminSupabase
            .from('activadores').update(rollbackPayload).eq('usuario_id', userId)
          if (rollbackError) errors.push(rollbackError.message)
        } catch (error) { errors.push(error.message) }
        try { await syncUserRoles(userId, previousRoles) }
        catch (error) { errors.push(error.message) }
        return errors
      }

      try {
        await syncUserRoles(userId, roles)
      } catch (error) {
        let rollbackErrors
        try { rollbackErrors = await rollbackUserUpdate() }
        catch (rollbackError) { rollbackErrors = [rollbackError.message] }
        jsonError(res, 500, rollbackErrors.length ? 'No se pudieron sincronizar roles; rollback incompleto.' : 'No se pudieron sincronizar roles; cambios revertidos.',
          [error.message, ...rollbackErrors].join('; '))
        return
      }

      const authUpdatePayload = {
        user_metadata: { nombre, plaza },
      }

      if (emailConfirm) {
        authUpdatePayload.email_confirm = true
      }

      if (emailChanged) {
        authUpdatePayload.email = email
        if (!emailConfirm) {
          authUpdatePayload.email_confirm = true
        }
      }

      let updateAuthErr
      try {
        if (!authIdForUpdate) {
          updateAuthErr = null
        } else {
          const result = await adminSupabase.auth.admin.updateUserById(authIdForUpdate, authUpdatePayload)
          updateAuthErr = result.error
        }
      } catch (error) { updateAuthErr = error }

      if (updateAuthErr) {
        let rollbackErrors
        try { rollbackErrors = await rollbackUserUpdate() }
        catch (error) { rollbackErrors = [error.message] }

        jsonError(
          res,
          500,
          'No se pudo actualizar Auth. Se intento revertir el cambio en tabla para mantener consistencia.',
          [updateAuthErr.message, ...rollbackErrors].join('; ')
        )
        return
      }

      const hadActivadorRole = previousRoles.length ? previousRoles.includes('activador') : previousRow.rol === 'activador'
      if (esActivador ? memberTeamIds : hadActivadorRole) {
        try {
          await syncActivadorTeams(userId, esActivador && teamId ? memberTeamIds : [])
        } catch (error) {
          if (!isMissingOrganizationSchema(error)) {
            jsonError(res, 409, 'El usuario se actualizo, pero no se pudieron actualizar sus equipos de activador.', error?.message)
            return
          }
        }
      }

      if (shouldSyncLeaderTeams) {
        try {
          if (leaderOrganizationAvailable) {
            await syncLeaderTeams(userId, esLider ? requestedTeamIds : [])
          }
        } catch (error) {
          jsonError(res, 409, 'El usuario se actualizo, pero no se pudieron actualizar sus equipos.', error?.message)
          return
        }
      }

      if (shouldSyncBillerTeams && billerOrganizationAvailable) {
        try {
          await syncFacturadorTeams(userId, nombre, esFacturador ? requestedBillerTeamIds : [], esFacturador)
        } catch (error) {
          jsonError(res, 409, 'El usuario se actualizo, pero no se pudieron actualizar sus equipos facturados.', error?.message)
          return
        }
      }

      res.json({
        ok: true,
        rol,
        roles,
        emailUpdated: emailChanged,
      })
    })
  )

  app.patch(
    '/admin/users/:userId/status',
    asyncRoute(async (req, res) => {
      const { userId } = req.params
      const estado = normalizeText(req.body?.estado)
      const motivo = normalizeNullableText(req.body?.motivo_inhabilitacion)
      const habilitar = estado === 'activo'

      if (!ALLOWED_USER_STATES.has(estado)) {
        jsonError(res, 400, 'estado invalido.')
        return
      }
      if (!habilitar && !motivo) {
        jsonError(res, 400, 'El motivo de inhabilitacion es obligatorio.')
        return
      }

      const { data: perfil, error: perfilError } = await adminSupabase
        .from('activadores').select('usuario_id,auth_user_id,estado,equipo_id').eq('usuario_id', userId).maybeSingle()
      if (perfilError) { jsonError(res, 500, 'No se pudo leer el usuario.', perfilError.message); return }
      if (!perfil) { jsonError(res, 404, 'No se encontro el usuario en activadores.'); return }
      if (perfil.estado === estado) { jsonError(res, 409, habilitar ? 'El usuario ya esta activo.' : 'El usuario ya esta inhabilitado.'); return }
      if (!perfil.auth_user_id) { jsonError(res, 409, 'El usuario no tiene cuenta de acceso; no se puede cambiar su estado.'); return }

      const payload = {
        estado,
        inhabilitado_at: habilitar ? null : new Date().toISOString(),
        motivo_inhabilitacion: habilitar ? null : motivo,
      }
      if (habilitar && perfil.equipo_id) {
        const { data: equipo, error: equipoError } = await adminSupabase.from('equipos').select('activo').eq('id', perfil.equipo_id).maybeSingle()
        if (equipoError) { jsonError(res, 500, 'No se pudo verificar el equipo del usuario.', equipoError.message); return }
        if (!equipo?.activo) Object.assign(payload, { equipo_id: null, organizacion_pendiente: true })
      }
      if (!habilitar) {
        const relaciones = await Promise.all([
          adminSupabase.from('activadores').select('usuario_id', { count: 'exact', head: true }).eq('lider_id', userId).eq('estado', 'activo'),
          adminSupabase.from('equipos').select('id', { count: 'exact', head: true }).eq('lider_actual_id', userId).eq('activo', true),
        ])
        const fallida = relaciones.find((item) => item.error)
        if (fallida) { jsonError(res, 500, 'No se pudo verificar relaciones activas del usuario.', fallida.error.message); return }
        if (relaciones.some((item) => (item.count ?? 0) > 0)) {
          jsonError(res, 409, 'El usuario lidera equipos o activadores vigentes. Reasigne el liderazgo antes de inhabilitarlo.')
          return
        }
      }

      try { await cambiarAcceso(adminSupabase, perfil.auth_user_id, habilitar) }
      catch (error) { jsonError(res, 500, error.message); return }

      const { error } = await adminSupabase.from('activadores').update(payload).eq('usuario_id', userId)
      if (error) {
        try { await cambiarAcceso(adminSupabase, perfil.auth_user_id, !habilitar) }
        catch (rollbackError) { console.error('[admin-api] No se pudo revertir el acceso.', sanitizeLogDetails(rollbackError)) }
        jsonError(res, 500, 'No se pudo cambiar el estado del usuario.', error.message)
        return
      }
      res.json({ ok: true, ...payload })
    })
  )

  app.put(
    '/admin/activaciones/:activacionId/fotos/:tipo',
    parseActivationPhotoBody,
    asyncRoute(async (req, res) => {
      const activacionId = normalizeText(req.params?.activacionId)
      const tipo = normalizeText(req.params?.tipo).toLowerCase()
      const fieldByType = { principal: 'foto_url', 'cash-in': 'foto_cash_in' }
      const photoField = fieldByType[tipo]
      const mimeType = normalizeText(req.headers['content-type']).split(';')[0].toLowerCase()
      const extension = ACTIVATION_PHOTO_TYPES[mimeType]

      if (!activacionId) {
        jsonError(res, 400, 'Parametro activacionId requerido.')
        return
      }
      if (!photoField) {
        jsonError(res, 400, 'Tipo de foto invalido.')
        return
      }
      if (!extension || !isValidActivationPhotoBuffer(req.body, mimeType)) {
        jsonError(res, 415, 'La foto debe ser JPEG, PNG o WebP valido.')
        return
      }
      if (req.body.length > ACTIVATION_PHOTO_MAX_BYTES) {
        jsonError(res, 413, 'La foto excede el limite de 10 MB.')
        return
      }

      const { data: existingRow, error: existingError } = await adminSupabase
        .from('activaciones')
        .select('id,foto_url,foto_cash_in')
        .eq('id', activacionId)
        .maybeSingle()
      if (existingError) {
        jsonError(res, 500, 'No se pudo leer la activacion.', existingError)
        return
      }
      if (!existingRow?.id) {
        jsonError(res, 404, 'No se encontro la activacion indicada.')
        return
      }

      const newObjectPath = `portal-reemplazos/${photoField}/${crypto.randomUUID()}.${extension}`
      let newStoredValue
      try {
        newStoredValue = await fotoStorage.uploadNew(newObjectPath, req.body, mimeType)
      } catch (uploadError) {
        jsonError(res, 500, 'No se pudo guardar la nueva foto.', uploadError)
        return
      }

      const { data: updatedRow, error: updateError } = await adminSupabase
        .from('activaciones')
        .update({ [photoField]: newStoredValue })
        .eq('id', activacionId)
        .select('*')
        .maybeSingle()
      if (updateError || !updatedRow?.id) {
        try {
          await fotoStorage.remove([newStoredValue])
        } catch (cleanupError) {
          console.error('[admin-api] No se pudo limpiar una foto nueva sin referencia.', sanitizeLogDetails(cleanupError))
        }
        jsonError(res, updateError ? 500 : 404, updateError ? 'No se pudo actualizar la activacion.' : 'No se encontro la activacion indicada.', updateError)
        return
      }

      const previousStoredValue = existingRow[photoField]
      let warning = null
      if (previousStoredValue && previousStoredValue !== newStoredValue) {
        let removePreviousError = null
        try {
          await fotoStorage.remove([previousStoredValue])
        } catch (error) {
          removePreviousError = error
        }
        if (removePreviousError) {
          warning = 'La foto fue reemplazada, pero no se pudo eliminar el archivo anterior.'
          console.error('[admin-api] No se pudo eliminar una foto reemplazada.', sanitizeLogDetails(removePreviousError))
        }
      }

      let activation
      try {
        const signedRows = await attachActivationSignedPhotos(fotoStorage, activacionesBucket, [updatedRow])
        activation = signedRows[0]
      } catch (signedUrlError) {
        activation = {
          ...updatedRow,
          foto_url_signed: null,
          foto_cash_in_signed: null,
        }
        warning = [warning, 'La foto fue reemplazada, pero su enlace seguro no esta disponible temporalmente.']
          .filter(Boolean)
          .join(' ')
        console.error('[admin-api] No se pudo generar el enlace seguro de una foto reemplazada.', sanitizeLogDetails(signedUrlError))
      }

      res.json({ ok: true, activation, warning })
    })
  )

  app.patch(
    '/admin/activaciones/:activacionId',
    asyncRoute(async (req, res) => {
      const activacionId = normalizeText(req.params?.activacionId)
      const editReason = normalizeText(req.body?.motivoEdicion)
      const activationCategory = normalizeText(req.body?.categoriaActivacion)
      const changes = req.body?.changes
      const unexpectedBodyFields = Object.keys(req.body ?? {}).filter(
        (key) => !['changes', 'motivoEdicion', 'categoriaActivacion'].includes(key)
      )

      if (!activacionId) {
        jsonError(res, 400, 'Parametro activacionId requerido.')
        return
      }
      if (!editReason) {
        jsonError(res, 400, 'El motivo de edicion es obligatorio.')
        return
      }
      if (unexpectedBodyFields.length) {
        jsonError(res, 400, `Campos de solicitud no permitidos: ${unexpectedBodyFields.join(', ')}.`)
        return
      }
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        jsonError(res, 400, 'changes debe ser un objeto con los campos a modificar.')
        return
      }

      const changeKeys = Object.keys(changes)
      const forbiddenFields = changeKeys.filter((key) => !ACTIVATION_EDITABLE_FIELDS.has(key))
      if (forbiddenFields.length) {
        jsonError(res, 400, `Campos no permitidos: ${forbiddenFields.join(', ')}.`)
        return
      }
      if (!changeKeys.length) {
        jsonError(res, 400, 'No se enviaron cambios para guardar.')
        return
      }

      const updatePayload = {}
      for (const key of changeKeys) {
        if (['comercio_fuera_mercado', 'descargo_app', 'registro', 'cash_in',
          'cash_out', 'p2p', 'qr_fisico', 'respaldo', 'creditos', 'remesas', 'hubo_error'].includes(key)) {
          if (key === 'comercio_fuera_mercado' && changes[key] === null) {
            updatePayload[key] = null
          } else if (typeof changes[key] !== 'boolean') {
            jsonError(res, 400, `${key} debe ser booleano.`)
            return
          } else {
            updatePayload[key] = changes[key]
          }
        } else {
          updatePayload[key] = normalizeNullableText(changes[key])
        }
      }

      if (updatePayload.email_cliente && !isValidEmail(updatePayload.email_cliente)) {
        jsonError(res, 400, 'El correo del cliente no es valido.')
        return
      }
      if (updatePayload.telefono_cliente && !/^\+?[0-9\s()-]{6,20}$/.test(updatePayload.telefono_cliente)) {
        jsonError(res, 400, 'El telefono no tiene un formato valido.')
        return
      }
      if (updatePayload.tamano_tienda && !ALLOWED_STORE_SIZES.has(updatePayload.tamano_tienda)) {
        jsonError(res, 400, 'tamano_tienda debe ser Pequeña, Mediana o Grande.')
        return
      }
      const textLengthError = validateActivationTextLengths(updatePayload)
      if (textLengthError) {
        jsonError(res, 400, textLengthError)
        return
      }

      const { data: existingRow, error: existingErr } = await adminSupabase
        .from('activaciones')
        .select('*')
        .eq('id', activacionId)
        .maybeSingle()
      if (existingErr) {
        jsonError(res, 500, 'No se pudo leer la activacion.', existingErr.message)
        return
      }
      if (!existingRow?.id) {
        jsonError(res, 404, 'No se encontro la activacion indicada.')
        return
      }

      const classificationKeys = new Set([
        'tipo_activacion', 'tamano_tienda', 'tipo_tienda', 'tipo_comercio',
        'rubro_comercio', 'rubro_comercio_otro', 'comercio_fuera_mercado',
      ])
      if (changeKeys.some((key) => classificationKeys.has(key))) {
        const normalizedClassification = normalizeActivationClassification({
          ...existingRow,
          ...updatePayload,
          tipo_grupo: activationCategory,
        }, existingRow)
        const classificationError = validateActivationClassification(normalizedClassification, existingRow)
        if (classificationError) {
          jsonError(res, 400, classificationError)
          return
        }
        Object.assign(updatePayload, activationClassificationUpdate(normalizedClassification))
      }

      const eligibilityRow = {
        ...existingRow,
        ...updatePayload,
        tipo_grupo: activationCategory || existingRow.tipo_grupo,
      }
      if (updatePayload.creditos === true && !isCreditosEligible(eligibilityRow)) {
        jsonError(res, 400, 'Créditos no aplica al subtipo seleccionado.')
        return
      }
      if (updatePayload.remesas === true && !isRemesasEligible(eligibilityRow)) {
        jsonError(res, 400, 'Remesas no aplica al subtipo seleccionado.')
        return
      }

      const actualUpdatePayload = Object.fromEntries(
        Object.entries(updatePayload).filter(([key, value]) => {
          const previousValue = existingRow[key] === '' ? null : existingRow[key]
          return previousValue !== value
        })
      )
      const actualChangeKeys = Object.keys(actualUpdatePayload)
      if (!actualChangeKeys.length) {
        jsonError(res, 400, 'No hay cambios nuevos para guardar.')
        return
      }

      const mergedRow = { ...existingRow, ...actualUpdatePayload }
      if (normalizeText(mergedRow.rubro_comercio).toLowerCase() === 'otro' &&
        !normalizeText(mergedRow.rubro_comercio_otro)) {
        jsonError(res, 400, 'rubro_comercio_otro es obligatorio cuando el rubro es Otro.')
        return
      }
      if (mergedRow.hubo_error === true && !normalizeText(mergedRow.tipo_error)) {
        jsonError(res, 400, 'tipo_error es obligatorio cuando hubo_error es verdadero.')
        return
      }
      if (mergedRow.hubo_error === true && normalizeText(mergedRow.tipo_error) === 'Otro' &&
        !normalizeText(mergedRow.descripcion_error)) {
        jsonError(res, 400, 'descripcion_error es obligatoria cuando tipo_error es Otro.')
        return
      }

      const { data: updatedRow, error: updateErr } = await adminSupabase
        .from('activaciones')
        .update(actualUpdatePayload)
        .eq('id', activacionId)
        .select('*')
        .maybeSingle()
      if (updateErr) {
        jsonError(res, 500, 'No se pudo actualizar la activacion.', updateErr.message)
        return
      }
      if (!updatedRow?.id) {
        jsonError(res, 404, 'No se encontro la activacion al guardar los cambios.')
        return
      }

      console.info('[admin-api] Activacion editada', {
        activacionId,
        camposModificados: actualChangeKeys,
        fecha: new Date().toISOString(),
      })
      res.json({ activation: updatedRow })
    })
  )

  app.get('/admin/users/:userId/eliminable', asyncRoute(async (req, res) => {
    try { res.json({ eliminable: !(await tieneHistorial(adminSupabase, req.params.userId)) }) }
    catch (error) { jsonError(res, 500, error.message) }
  }))

  app.delete(
    '/admin/users/:userId',
    requireAdminReauthentication,
    asyncRoute(async (req, res) => {
      const { userId } = req.params

      const { data: perfil, error: perfilError } = await adminSupabase
        .from('activadores').select('usuario_id,auth_user_id,estado').eq('usuario_id', userId).maybeSingle()
      if (perfilError) { jsonError(res, 500, perfilError.message); return }
      if (!perfil) { jsonError(res, 404, 'No se encontro el usuario en activadores.'); return }
      if (perfil.estado !== 'inhabilitado') {
        jsonError(res, 409, 'El usuario esta activo. Debe inhabilitarse antes de eliminarlo.')
        return
      }

      let conHistorial
      try { conHistorial = await tieneHistorial(adminSupabase, userId) }
      catch (error) { jsonError(res, 500, error.message); return }
      if (conHistorial) {
        jsonError(res, 409, 'El usuario tiene historial (activaciones, equipos, viajes o eventos). Solo puede quedar inhabilitado.')
        return
      }

      const { error: historialError } = await adminSupabase.from('activador_equipo_historial').delete().eq('activador_id', userId)
      if (historialError) { jsonError(res, 500, 'No se pudo eliminar el usuario.', historialError.message); return }
      const { error: perfilDeleteError } = await adminSupabase.from('activadores').delete().eq('usuario_id', userId)
      if (perfilDeleteError) { jsonError(res, 500, 'No se pudo eliminar el usuario.', perfilDeleteError.message); return }

      if (perfil.auth_user_id) {
        const { error: authDeleteError } = await adminSupabase.auth.admin.deleteUser(perfil.auth_user_id)
        if (authDeleteError && !/user not found/i.test(authDeleteError.message ?? '')) {
          jsonError(res, 500, 'Se elimino el perfil, pero no la cuenta de acceso. Reintente o eliminela en Supabase Auth.', authDeleteError.message)
          return
        }
      }

      res.json({ ok: true, message: 'Usuario eliminado.' })
    })
  )

  app.get(
    '/admin/storage/summary',
    asyncRoute(async (_req, res) => {
      const leerJsonRespaldos = (key) => (r2Respaldos
        ? r2Respaldos.getJson(key).then((data) => ({ data }), (error) => ({ error }))
        : Promise.resolve({ data: null }))
      const [
        { count: activacionesCount, error: activacionesCountErr },
        { count: activacionesWithPhotoCount, error: activacionesWithPhotoCountErr },
        bucketUsageResult,
        usoR2Result,
        respaldoResult,
        { data: databaseSizeData, error: databaseSizeErr },
      ] = await Promise.all([
        adminSupabase.from('activaciones').select('id', { count: 'exact', head: true }),
        adminSupabase.from('activaciones').select('id', { count: 'exact', head: true }).not('foto_url', 'is', null).neq('foto_url', ''),
        calculateBucketUsageBytes(adminSupabase, activacionesBucket).then((data) => ({ data }), (error) => ({ error })),
        leerJsonRespaldos(R2_USO_KEY),
        leerJsonRespaldos(RESPALDO_ESTADO_KEY),
        adminSupabase.rpc('get_database_size_bytes'),
      ])

      if (activacionesCountErr) {
        jsonError(res, 500, 'No se pudo obtener conteo de activaciones.', activacionesCountErr.message)
        return
      }
      if (activacionesWithPhotoCountErr) {
        jsonError(res, 500, 'No se pudo obtener conteo de activaciones con foto.', activacionesWithPhotoCountErr.message)
        return
      }
      if (bucketUsageResult.error) {
        jsonError(
          res,
          500,
          'No se pudo calcular uso del bucket de fotos.',
          bucketUsageResult.error instanceof Error ? bucketUsageResult.error.message : undefined
        )
        return
      }
      const bucketUsage = bucketUsageResult.data

      const usoR2 = usoR2Result.data
      const r2Usage = usoR2?.fotos ?? null
      const respaldosBytes = usoR2?.respaldos?.totalBytes ?? null
      const r2UsageUnavailableReason = !r2 || !r2Respaldos
        ? 'R2 no esta configurado.'
        : usoR2Result.error
          ? (usoR2Result.error instanceof Error ? usoR2Result.error.message : 'No se pudo leer el uso de R2.')
          : usoR2 ? null : 'El uso se mide cada madrugada; aun no hay medicion.'
      const respaldo = respaldoResult.error
        ? { ok: false, error: respaldoResult.error instanceof Error ? respaldoResult.error.message : 'No se pudo leer el estado del respaldo.' }
        : respaldoResult.data

      let databaseSizeBytes = null
      let databaseSizeUnavailableReason = null

      if (databaseSizeErr) {
        databaseSizeUnavailableReason = databaseSizeErr.message
      } else if (typeof databaseSizeData === 'number') {
        databaseSizeBytes = databaseSizeData
      } else if (typeof databaseSizeData === 'string') {
        const parsedSize = Number(databaseSizeData)
        if (Number.isFinite(parsedSize) && parsedSize >= 0) {
          databaseSizeBytes = parsedSize
        }
      } else if (databaseSizeData && typeof databaseSizeData === 'object') {
        const candidate =
          databaseSizeData.get_database_size_bytes ??
          databaseSizeData.database_size_bytes ??
          databaseSizeData.size_bytes ??
          null
        const parsedSize = Number(candidate)
        if (Number.isFinite(parsedSize) && parsedSize >= 0) {
          databaseSizeBytes = parsedSize
        }
      }

      let estimatedDatabase = null
      let estimationUnavailableReason = null
      try {
        estimatedDatabase = await estimateDatabaseUsageFromActivaciones(adminSupabase, {
          activacionesCount: activacionesCount ?? 0,
          databaseLimitBytes,
        })
      } catch (error) {
        estimationUnavailableReason = error instanceof Error ? error.message : null
      }

      const storageRemainingBytes =
        storageLimitBytes == null ? null : Math.max(0, storageLimitBytes - bucketUsage.totalBytes)
      const storageUsagePercent =
        storageLimitBytes == null || storageLimitBytes <= 0
          ? null
          : Number(((bucketUsage.totalBytes / storageLimitBytes) * 100).toFixed(2))

      const effectiveDatabaseUsedBytes =
        databaseSizeBytes ?? estimatedDatabase?.estimated_database_used_bytes ?? null
      const databaseRemainingBytes =
        databaseLimitBytes == null || effectiveDatabaseUsedBytes == null
          ? null
          : Math.max(0, databaseLimitBytes - effectiveDatabaseUsedBytes)
      const databaseUsagePercent =
        databaseLimitBytes == null || databaseLimitBytes <= 0 || effectiveDatabaseUsedBytes == null
          ? null
          : Number(((effectiveDatabaseUsedBytes / databaseLimitBytes) * 100).toFixed(2))

      const perActivationDatabaseBytes =
        estimatedDatabase?.per_activation_estimated_bytes > 0
          ? estimatedDatabase.per_activation_estimated_bytes
          : Number(activacionesCount ?? 0) > 0 && effectiveDatabaseUsedBytes != null
            ? Math.max(1, Math.round(effectiveDatabaseUsedBytes / Number(activacionesCount ?? 0)))
            : null

      const combinedCapacityEstimation = estimateCombinedActivationCapacity({
        activacionesCount: activacionesCount ?? 0,
        activacionesWithPhotoCount: activacionesWithPhotoCount ?? 0,
        storageObjectsCount: bucketUsage.totalObjects + (r2Usage?.totalObjects ?? 0),
        storageUsedBytes: bucketUsage.totalBytes + (r2Usage?.totalBytes ?? 0),
        storageRemainingBytes: r2Usage ? Math.max(0, R2_FREE_PLAN_STORAGE_BYTES - r2Usage.totalBytes - (respaldosBytes ?? 0)) : storageRemainingBytes,
        databaseRemainingBytes,
        perActivationDatabaseBytes,
      })

      res.json({
        summary: {
          bucket: activacionesBucket,
          activaciones_count: activacionesCount ?? 0,
          activaciones_with_photo_count: activacionesWithPhotoCount ?? 0,
          storage_objects_count: bucketUsage.totalObjects,
          storage_used_bytes: bucketUsage.totalBytes,
          storage_limit_bytes: storageLimitBytes,
          storage_limit_source: storageLimitSource,
          storage_remaining_bytes: storageRemainingBytes,
          storage_usage_percent: storageUsagePercent,
          database_size_bytes: databaseSizeBytes,
          database_used_effective_bytes: effectiveDatabaseUsedBytes,
          database_limit_bytes: databaseLimitBytes,
          database_limit_source: databaseLimitSource,
          database_remaining_bytes: databaseRemainingBytes,
          database_usage_percent: databaseUsagePercent,
          database_size_source:
            databaseSizeBytes == null
              ? estimatedDatabase
                ? 'estimate:activaciones_avg_row'
                : null
              : 'rpc:get_database_size_bytes',
          database_size_unavailable_reason:
            databaseSizeBytes == null ? databaseSizeUnavailableReason : null,
          database_estimation: estimatedDatabase,
          database_estimation_unavailable_reason:
            estimatedDatabase == null ? estimationUnavailableReason : null,
          combined_capacity_estimation: combinedCapacityEstimation,
          plan_reference: SUPABASE_FREE_PLAN_REFERENCE,
          r2_bucket: r2?.bucket ?? null,
          r2_used_bytes: r2Usage?.totalBytes ?? null,
          r2_objects_count: r2Usage?.totalObjects ?? null,
          r2_limit_bytes: R2_FREE_PLAN_STORAGE_BYTES,
          r2_usage_percent: r2Usage ? Number(((r2Usage.totalBytes / R2_FREE_PLAN_STORAGE_BYTES) * 100).toFixed(2)) : null,
          r2_unavailable_reason: r2UsageUnavailableReason,
          r2_measured_at: usoR2?.medido ?? null,
          r2_backup_bytes: respaldosBytes,
          r2_uploads_enabled: r2UploadsEnabled,
          respaldo,
          archive_retention_days: archiveRetentionDays,
        },
      })
    })
  )

  app.delete(
    '/admin/activaciones/:activacionId',
    requireAdminReauthentication,
    asyncRoute(async (req, res) => {
      const activacionId = normalizeText(req.params?.activacionId)
      if (!activacionId) {
        jsonError(res, 400, 'Parametro activacionId requerido.')
        return
      }

      const { data: existingRow, error: existingRowErr } = await adminSupabase
        .from('activaciones')
        .select('id, foto_url, foto_cash_in')
        .eq('id', activacionId)
        .maybeSingle()

      if (existingRowErr) {
        jsonError(res, 500, 'No se pudo leer la activacion.', existingRowErr.message)
        return
      }

      if (!existingRow?.id) {
        jsonError(res, 404, 'No se encontro la activacion indicada.')
        return
      }

      const storedPhotoValues = [existingRow.foto_url, existingRow.foto_cash_in]
        .filter((value) => resolveStorageObjectPathFromFotoUrl(value, activacionesBucket))
      const storageObjectPaths = [...new Set(
        storedPhotoValues.map((value) => resolveStorageObjectPathFromFotoUrl(value, activacionesBucket))
      )]

      const { data: deletedRows, error: deleteActivationErr } = await adminSupabase
        .from('activaciones')
        .delete()
        .eq('id', activacionId)
        .select('id')

      if (deleteActivationErr) {
        jsonError(res, 500, 'No se pudo eliminar la activacion.', deleteActivationErr.message)
        return
      }

      const deletedActivation = Array.isArray(deletedRows) && deletedRows.length > 0
      if (!deletedActivation) {
        jsonError(res, 404, 'No se encontro la activacion indicada para eliminar.')
        return
      }

      const photoDelete = {
        attempted: storageObjectPaths.length > 0,
        ok: true,
        bucket: activacionesBucket,
        object_paths: storageObjectPaths,
        message: storageObjectPaths.length
          ? 'Fotos eliminadas correctamente.'
          : 'La activacion no tenia fotos asociadas.',
      }

      if (storageObjectPaths.length) {
        try {
          await fotoStorage.remove(storedPhotoValues)
        } catch (removePhotoErr) {
          photoDelete.ok = false
          photoDelete.message = removePhotoErr.message
        }
      }

      if (!photoDelete.ok) {
        res.json({
          ok: true,
          warning:
            'La activacion se elimino, pero no fue posible borrar la foto del almacenamiento.',
          deleted_activation: true,
          photoDelete,
        })
        return
      }

      res.json({
        ok: true,
        deleted_activation: true,
        photoDelete,
      })
    })
  )

  app.get(
    '/admin/notifications',
    asyncRoute(async (req, res) => {
      const limit = parseLimit(req.query?.limit, { fallback: 60, min: 1, max: 300 })

      let { data: notifications, error: notificationsErr } = await adminSupabase
        .from('notificaciones')
        .select('id, titulo, mensaje, alcance, usuario_objetivo_id, tipo_audiencia, rol_objetivo, destinatarios_total, creado_por, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (notificationsErr && isMissingOrganizationSchema(notificationsErr)) {
        const legacyResult = await adminSupabase.from('notificaciones')
          .select('id, titulo, mensaje, alcance, usuario_objetivo_id, creado_por, created_at')
          .order('created_at', { ascending: false }).limit(limit)
        notifications = legacyResult.data
        notificationsErr = legacyResult.error
      }

      if (notificationsErr) {
        jsonError(
          res,
          500,
          'No se pudo obtener historial de notificaciones.',
          notificationsErr.message
        )
        return
      }

      if (!notifications?.length) {
        res.json({ notifications: [] })
        return
      }

      const notificationIds = notifications.map((item) => item.id)
      const userTargetIds = [
        ...new Set(notifications.map((item) => item.usuario_objetivo_id).filter(Boolean)),
      ]

      const [{ data: recipientsRows, error: recipientsErr }, { data: usersRows, error: usersErr }] =
        await Promise.all([
          adminSupabase
            .from('notificaciones_destinatarios')
            .select('notificacion_id, leida_at')
            .in('notificacion_id', notificationIds),
          userTargetIds.length
            ? adminSupabase
                .from('activadores')
                .select('usuario_id, nombre, email')
                .in('usuario_id', userTargetIds)
            : Promise.resolve({ data: [], error: null }),
        ])

      if (recipientsErr) {
        jsonError(
          res,
          500,
          'No se pudo obtener estado de destinatarios.',
          recipientsErr.message
        )
        return
      }

      if (usersErr) {
        jsonError(
          res,
          500,
          'No se pudo obtener detalle de usuarios objetivo.',
          usersErr.message
        )
        return
      }

      const statsMap = {}
      for (const row of recipientsRows ?? []) {
        if (!statsMap[row.notificacion_id]) {
          statsMap[row.notificacion_id] = { total: 0, read: 0 }
        }
        statsMap[row.notificacion_id].total += 1
        if (row.leida_at) {
          statsMap[row.notificacion_id].read += 1
        }
      }

      const usersMap = Object.fromEntries(
        (usersRows ?? []).map((item) => [
          item.usuario_id,
          {
            usuario_id: item.usuario_id,
            nombre: item.nombre ?? null,
            email: item.email ?? null,
          },
        ])
      )

      const payload = notifications.map((item) => {
        const stats = statsMap[item.id] ?? { total: 0, read: 0 }
        return {
          id: item.id,
          titulo: item.titulo,
          mensaje: item.mensaje,
          alcance: item.alcance,
          tipo_audiencia: item.tipo_audiencia ?? (item.alcance === 'user' ? 'users' : 'all'),
          rol_objetivo: item.rol_objetivo ?? null,
          usuarioObjetivo: item.usuario_objetivo_id
            ? usersMap[item.usuario_objetivo_id] ?? {
                usuario_id: item.usuario_objetivo_id,
                nombre: null,
                email: null,
              }
            : null,
          creado_por: item.creado_por,
          created_at: item.created_at,
          destinatarios_total: item.destinatarios_total ?? stats.total,
          destinatarios_leidos: stats.read,
          destinatarios_pendientes: Math.max(0, stats.total - stats.read),
        }
      })

      res.json({ notifications: payload })
    })
  )

  app.post(
    '/admin/notifications',
    asyncRoute(async (req, res) => {
      const rawTitle = req.body?.titulo
      const rawMessage = req.body?.mensaje
      const rawScope = req.body?.alcance
      const rawTargetUserId = req.body?.usuarioObjetivoId
      const rawAudience = req.body?.tipoAudiencia
      const targetRole = normalizeText(req.body?.rolObjetivo)
      const requestedUserIds = Array.isArray(req.body?.usuarioObjetivoIds)
        ? req.body.usuarioObjetivoIds.map(normalizeText).filter(Boolean)
        : []

      const title = normalizeText(rawTitle)
      const message = normalizeText(rawMessage)
      const audience = ['all', 'role', 'users'].includes(rawAudience)
        ? rawAudience
        : rawScope === 'user' ? 'users' : rawScope === 'all' ? 'all' : ''
      const scope = audience === 'users' ? 'user' : 'all'
      const targetUserId = normalizeText(rawTargetUserId)
      const specificUserIds = [...new Set([...requestedUserIds, ...(targetUserId ? [targetUserId] : [])])]
      const createdBy = normalizeText(req.user.email) || 'admin'

      if (title.length < 3 || title.length > 120) {
        jsonError(res, 400, 'El titulo debe tener entre 3 y 120 caracteres.')
        return
      }

      if (message.length < 3 || message.length > 2000) {
        jsonError(res, 400, 'El mensaje debe tener entre 3 y 2000 caracteres.')
        return
      }

      if (!audience) {
        jsonError(res, 400, 'Tipo de audiencia invalido.')
        return
      }
      if (audience === 'role' && !['activador', 'lider', 'facturador'].includes(targetRole)) {
        jsonError(res, 400, 'rolObjetivo invalido.')
        return
      }
      if (audience === 'users' && (!specificUserIds.length || specificUserIds.length > 500)) {
        jsonError(res, 400, 'Selecciona entre 1 y 500 usuarios especificos.')
        return
      }

      let recipients = []

      if (audience === 'all' || audience === 'role') {
        let recipientsQuery = adminSupabase.from('activadores')
          .select('usuario_id, nombre, email, rol').eq('estado', 'activo').not('usuario_id', 'is', null)
        if (audience === 'role') recipientsQuery = recipientsQuery.eq('rol', targetRole)
        const { data, error } = await recipientsQuery

        if (error) {
          jsonError(res, 500, 'No se pudo obtener lista de destinatarios.', error.message)
          return
        }

        const dedupedRecipients = new Map()
        for (const item of data ?? []) {
          if (item?.usuario_id && !dedupedRecipients.has(item.usuario_id)) {
            dedupedRecipients.set(item.usuario_id, item)
          }
        }

        recipients = [...dedupedRecipients.values()]
      } else {
        const { data, error } = await adminSupabase
          .from('activadores')
          .select('usuario_id, nombre, email, rol')
          .in('usuario_id', specificUserIds)
          .eq('estado', 'activo')

        if (error) {
          jsonError(res, 500, 'No se pudo validar el usuario objetivo.', error.message)
          return
        }

        recipients = [...new Map((data ?? []).filter((item) => item?.usuario_id).map((item) => [item.usuario_id, item])).values()]
      }

      if (!recipients.length) {
        jsonError(res, 400, 'No hay destinatarios disponibles para este envio.')
        return
      }

      const notificationPayload = {
        titulo: title,
        mensaje: message,
        alcance: scope,
        usuario_objetivo_id: audience === 'users' && specificUserIds.length === 1 ? specificUserIds[0] : null,
        tipo_audiencia: audience,
        rol_objetivo: audience === 'role' ? targetRole : null,
        destinatarios_total: recipients.length,
        creado_por: createdBy,
      }

      let { data: insertedNotification, error: insertNotificationErr } = await adminSupabase
        .from('notificaciones')
        .insert(notificationPayload)
        .select('id, titulo, mensaje, alcance, usuario_objetivo_id, tipo_audiencia, rol_objetivo, destinatarios_total, creado_por, created_at')
        .single()

      if (insertNotificationErr && isMissingOrganizationSchema(insertNotificationErr)) {
        const legacyPayload = {
          titulo: title, mensaje: message, alcance: scope,
          usuario_objetivo_id: audience === 'users' && specificUserIds.length === 1 ? specificUserIds[0] : null,
          creado_por: createdBy,
        }
        const legacyInsert = await adminSupabase.from('notificaciones').insert(legacyPayload)
          .select('id, titulo, mensaje, alcance, usuario_objetivo_id, creado_por, created_at').single()
        insertedNotification = legacyInsert.data
        insertNotificationErr = legacyInsert.error
      }

      if (insertNotificationErr || !insertedNotification?.id) {
        jsonError(
          res,
          500,
          'No se pudo registrar la notificacion.',
          insertNotificationErr?.message
        )
        return
      }

      const recipientsPayload = recipients.map((item) => ({
        notificacion_id: insertedNotification.id,
        usuario_id: item.usuario_id,
      }))

      const { error: insertRecipientsErr } = await adminSupabase
        .from('notificaciones_destinatarios')
        .insert(recipientsPayload)

      if (insertRecipientsErr) {
        await adminSupabase
          .from('notificaciones')
          .delete()
          .eq('id', insertedNotification.id)

        jsonError(
          res,
          500,
          'No se pudo registrar destinatarios de la notificacion.',
          insertRecipientsErr.message
        )
        return
      }

      res.status(201).json({
        notification: {
          id: insertedNotification.id,
          titulo: insertedNotification.titulo,
          mensaje: insertedNotification.mensaje,
          alcance: insertedNotification.alcance,
          tipo_audiencia: audience,
          rol_objetivo: audience === 'role' ? targetRole : null,
          usuarioObjetivo:
            audience === 'users' && specificUserIds.length === 1
              ? {
                  usuario_id: specificUserIds[0],
                  nombre: recipients[0]?.nombre ?? null,
                  email: recipients[0]?.email ?? null,
                }
              : null,
          creado_por: insertedNotification.creado_por,
          created_at: insertedNotification.created_at,
          destinatarios_total: recipientsPayload.length,
          destinatarios_leidos: 0,
          destinatarios_pendientes: recipientsPayload.length,
        },
      })
    })
  )

  app.use((error, _req, res, _next) => {
    console.error('[admin-api] Error no controlado:', sanitizeLogDetails(error))

    if (res.headersSent) {
      return
    }

    jsonError(res, 500, 'Error interno del servidor.')
  })

  return app
}
