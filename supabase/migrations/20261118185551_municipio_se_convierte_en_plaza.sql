-- A plaza is either departmental (groups the rest of a department's municipios) or a single municipio promoted out of it.
-- An activation's plaza follows where it happened: the plaza grouping its municipio, falling back to the team's plaza.

-- Runs after the organization snapshot (triggers fire by name), so the team's plaza is the fallback it overrides.
CREATE OR REPLACE FUNCTION public.ubicar_activacion() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
declare
  v_plaza public.plazas%rowtype;
begin
  new.municipio_id := public.municipio_en_punto(new.latitud, new.longitud);
  if new.municipio_id is null then return new; end if;
  select coalesce(m.nombre_comun, m.nombre) into new.ciudad_activacion
  from public.municipios m where m.id = new.municipio_id;
  select p.* into v_plaza from public.plaza_municipios pm join public.plazas p on p.id = pm.plaza_id
  where pm.municipio_id = new.municipio_id;
  if v_plaza.id is not null then
    new.plaza_base_id_registro := v_plaza.id;
    new.plaza_base_registro := v_plaza.nombre;
    new.plaza_id_registro := v_plaza.id;
  end if;
  return new;
end;
$$;

CREATE FUNCTION public.convertir_municipio_en_plaza(p_municipio_id integer) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
declare
  v_nombre text;
  v_origen uuid;
  v_plaza uuid;
  v_activaciones integer;
begin
  select coalesce(m.nombre_comun, m.nombre), pm.plaza_id into v_nombre, v_origen
  from public.municipios m left join public.plaza_municipios pm on pm.municipio_id = m.id
  where m.id = p_municipio_id;
  if v_nombre is null then raise exception 'El municipio no existe'; end if;
  if v_origen is not null and (select count(*) from public.plaza_municipios where plaza_id = v_origen) = 1 then
    raise exception '% ya es una plaza', v_nombre;
  end if;

  select id into v_plaza from public.plazas where nombre_normalizado = lower(public.unaccent(btrim(v_nombre)));
  if v_plaza is not null and exists (select 1 from public.plaza_municipios where plaza_id = v_plaza) then
    raise exception 'Ya existe una plaza llamada % con otros municipios', v_nombre;
  end if;
  if v_plaza is null then
    insert into public.plazas (nombre, nombre_normalizado, activa, es_ciudad_geografica)
    values (v_nombre, lower(public.unaccent(btrim(v_nombre))), true, true)
    returning id into v_plaza;
  else
    update public.plazas set activa = true where id = v_plaza;
  end if;

  delete from public.plaza_municipios where municipio_id = p_municipio_id;
  insert into public.plaza_municipios (plaza_id, municipio_id) values (v_plaza, p_municipio_id);

  update public.activaciones
  set plaza_base_id_registro = v_plaza, plaza_base_registro = v_nombre, plaza_id_registro = v_plaza
  where municipio_id = p_municipio_id;
  get diagnostics v_activaciones = row_count;

  return jsonb_build_object('plaza_id', v_plaza, 'plaza', v_nombre, 'plaza_origen', v_origen, 'activaciones', v_activaciones);
end;
$$;

REVOKE ALL ON FUNCTION public.convertir_municipio_en_plaza(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convertir_municipio_en_plaza(integer) TO service_role;

-- Plazas that are already a single municipio take its whole history, as a conversion would.
update public.activaciones a
set plaza_base_id_registro = p.id, plaza_base_registro = p.nombre, plaza_id_registro = p.id
from public.plaza_municipios pm
join public.plazas p on p.id = pm.plaza_id
where pm.municipio_id = a.municipio_id
  and (select count(*) from public.plaza_municipios x where x.plaza_id = pm.plaza_id) = 1
  and a.plaza_base_id_registro is distinct from p.id;
