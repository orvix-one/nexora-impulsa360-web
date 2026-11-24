# Expand/contract

Cosas que se dejaron de usar pero siguen en la BD porque builds instalados o código viejo pueden depender de ellas. Antes de quitar una, correr su búsqueda. Al hacerlo, borrar la fila (la historia queda en git).

La app no se actualiza sola: "versión mínima" significa que ya no queda en campo un build que la use.

| Objeto | Reemplazo | Buscar | Quitar cuando |
|---|---|---|---|
| fotos sin prefijo `r2:` y bucket de Supabase | R2 | `rg "storage\.from\(" App.js lib`; objetos en `storage.objects` | builds ≤ 1.0.34 ya no están en campo, un build quitó el respaldo a Supabase de `lib/upload.js` y `App.js`, el portal ya no responde `fallback: 'supabase'` y el bucket está vacío |
| `activaciones.tipo_tienda`, `tipo_comercio`, `reactivacion_comercio`, `estado_sync`, `creado_en` | — | `rg "<columna>"` en app y web | la app ya no las envía ni lee (el build 92 todavía las envía en `lib/activationRecord.js`) |
| `activaciones.base_activacion` como fuente de la categoría | `activaciones.categoria` | `rg "inferActivationCategory\|base_activacion"` | builds ≤ 1.0.35 ya no están en campo |
| `activaciones.es_plaza_temporal`, `plaza_temporal` | `viaje_id`, `evento_id` | `rg "plaza_temporal"` en la app | builds ≤ 1.0.35 ya no están en campo |
| `activaciones.ciudad_activacion` escrita por la app | `municipio_id` (calculado del GPS) | `rg "ciudad_activacion"` en la app | builds ≤ 1.0.35 ya no están en campo |
| `plazas.es_ciudad_geografica`, `aliases` (catálogo de ciudades de la app) | `plaza_municipios` | `rg "es_ciudad_geografica"` en app y web | builds ≤ 1.0.36 ya no están en campo |
