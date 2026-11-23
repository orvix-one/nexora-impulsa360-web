import test from 'node:test'
import assert from 'node:assert/strict'
import { cambiarAcceso, REFERENCIAS_HISTORIAL, tieneHistorial } from '../server/usuarios.js'

/** @param {Record<string, number>} conteos `tabla.columna` → filas */
function dbConConteos(conteos, error = null) {
  return {
    from: (tabla) => ({
      select: (columna) => ({
        eq: async () => (error ? { error } : { count: conteos[`${tabla}.${columna}`] ?? 0, error: null }),
      }),
    }),
  }
}

test('sin referencias no hay historial y la propia membresia de equipo no cuenta', async () => {
  assert.equal(await tieneHistorial(dbConConteos({ 'activador_equipo_historial.activador_id': 2 }), 'u1'), false)
  assert.equal(REFERENCIAS_HISTORIAL.some(([t, c]) => t === 'activador_equipo_historial' && c === 'activador_id'), false)
})

test('cualquier referencia registrada cuenta como historial', async () => {
  for (const [tabla, columna] of REFERENCIAS_HISTORIAL) {
    assert.equal(await tieneHistorial(dbConConteos({ [`${tabla}.${columna}`]: 1 }), 'u1'), true, `${tabla}.${columna}`)
  }
})

test('si una consulta falla no se asume que no hay historial', async () => {
  await assert.rejects(tieneHistorial(dbConConteos({}, { message: 'boom' }), 'u1'), /historial/)
})

test('inhabilitar bloquea el acceso indefinidamente y activar lo levanta', async () => {
  const llamadas = []
  const db = { auth: { admin: { updateUserById: async (id, attrs) => { llamadas.push([id, attrs.ban_duration]); return { error: null } } } } }
  await cambiarAcceso(db, 'a1', false)
  await cambiarAcceso(db, 'a1', true)
  assert.deepEqual(llamadas, [['a1', '876000h'], ['a1', 'none']])
})

test('un error de Auth se propaga', async () => {
  const db = { auth: { admin: { updateUserById: async () => ({ error: { message: 'x' } }) } } }
  await assert.rejects(cambiarAcceso(db, 'a1', false), /bloquear/)
})
