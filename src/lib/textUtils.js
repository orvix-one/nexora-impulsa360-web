const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function sinTildes(value) {
  return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function containsNormalized(value, query) {
  const normalizedQuery = sinTildes(query)
  if (!normalizedQuery) {
    return true
  }

  return sinTildes(value).includes(normalizedQuery)
}

export function normalizeEmail(value) {
  return normalizeText(value)
}

export function isValidEmail(value) {
  return EMAIL_REGEX.test(normalizeEmail(value))
}
