const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '')

// Stored photo values with this prefix live in Cloudflare R2 under the same object path; anything else is Supabase Storage.
export const R2_STORED_PREFIX = 'r2:'

export const toR2StoredValue = (objectPath) => `${R2_STORED_PREFIX}${objectPath}`

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveSupabaseObjectPath(fotoUrl, bucketName) {
  const normalized = normalizeText(fotoUrl)
  if (!normalized) {
    return null
  }

  let path = normalized

  if (/^https?:\/\//i.test(path)) {
    try {
      const parsedUrl = new URL(path)
      path = parsedUrl.pathname ?? ''
    } catch {
      return null
    }
  }

  path = path.split('?')[0]?.split('#')[0] ?? ''
  path = path.replace(/^\/+/, '')

  if (!path) {
    return null
  }

  const publicPrefix = `storage/v1/object/public/${bucketName}/`
  const signPrefix = `storage/v1/object/sign/${bucketName}/`

  if (path.startsWith(publicPrefix)) {
    return decodeURIComponentSafe(path.slice(publicPrefix.length)).replace(/^\/+/, '')
  }

  if (path.startsWith(signPrefix)) {
    return decodeURIComponentSafe(path.slice(signPrefix.length)).replace(/^\/+/, '')
  }

  const genericPublicPrefix = 'storage/v1/object/public/'
  if (path.startsWith(genericPublicPrefix)) {
    const afterPrefix = path.slice(genericPublicPrefix.length)
    if (!afterPrefix.startsWith(`${bucketName}/`)) {
      return null
    }

    return decodeURIComponentSafe(afterPrefix.slice(bucketName.length + 1)).replace(/^\/+/, '')
  }

  const genericSignPrefix = 'storage/v1/object/sign/'
  if (path.startsWith(genericSignPrefix)) {
    const afterPrefix = path.slice(genericSignPrefix.length)
    if (!afterPrefix.startsWith(`${bucketName}/`)) {
      return null
    }

    return decodeURIComponentSafe(afterPrefix.slice(bucketName.length + 1)).replace(/^\/+/, '')
  }

  if (path.startsWith(`${bucketName}/`)) {
    return decodeURIComponentSafe(path.slice(bucketName.length + 1)).replace(/^\/+/, '')
  }

  return decodeURIComponentSafe(path).replace(/^\/+/, '')
}

export function resolveStorageLocation(fotoUrl, bucketName) {
  const normalized = normalizeText(fotoUrl)
  if (normalized.startsWith(R2_STORED_PREFIX)) {
    const objectPath = normalized.slice(R2_STORED_PREFIX.length).replace(/^\/+/, '')
    return objectPath ? { provider: 'r2', objectPath } : null
  }
  const objectPath = resolveSupabaseObjectPath(normalized, bucketName)
  return objectPath ? { provider: 'supabase', objectPath } : null
}

export function resolveStorageObjectPathFromFotoUrl(fotoUrl, bucketName) {
  return resolveStorageLocation(fotoUrl, bucketName)?.objectPath ?? null
}
