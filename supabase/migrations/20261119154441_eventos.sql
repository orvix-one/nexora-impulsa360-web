-- Events: one or more activators assigned to an optional place over a date or hour range. Replaces place assignments and place types.

-- Every place gets a point. Carmela Serruto was cancelled and recreated as Joven Emprendedor (same team, day and point); Sacaba - Virgen de Amparo has no activations to locate it, so it takes the OSM centre of Sacaba.
do $$
begin
  if exists (
    select 1 from public.lugar_asignaciones a join public.lugares l on l.id = a.lugar_id
    where l.nombre = 'Carmela Serruto' and a.cancelado_at is null
  ) or exists (select 1 from public.activaciones x join public.lugares l on l.id = x.lugar_id where l.nombre = 'Carmela Serruto') then
    raise exception 'Carmela Serruto has live assignments or activations; merge it by hand';
  end if;
end $$;

delete from public.lugar_asignaciones where lugar_id in (select id from public.lugares where nombre = 'Carmela Serruto' and latitud is null);
delete from public.lugares where nombre = 'Carmela Serruto' and latitud is null;
update public.lugares set latitud = -17.403834, longitud = -66.0402928
where nombre = 'Sacaba - Virgen de Amparo' and latitud is null;

alter table public.lugares drop constraint lugares_punto_check;
alter table public.lugares alter column latitud set not null, alter column longitud set not null;
alter table public.lugares add constraint lugares_radio_check check (radio_m between 20 and 5000);
alter table public.lugares drop column tipo;
drop table public.tipos_lugar;

-- Without a place every activation of a member counts; with one, only those within radio_m (copied from the place, editable per event).
create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) <> ''),
  lugar_id uuid references public.lugares(id) on delete restrict,
  radio_m integer check (radio_m between 20 and 5000),
  inicio timestamptz not null,
  fin timestamptz,
  cancelado_at timestamptz,
  creado_por uuid references public.activadores(usuario_id),
  created_at timestamptz not null default now(),
  constraint eventos_rango_check check (fin is null or fin > inicio),
  constraint eventos_radio_lugar_check check ((lugar_id is null) = (radio_m is null))
);

create index idx_eventos_lugar on public.eventos using btree (lugar_id);

create table public.evento_activadores (
  evento_id uuid not null references public.eventos(id) on delete cascade,
  activador_id uuid not null references public.activadores(usuario_id) on delete restrict,
  agregado_por uuid references public.activadores(usuario_id),
  created_at timestamptz not null default now(),
  primary key (evento_id, activador_id)
);

create index idx_evento_activadores_activador on public.evento_activadores using btree (activador_id);

alter table public.eventos enable row level security;
alter table public.evento_activadores enable row level security;

alter table public.activaciones add column evento_id uuid references public.eventos(id) on delete set null;
create index idx_activaciones_evento on public.activaciones using btree (evento_id) where evento_id is not null;

-- Each assignment batch becomes one event (same id). Activations already tied to a place keep it through their batch, even one cancelled after the fact; a batch with activations is never a cancelled event.
create temp table activacion_lote on commit drop as
select distinct on (x.id) x.id as activacion_id, a.lote_id, a.activador_id
from public.activaciones x
join public.lugar_asignaciones a on a.activador_id = x.usuario_id and a.lugar_id = x.lugar_id
  and x.created_at >= a.inicio and x.created_at < a.fin
where x.lugar_id is not null
order by x.id, (a.cancelado_at is null or a.cancelado_at > x.created_at) desc, a.inicio desc;

insert into public.eventos (id, nombre, lugar_id, radio_m, inicio, fin, cancelado_at, creado_por, created_at)
select a.lote_id, l.nombre, l.id, l.radio_m, min(a.inicio), max(a.fin),
  case when bool_and(a.cancelado_at is not null)
    and not exists (select 1 from activacion_lote al where al.lote_id = a.lote_id) then max(a.cancelado_at) end,
  (array_agg(a.creado_por order by a.created_at))[1], min(a.created_at)
from public.lugar_asignaciones a join public.lugares l on l.id = a.lugar_id
group by a.lote_id, l.id;

insert into public.evento_activadores (evento_id, activador_id, agregado_por, created_at)
select distinct on (a.lote_id, a.activador_id) a.lote_id, a.activador_id, a.creado_por, a.created_at
from public.lugar_asignaciones a join public.eventos e on e.id = a.lote_id
where a.cancelado_at is null or e.cancelado_at is not null
  or exists (select 1 from activacion_lote al where al.lote_id = a.lote_id and al.activador_id = a.activador_id)
order by a.lote_id, a.activador_id, a.created_at;

update public.activaciones x set evento_id = al.lote_id
from activacion_lote al
where x.id = al.activacion_id;

do $$
declare
  v_sin_evento integer;
begin
  select count(*) into v_sin_evento from public.activaciones where lugar_id is not null and evento_id is null;
  if v_sin_evento > 0 then
    raise exception '% activations with a place found no event', v_sin_evento;
  end if;
end $$;

drop trigger trg_vincular_viaje_y_lugar on public.activaciones;
drop function public.vincular_viaje_y_lugar();
drop table public.lugar_asignaciones;

-- Several open events may overlap for one activator: the one whose place is nearest wins, then events without a place, then the latest start.
create function public.vincular_viaje_y_evento() returns trigger
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
      new.evento_id := old.evento_id;
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

  select c.evento_id, c.lugar_id, c.distancia into new.evento_id, new.lugar_id, new.distancia_lugar_m
  from (
    select e.id as evento_id, e.lugar_id, e.radio_m, e.inicio,
      case when l.id is not null then extensions.st_distance(
        extensions.st_makepoint(l.longitud, l.latitud)::extensions.geography,
        extensions.st_makepoint(new.longitud, new.latitud)::extensions.geography
      ) end as distancia
    from public.evento_activadores ea
    join public.eventos e on e.id = ea.evento_id
    left join public.lugares l on l.id = e.lugar_id
    where ea.activador_id = new.usuario_id and e.cancelado_at is null
      and v_momento >= e.inicio and (e.fin is null or v_momento < e.fin)
  ) c
  where c.lugar_id is null or c.distancia <= c.radio_m
  order by c.distancia nulls last, c.inicio desc
  limit 1;

  return new;
end;
$$;

revoke all on function public.vincular_viaje_y_evento() from public, anon, authenticated;

create trigger trg_vincular_viaje_y_evento
  before insert or update of viaje_id, evento_id, lugar_id, distancia_lugar_m on public.activaciones
  for each row execute function public.vincular_viaje_y_evento();
