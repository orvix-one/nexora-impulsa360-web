-- anon/authenticated lose the blanket table, sequence and function grants (including TRUNCATE, which RLS does not stop).
-- Only what the mobile app and the user-scoped portal calls use is granted back.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

grant select on
  public.activaciones,
  public.activadores,
  public.activador_plaza_temporal,
  public.plazas,
  public.notificaciones,
  public.notificaciones_destinatarios
to authenticated;

-- Table-level on purpose: installed builds send different column sets in the activaciones upsert.
grant insert, update on public.activaciones to authenticated;
grant update (leida_at) on public.notificaciones_destinatarios to authenticated;
grant select (usuario_id, rol) on public.activador_roles to authenticated;

-- Trigger functions are never called through the API; firing a trigger does not check EXECUTE.
revoke execute on function
  public.snapshot_organizacion_activacion(),
  public.registrar_cambio_equipo_activador(),
  public.normalizar_nombre_plaza(),
  public.normalizar_tipo_activacion_limbo(),
  public.plaza_efectiva_activador(uuid, timestamptz)
from public, anon, authenticated;

revoke execute on function
  public.control_activadores_jerarquia(date, date),
  public.control_activaciones_detalle(uuid, uuid, date, date),
  public.validar_elegibilidad_reactivacion(text, text, text, date, uuid),
  public.registrar_eventos_telemetria(jsonb),
  public.puede_leer_foto_activacion_equipo(text)
from public, anon;

-- The organization snapshot on activaciones is server-owned: clients can neither seed it on insert nor change it on update.

CREATE OR REPLACE FUNCTION public.snapshot_organizacion_activacion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_momento timestamptz := coalesce(new.created_at, now());
  v_equipo public.equipos%rowtype;
  v_lider_id uuid;
  v_plaza record;
begin
  -- auth.role() is null for direct database connections (imports, migrations), which are trusted.
  if new.equipo_id_registro is not null and coalesce(auth.role(), 'service_role') not in ('anon', 'authenticated') then
    select plaza_id into new.plaza_base_id_registro
    from public.equipos where id = new.equipo_id_registro;
    select id into new.plaza_efectiva_id_registro from public.plazas
    where nombre_normalizado = lower(unaccent(btrim(
      coalesce(new.plaza_efectiva_registro, new.plaza_temporal, new.ciudad_activacion)
    )));
    new.plaza_efectiva_id_registro := coalesce(new.plaza_efectiva_id_registro, new.plaza_base_id_registro);
    new.plaza_id_registro := coalesce(new.plaza_id_registro, new.plaza_efectiva_id_registro);
    return new;
  end if;
  select e.* into v_equipo
  from public.activador_equipo_historial h
  join public.equipos e on e.id = h.equipo_id
  where h.activador_id = new.usuario_id
    and v_momento >= h.inicio and (h.fin is null or v_momento < h.fin)
  order by h.inicio desc limit 1;

  if v_equipo.id is null then
    select e.* into v_equipo from public.activadores a join public.equipos e on e.id = a.equipo_id
    where a.usuario_id = new.usuario_id;
  end if;

  select h.lider_id into v_lider_id from public.equipo_lider_historial h
  where h.equipo_id = v_equipo.id
    and v_momento >= h.inicio and (h.fin is null or v_momento < h.fin)
  order by h.inicio desc limit 1;

  select * into v_plaza from public.plaza_efectiva_activador(new.usuario_id, v_momento);
  new.equipo_id_registro := v_equipo.id;
  new.plaza_base_id_registro := v_equipo.plaza_id;
  new.plaza_efectiva_id_registro := coalesce(v_plaza.plaza_efectiva_id, v_equipo.plaza_id);
  new.plaza_id_registro := new.plaza_efectiva_id_registro;
  new.equipo_numero_registro := v_equipo.numero;
  new.equipo_nombre_registro := v_equipo.nombre;
  new.facturador_id_registro := v_equipo.facturador_id;
  select nombre into new.facturador_nombre_registro from public.facturadores where id = v_equipo.facturador_id;
  new.lider_id_registro := coalesce(v_lider_id, v_equipo.lider_actual_id);
  select nombre into new.lider_nombre_registro from public.activadores where usuario_id = new.lider_id_registro;
  new.plaza_base_registro := v_plaza.plaza_base;
  new.plaza_efectiva_registro := coalesce(v_plaza.plaza_efectiva, new.ciudad_activacion);
  new.plaza_temporal_registro := coalesce(v_plaza.es_temporal, false);
  new.plaza_temporal_asignacion_id := v_plaza.asignacion_id;
  return new;
end;
$$;

CREATE FUNCTION public.proteger_snapshot_activacion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if auth.role() in ('anon', 'authenticated') then
    new.equipo_id_registro := old.equipo_id_registro;
    new.equipo_numero_registro := old.equipo_numero_registro;
    new.equipo_nombre_registro := old.equipo_nombre_registro;
    new.facturador_id_registro := old.facturador_id_registro;
    new.facturador_nombre_registro := old.facturador_nombre_registro;
    new.lider_id_registro := old.lider_id_registro;
    new.lider_nombre_registro := old.lider_nombre_registro;
    new.plaza_id_registro := old.plaza_id_registro;
    new.plaza_base_id_registro := old.plaza_base_id_registro;
    new.plaza_efectiva_id_registro := old.plaza_efectiva_id_registro;
    new.plaza_base_registro := old.plaza_base_registro;
    new.plaza_efectiva_registro := old.plaza_efectiva_registro;
    new.plaza_temporal_registro := old.plaza_temporal_registro;
    new.plaza_temporal_asignacion_id := old.plaza_temporal_asignacion_id;
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION public.proteger_snapshot_activacion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_proteger_snapshot_activacion
  BEFORE UPDATE ON public.activaciones
  FOR EACH ROW EXECUTE FUNCTION public.proteger_snapshot_activacion();
