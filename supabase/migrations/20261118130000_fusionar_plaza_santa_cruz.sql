-- Merges the duplicate plaza "Santa Cruz de la Sierra" (created for the old app's city list, no teams or activations)
-- into "Santa Cruz", the plaza the teams, activators and activation history use.

do $$
declare
  v_origen uuid;
  v_destino uuid;
begin
  select id into v_origen from public.plazas where nombre = 'Santa Cruz de la Sierra';
  select id into v_destino from public.plazas where nombre = 'Santa Cruz';
  -- An empty database (DEV rebuilt from migrations before loading a backup) has neither plaza.
  if v_origen is null and v_destino is null then
    return;
  end if;
  if v_origen is null or v_destino is null then
    raise exception 'No se encontraron las plazas "Santa Cruz de la Sierra" y "Santa Cruz".';
  end if;

  perform public.reasignar_y_eliminar_plaza(v_origen, v_destino);

  -- Builds <= 1.0.35 still list cities from the catalog; keep Santa Cruz in it under both names.
  update public.plazas
  set es_ciudad_geografica = true, aliases = array['Santa Cruz de la Sierra']
  where id = v_destino;

  update public.activadores set plaza = 'Santa Cruz'
  where plaza_id is null and plaza = 'Santa Cruz de la Sierra';
end;
$$;
