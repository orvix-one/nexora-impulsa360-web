drop trigger if exists trg_normalizar_tipo_activacion_limbo on public.activaciones;
drop function if exists public.normalizar_tipo_activacion_limbo();
drop function if exists public.registrar_eventos_telemetria(jsonb);
drop function if exists public.reasignar_y_eliminar_plaza(uuid, uuid);
