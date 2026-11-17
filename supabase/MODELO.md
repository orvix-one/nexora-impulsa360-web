# Modelo de datos

Domain knowledge the schema and code do not state on their own. Columns, types and constraints live in `migrations/`; do not copy them here. When code and this file disagree, the code wins: fix this file.

## Glosario

- **Activación**: registro de un cliente final dado de alta (o reactivado) en la billetera por un activador. Fila de `activaciones`; el id lo genera la app, así el upsert offline es idempotente.
- **Categoría**: `comercio`, `tienda_barrio`, `transeunte`, `cliente_antiguo`. Agrupa los tipos de activación.
- **Tipo de activación**: subtipo dentro de la categoría (`comercio`, `reactivacion*`, `limbo`, `no_habilitado`, `reimpresion_qr`, `transeunte`, `cliente_antiguo`). `limbo` es compartido por Comercio y Tienda de Barrio; se distinguen por `base_activacion`.
- **Departamento > provincia > municipio**: división oficial (códigos INE: 2 + 2 + 2 dígitos, p.ej. `070101` Santa Cruz de la Sierra). Fuente: OCHA COD-AB (Ministerio de Desarrollo Rural y Tierras, 2024-09-16), 339 municipios. El código INE es la clave natural; `id` es interno.
- **Plaza**: concepto del Banco Ganadero, no una división oficial. El banco la define y puede cambiarla (hoy Santa Cruz, mañana Montero). Un activador tiene una plaza base.
- **Plaza temporal** (hoy): mezcla dos cosas distintas que se van a separar: **visita** (el activador viaja a otra plaza aprobada por el banco; puede dar viáticos al llegar a una meta) y **evento** (feria, mercado, universidad, campaña con puntos de activación).
- **Equipo / líder / facturador**: un activador pertenece a un equipo de una plaza; el equipo tiene un líder y un facturador. Todo cambia en el tiempo y se guarda en historiales (`activador_equipo_historial`, `equipo_lider_historial`).
- **Snapshot de organización**: al insertar una activación, `trg_snapshot_organizacion_activacion` copia equipo, líder, facturador y plaza vigentes en `created_at` a las columnas `*_registro`. Así los reportes históricos no cambian cuando la organización cambia. Solo el servidor las escribe.

## Núcleo vs. específico del cliente

El núcleo no menciona al banco. Lo propio del Ganadero (plazas, etiquetas del reporte, tipos de activación del banco) va con el prefijo `yolo_`. Aún no hay soporte para un segundo cliente; el objetivo es que agregarlo sea modificar un modelo limpio, no desenredar uno acoplado.

## Reglas de dominio

Cada regla cita su fuente en el código.

- **Reactivación**: un cliente solo puede reactivarse (o reimprimir QR) pasados 60 días desde su última activación, por CI o por los últimos 8 dígitos del teléfono. RPC `validar_elegibilidad_reactivacion`; cliente en `impulsa360-mobile/lib/elegibilidadReactivacion.js`. Se valida al guardar y de nuevo al sincronizar.
- **Productos Créditos/Remesas** por categoría y tipo: `impulsa360-mobile/lib/elegibilidadProductos.js`. Espejo web: `src/lib/activationEditing.js`; el servidor lo hace cumplir en el PATCH de `server/app.js`.
- **Fotos** (evidencia y Cash-In) por categoría y tipo: `impulsa360-mobile/lib/reglasFotografias.js`. Límite 6 MB / 12 MP.
- **Roles**: `administrador`, `lider`, `activador`, `facturador`, `banco`. Un usuario puede tener varios en `activador_roles`. Portal: `administrador`, `lider`, `banco`; el líder ve solo su alcance (`server/alcanceLider.js`); `banco` ve todo. Un líder solo usa el formulario si `activadores.puede_activar`.
- **Identidad**: `activadores.usuario_id = auth.uid()` para todo usuario móvil; RLS, RPC y rutas de Storage dependen de ello.
- **Plaza temporal**: `activador_plaza_temporal` guarda ventanas `[inicio, fin)` sin solaparse por activador; `tipo_zona` ∈ universidad, feria, evento, campana, punto_temporal. Plaza efectiva de una activación: la temporal vigente en `created_at`, si no, la base.
- **Fotos**: `foto_url` / `foto_cash_in` con prefijo `r2:` están en Cloudflare R2; sin prefijo, en el bucket privado de Supabase hasta que el cron nocturno las archive (`server/archivarFotos.js`). Acceso: dueño, administrador o líder del equipo vigente (`puede_leer_foto_activacion_equipo`).
- **Notificaciones**: se marcan leídas por `notificaciones_destinatarios.id`; marcar una ya leída cuenta como éxito.
- **Fechas**: todo `timestamptz` se guarda en UTC y se muestra en `America/La_Paz`. Para "hoy" en SQL usar `(now() at time zone 'America/La_Paz')::date`, nunca `created_at::date` (depende de la zona de la sesión). La app no envía `created_at`.

## Cómo saber qué usa la app o la web

No hay contrato escrito: se consulta el código.

- App, tablas, RPC y canales: `rg "\.from\(|\.rpc\(|\.channel\(" App.js components lib` en `impulsa360-mobile/`.
- App, columnas que escribe en `activaciones`: `CAMPOS_ACTIVACION_SUPABASE` en `impulsa360-mobile/lib/activationRecord.js` (más `usuario_id`, `impulsador`, `plaza`, `estado_sync` en `App.js`).
- Web: el navegador solo usa `supabase.auth`; todo lo demás pasa por `server/` con `service_role`. `rg "\.from\(|\.rpc\(" server`.
- Las versiones instaladas de la app siguen escribiendo columnas viejas: ver `EXPAND_CONTRACT.md` antes de borrar o renombrar algo.

## Grants

Los default privileges de `postgres` ya no dan acceso a `anon`/`authenticated`. Toda tabla, secuencia o función nueva declara sus grants en su migración. Los default privileges de `supabase_admin` no se pueden cambiar desde una migración.
