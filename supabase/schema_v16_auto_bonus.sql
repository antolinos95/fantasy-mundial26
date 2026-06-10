-- schema_v16: bonificaciones de clasificación automáticas
-- Al terminar un partido eliminatorio, el ganador recibe automáticamente
-- el bono de la siguiente ronda (r32→r16, r16→qf, qf→sf, sf→final).
-- award_qualification_bonus ya es idempotente (no duplica si ya existe).

CREATE OR REPLACE FUNCTION auto_award_qualification_bonus()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_next_stage  text;
  v_winner_team uuid;
  v_league_id   uuid;
BEGIN
  -- Solo cuando el partido pasa a 'finished' con resultado y es eliminatorio
  IF NEW.status <> 'finished' OR NEW.home_goals IS NULL OR NEW.match_type IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.match_type NOT IN ('r32', 'r16', 'qf', 'sf', 'final') THEN
    RETURN NEW;
  END IF;

  -- Determinar equipo ganador
  IF NEW.home_goals > NEW.away_goals THEN
    v_winner_team := NEW.home_team_id;
  ELSIF NEW.away_goals > NEW.home_goals THEN
    v_winner_team := NEW.away_team_id;
  ELSE
    RETURN NEW; -- empate en eliminatorias no esperado
  END IF;

  -- Etapa que acaba de conseguir el ganador
  v_next_stage := CASE NEW.match_type
    WHEN 'r32'   THEN 'r16'
    WHEN 'r16'   THEN 'qf'
    WHEN 'qf'    THEN 'sf'
    WHEN 'sf'    THEN 'final'
    WHEN 'final' THEN NULL  -- campeón: no hay etapa extra, el bono 'final' ya se dio al ganar la SF
  END;

  IF v_next_stage IS NULL THEN RETURN NEW; END IF;

  -- Aplicar el bono en todas las ligas donde alguien tiene ese equipo
  FOR v_league_id IN (
    SELECT DISTINCT p.league_id FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_winner_team
  ) LOOP
    PERFORM award_qualification_bonus(v_league_id, v_winner_team, v_next_stage);
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
