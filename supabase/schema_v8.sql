-- ============================================================
-- v8: Autopick del draft con temporizador (opción del admin)
-- Ejecutar ENTERO en el SQL Editor de Supabase
-- ============================================================

-- 1. Columnas nuevas
ALTER TABLE leagues     ADD COLUMN IF NOT EXISTS draft_timer_seconds integer;       -- NULL/0 = desactivado
ALTER TABLE draft_state ADD COLUMN IF NOT EXISTS turn_started_at timestamptz;       -- inicio del turno actual

-- 2. Autopick para una liga si el turno ha expirado (atómico con FOR UPDATE)
CREATE OR REPLACE FUNCTION autopick_if_expired(p_league_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_state   draft_state%ROWTYPE;
  v_timer   integer;
  v_n       integer;
  v_round   integer; v_pos integer; v_idx integer;
  v_player  uuid;
  v_team    uuid;
  v_needed  integer;
  v_picks   integer;
BEGIN
  SELECT draft_timer_seconds INTO v_timer FROM leagues WHERE id = p_league_id;
  IF v_timer IS NULL OR v_timer <= 0 THEN RETURN false; END IF;

  -- Bloquea la fila para serializar el autopick entre clientes/cron
  SELECT * INTO v_state FROM draft_state WHERE league_id = p_league_id FOR UPDATE;
  IF NOT FOUND OR NOT v_state.started OR v_state.finished THEN RETURN false; END IF;
  IF v_state.turn_started_at IS NULL
     OR v_state.turn_started_at + (v_timer || ' seconds')::interval > now() THEN
    RETURN false;  -- aún no expira
  END IF;

  SELECT count(*) INTO v_n FROM draft_order WHERE league_id = p_league_id;
  IF v_n = 0 THEN RETURN false; END IF;

  -- Jugador del turno (orden serpiente)
  v_round := floor((v_state.current_pick - 1) / v_n);
  v_pos   := (v_state.current_pick - 1) % v_n;
  v_idx   := CASE WHEN v_round % 2 = 0 THEN v_pos ELSE v_n - 1 - v_pos END;
  SELECT player_id INTO v_player FROM draft_order
    WHERE league_id = p_league_id AND draft_position = v_idx + 1;
  IF v_player IS NULL THEN RETURN false; END IF;

  -- Mejor disponible (primer equipo libre por nombre)
  SELECT t.id INTO v_team FROM teams t
  WHERE t.id NOT IN (SELECT team_id FROM drafted_teams WHERE league_id = p_league_id)
  ORDER BY t.name LIMIT 1;
  IF v_team IS NULL THEN RETURN false; END IF;

  INSERT INTO drafted_teams(league_id, team_id, player_id, pick_number)
  VALUES (p_league_id, v_team, v_player, v_state.current_pick);

  v_needed := v_n * v_state.teams_per_player;
  SELECT count(*) INTO v_picks FROM drafted_teams WHERE league_id = p_league_id;

  IF v_picks >= v_needed THEN
    UPDATE draft_state SET current_pick = current_pick + 1, finished = true, turn_started_at = now()
      WHERE league_id = p_league_id;
    UPDATE leagues SET status = 'active' WHERE id = p_league_id;
  ELSE
    UPDATE draft_state SET current_pick = current_pick + 1,
      round = floor(current_pick / v_n) + 1, turn_started_at = now()
      WHERE league_id = p_league_id;
  END IF;
  RETURN true;
END;
$func$;

-- 3. Barrido para todas las ligas (lo llama el cron)
CREATE OR REPLACE FUNCTION auto_advance_drafts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE r record;
BEGIN
  FOR r IN SELECT league_id FROM draft_state WHERE started AND NOT finished LOOP
    PERFORM autopick_if_expired(r.league_id);
  END LOOP;
END;
$func$;

GRANT EXECUTE ON FUNCTION autopick_if_expired(uuid) TO anon, authenticated;

-- 4. Programar el cron (requiere extensión pg_cron habilitada en Supabase:
--    Dashboard → Database → Extensions → activar "pg_cron")
--    Ejecuta esto UNA vez:
-- SELECT cron.schedule('auto-advance-drafts', '* * * * *', $$SELECT auto_advance_drafts()$$);
