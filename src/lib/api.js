// @ts-check
/// <reference types="vite/client" />
// Single HTTP client for the portal API: base URL, Bearer token, JSON body and error shape.

export const API_BASE_URL = (import.meta.env.VITE_ADMIN_API_URL ?? '/api').replace(/\/$/, '')

let tokenSource = { current: () => null, refresh: async () => null }

/**
 * @param {{ current: () => string | null, refresh: () => Promise<string | null> }} source
 * `current` reads the session token synchronously; `refresh` waits for a fresh one after a 401.
 */
export function configureApi(source) {
  tokenSource = source
}

/** @param {string} path API path starting with `/`. */
export function apiUrl(path) {
  const root = /^https?:\/\//i.test(API_BASE_URL)
    ? API_BASE_URL
    : `${window.location.origin}${API_BASE_URL}`
  return `${root}${path.startsWith('/') ? '' : '/'}${path}`
}

/** @returns {Error & { status: number }} */
function httpError(message, status) {
  return Object.assign(new Error(message), { status })
}

async function readPayload(response) {
  try {
    return JSON.parse(await response.text())
  } catch {
    return null
  }
}

/** @param {string} path @param {RequestOptions} options @param {string} token */
function send(path, { method = 'GET', body, headers, signal, cache }, token) {
  const rawBody = typeof body === 'string' || body instanceof Blob ? body : undefined
  return fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    cache,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && rawBody === undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
}

/**
 * @typedef {object} RequestOptions
 * @property {string} [method]
 * @property {unknown} [body] Objects are sent as JSON; strings and Blobs as-is.
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal} [signal]
 * @property {RequestCache} [cache]
 */

/**
 * Calls the API with the current session token.
 * `token` overrides the session (used while the session is not yet published).
 * `raw: true` resolves with the Response instead of the parsed JSON.
 * @param {string} path
 * @param {RequestOptions & { token?: string, raw?: boolean }} [options]
 * @returns {Promise<any>}
 */
export async function apiRequest(path, { token, raw = false, ...options } = {}) {
  const sessionToken = token ?? tokenSource.current()
  if (!sessionToken) throw httpError('Sesion requerida.', 401)

  let response = await send(path, options, sessionToken)
  if (response.status === 401 && !token) {
    const refreshed = await tokenSource.refresh()
    if (refreshed && refreshed !== sessionToken) response = await send(path, options, refreshed)
  }

  if (!response.ok) {
    const payload = await readPayload(response)
    throw httpError(payload?.error || `Error HTTP ${response.status}`, response.status)
  }
  return raw ? response : readPayload(response)
}
