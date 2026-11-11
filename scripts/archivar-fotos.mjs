// Backfill/manual run of the Supabase -> R2 photo archive (same logic as the daily /cron/archivar-fotos job).
// Usage: node scripts/archivar-fotos.mjs [--dias 2] [--limit N] [--dry-run]
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { archivarFotos } from '../server/archivarFotos.js'
import { createR2Storage } from '../server/r2.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : Number(args[index + 1])
}
const dryRun = args.includes('--dry-run')
const dias = option('--dias', 2)
const limit = option('--limit', Infinity)
const bucketName = process.env.ADMIN_STORAGE_BUCKET_ACTIVACIONES || 'fotos-activaciones'
const PAGE_SIZE = 100

const adminSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const r2 = createR2Storage(process.env)
if (!r2) throw new Error('R2 is not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)')

const antesDe = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
console.log(`${dryRun ? '[dry-run] ' : ''}archiving photos created before ${antesDe.toISOString()} to R2 bucket ${r2.bucket}`)

const total = { candidatos: 0, movidas: 0, omitidas: 0, fallidas: 0, bytes: 0 }
let processed = 0
while (processed < limit) {
  const pagina = await archivarFotos({
    adminSupabase,
    r2,
    bucketName,
    antesDe,
    limite: dryRun ? Math.min(limit, 100000) : Math.min(PAGE_SIZE, limit - processed),
    dryRun,
    onItem: ({ candidato, estado, motivo }) => {
      processed += 1
      if (estado !== 'movida' && estado !== 'dry-run') console.log(`${estado} ${candidato.name} ${motivo ?? ''}`)
      if (processed % 100 === 0) console.log(`${processed} processed`)
    },
  })
  for (const key of Object.keys(total)) total[key] += pagina[key]
  if (dryRun || !pagina.movidas) break
}
console.log(`${dryRun ? 'would move' : 'moved'} ${(total.bytes / 1048576).toFixed(1)} MB`, JSON.stringify(total))
if (dryRun && total.candidatos === 1000) console.log('dry-run is capped at 1000 candidates by the PostgREST row limit')
process.exit(total.fallidas ? 1 : 0)
