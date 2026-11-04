-- Reactivation and QR reprint require 60 days since the last activation (was 90), and Tienda de Barrio "config_cuenta" is unified into "limbo".

CREATE OR REPLACE FUNCTION public.validar_elegibilidad_reactivacion(p_ci text DEFAULT NULL::text, p_telefono text DEFAULT NULL::text, p_tipo_activacion text DEFAULT NULL::text, p_fecha_referencia date DEFAULT CURRENT_DATE, p_registro_id uuid DEFAULT NULL::uuid) RETURNS TABLE(eligible boolean, reason text, previous_activation_date date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_usuario_id uuid := auth.uid();
  v_tipo text := lower(coalesce(p_tipo_activacion, ''));
  v_ci text := upper(regexp_replace(coalesce(p_ci, ''), '[^0-9A-Za-z]', '', 'g'));
  v_telefono_digits text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_telefono text;
  v_fecha_referencia date := coalesce(p_fecha_referencia, current_date);
  v_limite date;
begin
  if v_usuario_id is null then
    raise exception using errcode = '42501', message = 'Sesión autenticada requerida.';
  end if;

  if not exists (
    select 1
    from public.activadores a
    where a.usuario_id = v_usuario_id
      and lower(btrim(coalesce(a.estado, ''))) = 'activo'
  ) then
    raise exception using errcode = '42501', message = 'Usuario inexistente o inactivo.';
  end if;

  if v_fecha_referencia < current_date - 1 or v_fecha_referencia > current_date + 1 then
    v_fecha_referencia := current_date;
  end if;
  v_limite := v_fecha_referencia - 60;

  if not (v_tipo like 'reactivacion%' or v_tipo = 'reimpresion_qr') then
    return query select true, null::text, null::date;
    return;
  end if;

  v_telefono := case
    when length(v_telefono_digits) > 8 then right(v_telefono_digits, 8)
    else v_telefono_digits
  end;

  if v_ci = '' and v_telefono = '' then
    return query select true, null::text, null::date;
    return;
  end if;

  return query
  with recientes as (
    select
      a.id,
      coalesce(a.fecha_activacion, a.created_at::date) as fecha,
      upper(regexp_replace(coalesce(a.ci_cliente, ''), '[^0-9A-Za-z]', '', 'g')) as ci_norm,
      case
        when length(regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g')) > 8
          then right(regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g'), 8)
        else regexp_replace(coalesce(a.telefono_cliente, ''), '\D', '', 'g')
      end as telefono_norm
    from public.activaciones a
    where (p_registro_id is null or a.id <> p_registro_id)
      and coalesce(a.fecha_activacion, a.created_at::date) > v_limite
      and coalesce(a.fecha_activacion, a.created_at::date) <= v_fecha_referencia
  ),
  coincidencia as (
    select r.fecha
    from recientes r
    where (v_ci <> '' and r.ci_norm = v_ci)
       or (v_telefono <> '' and r.telefono_norm = v_telefono)
    order by r.fecha desc
    limit 1
  )
  select
    (c.fecha is null) as eligible,
    case
      when c.fecha is null then null::text
      else 'periodo_minimo_no_cumplido'
    end as reason,
    c.fecha as previous_activation_date
  from (select null::date) base
  left join coincidencia c on true;
end;
$$;


-- Tienda de Barrio and Comercio now share tipo_activacion 'limbo'; the group stays distinguishable through base_activacion.
CREATE OR REPLACE FUNCTION public.normalizar_tipo_activacion_limbo() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  -- Mobile builds up to 1.0.32 still send 'config_cuenta'.
  if lower(btrim(coalesce(new.tipo_activacion, ''))) = 'config_cuenta' then
    new.tipo_activacion := 'limbo';
    new.base_activacion := coalesce(nullif(btrim(new.base_activacion), ''), 'tienda_barrio');
  end if;
  return new;
end;
$$;

REVOKE ALL ON FUNCTION public.normalizar_tipo_activacion_limbo() FROM PUBLIC;

CREATE TRIGGER trg_normalizar_tipo_activacion_limbo
  BEFORE INSERT OR UPDATE OF tipo_activacion ON public.activaciones
  FOR EACH ROW EXECUTE FUNCTION public.normalizar_tipo_activacion_limbo();

UPDATE public.activaciones
SET tipo_activacion = 'limbo',
    base_activacion = coalesce(nullif(btrim(base_activacion), ''), 'tienda_barrio')
WHERE lower(btrim(tipo_activacion)) = 'config_cuenta';
