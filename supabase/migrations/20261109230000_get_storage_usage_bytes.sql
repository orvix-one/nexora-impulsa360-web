-- Capacity summary for the admin portal: walking the bucket via the Storage API takes over a minute, this is one indexed query.

CREATE OR REPLACE FUNCTION public.get_storage_usage_bytes(p_bucket text)
RETURNS TABLE (total_bytes bigint, total_objects bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint, count(*)::bigint
  from storage.objects o
  where o.bucket_id = p_bucket
    and o.name not like '%.emptyFolderPlaceholder'
$$;

REVOKE ALL ON FUNCTION public.get_storage_usage_bytes(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_bytes(text) TO service_role;
