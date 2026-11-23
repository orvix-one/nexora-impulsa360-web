import test from 'node:test'
import assert from 'node:assert/strict'
import { ajustarRoles, equiposDelUsuario, formularioDesdeUsuario, formularioVacio, payloadUsuario, validarContrasena, validarFormulario } from '../src/lib/usuarios.js'
import { contarRegistros } from '../src/lib/textUtils.js'

const nuevo = () => ({ ...formularioVacio(), nombre: 'Ana', email: ' Ana@Mail.com ', password: 'Segura#2026x' })

test('exige contrasena fuerte solo al registrar', () => {
  assert.equal(validarFormulario(nuevo(), { esNuevo: true }), null)
  assert.match(validarFormulario({ ...nuevo(), password: 'debil' }, { esNuevo: true }), /contrasena/)
  assert.equal(validarFormulario({ ...nuevo(), password: '' }, { esNuevo: false }), null)
})

test('valida la nueva contrasena al cambiarla', () => {
  assert.equal(validarContrasena('Segura#2026x'), null)
  assert.match(validarContrasena(''), /Ingresa/)
  assert.match(validarContrasena('segura2026x'), /mayuscula/)
})

test('el payload lleva contrasena solo al registrar y normaliza el correo', () => {
  const opciones = { organizacionDisponible: true }
  assert.equal(payloadUsuario(nuevo(), { ...opciones, esNuevo: true }).password, 'Segura#2026x')
  const edicion = payloadUsuario(nuevo(), { ...opciones, esNuevo: false })
  assert.equal('password' in edicion, false)
  assert.equal(edicion.email, 'ana@mail.com')
  assert.equal(edicion.equipo_id, '')
})

test('al quitar un rol se limpian sus campos', () => {
  const form = { ...nuevo(), roles: ['facturador'], equipo_id: 'e1', equipo_ids: ['e2'], puede_activar: true, facturador_equipo_ids: ['e3'] }
  ajustarRoles(form)
  assert.deepEqual([form.equipo_id, form.equipo_ids, form.puede_activar, form.facturador_equipo_ids], ['', [], false, ['e3']])
})

test('el formulario de edicion toma los equipos que lidera el usuario', () => {
  const equipos = [{ id: 'e1', plaza_id: 'p1', lider_actual_id: 'u1' }, { id: 'e2', plaza_id: 'p2', lider_actual_id: 'u9' }]
  const form = formularioDesdeUsuario({ usuario_id: 'u1', roles: ['lider'], equipo_id: 'e2' }, equipos)
  assert.deepEqual(form.equipo_ids, ['e1'])
  assert.equal(form.plaza_id, 'p2')
  assert.equal(form.password, '')
})

test('lista los equipos liderados y facturados sin repetir', () => {
  assert.equal(equiposDelUsuario({ roles: ['activador'], equipo_numero: 4 }), '#4')
  assert.equal(equiposDelUsuario({ roles: ['activador'] }), 'Sin equipo')
  const usuario = { roles: ['lider', 'facturador'], equipos_asignados: [{ id: 'a', numero: 1 }], equipos_facturados: [{ id: 'a', numero: 1 }, { id: 'b', numero: 2 }] }
  assert.equal(equiposDelUsuario(usuario), '#1, #2')
})

test('cuenta registros en singular y plural', () => {
  assert.equal(contarRegistros(1), '1 registro')
  assert.equal(contarRegistros(0), '0 registros')
})
