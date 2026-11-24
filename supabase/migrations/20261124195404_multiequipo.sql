-- An activador can belong to several teams at once. Open rows of activador_equipo_historial are the memberships;
-- activadores.equipo_id is the principal team, always one of them, and what activations get when the app sends none.

alter table public.activador_equipo_historial
  drop constraint activador_equipo_historial_activador_id_tstzrange_excl,
  add constraint activador_equipo_historial_membresia_unica
    exclude using gist (activador_id with =, equipo_id with =, tstzrange(inicio, fin, '[)') with &&);

-- The team the user chose in the app for this activation. The snapshot columns (*_registro) stay server-owned.
alter table public.activaciones add column equipo_elegido_id uuid references public.equipos(id);

create or replace function public.registrar_cambio_equipo_activador() returns trigger
  language plpgsql security definer
  set search_path to ''
as $$
begin
  if new.equipo_id is null or (tg_op = 'UPDATE' and old.equipo_id is not distinct from new.equipo_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.activador_equipo_historial
    where activador_id = new.usuario_id and equipo_id = new.equipo_id and fin is null
  ) then
    insert into public.activador_equipo_historial(activador_id, equipo_id, inicio, autorizado_por, motivo)
    values (new.usuario_id, new.equipo_id, now(), auth.uid(), 'Equipo principal');
  end if;
  return new;
end;
$$;

create function public.asignar_equipos_activador(
  p_activador_id uuid,
  p_equipo_ids uuid[],
  p_inicio timestamptz default now(),
  p_motivo text default null
) returns void
  language plpgsql security definer
  set search_path to ''
as $$
declare
  v_ids uuid[];
begin
  select array(
    select distinct x from unnest(coalesce(p_equipo_ids, array[]::uuid[]) || a.equipo_id) x where x is not null
  ) into v_ids
  from public.activadores a where a.usuario_id = p_activador_id;
  if v_ids is null then
    raise exception 'El activador no existe';
  end if;
  if exists (
    select 1 from unnest(v_ids) x
    where not exists (
      select 1 from public.activador_equipo_historial h
      where h.activador_id = p_activador_id and h.equipo_id = x and h.fin is null
    )
    and not exists (select 1 from public.equipos e where e.id = x and e.activo)
  ) then
    raise exception 'Uno o mas equipos no existen o estan inactivos';
  end if;

  delete from public.activador_equipo_historial
  where activador_id = p_activador_id and fin is null and inicio >= p_inicio and not (equipo_id = any(v_ids));
  update public.activador_equipo_historial set fin = p_inicio
  where activador_id = p_activador_id and fin is null and not (equipo_id = any(v_ids));

  insert into public.activador_equipo_historial(activador_id, equipo_id, inicio, autorizado_por, motivo)
  select p_activador_id, x, p_inicio, auth.uid(), p_motivo
  from unnest(v_ids) x
  where not exists (
    select 1 from public.activador_equipo_historial h
    where h.activador_id = p_activador_id and h.equipo_id = x and h.fin is null
  );
end;
$$;

revoke all on function public.asignar_equipos_activador(uuid, uuid[], timestamptz, text) from public, anon, authenticated;
grant execute on function public.asignar_equipos_activador(uuid, uuid[], timestamptz, text) to service_role;

create or replace function public.snapshot_organizacion_activacion() returns trigger
  language plpgsql security definer
  set search_path to 'public'
as $$
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

  -- The chosen team counts only if the user was a member of it at capture time.
  if new.equipo_elegido_id is not null then
    select e.* into v_equipo
    from public.activador_equipo_historial h
    join public.equipos e on e.id = h.equipo_id
    where h.activador_id = new.usuario_id and h.equipo_id = new.equipo_elegido_id
      and v_momento >= h.inicio and (h.fin is null or v_momento < h.fin)
    limit 1;
  end if;

  if v_equipo.id is null then
    select e.* into v_equipo
    from public.activadores a
    join public.activador_equipo_historial h on h.activador_id = a.usuario_id and h.equipo_id = a.equipo_id
    join public.equipos e on e.id = a.equipo_id
    where a.usuario_id = new.usuario_id
      and v_momento >= h.inicio and (h.fin is null or v_momento < h.fin)
    limit 1;
  end if;

  if v_equipo.id is null then
    select e.* into v_equipo
    from public.activador_equipo_historial h
    join public.equipos e on e.id = h.equipo_id
    where h.activador_id = new.usuario_id
      and v_momento >= h.inicio and (h.fin is null or v_momento < h.fin)
    order by h.inicio desc limit 1;
  end if;

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

create function public.equipos_del_usuario()
  returns table(equipo_id uuid, numero bigint, nombre text, plaza text, es_principal boolean, es_lider boolean, es_activador boolean)
  language sql stable security definer
  set search_path to ''
as $$
  with yo as (
    select a.usuario_id, a.equipo_id,
      exists (select 1 from public.activador_roles r where r.usuario_id = a.usuario_id and r.rol = 'activador') as es_activador
    from public.activadores a
    where a.usuario_id = auth.uid() and a.estado = 'activo'
  ),
  miembro as (
    select h.equipo_id from public.activador_equipo_historial h join yo on yo.usuario_id = h.activador_id
    where h.fin is null and yo.es_activador
  ),
  lidera as (
    select e.id as equipo_id from public.equipos e join yo on yo.usuario_id = e.lider_actual_id
  )
  select e.id, e.numero, e.nombre, p.nombre,
    e.id is not distinct from yo.equipo_id,
    e.id in (select l.equipo_id from lidera l),
    e.id in (select m.equipo_id from miembro m)
  from public.equipos e
  join public.plazas p on p.id = e.plaza_id
  cross join yo
  where e.activo and (e.id in (select m.equipo_id from miembro m) or e.id in (select l.equipo_id from lidera l))
  order by e.id is not distinct from yo.equipo_id desc, e.numero;
$$;

revoke all on function public.equipos_del_usuario() from public, anon;
grant execute on function public.equipos_del_usuario() to authenticated, service_role;

create or replace function public.proteger_snapshot_activacion() returns trigger
  language plpgsql
  set search_path to ''
as $$
begin
  if auth.role() in ('anon', 'authenticated') then
    new.equipo_elegido_id := old.equipo_elegido_id;
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

-- A leader may read the photos of anyone currently in one of the teams they lead.
create or replace function public.puede_leer_foto_activacion_equipo(p_nombre text) returns boolean
  language sql stable security definer
  set search_path to ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.activadores a
    where a.usuario_id = auth.uid() and a.estado = 'activo'
      and (
        a.rol = 'administrador'
        or exists (select 1 from public.activador_roles r where r.usuario_id = a.usuario_id and r.rol = 'administrador')
        or (
          p_nombre ~ '^activaciones/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
          and exists (
            select 1
            from public.equipo_lider_historial l
            join public.equipos e on e.id = l.equipo_id and e.activo
            where l.lider_id = a.usuario_id and l.fin is null
              and l.equipo_id in (
                select h.equipo_id from public.activador_equipo_historial h
                where h.activador_id = split_part(p_nombre, '/', 2)::uuid and h.fin is null
                union
                select o.equipo_id from public.activadores o
                where o.usuario_id = split_part(p_nombre, '/', 2)::uuid and o.equipo_id is not null
              )
          )
        )
      )
  );
$$;

-- Adds team number and leader name so the app stops showing raw ids.
drop function public.control_activaciones_detalle(uuid, uuid, date, date);

CREATE FUNCTION public.control_activaciones_detalle(p_activador_id uuid, p_equipo_id uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(id uuid, usuario_id uuid, fecha_activacion date, created_at timestamp with time zone, tipo_activacion text, nombres_cliente text, apellidos_cliente text, plaza text, foto_url text, foto_cash_in text, equipo_id_registro uuid, lider_id_registro uuid, equipo_numero_registro bigint, lider_nombre_registro text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_rol text;
  v_estado text;
  v_es_admin boolean;
  v_es_lider boolean;
  v_lider_equipo_id uuid;
  v_equipo_actual_id uuid;
  v_activador_tiene_historial boolean;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Sesión autenticada requerida.';
  end if;
  if p_activador_id is null or p_equipo_id is null then
    raise exception using errcode = '22004', message = 'Activador y equipo son obligatorios.';
  end if;

  select
    regexp_replace(
      translate(lower(btrim(coalesce(a.rol, ''))), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    lower(btrim(coalesce(a.estado, '')))
  into v_rol, v_estado
  from public.activadores a
  where a.usuario_id = v_usuario_id;

  if not found or v_estado <> 'activo' then
    raise exception using errcode = '42501', message = 'Usuario inexistente o inactivo.';
  end if;

  v_es_admin := v_rol in ('admin', 'administrador', 'administrator')
    or v_rol like 'admin\_%' escape '\'
    or v_rol like 'administrador\_%' escape '\'
    or v_rol like 'administrator\_%' escape '\'
    or exists (
      select 1
      from public.activador_roles ar
      cross join lateral (
        select regexp_replace(
          translate(lower(btrim(coalesce(ar.rol, ''))), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+',
          '_',
          'g'
        ) as rol_norm
      ) r
      where ar.usuario_id = v_usuario_id
        and (
          r.rol_norm in ('admin', 'administrador', 'administrator')
          or r.rol_norm like 'admin\_%' escape '\'
          or r.rol_norm like 'administrador\_%' escape '\'
          or r.rol_norm like 'administrator\_%' escape '\'
        )
    );
  v_es_lider := v_rol in ('lider', 'leader', 'supervisor', 'lider_activador', 'activador_lider', 'leader_activator', 'activator_leader')
    or v_rol like 'lider\_%' escape '\'
    or v_rol like 'leader\_%' escape '\'
    or v_rol like 'supervisor\_%' escape '\'
    or ((v_rol like '%lider%' or v_rol like '%leader%') and v_rol like '%activador%')
    or exists (
      select 1
      from public.activador_roles ar
      cross join lateral (
        select regexp_replace(
          translate(lower(btrim(coalesce(ar.rol, ''))), 'áéíóúüñ', 'aeiouun'),
          '[^a-z0-9]+',
          '_',
          'g'
        ) as rol_norm
      ) r
      where ar.usuario_id = v_usuario_id
        and (
          r.rol_norm in ('lider', 'leader', 'supervisor', 'lider_activador', 'activador_lider', 'leader_activator', 'activator_leader')
          or r.rol_norm like 'lider\_%' escape '\'
          or r.rol_norm like 'leader\_%' escape '\'
          or r.rol_norm like 'supervisor\_%' escape '\'
          or ((r.rol_norm like '%lider%' or r.rol_norm like '%leader%') and r.rol_norm like '%activador%')
        )
    );

  if not v_es_admin and not v_es_lider then
    raise exception using errcode = '42501', message = 'El usuario no tiene acceso a Control Activadores.';
  end if;

  select h.lider_id
  into v_lider_equipo_id
  from public.equipo_lider_historial h
  join public.equipos e on e.id = h.equipo_id and e.activo = true
  join public.activadores l
    on l.usuario_id = h.lider_id
   and lower(btrim(coalesce(l.estado, ''))) = 'activo'
  where h.equipo_id = p_equipo_id
    and h.fin is null
    and (v_es_admin or h.lider_id = v_usuario_id)
  limit 1;

  if v_lider_equipo_id is null then
    raise exception using errcode = '42501', message = 'El equipo no está dentro del alcance del usuario.';
  end if;

  select
    a.equipo_id,
    exists (
      select 1
      from public.activador_equipo_historial hx
      where hx.activador_id = a.usuario_id
    )
  into v_equipo_actual_id, v_activador_tiene_historial
  from public.activadores a
  where a.usuario_id = p_activador_id
    and lower(btrim(coalesce(a.estado, ''))) = 'activo'
    and (
      exists (
        select 1
        from public.activador_equipo_historial ah
        where ah.activador_id = a.usuario_id
          and ah.equipo_id = p_equipo_id
          and ah.fin is null
      )
      or (
        a.equipo_id = p_equipo_id
        and not exists (
          select 1
          from public.activador_equipo_historial ah
          where ah.activador_id = a.usuario_id
            and ah.fin is null
        )
      )
    );

  if not found then
    raise exception using errcode = '42501', message = 'El activador no pertenece actualmente al equipo solicitado.';
  end if;

  return query
  with activaciones_base as (
    select
      ac.*,
      coalesce(ac.created_at, ac.fecha_activacion::timestamp at time zone 'UTC') as momento
    from public.activaciones ac
    where ac.usuario_id = p_activador_id
      and (p_desde is null or coalesce(ac.fecha_activacion, ac.created_at::date) >= p_desde)
      and (p_hasta is null or coalesce(ac.fecha_activacion, ac.created_at::date) <= p_hasta)
  ),
  activaciones_resueltas as (
    select
      ac.*,
      coalesce(
        ac.equipo_id_registro,
        ah.equipo_id,
        case when not v_activador_tiene_historial then v_equipo_actual_id end
      ) as equipo_atribuido_id,
      coalesce(ac.lider_id_registro, lh.lider_id) as lider_atribuido_id
    from activaciones_base ac
    left join lateral (
      select h.equipo_id
      from public.activador_equipo_historial h
      where ac.equipo_id_registro is null
        and h.activador_id = ac.usuario_id
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) ah on true
    left join lateral (
      select h.lider_id
      from public.equipo_lider_historial h
      where ac.lider_id_registro is null
        and h.equipo_id = coalesce(
          ac.equipo_id_registro,
          ah.equipo_id,
          case when not v_activador_tiene_historial then v_equipo_actual_id end
        )
        and ac.momento >= h.inicio
        and (h.fin is null or ac.momento < h.fin)
      order by h.inicio desc
      limit 1
    ) lh on true
  )
  select
    ac.id,
    ac.usuario_id,
    ac.fecha_activacion,
    ac.created_at,
    ac.tipo_activacion,
    ac.nombres_cliente,
    ac.apellidos_cliente,
    ac.plaza,
    ac.foto_url,
    ac.foto_cash_in,
    ac.equipo_id_registro,
    ac.lider_id_registro,
    ac.equipo_numero_registro,
    ac.lider_nombre_registro
  from activaciones_resueltas ac
  where ac.equipo_atribuido_id = p_equipo_id
    and ac.lider_atribuido_id = v_lider_equipo_id
  order by coalesce(ac.fecha_activacion, ac.created_at::date) desc, ac.created_at desc;
end;
$function$;

revoke all on function public.control_activaciones_detalle(uuid, uuid, date, date) from public, anon;
grant execute on function public.control_activaciones_detalle(uuid, uuid, date, date) to authenticated, service_role;
