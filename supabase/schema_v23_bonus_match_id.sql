-- schema_v23: asociar bonus de clasificación al match de la eliminatoria
-- 1. award_qualification_bonus acepta p_match_id opcional
-- 2. Trigger auto_award_qualification_bonus pasa NEW.id
-- 3. Backfill de bonus existentes sin match_id

-- ── 1. Función con p_match_id ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION award_qualification_bonus(
  p_league_id uuid, p_team_id uuid, p_stage text, p_match_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_owner uuid;
  v_pts   integer := CASE p_stage WHEN 'r16' THEN 1 WHEN 'qf' THEN 3 WHEN 'sf' THEN 5 WHEN 'final' THEN 8 ELSE 0 END;
  v_label text    := CASE p_stage WHEN 'r16' THEN 'Octavos' WHEN 'qf' THEN 'Cuartos' WHEN 'sf' THEN 'Semifinal' WHEN 'final' THEN 'Final' ELSE p_stage END;
BEGIN
  IF EXISTS(SELECT 1 FROM qualification_bonuses WHERE league_id=p_league_id AND team_id=p_team_id AND stage=p_stage) THEN RETURN; END IF;
  SELECT player_id INTO v_owner FROM drafted_teams WHERE team_id=p_team_id AND league_id=p_league_id LIMIT 1;
  IF v_owner IS NULL THEN RETURN; END IF;

  INSERT INTO qualification_bonuses(league_id,team_id,stage) VALUES(p_league_id,p_team_id,p_stage);
  INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
  VALUES(p_league_id,v_owner,p_match_id,'bonus',v_pts,'Bono ' || v_label);

  DELETE FROM scores WHERE league_id=p_league_id;
  INSERT INTO scores(league_id,player_id,points)
  SELECT league_id,player_id,SUM(points) FROM score_log WHERE league_id=p_league_id GROUP BY league_id,player_id;
END;
$func$;

-- ── 2. Trigger pasa NEW.id ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_award_qualification_bonus()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_next_stage  text;
  v_winner_team uuid;
  v_league_id   uuid;
BEGIN
  IF NEW.status <> 'finished' OR NEW.home_goals IS NULL OR NEW.match_type IS NULL THEN RETURN NEW; END IF;
  IF NEW.match_type NOT IN ('r32', 'r16', 'qf', 'sf', 'final') THEN RETURN NEW; END IF;

  IF NEW.home_goals > NEW.away_goals THEN
    v_winner_team := NEW.home_team_id;
  ELSIF NEW.away_goals > NEW.home_goals THEN
    v_winner_team := NEW.away_team_id;
  ELSE
    -- Empate en 90': ganador por winner_team_id (prórroga/penaltis)
    v_winner_team := NEW.winner_team_id;
  END IF;

  IF v_winner_team IS NULL THEN RETURN NEW; END IF;

  v_next_stage := CASE NEW.match_type
    WHEN 'r32'   THEN 'r16'
    WHEN 'r16'   THEN 'qf'
    WHEN 'qf'    THEN 'sf'
    WHEN 'sf'    THEN 'final'
    WHEN 'final' THEN NULL
  END;

  IF v_next_stage IS NULL THEN RETURN NEW; END IF;

  FOR v_league_id IN (
    SELECT DISTINCT p.league_id FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_winner_team
  ) LOOP
    PERFORM award_qualification_bonus(v_league_id, v_winner_team, v_next_stage, NEW.id);
  END LOOP;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_auto_qualification_bonus ON matches;
CREATE TRIGGER trg_auto_qualification_bonus
AFTER UPDATE ON matches
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'finished')
EXECUTE FUNCTION auto_award_qualification_bonus();

-- ── 3. Backfill: asignar match_id a bonus existentes ────────────────────────
UPDATE score_log sl
SET match_id = m.id
FROM matches m, drafted_teams dt
WHERE sl.category = 'bonus'
  AND sl.match_id IS NULL
  AND dt.player_id = sl.player_id
  AND dt.league_id = sl.league_id
  AND m.status = 'finished'
  AND m.match_type = CASE sl.detail
    WHEN 'Bono Octavos'   THEN 'r32'
    WHEN 'Bono Cuartos'   THEN 'r16'
    WHEN 'Bono Semifinal' THEN 'qf'
    WHEN 'Bono Final'     THEN 'sf'
    ELSE NULL
  END
  AND (
    m.winner_team_id = dt.team_id
    OR (m.winner_team_id IS NULL AND m.home_goals > m.away_goals AND m.home_team_id = dt.team_id)
    OR (m.winner_team_id IS NULL AND m.away_goals > m.home_goals AND m.away_team_id = dt.team_id)
  );
