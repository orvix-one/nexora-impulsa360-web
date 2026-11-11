// @ts-check
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * @param {{ filename: string, content: BlobPart, mimeType: string }} archivo
 */
export function descargarArchivo({ filename, content, mimeType }) {
  const blob = new Blob([content], { type: mimeType })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
