// Cloudflare R2 client for activation photos; createR2Storage returns null when R2 is not configured.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const USAGE_CACHE_MS = 10 * 60 * 1000

export function resolveR2AccountId(rawValue) {
  return String(rawValue ?? '').match(/[0-9a-f]{32}/i)?.[0]?.toLowerCase() ?? null
}

export function createR2Storage(env) {
  const accountId = resolveR2AccountId(env.R2_ACCOUNT_ID)
  const bucket = String(env.R2_BUCKET ?? '').trim()
  if (!accountId || !bucket || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  })
  let usageCache = null

  return {
    bucket,

    signGet(key, expiresIn) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
    },

    signPut(key, { contentType, contentLength }, expiresIn) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
        { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) }
      )
    },

    async put(key, body, contentType) {
      const result = await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
      usageCache = null
      return { etag: String(result.ETag ?? '').replaceAll('"', '') }
    },

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return { size: Number(result.ContentLength ?? 0), etag: String(result.ETag ?? '').replaceAll('"', '') }
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404) return null
        throw error
      }
    },

    async remove(keys) {
      if (!keys.length) return
      const result = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }))
      usageCache = null
      if (result.Errors?.length) throw new Error(`R2 delete failed: ${result.Errors[0].Key} ${result.Errors[0].Message}`)
    },

    async usage() {
      if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_MS) return usageCache.value
      let totalBytes = 0
      let totalObjects = 0
      let ContinuationToken
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }))
        for (const item of page.Contents ?? []) {
          totalBytes += Number(item.Size ?? 0)
          totalObjects += 1
        }
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (ContinuationToken)
      usageCache = { at: Date.now(), value: { totalBytes, totalObjects } }
      return usageCache.value
    },
  }
}
