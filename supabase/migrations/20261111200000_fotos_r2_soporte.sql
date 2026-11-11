-- Photo archiving to Cloudflare R2 (server/archivarFotos.js) and real database size for the capacity page.
-- Only photos referenced by exactly one activaciones column are candidates: unreferenced objects may belong to an offline sync in progress.

CREATE OR REPLACE FUNCTION public.listar_fotos_para_archivar(p_bucket text, p_antes timestamptz, p_limite integer)
RETURNS TABLE (name text, size bigint, activacion_id uuid, campo text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with refs as (
    select a.id, 'foto_url'::text as campo, a.foto_url as valor
    from public.activaciones a
    where a.foto_url is not null and a.foto_url not like 'r2:%'
    union all
    select a.id, 'foto_cash_in'::text, a.foto_cash_in
    from public.activaciones a
    where a.foto_cash_in is not null and a.foto_cash_in not like 'r2:%'
  ),
  unicos as (
    select r.valor from refs r group by r.valor having count(*) = 1
  )
  select o.name, (o.metadata->>'size')::bigint, r.id, r.campo
  from storage.objects o
  join refs r on r.valor = o.name
  join unicos u on u.valor = o.name
  where o.bucket_id = p_bucket
    and o.created_at < p_antes
  order by o.created_at
  limit p_limite
$$;

REVOKE ALL ON FUNCTION public.listar_fotos_para_archivar(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listar_fotos_para_archivar(text, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_database_size_bytes()
RETURNS bigint
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select pg_catalog.pg_database_size(pg_catalog.current_database())
$$;

REVOKE ALL ON FUNCTION public.get_database_size_bytes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_size_bytes() TO service_role;
