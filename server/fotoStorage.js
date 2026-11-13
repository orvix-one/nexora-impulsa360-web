// Routes each stored photo value to Supabase Storage or Cloudflare R2.
import { resolveStorageLocation, toR2StoredValue } from './storagePaths.js'

const SUPABASE_SIGN_BATCH = 100

export function createFotoStorage({ adminSupabase, bucketName, r2 }) {
  function groupByProvider(values) {
    const groups = { supabase: [], r2: [] }
    for (const value of new Set(values.filter(Boolean))) {
      const location = resolveStorageLocation(value, bucketName)
      if (location) groups[location.provider].push({ value, objectPath: location.objectPath })
    }
    return groups
  }

  async function signMany(values, expiresIn) {
    const { supabase, r2: r2Entries } = groupByProvider(values)
    const signed = new Map()

    for (let index = 0; index < supabase.length; index += SUPABASE_SIGN_BATCH) {
      const batch = supabase.slice(index, index + SUPABASE_SIGN_BATCH)
      const { data, error } = await adminSupabase.storage
        .from(bucketName)
        .createSignedUrls(batch.map((entry) => entry.objectPath), expiresIn)
      if (error) throw error
      batch.forEach((entry, itemIndex) => {
        const signedUrl = data?.[itemIndex]?.signedUrl
        if (signedUrl) signed.set(entry.value, signedUrl)
      })
    }

    if (r2Entries.length && !r2) throw new Error('Hay fotos en R2 pero R2 no esta configurado.')
    for (const entry of r2Entries) {
      signed.set(entry.value, await r2.signGet(entry.objectPath, expiresIn))
    }
    return signed
  }

  async function remove(values) {
    const { supabase, r2: r2Entries } = groupByProvider(values)
    if (supabase.length) {
      const { error } = await adminSupabase.storage.from(bucketName).remove(supabase.map((entry) => entry.objectPath))
      if (error) throw error
    }
    if (r2Entries.length) {
      if (!r2) throw new Error('Hay fotos en R2 pero R2 no esta configurado.')
      await r2.remove(r2Entries.map((entry) => entry.objectPath))
    }
  }

  async function uploadNew(objectPath, body, contentType) {
    if (r2) {
      await r2.put(objectPath, body, contentType)
      return toR2StoredValue(objectPath)
    }
    const { error } = await adminSupabase.storage.from(bucketName).upload(objectPath, body, { contentType, upsert: false })
    if (error) throw error
    return objectPath
  }

  return { signMany, remove, uploadNew }
}
