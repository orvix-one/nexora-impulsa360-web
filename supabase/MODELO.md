# Modelo de datos

Domain knowledge the schema and code do not state on their own. Columns, types and constraints live in `migrations/`; do not copy them here. When code and this file disagree, the code wins: fix this file.

## Glosario

- **Activación**: registro de un cliente final dado de alta (o reactivado) en la billetera por un activador. Fila de `activaciones`; el id lo genera la app, así el upsert offline es idempotente.
- **Categoría**: `comercio`, `tienda_barrio`, `transeunte`, `cliente_antiguo`. Agrupa los tipos de activación.
- **Tipo de activación**: subtipo dentro de la categoría (`comercio`, `reactivacion*`, `limbo`, `no_habilitado`, `reimpresion_qr`, `transeunte`, `cliente_antiguo`). `limbo` es compartido por Comercio y Tienda de Barrio; se distinguen por `base_activacion`.
- **Departamento > provincia > municipio**: división oficial (códigos INE: 2 + 2 + 2 dígitos, p.ej. `070101` Santa Cruz de la Sierra). Fuente: OCHA COD-AB (Ministerio de Desarrollo Rural y Tierras, 2024-09-16), 339 municipios. El código INE es la clave natural; `id` es interno.
- **Plaza**: concepto del Banco Ganadero, no una división oficial. El banco la define y puede cambiarla (hoy Santa Cruz, mañana Montero). Un activador tiene una plaza base. Cada departamento es una plaza que agrupa sus municipios (`plaza_municipios`); un municipio puede convertirse en plaza propia (`convertir_municipio_en_plaza`, como Riberalta), y nunca se juntan varios municipios en una plaza nueva. Al convertirlo, todo su historial de activaciones pasa a la nueva plaza. La plaza de una activación (`plaza_base_*_registro`) es la del municipio donde ocurrió; la del equipo solo si el punto no cae en ninguno. La geografía nunca apunta a la plaza.
- **Ubicación de una activación**: el municipio sale del punto GPS (`trg_ubicar_activacion`, PostGIS) y `ciudad_activacion` es su nombre común. Nadie la escribe a mano: lo que mande la app se sobrescribe.
- **Zona (barrio)**: el banco reporta por barrio. Catálogo `zonas` de puntos con nombre (OSM y los nombres que 3 activadores distintos escribieron a menos de 1 km en el mismo municipio, `promover_zona`); no hay polígonos. Regla de certeza, igual en `zona_sugerida` y en la app (`lib/zonas.js`): el barrio más cercano a ≤ 250 m y el siguiente al menos 1,5 veces más lejos. Si es cierta, la app muestra el barrio con opción a corregir; si no, el activador lo elige de los cercanos o lo escribe. `zona_fuente`: `gps`, `elegida` o `escrita`; las zonas escritas antes de la 1.0.36 se conservan como `escrita`.
- **Viaje**: un activador trabaja en otro municipio entre dos fechas (`viajes`, sin solaparse por activador).
- **Lugar de interés**: punto con nombre y radio (`lugares`); siempre tiene coordenadas. Sin tipo: clasificarlos queda para el análisis. Con activaciones su punto queda fijo, porque cada activación guarda la distancia medida a ese punto; el radio se puede calibrar porque cada evento copia el suyo al crearse. Solo se elimina si ningún evento ni activación lo usa (`accionesLugar`).
- **Evento**: uno o más activadores asignados por un rango de fechas u horas (`eventos`, `evento_activadores`), con lugar opcional y su propio radio. Sin fin queda abierto hasta que se finaliza; finalizar pone el fin en ese momento. Los eventos de un activador pueden solaparse.
- **Equipo / líder / facturador**: un activador pertenece a un equipo de una plaza; el equipo tiene un líder y un facturador. Todo cambia en el tiempo y se guarda en historiales (`activador_equipo_historial`, `equipo_lider_historial`).
- **Snapshot de organización**: al insertar una activación, `trg_snapshot_organizacion_activacion` copia equipo, líder, facturador y plaza base vigentes en `created_at` a las columnas `*_registro`. Así los reportes históricos no cambian cuando la organización cambia. Solo el servidor las escribe.

## Núcleo vs. específico del cliente

El núcleo no menciona al banco. Lo propio del Ganadero (plazas, etiquetas del reporte, tipos de activación del banco) va con el prefijo `yolo_`. Aún no hay soporte para un segundo cliente; el objetivo es que agregarlo sea modificar un modelo limpio, no desenredar uno acoplado.

## Reglas de dominio

Cada regla cita su fuente en el código.

- **Reactivación**: un cliente solo puede reactivarse (o reimprimir QR) pasados 60 días desde su última activación, por CI o por los últimos 8 dígitos del teléfono. RPC `validar_elegibilidad_reactivacion`; cliente en `impulsa360-mobile/lib/elegibilidadReactivacion.js`. Se valida al guardar y de nuevo al sincronizar.
- **Productos Créditos/Remesas** por categoría y tipo: `impulsa360-mobile/lib/elegibilidadProductos.js`. Espejo web: `src/lib/activationEditing.js`; el servidor lo hace cumplir en el PATCH de `server/app.js`.
- **Fotos** (evidencia y Cash-In) por categoría y tipo: `impulsa360-mobile/lib/reglasFotografias.js`. Límite 6 MB / 12 MP.
- **Roles**: `administrador`, `lider`, `activador`, `facturador`, `banco`. Un usuario puede tener varios en `activador_roles`. Portal: `administrador`, `lider`, `banco`; el líder ve solo su alcance (`server/alcanceLider.js`); `banco` ve todo. Puede activar quien tiene el rol `activador`; al marcar `lider` en el portal se marca también `activador`.
- **Equipos de una persona**: una persona puede liderar y activar en varios equipos (multiplaza). Integrante = fila abierta de `activador_equipo_historial` (una por equipo); `activadores.equipo_id` es el equipo principal, siempre uno de ellos (`asignar_equipos_activador`). Líder = `equipos.lider_actual_id`; facturador = `equipos.facturador_id`. Los roles por equipo se derivan de eso, sin tabla propia; `administrador` y `banco` son globales.
- **Equipo de una activación**: la app envía `equipo_elegido_id`; `snapshot_organizacion_activacion` lo usa para fijar `equipo_id_registro` solo si el usuario es integrante de ese equipo en `created_at`, y si no usa el principal. El líder registrado es el de ese equipo.
- **Identidad**: `activadores.usuario_id = auth.uid()` para todo usuario móvil; RLS, RPC y rutas de Storage dependen de ello.
- **Ciclo de vida de un usuario** (`server/usuarios.js`): una persona = un perfil, y todo perfil tiene cuenta de acceso con el mismo id. Inhabilitar conserva la cuenta pero la bloquea (ban en Supabase Auth) y activar la desbloquea; el estado solo cambia por `PATCH /admin/users/:id/status`. Solo se elimina un perfil inhabilitado sin historial (`REFERENCIAS_HISTORIAL`), junto con su cuenta; con historial queda inhabilitado para siempre. Nunca borrar una cuenta desde el panel de Supabase.
- **Viaje de una activación**: al insertar, `trg_vincular_viaje_y_evento` toma el viaje vigente del activador en `created_at`, sin importar dónde cayó el punto. Viajes del mismo activador no se solapan, así que hay a lo sumo uno.
- **Evento de una activación**: al insertar, `trg_vincular_viaje_y_evento` toma un evento vigente del activador. Sin lugar cuenta cualquier punto; con lugar, solo dentro del radio del evento, y guarda `lugar_id` y la distancia. Si hay varios, gana el lugar más cercano, luego el evento sin lugar, luego el que empezó más tarde. Quien se suma a un evento en curso cuenta desde que se suma. Nunca se bloquea un registro.
- **Cancelar o finalizar un evento**: cancelar significa que no ocurrió y solo se puede sin activaciones; con activaciones solo se finaliza (`src/lib/eventos.js`, `accionesEvento`).
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
