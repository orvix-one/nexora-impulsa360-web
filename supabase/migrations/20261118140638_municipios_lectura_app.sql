-- The app names the destination of the activator's trip; official geography is public, the polygons are not needed.
grant select (id, nombre, nombre_comun) on public.municipios to authenticated;

create policy municipios_select_authenticated on public.municipios
  for select to authenticated
  using (true);
