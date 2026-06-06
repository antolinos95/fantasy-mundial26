-- schema_v11: Triggers automáticos para Web Push
-- Llama al edge function notify_push vía pg_net (HTTP).
-- Requiere: extensión pg_net habilitada en Supabase (ya activa por defecto).

-- ─────────────────────────────────────────────
-- Helper: llama al API /api/push/send del proyecto
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION call_push_send(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  PERFORM net.http_post(
    url     := current_setting('app.push_send_url', true),
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-push-secret',  current_setting('app.push_secret', true)
    ),
    body    := payload::text
  );
END;
$func$;

-- Configura estos valores en Supabase → Settings → Database → Custom config:
--   app.push_send_url = https://TU-DOMINIO.vercel.app/api/push/send
--   app.push_secret   = fm26_push_secret_changeme  (igual que .env.local)

-- ─────────────────────────────────────────────
-- Trigger 1: Nuevo evento de jugador (gol, etc.)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_push_player_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_match  matches%ROWTYPE;
  v_label  text;
  v_body   text;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = NEW.match_id;

  v_label := CASE NEW.event_type
    WHEN 'goal'             THEN 'Gol ⚽'
    WHEN 'goal_extra_time'  THEN 'Gol en prorroga ⚽'
    WHEN 'penalty_shootout' THEN 'Gol en penaltis 🥅'
    WHEN 'red_card'         THEN 'Tarjeta roja 🟥'
    WHEN 'own_goal'         THEN 'Gol en propia puerta 🤦'
    ELSE NEW.event_type
  END;

  v_body := v_label || ' — partido ' ||
            coalesce((SELECT name FROM teams WHERE id = v_match.home_team_id), '?') ||
            ' vs ' ||
            coalesce((SELECT name FROM teams WHERE id = v_match.away_team_id), '?');

  PERFORM call_push_send(jsonb_build_object(
    'title',  'Fantasy Mundial 🏆',
    'body',   v_body,
    'url',    '/standings'
  ));

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_push_player_event ON player_events;
CREATE TRIGGER trg_push_player_event
  AFTER INSERT ON player_events
  FOR EACH ROW EXECUTE FUNCTION notify_push_player_event();

-- ─────────────────────────────────────────────
-- Trigger 2: Partido finalizado → resultado
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_push_match_finished()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_home text;
  v_away text;
BEGIN
  -- Solo disparar cuando cambia a 'finished'
  IF NEW.status = 'finished' AND (OLD.status IS DISTINCT FROM 'finished') THEN
    SELECT name INTO v_home FROM teams WHERE id = NEW.home_team_id;
    SELECT name INTO v_away FROM teams WHERE id = NEW.away_team_id;

    PERFORM call_push_send(jsonb_build_object(
      'title', 'Resultado final ⚽',
      'body',  coalesce(v_home,'?') || ' ' || NEW.home_goals || ' - ' ||
               NEW.away_goals || ' ' || coalesce(v_away,'?') ||
               ' — ¡Revisa tus puntos!',
      'url',   '/standings'
    ));
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_push_match_finished ON matches;
CREATE TRIGGER trg_push_match_finished
  AFTER UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION notify_push_match_finished();

-- ─────────────────────────────────────────────
-- pg_cron: ver schema_v11b_push_cron.sql
-- Ejecutar ese archivo POR SEPARADO después de habilitar pg_cron en
-- Supabase → Database → Extensions → pg_cron
-- ─────────────────────────────────────────────
