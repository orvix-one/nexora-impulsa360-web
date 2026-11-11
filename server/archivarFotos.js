// Moves referenced activation photos older than a cutoff from Supabase Storage to Cloudflare R2.
// Per object: copy, verify (size + md5 ETag), compare-and-swap the activaciones column to `r2:<path>`, then delete from Supabase.
import crypto from 'node:crypto'
import { toR2StoredValue } from './storagePaths.js'

async function archivarObjeto({ adminSupabase, r2, bucketName, candidato }) {
  const { name, size, activacion_id: activacionId, campo } = candidato
  const r2Value = toR2StoredValue(name)

  const { data: blob, error: downloadError } = await adminSupabase.storage.from(bucketName).download(name)
  if (downloadError) throw new Error(`descarga: ${downloadError.message}`)
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length !== Number(size)) throw new Error(`descarga incompleta: ${bytes.length} de ${size} bytes`)

  const md5 = crypto.createHash('md5').update(bytes).digest('hex')
  await r2.put(name, bytes, 'image/jpeg')
  const stored = await r2.head(name)
  if (!stored || stored.size !== bytes.length || stored.etag !== md5) {
    throw new Error('verificacion R2 fallida')
  }

  const { data: updated, error: updateError } = await adminSupabase.from('activaciones')
    .update({ [campo]: r2Value })
    .eq('id', activacionId)
    .eq(campo, name)
    .select('id')
  if (updateError) throw new Error(`actualizacion: ${updateError.message}`)

  if (!updated?.length) {
    const { data: current, error: readError } = await adminSupabase.from('activaciones')
      .select(campo).eq('id', activacionId).maybeSingle()
    if (readError) throw new Error(`relectura: ${readError.message}`)
    if (current?.[campo] !== r2Value) {
      await r2.remove([name])
      return { estado: 'omitida', motivo: 'la foto cambio durante el archivado' }
    }
  }

  const { error: removeError } = await adminSupabase.storage.from(bucketName).remove([name])
  if (removeError) throw new Error(`borrado supabase: ${removeError.message}`)
  return { estado: 'movida', bytes: bytes.length }
}

export async function archivarFotos({
  adminSupabase,
  r2,
  bucketName,
  antesDe,
  limite = 200,
  deadline = Infinity,
  dryRun = false,
  onItem = () => {},
}) {
  if (!r2) throw new Error('R2 no esta configurado.')
  const { data: candidatos, error } = await adminSupabase.rpc('listar_fotos_para_archivar', {
    p_bucket: bucketName,
    p_antes: antesDe.toISOString(),
    p_limite: limite,
  })
  if (error) throw new Error(`candidatos: ${error.message}`)

  const resumen = { candidatos: candidatos?.length ?? 0, movidas: 0, omitidas: 0, fallidas: 0, bytes: 0, pendientesPorTiempo: 0 }
  for (const candidato of candidatos ?? []) {
    if (Date.now() >= deadline) {
      resumen.pendientesPorTiempo += 1
      continue
    }
    if (dryRun) {
      resumen.bytes += Number(candidato.size)
      onItem({ candidato, estado: 'dry-run' })
      continue
    }
    try {
      const resultado = await archivarObjeto({ adminSupabase, r2, bucketName, candidato })
      if (resultado.estado === 'movida') {
        resumen.movidas += 1
        resumen.bytes += resultado.bytes
      } else {
        resumen.omitidas += 1
      }
      onItem({ candidato, ...resultado })
    } catch (itemError) {
      resumen.fallidas += 1
      onItem({ candidato, estado: 'fallida', motivo: itemError.message })
    }
  }
  return resumen
}
