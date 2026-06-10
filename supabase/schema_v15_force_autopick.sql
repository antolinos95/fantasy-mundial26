-- schema_v15: force_autopick — el admin puede forzar el pick del turno actual
-- sin depender del timer. Misma lógica que autopick_if_expired pero sin
-- comprobar si el tiempo ha expirado.

CREATE OR REPLACE FUNCTION force_autopick(p_league_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_state   draft_state%ROWTYPE;
  v_n       integer;
  v_round   integer; v_pos integer; v_idx integer;
  v_player  uuid;
  v_team    uuid;
  v_needed  integer;
  v_picks   integer;
BEGIN
  SELECT * INTO v_state FROM draft_state WHERE league_id = p_league_id FOR UPDATE;
  IF NOT FOUND OR NOT v_state.started OR v_state.finished THEN RETURN false; END IF;

  SELECT count(*) INTO v_n FROM draft_order WHERE league_id = p_league_id;
  IF v_n = 0 THEN RETURN false; END IF;

  v_round := floor((v_state.current_pick - 1) / v_n);
  v_pos   := (v_state.current_pick - 1) % v_n;
  v_idx   := CASE WHEN v_round % 2 = 0 THEN v_pos ELSE v_n - 1 - v_pos END;
  SELECT player_id INTO v_player FROM draft_order
    WHERE league_id = p_league_id AND draft_position = v_idx + 1;
  IF v_player IS NULL THEN RETURN false; END IF;

  -- (a) primera de su cola que siga libre
  SELECT dq.team_id INTO v_team
  FROM draft_queue dq
  WHERE dq.player_id = v_player
    AND dq.team_id NOT IN (SELECT team_id FROM drafted_teams WHERE league_id = p_league_id)
  ORDER BY dq.rank LIMIT 1;

  -- (b) fallback: primer disponible por nombre
  IF v_team IS NULL THEN
    SELECT t.id INTO v_team FROM teams t
    WHERE t.id NOT IN (SELECT team_id FROM drafted_teams WHERE league_id = p_league_id)
    ORDER BY t.name LIMIT 1;
  END IF;
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
