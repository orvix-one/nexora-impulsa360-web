-- Trips (an activator working in another municipio for a while) and activation places (a point where activators are assigned),
-- replacing activador_plaza_temporal, whose rows are classified and moved here.

create table public.viajes (
  id uuid primary key default gen_random_uuid(),
  activador_id uuid not null references public.activadores(usuario_id) on delete restrict,
  municipio_id integer not null references public.municipios(id),
  inicio timestamptz not null,
  fin timestamptz not null,
  nota text,
  creado_por uuid references public.activadores(usuario_id),
  cancelado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint viajes_rango_check check (fin > inicio),
  constraint viajes_sin_solape exclude using gist (activador_id with =, tstzrange(inicio, fin) with &&) where (cancelado_at is null)
);

create index idx_viajes_municipio on public.viajes using btree (municipio_id);

create table public.tipos_lugar (
  codigo text primary key,
  etiqueta text not null
);

insert into public.tipos_lugar (codigo, etiqueta) values
  ('universidad', 'Universidad'),
  ('feria', 'Feria'),
  ('mercado', 'Mercado'),
  ('institucion', 'Institución'),
  ('otro', 'Otro');

create table public.lugares (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) <> ''),
  tipo text references public.tipos_lugar(codigo),
  latitud double precision,
  longitud double precision,
  radio_m integer not null default 300 check (radio_m > 0),
  municipio_id integer references public.municipios(id),
  activo boolean not null default true,
  creado_por uuid references public.activadores(usuario_id),
  created_at timestamptz not null default now(),
  constraint lugares_punto_check check ((latitud is null) = (longitud is null))
);

create index idx_lugares_municipio on public.lugares using btree (municipio_id);

-- One row per activator; rows created together share lote_id so the portal can show them as one assignment.
create table public.lugar_asignaciones (
  id uuid primary key default gen_random_uuid(),
  lugar_id uuid not null references public.lugares(id) on delete restrict,
  activador_id uuid not null references public.activadores(usuario_id) on delete restrict,
  inicio timestamptz not null,
  fin timestamptz not null,
  lote_id uuid not null,
  creado_por uuid references public.activadores(usuario_id),
  cancelado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lugar_asignaciones_rango_check check (fin > inicio)
);

create index idx_lugar_asignaciones_activador on public.lugar_asignaciones using btree (activador_id, inicio, fin);
create index idx_lugar_asignaciones_lugar on public.lugar_asignaciones using btree (lugar_id);
create index idx_lugar_asignaciones_lote on public.lugar_asignaciones using btree (lote_id);

alter table public.viajes enable row level security;
alter table public.tipos_lugar enable row level security;
alter table public.lugares enable row level security;
alter table public.lugar_asignaciones enable row level security;

create policy viajes_select_own on public.viajes
  for select to authenticated
  using (activador_id = auth.uid() and cancelado_at is null);

grant select on public.viajes to authenticated;

create function public.ubicar_lugar() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.municipio_id := case
    when new.latitud is null then new.municipio_id
    else public.municipio_en_punto(new.latitud, new.longitud)
  end;
  return new;
end;
$$;

revoke all on function public.ubicar_lugar() from public, anon, authenticated;

create trigger trg_ubicar_lugar
  before insert or update of latitud, longitud on public.lugares
  for each row execute function public.ubicar_lugar();

alter table public.activaciones
  add column viaje_id uuid references public.viajes(id) on delete set null,
  add column lugar_id uuid references public.lugares(id) on delete set null,
  add column distancia_lugar_m real;

create index idx_activaciones_viaje on public.activaciones using btree (viaje_id) where viaje_id is not null;
create index idx_activaciones_lugar on public.activaciones using btree (lugar_id) where lugar_id is not null;

-- An activation belongs to a place only when its activator is assigned there and the point is within the place's radius; the nearest wins.
-- SECURITY DEFINER because the app inserts as authenticated, which cannot read these tables.
create function public.vincular_viaje_y_lugar() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_momento timestamptz := coalesce(new.created_at, now());
begin
  if tg_op = 'UPDATE' then
    if coalesce(auth.role(), 'service_role') in ('anon', 'authenticated') then
      new.viaje_id := old.viaje_id;
      new.lugar_id := old.lugar_id;
      new.distancia_lugar_m := old.distancia_lugar_m;
    end if;
    return new;
  end if;

  select v.id into new.viaje_id
  from public.viajes v
  where v.activador_id = new.usuario_id and v.cancelado_at is null
    and v_momento >= v.inicio and v_momento < v.fin
  limit 1;

  select c.lugar_id, c.distancia into new.lugar_id, new.distancia_lugar_m
  from (
    select l.id as lugar_id, l.radio_m,
      extensions.st_distance(
        extensions.st_makepoint(l.longitud, l.latitud)::extensions.geography,
        extensions.st_makepoint(new.longitud, new.latitud)::extensions.geography
      ) as distancia
    from public.lugar_asignaciones a
    join public.lugares l on l.id = a.lugar_id
    where a.activador_id = new.usuario_id and a.cancelado_at is null
      and v_momento >= a.inicio and v_momento < a.fin
      and l.latitud is not null
  ) c
  where c.distancia <= c.radio_m
  order by c.distancia
  limit 1;

  return new;
end;
$$;

revoke all on function public.vincular_viaje_y_lugar() from public, anon, authenticated;

create trigger trg_vincular_viaje_y_lugar
  before insert or update of viaje_id, lugar_id, distancia_lugar_m on public.activaciones
  for each row execute function public.vincular_viaje_y_lugar();

-- Move activador_plaza_temporal. Every row must match exactly one classification or the migration aborts.
create temp table clasificacion (
  plaza_clave text not null,
  ciudad_patron text not null,
  destino text not null check (destino in ('viaje', 'lugar', 'descartar')),
  municipio_ine text,
  lugar_nombre text,
  lugar_tipo text
) on commit drop;

insert into clasificacion values
  ('puerto quijarro', '%', 'viaje', '071402', null, null),
  ('potosi', 'llallagua', 'viaje', '050203', null, null),
  ('la paz', '%', 'viaje', '020101', null, null),
  ('camiri', '%', 'viaje', '070706', null, null),
  ('montero', '%', 'viaje', '071001', null, null),
  ('4 canadas', '%', 'viaje', '071106', null, null),
  ('universidad upea', '%', 'lugar', null, 'Universidad UPEA', 'universidad'),
  ('unifranz', '%', 'lugar', null, 'Unifranz', 'universidad'),
  ('uagrm', '%', 'lugar', null, 'UAGRM', 'universidad'),
  ('sacaba - virgen de amparo', '%', 'lugar', null, 'Sacaba - Virgen de Amparo', 'feria'),
  ('mercado integracion de las americas', '%', 'lugar', null, 'Mercado Integración de las Américas', 'mercado'),
  ('mercado san antonio', '%', 'lugar', null, 'Mercado San Antonio', 'mercado'),
  ('mercado santa rosa', '%', 'lugar', null, 'Mercado Santa Rosa', 'mercado'),
  ('mercado triangular', '%', 'lugar', null, 'Mercado Triangular', 'mercado'),
  ('santa cruz de la sierra', 'mercado el para%', 'lugar', null, 'Mercado El Paraíso', 'mercado'),
  ('joven emprendedor', '%', 'lugar', null, 'Joven Emprendedor', 'otro'),
  ('carmela serruto', '%', 'lugar', null, 'Carmela Serruto', 'otro'),
  ('evento prueba', '%', 'descartar', null, null, null),
  ('prueba', '%', 'descartar', null, null, null);

create temp table origen on commit drop as
select t.*, c.destino, c.municipio_ine, c.lugar_nombre, c.lugar_tipo,
  count(*) over (partition by t.id) as coincidencias
from public.activador_plaza_temporal t
left join clasificacion c
  on c.plaza_clave = lower(public.unaccent(regexp_replace(btrim(t.plaza_temporal), '\s+', ' ', 'g')))
  and lower(public.unaccent(regexp_replace(btrim(coalesce(t.ciudad_plaza, '')), '\s+', ' ', 'g'))) like c.ciudad_patron;

do $$
declare
  v_sin_clasificar text;
begin
  select string_agg(distinct plaza_temporal || ' / ' || coalesce(ciudad_plaza, ''), ', ') into v_sin_clasificar
  from origen where destino is null or coincidencias <> 1;
  if v_sin_clasificar is not null then
    raise exception 'activador_plaza_temporal sin clasificar o ambiguo: %', v_sin_clasificar;
  end if;
end;
$$;

create temp table equivalencia (
  origen_id uuid primary key,
  viaje_id uuid,
  asignacion_id uuid,
  lugar_id uuid
) on commit drop;

with nuevas as (
  insert into public.viajes (activador_id, municipio_id, inicio, fin, nota, creado_por, cancelado_at, created_at)
  select o.activador_id, m.id, o.inicio, o.fin, o.motivo, o.autorizado_por,
    case when o.activo then o.cancelado_at else coalesce(o.cancelado_at, o.created_at) end,
    o.created_at
  from origen o join public.municipios m on m.codigo_ine = o.municipio_ine
  where o.destino = 'viaje'
  returning id, activador_id, inicio, created_at
)
insert into equivalencia (origen_id, viaje_id)
select o.id, n.id
from origen o join nuevas n
  on n.activador_id = o.activador_id and n.inicio = o.inicio and n.created_at = o.created_at
where o.destino = 'viaje';

insert into public.lugares (nombre, tipo, latitud, longitud, created_at)
select o.lugar_nombre, min(o.lugar_tipo),
  percentile_cont(0.5) within group (order by a.latitud),
  percentile_cont(0.5) within group (order by a.longitud),
  min(o.created_at)
from origen o
left join public.activaciones a on a.plaza_temporal_asignacion_id = o.id
where o.destino = 'lugar'
group by o.lugar_nombre;

with nuevas as (
  insert into public.lugar_asignaciones (lugar_id, activador_id, inicio, fin, lote_id, creado_por, cancelado_at, created_at)
  select l.id, o.activador_id, o.inicio, o.fin,
    md5(l.id::text || o.inicio::text || o.fin::text)::uuid,
    o.autorizado_por,
    case when o.activo then o.cancelado_at else coalesce(o.cancelado_at, o.created_at) end,
    o.created_at
  from origen o join public.lugares l on l.nombre = o.lugar_nombre
  where o.destino = 'lugar'
  returning id, lugar_id, activador_id, inicio, created_at
)
insert into equivalencia (origen_id, asignacion_id, lugar_id)
select o.id, n.id, n.lugar_id
from origen o
join public.lugares l on l.nombre = o.lugar_nombre
join nuevas n on n.lugar_id = l.id and n.activador_id = o.activador_id and n.inicio = o.inicio and n.created_at = o.created_at
where o.destino = 'lugar';

update public.activaciones a
set viaje_id = e.viaje_id,
  lugar_id = e.lugar_id,
  distancia_lugar_m = case when e.lugar_id is null or l.latitud is null then null else extensions.st_distance(
    extensions.st_makepoint(l.longitud, l.latitud)::extensions.geography,
    extensions.st_makepoint(a.longitud, a.latitud)::extensions.geography
  ) end
from equivalencia e
left join public.lugares l on l.id = e.lugar_id
where a.plaza_temporal_asignacion_id = e.origen_id;

do $$
declare
  v_origen integer;
  v_movidas integer;
  v_descartadas integer;
  v_vinculadas_antes integer;
  v_vinculadas_despues integer;
begin
  select count(*) into v_origen from public.activador_plaza_temporal;
  select count(*) into v_movidas from equivalencia;
  select count(*) into v_descartadas from origen where destino = 'descartar';
  if v_movidas + v_descartadas <> v_origen then
    raise exception 'filas movidas (%) + descartadas (%) <> origen (%)', v_movidas, v_descartadas, v_origen;
  end if;

  select count(*) into v_vinculadas_antes from public.activaciones a
  join origen o on o.id = a.plaza_temporal_asignacion_id where o.destino <> 'descartar';
  select count(*) into v_vinculadas_despues from public.activaciones
  where viaje_id is not null or lugar_id is not null;
  if v_vinculadas_antes <> v_vinculadas_despues then
    raise exception 'activaciones vinculadas antes (%) <> despues (%)', v_vinculadas_antes, v_vinculadas_despues;
  end if;
end;
$$;
