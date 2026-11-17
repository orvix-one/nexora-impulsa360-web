-- Removes "plaza temporal", replaced by viajes and lugares. Only activaciones.es_plaza_temporal and plaza_temporal stay:
-- installed app builds still send them in the upsert, so they are kept empty until those builds are gone (EXPAND_CONTRACT.md).

CREATE OR REPLACE FUNCTION public.snapshot_organizacion_activacion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_momento timestamptz := coalesce(new.created_at, now());
  v_equipo public.equipos%rowtype;
  v_lider_id uuid;
begin
  -- auth.role() is null for direct database connections (imports, migrations), which are trusted.
  if new.equipo_id_registro is not null and coalesce(auth.role(), 'service_role') not in ('anon', 'authenticated') then
    select plaza_id into new.plaza_base_id_registro
    from public.equipos where id = new.equipo_id_registro;
    new.plaza_id_registro := coalesce(new.plaza_id_registro, new.plaza_base_id_registro);
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

  new.equipo_id_registro := v_equipo.id;
  new.plaza_base_id_registro := v_equipo.plaza_id;
  new.plaza_id_registro := v_equipo.plaza_id;
  new.equipo_numero_registro := v_equipo.numero;
  new.equipo_nombre_registro := v_equipo.nombre;
  new.facturador_id_registro := v_equipo.facturador_id;
  select nombre into new.facturador_nombre_registro from public.facturadores where id = v_equipo.facturador_id;
  new.lider_id_registro := coalesce(v_lider_id, v_equipo.lider_actual_id);
  select nombre into new.lider_nombre_registro from public.activadores where usuario_id = new.lider_id_registro;
  select nombre into new.plaza_base_registro from public.plazas where id = v_equipo.plaza_id;
  new.es_plaza_temporal := false;
  new.plaza_temporal := null;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.proteger_snapshot_activacion() RETURNS trigger
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
    new.plaza_base_registro := old.plaza_base_registro;
    new.es_plaza_temporal := false;
    new.plaza_temporal := null;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.reasignar_y_eliminar_plaza(p_plaza_origen uuid, p_plaza_destino uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_destino public.plazas%rowtype;
begin
  if p_plaza_origen = p_plaza_destino then raise exception 'La plaza de destino debe ser distinta'; end if;
  select * into v_destino from public.plazas where id = p_plaza_destino and activa for update;
  if v_destino.id is null then raise exception 'La plaza de destino no existe o esta inactiva'; end if;
  if exists (select 1 from public.equipo_lider_historial where plaza_id = p_plaza_origen)
     or exists (select 1 from public.activaciones where plaza_id_registro = p_plaza_origen or plaza_base_id_registro = p_plaza_origen)
  then raise exception 'No se puede reasignar de forma segura: existe historial o activaciones históricas vinculadas. Debe deshabilitarse.'; end if;
  update public.equipos set plaza_id = p_plaza_destino where plaza_id = p_plaza_origen;
  update public.activadores set plaza_id = p_plaza_destino, plaza_base = v_destino.nombre, plaza = v_destino.nombre where plaza_id = p_plaza_origen;
  update public.plaza_municipios set plaza_id = p_plaza_destino where plaza_id = p_plaza_origen;
  delete from public.plazas where id = p_plaza_origen;
  return jsonb_build_object('equipos', (select count(*) from public.equipos where plaza_id = p_plaza_destino), 'plaza_destino', p_plaza_destino);
end $$;

update public.activaciones set es_plaza_temporal = false, plaza_temporal = null
where es_plaza_temporal or plaza_temporal is not null;

-- plaza_id_registro used to hold the temporary plaza when one was active; it is the team's base plaza now.
update public.activaciones set plaza_id_registro = plaza_base_id_registro
where plaza_id_registro is distinct from plaza_base_id_registro;

alter table public.activaciones
  drop column plaza_temporal_asignacion_id,
  drop column plaza_temporal_registro,
  drop column plaza_efectiva_registro,
  drop column plaza_efectiva_id_registro;

drop function public.plaza_efectiva_activador(uuid, timestamptz);
drop table public.activador_plaza_temporal;

-- Event and place names that the old form inserted into the plaza catalog.
delete from public.plazas p
where not p.es_ciudad_geografica
  and not exists (select 1 from public.equipos e where e.plaza_id = p.id)
  and not exists (select 1 from public.activadores a where a.plaza_id = p.id)
  and not exists (select 1 from public.equipo_lider_historial h where h.plaza_id = p.id)
  and not exists (select 1 from public.plaza_municipios pm where pm.plaza_id = p.id)
  and not exists (select 1 from public.activaciones x where x.plaza_id_registro = p.id or x.plaza_base_id_registro = p.id);
