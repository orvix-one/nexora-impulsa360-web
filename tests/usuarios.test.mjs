import test from 'node:test'
import assert from 'node:assert/strict'
import { ajustarRoles, fijarPrincipal, formularioDesdeUsuario, formularioVacio, marcarLider, participaEnEquipo, payloadUsuario, rolesConEquipos, sumarEquiposLiderados, validarContrasena, validarFormulario } from '../src/lib/usuarios.js'
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
  const form = { ...nuevo(), roles: ['facturador'], equipo_id: 'e1', equipos_activador: ['e1'], equipo_ids: ['e2'], facturador_equipo_ids: ['e3'] }
  ajustarRoles(form)
  assert.deepEqual([form.equipo_id, form.equipos_activador, form.equipo_ids, form.facturador_equipo_ids], ['', [], [], ['e3']])
})

test('el formulario de edicion toma los equipos que lidera el usuario', () => {
  const equipos = [{ id: 'e1', plaza_id: 'p1', lider_actual_id: 'u1' }, { id: 'e2', plaza_id: 'p2', lider_actual_id: 'u9' }]
  const form = formularioDesdeUsuario({ usuario_id: 'u1', roles: ['lider'], equipo_id: 'e2' }, equipos)
  assert.deepEqual(form.equipo_ids, ['e1'])
  assert.equal(form.plaza_id, 'p2')
  assert.equal(form.password, '')
})

test('un lider activa por defecto en los equipos que lidera', () => {
  const form = { ...nuevo(), roles: ['lider'] }
  marcarLider(form)
  assert.deepEqual(form.roles, ['lider', 'activador'])
  sumarEquiposLiderados(form, ['e1', 'e2'])
  assert.deepEqual([form.equipos_activador, form.equipo_id], [['e1', 'e2'], 'e1'])
  form.roles = ['lider']
  form.equipos_activador = []
  sumarEquiposLiderados(form, ['e3'])
  assert.deepEqual(form.equipos_activador, [], 'sin rol activador no se suman equipos')
})

test('el equipo principal siempre es uno de los equipos del activador', () => {
  const form = { ...nuevo(), equipo_id: 'e9', equipos_activador: ['e2', 'e3'] }
  fijarPrincipal(form)
  assert.equal(form.equipo_id, 'e2')
  form.equipos_activador = []
  fijarPrincipal(form)
  assert.equal(form.equipo_id, '')
})

test('el payload envia el principal y todos los equipos del activador', () => {
  const form = { ...nuevo(), equipo_id: 'e2', equipos_activador: ['e1', 'e2'] }
  const payload = payloadUsuario(form, { organizacionDisponible: true, esNuevo: false })
  assert.deepEqual([payload.equipo_id, payload.equipos_activador], ['e2', ['e1', 'e2']])
  assert.equal('puede_activar' in payload, false)
})

test('el formulario de edicion toma los equipos donde activa', () => {
  const usuario = { usuario_id: 'u1', roles: ['activador', 'lider'], equipo_id: 'e1', equipos: [
    { id: 'e1', numero: 1, roles: ['activador', 'lider'] },
    { id: 'e2', numero: 2, roles: ['lider'] },
  ] }
  assert.deepEqual(formularioDesdeUsuario(usuario, []).equipos_activador, ['e1'])
  assert.deepEqual(formularioDesdeUsuario({ usuario_id: 'u2', equipo_id: 'e5' }, []).equipos_activador, ['e5'])
})

test('agrupa los equipos por rol, con los roles globales primero', () => {
  const usuario = { roles: ['activador', 'lider', 'facturador', 'administrador'], equipos: [
    { id: 'a', numero: 2, principal: true, roles: ['activador', 'lider'] },
    { id: 'b', numero: 3, roles: ['lider'] },
    { id: 'c', numero: 4, roles: ['facturador'] },
  ] }
  const grupos = rolesConEquipos(usuario).map((g) => [g.rol, g.equipos?.map((e) => e.numero) ?? null])
  assert.deepEqual(grupos, [['administrador', null], ['lider', [2, 3]], ['activador', [2]], ['facturador', [4]]])
  assert.ok(participaEnEquipo(usuario, 'c'))
  assert.ok(!participaEnEquipo(usuario, 'z'))
  assert.deepEqual(rolesConEquipos({ roles: ['activador'], equipo_id: 'x', equipo_numero: 7 })[0].equipos.map((e) => e.numero), [7])
  assert.deepEqual(rolesConEquipos({ roles: ['activador'] })[0].equipos, [])
})

test('cuenta registros en singular y plural', () => {
  assert.equal(contarRegistros(1), '1 registro')
  assert.equal(contarRegistros(0), '0 registros')
})
