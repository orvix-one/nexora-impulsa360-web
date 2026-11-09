-- Telemetry is retired: mobile 1.0.34 (build 88) no longer sends events.
-- Builds <= 87 still call registrar_eventos_telemetria, so it stays as a no-op that reports success and lets them empty their local outbox.
-- Drop the function once no build <= 87 is in the field.

CREATE OR REPLACE FUNCTION public.registrar_eventos_telemetria(p_eventos jsonb) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$ select 0 $$;

DROP TABLE public.telemetria_eventos;
