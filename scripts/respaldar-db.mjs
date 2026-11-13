// Manual run of the nightly DB backup to R2.
import 'dotenv/config'
import { createR2BackupStorage } from '../server/r2.js'
import { abrirFuentePostgres, respaldarDb } from '../server/respaldoDb.js'

const dbUrl = process.env.DB_URL
const r2 = createR2BackupStorage(process.env)
if (!r2) throw new Error('R2 backups are not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)')

const estado = await respaldarDb({ abrirFuente: () => abrirFuentePostgres(dbUrl), r2 })
console.log(JSON.stringify(estado, null, 2))
process.exit(estado.ok ? 0 : 1)
