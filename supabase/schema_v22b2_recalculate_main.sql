-- schema_v22b — PARTE 2: función principal (pegar después de la PARTE 1)

CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_m   matches%ROWTYPE;
  v_lid uuid; v_hown uuid; v_aown uuid;
  v_win uuid; v_cls uuid; v_ko boolean;
  v_lgs uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_m FROM matches WHERE id=p_match_id;
  IF NOT FOUND OR v_m.status<>'finished' OR v_m.home_goals IS NULL THEN RETURN; END IF;

  IF    v_m.home_goals>v_m.away_goals THEN v_win:=v_m.home_team_id;
  ELSIF v_m.away_goals>v_m.home_goals THEN v_win:=v_m.away_team_id;
  ELSE  v_win:=NULL; END IF;

  v_ko:=v_m.match_type IS NOT NULL AND v_m.match_type<>'group';
  v_cls:=CASE WHEN v_ko THEN COALESCE(CASE WHEN v_win IS NULL THEN v_m.winner_team_id END,v_win) END;

  DELETE FROM score_log WHERE match_id=p_match_id AND category NOT IN ('wildcard_entry','bonus');

  FOR v_lid IN (
    SELECT DISTINCT p.league_id FROM drafted_teams dt
    JOIN players p ON p.id=dt.player_id
    WHERE dt.team_id IN (v_m.home_team_id,v_m.away_team_id)
  ) LOOP
    v_lgs:=array_append(v_lgs,v_lid);
    SELECT dt.player_id INTO v_hown FROM drafted_teams dt JOIN players p ON p.id=dt.player_id
      WHERE dt.team_id=v_m.home_team_id AND p.league_id=v_lid LIMIT 1;
    SELECT dt.player_id INTO v_aown FROM drafted_teams dt JOIN players p ON p.id=dt.player_id
      WHERE dt.team_id=v_m.away_team_id AND p.league_id=v_lid LIMIT 1;
    PERFORM recalc_league(p_match_id,v_lid,v_hown,v_aown,
      v_m.home_goals,v_m.away_goals,v_m.home_team_id,v_m.away_team_id,
      v_win,v_cls,v_ko);
  END LOOP;

  IF array_length(v_lgs,1)>0 THEN
    DELETE FROM scores WHERE league_id=ANY(v_lgs);
    INSERT INTO scores(league_id,player_id,points)
    SELECT league_id,player_id,SUM(points) FROM score_log
    WHERE league_id=ANY(v_lgs) GROUP BY league_id,player_id;
  END IF;
END;
$$;
