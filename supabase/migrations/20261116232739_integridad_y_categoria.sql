-- Missing foreign keys and NOT NULLs on columns that are never null in production.

ALTER TABLE public.activaciones
  ALTER COLUMN usuario_id SET NOT NULL,
  ALTER COLUMN fecha_activacion SET NOT NULL,
  ADD CONSTRAINT activaciones_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.activadores(usuario_id) ON DELETE RESTRICT;

ALTER TABLE public.activadores
  ADD CONSTRAINT activadores_lider_id_fkey
    FOREIGN KEY (lider_id) REFERENCES public.activadores(usuario_id) ON DELETE SET NULL;

ALTER TABLE public.notificaciones_destinatarios
  ADD CONSTRAINT notificaciones_destinatarios_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES public.activadores(usuario_id) ON DELETE CASCADE;

ALTER TABLE public.notificaciones
  ADD CONSTRAINT notificaciones_usuario_objetivo_id_fkey
    FOREIGN KEY (usuario_objetivo_id) REFERENCES public.activadores(usuario_id) ON DELETE SET NULL;

CREATE INDEX idx_activaciones_created_at_id ON public.activaciones USING btree (created_at DESC, id);
CREATE INDEX idx_activadores_lider_id ON public.activadores USING btree (lider_id);
CREATE INDEX idx_notificaciones_usuario_objetivo ON public.notificaciones USING btree (usuario_objetivo_id);

-- Never read or written by any build; always null in production.
ALTER TABLE public.activaciones DROP COLUMN foto_respaldo_url;

-- Category stored on the row instead of being inferred from base_activacion and tamano_tienda.

CREATE TABLE public.categorias_activacion (
    codigo text PRIMARY KEY,
    etiqueta text NOT NULL
);

ALTER TABLE public.categorias_activacion ENABLE ROW LEVEL SECURITY;

INSERT INTO public.categorias_activacion (codigo, etiqueta) VALUES
  ('comercio', 'Comercio'),
  ('tienda_barrio', 'Tienda de Barrio'),
  ('transeunte', 'Transeúnte'),
  ('cliente_antiguo', 'Cliente antiguo');

ALTER TABLE public.activaciones
  ADD COLUMN categoria text REFERENCES public.categorias_activacion(codigo);

CREATE FUNCTION public.categoria_desde_base(p_base text, p_tamano text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  select case
    when p_base in ('comercio', 'tienda_barrio', 'transeunte', 'cliente_antiguo') then p_base
    when p_tamano is not null then 'tienda_barrio'
    when p_base in ('none', 'limbo') then 'comercio'
  end
$$;

UPDATE public.activaciones
SET categoria = public.categoria_desde_base(base_activacion, tamano_tienda);

-- SECURITY DEFINER because categoria_desde_base is not executable by the roles that insert.
CREATE FUNCTION public.completar_categoria_activacion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- Builds that do not send categoria keep working: it is derived from the legacy columns.
  if tg_op = 'INSERT' then
    new.categoria := coalesce(new.categoria, public.categoria_desde_base(new.base_activacion, new.tamano_tienda));
  elsif new.categoria is not distinct from old.categoria then
    new.categoria := coalesce(public.categoria_desde_base(new.base_activacion, new.tamano_tienda), old.categoria);
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION public.completar_categoria_activacion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.categoria_desde_base(text, text) FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_completar_categoria_activacion
  BEFORE INSERT OR UPDATE OF base_activacion, tamano_tienda, categoria ON public.activaciones
  FOR EACH ROW EXECUTE FUNCTION public.completar_categoria_activacion();

ALTER TABLE public.activaciones ALTER COLUMN categoria SET NOT NULL;

CREATE INDEX idx_activaciones_categoria_fecha ON public.activaciones USING btree (categoria, fecha_activacion);
