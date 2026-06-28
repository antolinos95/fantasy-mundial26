-- schema_v22a: funciones wildcard diferido
-- Ejecutar PRIMERO este archivo, luego schema_v22b_recalculate.sql

DROP FUNCTION IF EXISTS enter_wildcard(uuid, uuid, uuid, uuid);

ALTER TABLE wildcard_entries ADD COLUMN IF NOT EXISTS cost_charged boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION enter_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid, p_qualifier_pick uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO wildcard_entries(league_id, player_id, match_id, qualifier_pick, cost_charged)
  VALUES(p_league_id, p_player_id, p_match_id, p_qualifier_pick, false);
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION apply_wildcard_cost(
  p_league_id uuid, p_player_id uuid, p_match_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rank    integer;
  v_cost    integer;
  v_charged boolean;
BEGIN
  SELECT cost_charged INTO v_charged FROM wildcard_entries
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;
  IF NOT FOUND OR v_charged THEN RETURN 0; END IF;

  SELECT pos INTO v_rank FROM (
    SELECT player_id, RANK() OVER (ORDER BY points DESC NULLS LAST) AS pos
    FROM scores WHERE league_id = p_league_id
  ) r WHERE player_id = p_player_id;

  v_cost := CASE
    WHEN COALESCE(v_rank, 99) <= 2 THEN 2
    WHEN COALESCE(v_rank, 99) <= 5 THEN 1
    ELSE 0
  END;

  UPDATE wildcard_entries SET cost_charged = true
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;

  IF v_cost > 0 THEN
    INSERT INTO score_log(league_id, player_id, match_id, category, points, detail)
    VALUES(p_league_id, p_player_id, p_match_id, 'wildcard_entry', -v_cost,
      CASE v_cost WHEN 2 THEN 'Entrada wildcard (−2 pts)' ELSE 'Entrada wildcard (−1 pt)' END);
    DELETE FROM scores WHERE league_id=p_league_id AND player_id=p_player_id;
    INSERT INTO scores(league_id, player_id, points)
    SELECT league_id, player_id, SUM(points)
    FROM score_log WHERE league_id=p_league_id AND player_id=p_player_id
    GROUP BY league_id, player_id;
  END IF;

  RETURN v_cost;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_charged boolean;
BEGIN
  SELECT cost_charged INTO v_charged FROM wildcard_entries
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_charged THEN RETURN false; END IF;
  DELETE FROM wildcard_entries WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;
  DELETE FROM match_lineups WHERE match_id=p_match_id AND player_id=p_player_id AND is_wildcard=true;
  DELETE FROM predictions WHERE match_id=p_match_id AND player_id=p_player_id AND is_wildcard=true;
  RETURN true;
END;
$$;
