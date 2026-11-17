-- Schema assertions (FKs, grants, categoria). Run after the migrations: psql "$DEV_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/esquema_aserciones.sql
-- Read-only assertions, safe on DEV and prod. Behavior checks with synthetic rows: seguridad_activaciones_dev.sql (DEV only).

begin;

do $$
begin
  assert (select count(*) from public.activaciones where categoria is null) = 0, 'categoria nula';
  assert (select count(*) from public.activaciones a
          where not exists (select 1 from public.activadores u where u.usuario_id = a.usuario_id)) = 0, 'activaciones huérfanas';
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'activaciones' and column_name = 'foto_respaldo_url'),
         'foto_respaldo_url sigue existiendo';
  assert (select count(*) from pg_constraint where conname in (
            'activaciones_usuario_id_fkey', 'activadores_lider_id_fkey',
            'notificaciones_destinatarios_usuario_id_fkey', 'notificaciones_usuario_objetivo_id_fkey')) = 4, 'faltan FKs';
  assert not has_table_privilege('anon', 'public.activaciones', 'truncate'), 'anon puede truncar';
  assert not has_table_privilege('authenticated', 'public.activaciones', 'truncate'), 'authenticated puede truncar';
  assert not has_table_privilege('authenticated', 'public.equipos', 'select'), 'authenticated lee equipos';
  assert has_table_privilege('authenticated', 'public.activaciones', 'insert'), 'authenticated no inserta';
  assert has_column_privilege('authenticated', 'public.notificaciones_destinatarios', 'leida_at', 'update'), 'no marca leídas';
  assert not has_function_privilege('anon', 'public.control_activadores_jerarquia(date,date)', 'execute'), 'anon ejecuta control';
  assert has_function_privilege('authenticated', 'public.validar_elegibilidad_reactivacion(text,text,text,date,uuid)', 'execute'), 'authenticated sin RPC de reactivación';
end $$;

rollback;
