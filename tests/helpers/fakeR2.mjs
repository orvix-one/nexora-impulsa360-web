// In-memory stand-in for server/r2.js.
import crypto from 'node:crypto'

export function createFakeR2({ corruptHead = false } = {}) {
  const objects = new Map()
  const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex')
  return {
    bucket: 'r2-test',
    objects,
    signGet: async (key, ttl) => `https://r2.test/${key}?ttl=${ttl}`,
    signPut: async (key, { contentType, contentLength }, ttl) =>
      `https://r2.test/${key}?put=1&type=${encodeURIComponent(contentType)}&len=${contentLength}&ttl=${ttl}`,
    async put(key, body) {
      const bytes = Buffer.from(body)
      objects.set(key, bytes)
      return { etag: md5(bytes) }
    },
    async head(key) {
      const bytes = objects.get(key)
      if (!bytes) return null
      return { size: corruptHead ? bytes.length - 1 : bytes.length, etag: md5(bytes) }
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key)
    },
    async usage() {
      let totalBytes = 0
      for (const bytes of objects.values()) totalBytes += bytes.length
      return { totalBytes, totalObjects: objects.size }
    },
  }
}
