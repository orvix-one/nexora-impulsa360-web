// Manual run of the nightly DB backup and R2 usage snapshot.
import 'dotenv/config'
import { createR2BackupStorage, createR2Storage, registrarUsoR2 } from '../server/r2.js'
import { abrirFuentePostgres, respaldarDb } from '../server/respaldoDb.js'

const dbUrl = process.env.DB_URL
const r2 = createR2BackupStorage(process.env)
if (!r2) throw new Error('R2 backups are not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)')

const estado = await respaldarDb({ abrirFuente: () => abrirFuentePostgres(dbUrl), r2 })
const uso = await registrarUsoR2({ fotos: createR2Storage(process.env), respaldos: r2 })
console.log(JSON.stringify({ ...estado, uso }, null, 2))
process.exit(estado.ok ? 0 : 1)
