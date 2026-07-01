-- schema_v25: enter_wildcard aplica coste automáticamente si el partido ya finalizó

CREATE OR REPLACE FUNCTION enter_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid, p_qualifier_pick uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  INSERT INTO wildcard_entries(league_id, player_id, match_id, qualifier_pick, cost_charged)
  VALUES(p_league_id, p_player_id, p_match_id, p_qualifier_pick, false);

  -- Si el partido ya terminó, cobrar el coste inmediatamente
  SELECT status INTO v_status FROM matches WHERE id = p_match_id;
  IF v_status = 'finished' THEN
    PERFORM apply_wildcard_cost(p_league_id, p_player_id, p_match_id);
  END IF;

  RETURN 0;
END;
$$;
