# Expand/contract

Cosas que se dejaron de usar pero siguen en la BD porque builds instalados o código viejo pueden depender de ellas. Antes de quitar una, correr su búsqueda. Al hacerlo, borrar la fila (la historia queda en git).

La app no se actualiza sola: "versión mínima" significa que ya no queda en campo un build que la use.

| Objeto | Reemplazo | Buscar | Quitar cuando |
|---|---|---|---|
| función `registrar_eventos_telemetria` (no-op) | — | `rg registrar_eventos_telemetria` en la app | builds ≤ 87 ya no están en campo |
| trigger `trg_normalizar_tipo_activacion_limbo` | tipo `limbo` | `rg config_cuenta` en app y web | builds ≤ 1.0.32 ya no están en campo |
| fotos sin prefijo `r2:` y bucket de Supabase | R2 | `rg "storage\.from\(" App.js lib`; objetos en `storage.objects` | builds ≤ 1.0.34 ya no están en campo y el bucket está vacío |
| `activaciones.tipo_tienda`, `tipo_comercio`, `reactivacion_comercio`, `estado_sync`, `creado_en` | — | `rg "<columna>"` en app y web | la app ya no las envía ni lee |
| `activaciones.base_activacion` como fuente de la categoría | `activaciones.categoria` | `rg "inferActivationCategory\|base_activacion"` | la app envía `categoria` |
