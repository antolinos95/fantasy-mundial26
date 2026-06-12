-- schema_v17: notificaciones push inteligentes
-- Solo avisa a propietarios de equipos que juegan y no han completado porra/jugadores.
-- Reemplaza el cron de schema_v11b_push_cron.sql

-- Eliminar cron anterior
SELECT cron.unschedule('push-market-close')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-market-close');

-- Nuevo cron horario con filtrado inteligente
SELECT cron.schedule(
  'push-market-close',
  '0 * * * *',
  $$
  DO $body$
  DECLARE
    v_match      matches%ROWTYPE;
    v_closes_at  timestamptz;
    v_home       text;
    v_away       text;
    v_player     RECORD;
    v_user_ids   jsonb := '[]'::jsonb;
    v_has_pred   boolean;
    v_has_lineup boolean;
  BEGIN
    -- Buscar partidos cuyo cierre de mercado ocurre en la próxima hora
    FOR v_match IN
      SELECT * FROM matches
      WHERE status = 'scheduled'
        AND match_date - interval '12 hours' BETWEEN now() AND now() + interval '60 minutes'
    LOOP
      SELECT name INTO v_home FROM teams WHERE id = v_match.home_team_id;
      SELECT name INTO v_away FROM teams WHERE id = v_match.away_team_id;

      v_user_ids := '[]'::jsonb;

      -- Por cada jugador propietario de alguno de los dos equipos (en cualquier liga)
      FOR v_player IN
        SELECT DISTINCT p.id AS player_id, p.user_id, p.league_id
        FROM drafted_teams dt
        JOIN players p ON p.id = dt.player_id
        WHERE dt.team_id IN (v_match.home_team_id, v_match.away_team_id)
          AND p.user_id IS NOT NULL
      LOOP
        -- Comprobar si ya tiene porra para este partido
        SELECT EXISTS(
          SELECT 1 FROM predictions
          WHERE match_id = v_match.id AND player_id = v_player.player_id
            AND is_wildcard IS NOT TRUE
        ) INTO v_has_pred;

        -- Comprobar si ya tiene 3 jugadores elegidos para sus equipos en este partido
        SELECT (
          SELECT COUNT(*)
          FROM match_lineups ml
          JOIN drafted_teams dt2 ON dt2.team_id = ml.team_id
            AND dt2.player_id = v_player.player_id
          WHERE ml.match_id = v_match.id
            AND ml.player_id = v_player.player_id
            AND ml.is_wildcard IS NOT TRUE
        ) >= 3 INTO v_has_lineup;

        -- Notificar solo si le falta porra O jugadores
        IF NOT v_has_pred OR NOT v_has_lineup THEN
          v_user_ids := v_user_ids || jsonb_build_array(v_player.user_id::text);
        END IF;
      END LOOP;

      -- Enviar solo si hay alguien pendiente
      IF jsonb_array_length(v_user_ids) > 0 THEN
        PERFORM call_push_send(jsonb_build_object(
          'title', '⏰ Cierre de mercado en 12 h',
          'body',  'Pon tu porra y alineación para ' ||
                   coalesce(v_home,'?') || ' vs ' || coalesce(v_away,'?'),
          'url',   '/standings',
          'userIds', v_user_ids
        ));
      END IF;

    END LOOP;
  END;
  $body$
  $$
);

-- Cron cada 5 min: avisa cuando un partido tuyo está a punto de empezar
SELECT cron.unschedule('push-match-starting')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-match-starting');

SELECT cron.schedule(
  'push-match-starting',
  '*/5 * * * *',
  $$
  DO $body$
  DECLARE
    v_match    matches%ROWTYPE;
    v_home     text;
    v_away     text;
    v_player   RECORD;
    v_user_ids jsonb := '[]'::jsonb;
  BEGIN
    -- Partidos que empiezan en los próximos 5 minutos
    FOR v_match IN
      SELECT * FROM matches
      WHERE status = 'scheduled'
        AND match_date BETWEEN now() AND now() + interval '5 minutes'
    LOOP
      SELECT name INTO v_home FROM teams WHERE id = v_match.home_team_id;
      SELECT name INTO v_away FROM teams WHERE id = v_match.away_team_id;

      v_user_ids := '[]'::jsonb;

      FOR v_player IN
        SELECT DISTINCT p.user_id
        FROM drafted_teams dt
        JOIN players p ON p.id = dt.player_id
        WHERE dt.team_id IN (v_match.home_team_id, v_match.away_team_id)
          AND p.user_id IS NOT NULL
      LOOP
        v_user_ids := v_user_ids || jsonb_build_array(v_player.user_id::text);
      END LOOP;

      IF jsonb_array_length(v_user_ids) > 0 THEN
        PERFORM call_push_send(jsonb_build_object(
          'title', '🔴 ¡Partido a punto de empezar!',
          'body',  coalesce(v_home,'?') || ' vs ' || coalesce(v_away,'?') || ' comienza ahora',
          'url',   '/standings',
          'userIds', v_user_ids
        ));
      END IF;

    END LOOP;
  END;
  $body$
  $$
);
