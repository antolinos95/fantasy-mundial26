CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_match      matches%ROWTYPE;
  v_league_id  uuid;
  v_home_own   uuid;
  v_away_own   uuid;
  v_hp         predictions%ROWTYPE;
  v_ap         predictions%ROWTYPE;
  v_he         boolean;
  v_ae         boolean;
  v_rec        RECORD;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  FOR v_league_id IN (
    SELECT DISTINCT p.league_id FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id IN (v_match.home_team_id, v_match.away_team_id)
  ) LOOP
    SELECT dt.player_id INTO v_home_own FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_match.home_team_id AND p.league_id = v_league_id LIMIT 1;

    SELECT dt.player_id INTO v_away_own FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_match.away_team_id AND p.league_id = v_league_id LIMIT 1;

    IF v_match.home_goals > v_match.away_goals THEN
      IF v_home_own IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_own,2)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2,updated_at=now();
      END IF;
    ELSIF v_match.home_goals < v_match.away_goals THEN
      IF v_away_own IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_own,2)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2,updated_at=now();
      END IF;
    ELSE
      IF v_home_own IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      END IF;
      IF v_away_own IS NOT NULL AND v_away_own IS DISTINCT FROM v_home_own THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      END IF;
    END IF;

    IF v_home_own IS NOT NULL AND v_away_own IS NOT NULL THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own;
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own;
      v_he := v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals;
      v_ae := v_ap IS NOT NULL AND v_ap.home_goals=v_match.home_goals AND v_ap.away_goals=v_match.away_goals;
      IF v_he AND NOT v_ae THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_own,-1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1,updated_at=now();
      ELSIF v_ae AND NOT v_he THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_own,-1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1,updated_at=now();
      END IF;
    ELSIF v_home_own IS NOT NULL THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      END IF;
    ELSIF v_away_own IS NOT NULL THEN
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own;
      IF v_ap IS NOT NULL AND v_ap.home_goals=v_match.home_goals AND v_ap.away_goals=v_match.away_goals THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_own,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      END IF;
    END IF;

    FOR v_rec IN (
      SELECT ml.player_id,
        SUM(CASE pe.event_type
          WHEN 'goal' THEN 1.0 WHEN 'goal_extra_time' THEN 0.5
          WHEN 'penalty_shootout' THEN 0.25 WHEN 'own_goal' THEN -1.0
          WHEN 'red_card' THEN -1.0 ELSE 0 END) AS pts
      FROM match_lineups ml
      JOIN player_events pe ON pe.squad_player_id=ml.squad_player_id AND pe.match_id=ml.match_id
      JOIN players p ON p.id=ml.player_id
      WHERE ml.match_id=p_match_id AND p.league_id=v_league_id
      GROUP BY ml.player_id
    ) LOOP
      IF v_rec.pts <> 0 THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_rec.player_id,v_rec.pts)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+v_rec.pts,updated_at=now();
      END IF;
    END LOOP;
  END LOOP;
END;
$func$;
