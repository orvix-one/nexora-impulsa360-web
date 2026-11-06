import assert from 'node:assert/strict'
import test from 'node:test'
import { calcularDashboard } from '../src/lib/metrics/agregados.js'
import { cargarDatosMetricas } from '../src/lib/metrics/carga.js'
import { dashboardCsv } from '../src/lib/metrics/exportCsv.js'
import { calendarioHoy } from '../src/lib/metrics/fechas.js'
import { construirOpciones, filtrosVacios } from '../src/lib/metrics/filtros.js'
import { crearContexto } from '../src/lib/metrics/identidad.js'
import { gruposTarjetas } from '../src/lib/metrics/tarjetas.js'
import { normalizarPlazaClave, SIN_CIUDAD_REGISTRADA } from '../src/lib/plazas.js'

const AHORA = new Date('2026-10-15T16:00:00Z')
const actual = '10000000-0000-0000-0000-000000000001'
const anterior = '10000000-0000-0000-0000-000000000002'
const activador = '20000000-0000-0000-0000-000000000001'
const otro = '20000000-0000-0000-0000-000000000002'
const users = [
  {
    usuario_id: activador,
    nombre: 'Persona de prueba',
    lider_id: actual,
    lider_nombre: 'Líder actual',
    rol: 'activador',
  },
]
const rows = Array.from({ length: 5 }, (_, i) => ({
  id: `30000000-0000-0000-0000-00000000000${i + 1}`,
  usuario_id: activador,
  impulsador: 'Persona de prueba',
  lider_id_registro: i < 4 ? anterior : actual,
  lider_nombre_registro: i < 4 ? 'Líder anterior' : 'Líder actual',
  fecha_activacion: `2026-10-0${i + 1}`,
  ciudad_activacion: 'la_paz',
  plaza: 'La Paz',
  tipo_activacion: 'comercio',
}))

function montar(activaciones = rows, usuarios = users) {
  const datos = structuredClone(activaciones)
  const ctx = crearContexto({
    activaciones: datos,
    usuarios: structuredClone(usuarios),
    plazas: [],
  })
  const filtros = filtrosVacios()
  const hoy = calendarioHoy(AHORA)
  const dashboard = () => calcularDashboard({ activaciones: datos, ctx, filtros, hoy })
  return {
    filtros,
    get dashboard() {
      return dashboard()
    },
    get opciones() {
      return construirOpciones(ctx)
    },
    get tarjetas() {
      return gruposTarjetas(dashboard(), hoy).flatMap((grupo) => grupo.tarjetas)
    },
    csv: async () => {
      const { rows: filas } = dashboard()
      return filas.length ? dashboardCsv(filas) : ''
    },
  }
}

async function assertCount(vm, expected) {
  assert.equal(vm.dashboard.kpis.total, expected)
  assert.equal(vm.dashboard.rows.length, expected)
  assert.equal(
    vm.dashboard.topActivadores.reduce((n, item) => n + item.value, 0),
    expected,
  )
  const csv = await vm.csv()
  assert.equal(csv ? csv.trim().split('\n').length - 1 : 0, expected)
}

test('el alcance del líder sigue lider_id_registro y conserva el corte por activador', async () => {
  const vm = montar()
  vm.filtros.activador = `uid:${activador}`
  await assertCount(vm, 5)
  assert.deepEqual(
    vm.dashboard.rows.map((r) => r.id),
    rows.map((r) => r.id),
  )
  assert.deepEqual(
    vm.dashboard.topLideres.map((l) => [l.key, l.value]),
    [
      [`lid:${anterior}`, 4],
      [`lid:${actual}`, 1],
    ],
  )
  assert.deepEqual(
    vm.opciones.lideres.map((l) => l.key),
    [`lid:${actual}`, `lid:${anterior}`],
  )
  assert.deepEqual(vm.dashboard.rows, rows) // snapshots intactos
  vm.filtros.lider = `lid:${actual}`
  await assertCount(vm, 1) // solo la activación registrada bajo el líder actual
  vm.filtros.lider = `lid:${anterior}`
  await assertCount(vm, 4) // las registradas bajo el líder anterior
})

test('mantiene filtros de fechas, plaza, tipo y activador sobre el mismo corte', async () => {
  const vm = montar()
  vm.filtros.lider = `lid:${anterior}`
  vm.filtros.activador = `uid:${activador}`
  vm.filtros.desde = '2026-10-02'
  vm.filtros.hasta = '2026-10-04'
  vm.filtros.plaza = 'pkey:lapaz'
  vm.filtros.tipo = 'comercio'
  await assertCount(vm, 3)
  for (const [clave, value] of [
    ['plaza', 'pkey:oruro'],
    ['tipo', 'otro'],
    ['activador', `uid:${otro}`],
  ]) {
    const original = vm.filtros[clave]
    vm.filtros[clave] = value
    await assertCount(vm, 0)
    vm.filtros[clave] = original
  }
})

test('no agrega registros desde el catálogo; conserva alcance global y UUID con nombres iguales', async () => {
  const catalog = [
    ...users,
    {
      usuario_id: otro,
      nombre: 'Persona de prueba',
      lider_id: anterior,
      lider_nombre: 'Otra líder',
      rol: 'activador',
    },
  ]
  const leader = montar(rows, catalog)
  await assertCount(leader, 5) // el catálogo nunca agrega activaciones
  const admin = montar(
    [...rows, { ...rows[0], id: '40000000-0000-0000-0000-000000000001', usuario_id: otro }],
    catalog,
  )
  await assertCount(admin, 6)
  assert.equal(admin.dashboard.topActivadores.length, 2)
  assert.equal(new Set(admin.dashboard.topActivadores.map((r) => r.key)).size, 2)
  admin.filtros.lider = `lid:${actual}`
  await assertCount(admin, 1) // solo la fila registrada bajo el líder actual
  admin.filtros.lider = `lid:${anterior}`
  await assertCount(admin, 5) // 4 del activador + 1 del otro, ambas bajo el anterior
  admin.filtros.lider = ''
  await assertCount(admin, 6)
})

test('ranking general incluye todo el catálogo sin excluir inhabilitados, deduplicados y con cero', async () => {
  const cero = '20000000-0000-0000-0000-000000000003'
  const multirrol = '20000000-0000-0000-0000-000000000004'
  const catalog = [
    { ...users[0], nombre: 'Zulma', estado: 'activo' },
    { ...users[0], usuario_id: cero, nombre: 'Ana', estado: 'activo' },
    { ...users[0], usuario_id: cero, nombre: 'Ana', estado: 'activo' },
    {
      ...users[0],
      usuario_id: multirrol,
      nombre: 'Berta',
      estado: 'activo',
      rol: 'lider',
      roles: ['lider', 'activador'],
    },
    { ...users[0], usuario_id: otro, nombre: 'Inactivo', estado: 'inactivo' },
    { ...users[0], usuario_id: 'solo-lider', nombre: 'Líder', estado: 'activo', rol: 'lider' },
    {
      ...users[0],
      usuario_id: 'solo-admin',
      nombre: 'Admin',
      estado: 'activo',
      rol: 'administrador',
    },
  ]
  const vm = montar(rows, catalog)
  assert.deepEqual(
    vm.dashboard.topActivadores.map((item) => [item.key, item.value]),
    [
      [`uid:${activador}`, 5],
      [`uid:${cero}`, 0],
      [`uid:${multirrol}`, 0],
      [`uid:${otro}`, 0],
    ],
  )
  assert.equal(vm.opciones.activadores.filter((item) => item.key === `uid:${cero}`).length, 1)
  vm.filtros.activador = `uid:${cero}`
  await assertCount(vm, 0)
  assert.deepEqual(
    vm.dashboard.topActivadores.map((item) => [item.label, item.value]),
    [['Ana', 0]],
  )
  vm.filtros.activador = ''
  vm.filtros.desde = '2027-01-01'
  vm.filtros.plaza = 'pkey:oruro'
  vm.filtros.tipo = 'otro'
  await assertCount(vm, 0)
  assert.deepEqual(
    vm.dashboard.topActivadores.map((item) => item.label),
    ['Ana', 'Berta', 'Inactivo (inhabilitado)', 'Zulma'],
  )
})

test('un fallo del catálogo no publica métricas de líder incompletas', async () => {
  const deps = {
    fetchActivaciones: async () => structuredClone(rows),
    solicitar: async () => {
      throw new Error('Catálogo no disponible')
    },
    registrarError: () => {},
  }
  await assert.rejects(cargarDatosMetricas(deps), /Catálogo no disponible/)
  const vm = montar([], [])
  await assertCount(vm, 0)
})

test('un fallo de plazas no impide cargar las métricas', async () => {
  const registrados = []
  const datos = await cargarDatosMetricas({
    fetchActivaciones: async () => structuredClone(rows),
    solicitar: async (path) => {
      if (path === '/portal/users') return { users: structuredClone(users) }
      throw new Error('Plazas no disponibles')
    },
    registrarError: (contexto) => registrados.push(contexto),
  })
  assert.equal(datos.activaciones.length, rows.length)
  assert.deepEqual(datos.plazas, [])
  assert.deepEqual(registrados, ['metricas.plazas'])
})

test('equipo combina integrantes autorizados con 0, 1 y varias activaciones sin cambiar totales', async () => {
  const equipo = '50000000-0000-0000-0000-000000000001'
  const otroEquipo = '50000000-0000-0000-0000-000000000002'
  const cero = '20000000-0000-0000-0000-000000000003'
  const catalog = [
    { ...users[0], equipo_id: equipo, nombre: 'Zulma' },
    { ...users[0], usuario_id: otro, equipo_id: equipo, nombre: 'Berta' },
    { ...users[0], usuario_id: cero, equipo_id: equipo, nombre: 'Ana' },
    { ...users[0], usuario_id: 'fuera', equipo_id: otroEquipo, nombre: 'Fuera' },
    { ...users[0], usuario_id: 'no-activador', equipo_id: equipo, rol: 'lider' },
  ]
  const records = [
    ...rows.slice(0, 3).map((r) => ({ ...r, equipo_id_registro: equipo })),
    { ...rows[3], usuario_id: otro, equipo_id_registro: equipo },
  ]
  const vm = montar(records, catalog)
  const baselineKpis = { ...vm.dashboard.kpis }
  const baselineRanking = structuredClone(vm.dashboard.topActivadores)
  const baselineCsv = await vm.csv()
  vm.filtros.equipo = `id:${equipo}`
  assert.deepEqual(
    vm.dashboard.topActivadores.map((r) => [r.key, r.value]),
    [
      [`uid:${activador}`, 3],
      [`uid:${otro}`, 1],
      [`uid:${cero}`, 0],
    ],
  )
  assert.deepEqual(vm.dashboard.kpis, baselineKpis)
  assert.equal(await vm.csv(), baselineCsv)
  assert.ok(vm.opciones.activadores.some((a) => a.key === `uid:${cero}`))
  vm.filtros.activador = `uid:${cero}`
  await assertCount(vm, 0)
  assert.equal(vm.dashboard.topActivadores.length, 1)
  vm.filtros.activador = 'uid:fuera'
  assert.equal(vm.dashboard.topActivadores.length, 0)
  vm.filtros.activador = ''
  vm.filtros.desde = '2027-01-01'
  await assertCount(vm, 0)
  assert.deepEqual(
    vm.dashboard.topActivadores.map((r) => r.label),
    ['Ana', 'Berta', 'Zulma'],
  )
  vm.filtros.desde = ''
  vm.filtros.lider = `lid:${anterior}`
  // Sin integrantes actuales del líder anterior, el ranking muestra a los
  // activadores cuyas filas sí quedan atribuidas a él (suma == total).
  assert.deepEqual(
    vm.dashboard.topActivadores.map((r) => [r.key, r.value]),
    [
      [`uid:${activador}`, 3],
      [`uid:${otro}`, 1],
    ],
  )
  vm.filtros.lider = ''
  vm.filtros.equipo = ''
  assert.deepEqual(vm.dashboard.topActivadores, baselineRanking)
  assert.deepEqual(vm.dashboard.kpis, baselineKpis)
  const restricted = montar(records, catalog.slice(0, 3))
  restricted.filtros.equipo = `id:${otroEquipo}`
  assert.equal(restricted.dashboard.topActivadores.length, 0)
  assert.ok(!restricted.opciones.equipos.some((e) => e.key === `id:${otroEquipo}`))

  // Equipo sin ninguna activación y homónimos.
  const emptyTeam = montar(
    [],
    Array.from({ length: 11 }, (_, i) => ({
      ...catalog[0],
      usuario_id: `60000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      nombre: 'Homónimo',
    })),
  )
  assert.ok(emptyTeam.opciones.equipos.some((e) => e.key === `id:${equipo}`))
  assert.equal(emptyTeam.dashboard.topActivadores.length, 11)
  emptyTeam.filtros.equipo = `id:${equipo}`
  await assertCount(emptyTeam, 0)
  assert.equal(emptyTeam.dashboard.topActivadores.length, 11)
})

test('reconoce Cliente antiguo como categoría sin alterar los tipos existentes', async () => {
  const clienteAntiguo = {
    ...rows[3],
    id: '90000000-0000-0000-0000-000000000001',
    tipo_activacion: 'cliente_antiguo',
    base_activacion: 'cliente_antiguo',
  }
  const data = [
    ...rows.slice(0, 3),
    clienteAntiguo,
    { ...rows[4], id: '90000000-0000-0000-0000-000000000002', tipo_activacion: 'transeunte' },
  ]
  const vm = montar(data)
  await assertCount(vm, 5)

  const clasificacion = Object.fromEntries(
    vm.dashboard.porClasificacion.map((i) => [i.label, i.value]),
  )
  assert.equal(clasificacion['Cliente antiguo'], 1)
  assert.equal(clasificacion.Comercio, 3)
  assert.equal(vm.dashboard.kpis.tiendas, 0)

  const tipos = Object.fromEntries(vm.dashboard.porTipo.map((i) => [i.label, i.value]))
  assert.deepEqual(tipos, { comercio: 3, 'Cliente antiguo': 1, transeunte: 1 })
  assert.ok(
    vm.opciones.tipos.some((t) => t.key === 'cliente_antiguo' && t.nombre === 'Cliente antiguo'),
  )

  vm.filtros.tipo = 'cliente_antiguo'
  await assertCount(vm, 1)
  vm.filtros.tipo = 'no-existe'
  await assertCount(vm, 0)
  vm.filtros.tipo = ''
  await assertCount(vm, 5)
})

test('la ciudad geográfica prevalece sobre la plaza organizacional en selector, filtro y gráfico Ciudades', async () => {
  const pidAlto = '70000000-0000-0000-0000-000000000001'
  const pidOruro = '70000000-0000-0000-0000-000000000002'
  const data = [
    // Activador de La Paz que activó en El Alto.
    {
      ...rows[0],
      id: 'a0000000-0000-0000-0000-000000000001',
      ciudad_activacion: 'el_alto',
      plaza_efectiva_id_registro: pidAlto,
      plaza_efectiva_registro: 'La Paz',
      plaza_base_registro: 'La Paz',
    },
    {
      ...rows[1],
      id: 'a0000000-0000-0000-0000-000000000002',
      ciudad_activacion: 'El Alto',
      plaza_efectiva_id_registro: pidAlto,
      plaza_efectiva_registro: 'el_alto',
      plaza: '',
    },
    // Activador de El Alto que activó en La Paz.
    {
      ...rows[2],
      id: 'a0000000-0000-0000-0000-000000000003',
      ciudad_activacion: 'la_paz',
      plaza_efectiva_id_registro: pidOruro,
      plaza_efectiva_registro: 'El Alto',
    },
    // Sin ciudad registrada: no se sustituye por la plaza del activador.
    {
      ...rows[3],
      id: 'a0000000-0000-0000-0000-000000000004',
      ciudad_activacion: null,
      plaza_efectiva_id_registro: pidAlto,
      plaza_efectiva_registro: 'La Paz',
      plaza: 'La Paz',
    },
    {
      ...rows[4],
      id: 'a0000000-0000-0000-0000-000000000005',
      ciudad_activacion: '   ',
      plaza_efectiva_id_registro: pidOruro,
      plaza_efectiva_registro: 'Oruro',
      plaza: '',
    },
  ]
  const vm = montar(data)
  await assertCount(vm, 5)

  const alto = vm.opciones.plazas.filter((p) => normalizarPlazaClave(p.nombre) === 'elalto')
  assert.equal(alto.length, 1, "'el_alto' y 'El Alto' son la misma ciudad")
  assert.equal(alto[0].key, 'pkey:elalto')
  assert.equal(alto[0].nombre, 'El Alto')

  const lapaz = vm.opciones.plazas.filter((p) => normalizarPlazaClave(p.nombre) === 'lapaz')
  assert.equal(lapaz.length, 1, 'la plaza organizacional El Alto no crea otra ciudad de La Paz')
  assert.equal(lapaz[0].key, 'pkey:lapaz')

  const sinCiudad = vm.opciones.plazas.find((p) => p.key === 'none')
  assert.equal(sinCiudad.nombre, SIN_CIUDAD_REGISTRADA)

  const barras = Object.fromEntries(vm.dashboard.porPlaza.map((i) => [i.key, i.value]))
  assert.equal(barras['pkey:elalto'], 2, 'las dos filas con ciudad El Alto se agrupan juntas')
  assert.equal(
    barras['pkey:lapaz'],
    1,
    'la fila con plaza organizacional El Alto cuenta como La Paz',
  )
  assert.equal(barras.none, 2, 'ciudad NULL o vacía agrupa en "Sin ciudad registrada"')

  vm.filtros.plaza = 'pkey:elalto'
  await assertCount(vm, 2)
  assert.ok((await vm.csv()).includes('El Alto'))
  vm.filtros.plaza = 'none'
  await assertCount(vm, 2)
  assert.ok((await vm.csv()).includes(SIN_CIUDAD_REGISTRADA))
  vm.filtros.plaza = ''
  await assertCount(vm, 5)
})

test('KPI Comercios cuenta solo registros con tipo_activacion comercio exacto', async () => {
  const data = [
    {
      ...rows[0],
      id: 'b0000000-0000-0000-0000-000000000001',
      tipo_activacion: 'comercio',
      nombre_comercio: 'Kiosko Sur',
    },
    { ...rows[1], id: 'b0000000-0000-0000-0000-000000000002', tipo_activacion: 'comercio' },
    {
      ...rows[2],
      id: 'b0000000-0000-0000-0000-000000000003',
      tipo_activacion: 'reactivacion_comercio',
      nombre_comercio: 'Minimarket Norte',
    },
    {
      ...rows[3],
      id: 'b0000000-0000-0000-0000-000000000004',
      tipo_activacion: 'transeunte',
      nombre_comercio: 'Puesto Central',
    },
    {
      ...rows[4],
      id: 'b0000000-0000-0000-0000-000000000005',
      tipo_activacion: 'Comercio',
      nombre_comercio: 'Tienda Mix',
    },
  ]
  const vm = montar(data)
  assert.equal(vm.dashboard.kpis.comercios, 3)

  const kpiComercios = vm.tarjetas.find((card) => card.key === 'comercios')
  assert.equal(kpiComercios.value, '3')
  assert.equal(kpiComercios.note, 'Registros con tipo comercio')

  vm.filtros.tipo = 'comercio'
  await assertCount(vm, 3)
  assert.equal(vm.dashboard.kpis.comercios, 3)
  vm.filtros.tipo = 'reactivacion_comercio'
  await assertCount(vm, 1)
  assert.equal(vm.dashboard.kpis.comercios, 0)
})

test('promedios diario y semanal usan días calendario del intervalo seleccionado', async () => {
  const vm = montar()
  vm.filtros.desde = '2026-10-02'
  vm.filtros.hasta = '2026-10-04'
  await assertCount(vm, 3)
  const { calendarioDiario, calendarioSemanal, diasPeriodo } = vm.dashboard.promedios
  assert.equal(diasPeriodo, 3) // 02, 03 y 04 inclusive
  assert.equal(calendarioDiario, 1) // 3 activaciones / 3 días
  assert.equal(calendarioSemanal, 3) // período < 7 días: sin extrapolar
  const diaria = vm.tarjetas.find((card) => card.key === 'promedio-diario')
  const semanal = vm.tarjetas.find((card) => card.key === 'promedio-semanal')
  assert.equal(diaria.value, '1,0')
  assert.equal(semanal.value, '3,0')
  assert.equal(diaria.note, 'Del 2/10 al 4/10')
})

test('promedios incluyen días sin activaciones en el denominador', async () => {
  const data = [
    { ...rows[0], id: 'c0000000-0000-0000-0000-000000000001', fecha_activacion: '2026-10-01' },
    { ...rows[1], id: 'c0000000-0000-0000-0000-000000000002', fecha_activacion: '2026-10-05' },
  ]
  const vm = montar(data)
  vm.filtros.desde = '2026-10-01'
  vm.filtros.hasta = '2026-10-05'
  await assertCount(vm, 2)
  const { calendarioDiario, calendarioSemanal, diasPeriodo } = vm.dashboard.promedios
  assert.equal(diasPeriodo, 5) // incluye el 02, 03 y 04 sin activaciones
  assert.equal(calendarioDiario, 0.4) // 2 / 5
  assert.equal(calendarioSemanal, 2) // período < 7 días: sin extrapolar
  assert.equal(vm.tarjetas.find((card) => card.key === 'promedio-diario').value, '0,4')
  assert.equal(vm.tarjetas.find((card) => card.key === 'promedio-semanal').value, '2,0')
})

test('promedios recalculan con filtros no de fecha sobre el mismo período', async () => {
  const vm = montar()
  vm.filtros.desde = '2026-10-01'
  vm.filtros.hasta = '2026-10-05'
  await assertCount(vm, 5)
  assert.equal(vm.dashboard.promedios.calendarioDiario, 1) // 5 / 5
  vm.filtros.plaza = 'pkey:oruro'
  await assertCount(vm, 0)
  assert.equal(vm.dashboard.promedios.calendarioDiario, 0) // protegido: 0 / 5
  assert.equal(vm.dashboard.promedios.calendarioSemanal, 0)
  vm.filtros.plaza = 'pkey:lapaz'
  await assertCount(vm, 5)
  assert.equal(vm.dashboard.promedios.calendarioDiario, 1)
  vm.filtros.tipo = 'no-existe'
  await assertCount(vm, 0)
  assert.equal(vm.dashboard.promedios.calendarioSemanal, 0)
})

test('promedios protegen período vacío, futuro y dataset vacío', async () => {
  const vm = montar()
  // Desde futuro: ninguna fila y ventana invertida -> 0 días -> 0 sin NaN.
  vm.filtros.desde = '2099-01-01'
  await assertCount(vm, 0)
  assert.equal(vm.dashboard.promedios.diasPeriodo, 0)
  assert.equal(vm.dashboard.promedios.calendarioDiario, 0)
  assert.equal(vm.dashboard.promedios.calendarioSemanal, 0)
  assert.equal(vm.tarjetas.find((card) => card.key === 'promedio-diario').value, '0,0')
  // Hasta futuro se recorta a hoy; sin fechas el período es el mes actual hasta hoy.
  vm.filtros.desde = ''
  vm.filtros.hasta = '2099-12-31'
  const conHastaFuturo = vm.dashboard.promedios
  const { todayKey: hoy } = calendarioHoy(AHORA)
  assert.equal(conHastaFuturo.periodoHasta, hoy)
  assert.ok(conHastaFuturo.diasPeriodo > 0)
  // Dataset vacío con período válido -> 0.
  const vacio = montar([])
  assert.equal(vacio.dashboard.promedios.calendarioDiario, 0)
  assert.equal(vacio.dashboard.promedios.calendarioSemanal, 0)
})

test('sin fechas seleccionadas los promedios usan el mes actual hasta hoy', async () => {
  const vm = montar()
  const { todayKey: hoy, monthKey } = calendarioHoy(AHORA)
  const mesInicio = `${monthKey}-01`
  const { calendarioDiario, calendarioSemanal, diasPeriodo, periodoDesde, periodoHasta, total } = {
    ...vm.dashboard.promedios,
    total: vm.dashboard.kpis.enPeriodo,
  }
  assert.equal(periodoDesde, mesInicio)
  assert.equal(periodoHasta, hoy)
  const diasEsperados =
    Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${mesInicio}T12:00:00Z`)) / 86400000) +
    1
  assert.equal(diasPeriodo, diasEsperados)
  assert.equal(calendarioDiario, total / diasEsperados)
  assert.equal(calendarioSemanal, total / (Math.max(diasEsperados, 7) / 7))
})

test('sin fechas seleccionadas los promedios ignoran activaciones fuera del mes actual', async () => {
  const vm = montar([
    { ...rows[0], id: 'd0000000-0000-0000-0000-000000000001', fecha_activacion: '2020-01-15' },
  ])
  await assertCount(vm, 1)
  assert.equal(vm.dashboard.kpis.enPeriodo, 0)
  assert.equal(vm.dashboard.promedios.calendarioDiario, 0)
  assert.equal(vm.dashboard.promedios.calendarioSemanal, 0)
})

test('la tarjeta Cash-In se oculta pero conserva cash_in en datos y CSV', async () => {
  const data = rows.map((row, index) => ({ ...row, cash_in: index < 2 }))
  const vm = montar(data)
  assert.ok(!vm.tarjetas.some((card) => card.key === 'cash-in'))
  assert.equal(vm.dashboard.kpis.cashIn, 2)
  const csv = await vm.csv()
  const [header, ...lineas] = csv.trim().split('\n')
  assert.ok(header.includes('Cash-In'))
  assert.equal(lineas.filter((linea) => linea.includes(',"Si",')).length, 2)
})

test('Salidas cuenta días distintos con al menos una activación por activador', async () => {
  const data = [
    { ...rows[0], id: 'e0000000-0000-0000-0000-000000000001', fecha_activacion: '2026-10-01' },
    { ...rows[1], id: 'e0000000-0000-0000-0000-000000000002', fecha_activacion: '2026-10-01' },
    { ...rows[2], id: 'e0000000-0000-0000-0000-000000000003', fecha_activacion: '2026-10-03' },
    {
      ...rows[3],
      id: 'e0000000-0000-0000-0000-000000000004',
      usuario_id: otro,
      impulsador: 'Otra persona',
      fecha_activacion: '2026-10-03',
    },
    {
      ...rows[4],
      id: 'e0000000-0000-0000-0000-000000000005',
      fecha_activacion: null,
      created_at: '',
    },
  ]
  const vm = montar(data)
  const porActivador = Object.fromEntries(
    vm.dashboard.topActivadores.map((fila) => [fila.key, fila.salidas]),
  )
  assert.deepEqual(porActivador, { [`uid:${activador}`]: 2, [`uid:${otro}`]: 1 })
  vm.filtros.desde = '2026-10-02'
  const filtrado = Object.fromEntries(
    vm.dashboard.topActivadores.map((fila) => [fila.key, fila.salidas]),
  )
  assert.deepEqual(filtrado, { [`uid:${activador}`]: 1, [`uid:${otro}`]: 1 })
})

test('Comercios cuenta tienda de barrio y comercio con subtipo comercio o limbo', async () => {
  const combinaciones = [
    ['tienda_barrio', 'comercio', true],
    ['tienda_barrio', 'limbo', true],
    ['comercio', 'comercio', true],
    ['comercio', 'limbo', true],
    ['tienda_barrio', 'reactivacion', false],
    ['tienda_barrio', 'no_habilitado', false],
    ['comercio', 'reactivacion_comercio', false],
    ['transeunte', 'transeunte', false],
    ['cliente_antiguo', 'cliente_antiguo', false],
    ['transeunte', 'comercio', false],
    [null, 'comercio', false],
  ]
  const data = combinaciones.map(([base, tipo], i) => ({
    ...rows[0],
    id: `f0000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    base_activacion: base,
    tipo_activacion: tipo,
  }))
  const vm = montar(data)
  const [fila] = vm.dashboard.topActivadores
  assert.equal(fila.value, combinaciones.length)
  assert.equal(fila.comercios, combinaciones.filter(([, , cuenta]) => cuenta).length)
  vm.filtros.tipo = 'limbo'
  assert.equal(vm.dashboard.topActivadores[0].comercios, 2)
})
