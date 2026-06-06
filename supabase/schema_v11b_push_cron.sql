-- schema_v11b: pg_cron para cierre de mercado (Web Push)
-- REQUISITO: habilitar pg_cron en Supabase → Database → Extensions → pg_cron
-- Ejecutar DESPUÉS de schema_v11_push_triggers.sql

-- Eliminar job previo si existe (idempotente)
SELECT cron.unschedule('push-market-close') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'push-market-close'
);

-- Corre cada hora — comprueba si el cierre de mercado ocurre en los próximos 60 min
SELECT cron.schedule(
  'push-market-close',
  '0 * * * *',
  $$
  DO $body$
  DECLARE
    v_next_match matches%ROWTYPE;
    v_closes_at  timestamptz;
    v_home       text;
    v_away       text;
  BEGIN
    SELECT * INTO v_next_match
    FROM matches
    WHERE match_date::date = now()::date
      AND status = 'scheduled'
    ORDER BY match_date
    LIMIT 1;

    IF NOT FOUND THEN RETURN; END IF;

    v_closes_at := v_next_match.match_date - interval '2 hours';

    IF v_closes_at BETWEEN now() AND now() + interval '60 minutes' THEN
      SELECT name INTO v_home FROM teams WHERE id = v_next_match.home_team_id;
      SELECT name INTO v_away FROM teams WHERE id = v_next_match.away_team_id;

      PERFORM call_push_send(jsonb_build_object(
        'title', '⏰ Cierre de mercado en 2 h',
        'body',  'Pon tu porra y alineación para ' ||
                 coalesce(v_home,'?') || ' vs ' || coalesce(v_away,'?'),
        'url',   '/standings'
      ));
    END IF;
  END;
  $body$
  $$
);
