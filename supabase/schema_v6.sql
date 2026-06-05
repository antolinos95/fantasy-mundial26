-- ============================================================
-- v6: Partidos globales + vista de estadísticas global
-- ============================================================

-- 1. Partidos globales: league_id nullable
ALTER TABLE matches ALTER COLUMN league_id DROP NOT NULL;

-- 2. Vista de estadísticas global (indiferente del lineup y la liga)
DROP VIEW IF EXISTS player_stats_by_league;

CREATE OR REPLACE VIEW player_stats_global AS
SELECT
  sp.id            AS squad_player_id,
  sp.team_id,
  sp.name,
  sp.position,
  sp.shirt_number,
  sp.photo_url,
  t.flag_emoji,
  t.name           AS team_name,
  COUNT(CASE WHEN pe.event_type IN ('goal','goal_extra_time','penalty_shootout') THEN 1 END) AS goals,
  COUNT(CASE WHEN pe.event_type = 'own_goal'  THEN 1 END) AS own_goals,
  COUNT(CASE WHEN pe.event_type = 'red_card'  THEN 1 END) AS red_cards
FROM squad_players sp
JOIN teams t ON t.id = sp.team_id
LEFT JOIN player_events pe ON pe.squad_player_id = sp.id
GROUP BY sp.id, sp.team_id, sp.name, sp.position, sp.shirt_number, sp.photo_url, t.flag_emoji, t.name;

-- Permisos de lectura pública
GRANT SELECT ON player_stats_global TO anon, authenticated;

-- 3. recalculate_scores: ahora opera sobre TODAS las ligas para un partido global
CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match        matches%ROWTYPE;
  v_league_id    uuid;
  v_home_owner   uuid;
  v_away_owner   uuid;
  v_home_pred    predictions%ROWTYPE;
  v_away_pred    predictions%ROWTYPE;
  v_home_exact   boolean;
  v_away_exact   boolean;
  v_event_rec    RECORD;
  v_event_pts    numeric;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  -- Iterar sobre cada liga que tenga dueños de estos equipos
  FOR v_league_id IN (
    SELECT DISTINCT p.league_id
    FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id IN (v_match.home_team_id, v_match.away_team_id)
  ) LOOP

    -- Encontrar dueños en esta liga
    SELECT dt.player_id INTO v_home_owner
    FROM drafted_teams dt JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_match.home_team_id AND p.league_id = v_league_id LIMIT 1;

    SELECT dt.player_id INTO v_away_owner
    FROM drafted_teams dt JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id = v_match.away_team_id AND p.league_id = v_league_id LIMIT 1;

    -- ── Puntos por resultado ───────────────────────────────
    IF v_match.home_goals > v_match.away_goals THEN
      IF v_home_owner IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_owner,2)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2, updated_at=now();
      END IF;
    ELSIF v_match.home_goals < v_match.away_goals THEN
      IF v_away_owner IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_owner,2)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2, updated_at=now();
      END IF;
    ELSE
      IF v_home_owner IS NOT NULL THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
      END IF;
      IF v_away_owner IS NOT NULL AND v_away_owner IS DISTINCT FROM v_home_owner THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
      END IF;
    END IF;

    -- ── Puntos por porra ───────────────────────────────────
    IF v_home_owner IS NOT NULL AND v_away_owner IS NOT NULL THEN
      SELECT * INTO v_home_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_home_owner;
      SELECT * INTO v_away_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_away_owner;

      v_home_exact := v_home_pred IS NOT NULL
        AND v_home_pred.home_goals = v_match.home_goals
        AND v_home_pred.away_goals = v_match.away_goals;
      v_away_exact := v_away_pred IS NOT NULL
        AND v_away_pred.home_goals = v_match.home_goals
        AND v_away_pred.away_goals = v_match.away_goals;

      IF v_home_exact AND NOT v_away_exact THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_owner,-1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1, updated_at=now();
      ELSIF v_away_exact AND NOT v_home_exact THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_owner,-1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1, updated_at=now();
      END IF;
    ELSIF v_home_owner IS NOT NULL AND v_home_owner IS DISTINCT FROM v_away_owner THEN
      -- Rival sin dueño: si aciertas ganas 1 punto
      SELECT * INTO v_home_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_home_owner;
      IF v_home_pred IS NOT NULL
        AND v_home_pred.home_goals = v_match.home_goals
        AND v_home_pred.away_goals = v_match.away_goals THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_home_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
      END IF;
    ELSIF v_away_owner IS NOT NULL THEN
      SELECT * INTO v_away_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_away_owner;
      IF v_away_pred IS NOT NULL
        AND v_away_pred.home_goals = v_match.home_goals
        AND v_away_pred.away_goals = v_match.away_goals THEN
        INSERT INTO scores(league_id,player_id,points) VALUES(v_league_id,v_away_owner,1)
        ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1, updated_at=now();
      END IF;
    END IF;

    -- ── Puntos por jugadores destacados en el lineup ───────
    FOR v_event_rec IN (
      SELECT ml.player_id, SUM(
        CASE pe.event_type
          WHEN 'goal'             THEN 1.0
          WHEN 'goal_extra_time'  THEN 0.5
          WHEN 'penalty_shootout' THEN 0.25
          WHEN 'own_goal'         THEN -1.0
          WHEN 'red_card'         THEN -1.0
          ELSE 0
        END
      ) AS event_pts
      FROM match_lineups ml
      JOIN player_events pe ON pe.squad_player_id = ml.squad_player_id AND pe.match_id = ml.match_id
      JOIN players p ON p.id = ml.player_id
      WHERE ml.match_id = p_match_id AND p.league_id = v_league_id
      GROUP BY ml.player_id
    ) LOOP
      IF v_event_rec.event_pts <> 0 THEN
        INSERT INTO scores(league_id,player_id,points)
        VALUES(v_league_id, v_event_rec.player_id, v_event_rec.event_pts)
        ON CONFLICT(league_id,player_id) DO UPDATE
          SET points = scores.points + v_event_rec.event_pts, updated_at = now();
      END IF;
    END LOOP;

  END LOOP;
END;
$$;
