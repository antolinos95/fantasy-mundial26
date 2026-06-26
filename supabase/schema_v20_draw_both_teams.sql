-- schema_v20: fix empate con los dos equipos
-- Cuando un jugador tiene ambos equipos en un empate, debe recibir
-- 1 punto por cada equipo (2 en total), no solo 1.
-- El bug era la condición IS DISTINCT FROM que bloqueaba el segundo insert.

CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $recalc_v20$
DECLARE
  v_match       matches%ROWTYPE;
  v_league_id   uuid;
  v_home_own    uuid;
  v_away_own    uuid;
  v_hp          predictions%ROWTYPE;
  v_ap          predictions%ROWTYPE;
  v_he          boolean;
  v_ae          boolean;
  v_rec         RECORD;
  v_wc          RECORD;
  v_leagues     uuid[] := ARRAY[]::uuid[];
  v_winner_team uuid;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  IF v_match.home_goals > v_match.away_goals THEN
    v_winner_team := v_match.home_team_id;
  ELSIF v_match.away_goals > v_match.home_goals THEN
    v_winner_team := v_match.away_team_id;
  ELSE
    v_winner_team := NULL;
  END IF;

  DELETE FROM score_log WHERE match_id = p_match_id
    AND category NOT IN ('wildcard_entry');

  FOR v_league_id IN (
    SELECT DISTINCT p.league_id FROM drafted_teams dt
    JOIN players p ON p.id = dt.player_id
    WHERE dt.team_id IN (v_match.home_team_id, v_match.away_team_id)
  ) LOOP
    v_leagues := array_append(v_leagues, v_league_id);

    SELECT dt.player_id INTO v_home_own FROM drafted_teams dt JOIN players p ON p.id=dt.player_id
      WHERE dt.team_id=v_match.home_team_id AND p.league_id=v_league_id LIMIT 1;
    SELECT dt.player_id INTO v_away_own FROM drafted_teams dt JOIN players p ON p.id=dt.player_id
      WHERE dt.team_id=v_match.away_team_id AND p.league_id=v_league_id LIMIT 1;

    -- ── RESULTADO ──
    IF v_match.home_goals > v_match.away_goals THEN
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',2,'Victoria');
      END IF;
    ELSIF v_match.home_goals < v_match.away_goals THEN
      IF v_away_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'result',2,'Victoria');
      END IF;
    ELSE
      -- Empate: cada propietario de equipo recibe 1 punto.
      -- Si el mismo jugador tiene los dos, recibe 2 (un insert por cada equipo).
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',1,'Empate');
      END IF;
      IF v_away_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'result',1,'Empate');
      END IF;
    END IF;

    -- ── PORRA (propietarios) ──
    IF v_home_own IS NOT NULL AND v_away_own IS NOT NULL AND v_home_own = v_away_own THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own AND is_wildcard IS NOT TRUE;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    ELSIF v_home_own IS NOT NULL AND v_away_own IS NOT NULL THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own AND is_wildcard IS NOT TRUE;
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own AND is_wildcard IS NOT TRUE;
      v_he := v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals;
      v_ae := v_ap IS NOT NULL AND v_ap.home_goals=v_match.home_goals AND v_ap.away_goals=v_match.away_goals;
      IF v_he AND NOT v_ae THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra robada');
      ELSIF v_ae AND NOT v_he THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',1,'Porra robada');
      ELSIF v_he AND v_ae THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra acertada');
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    ELSIF v_home_own IS NOT NULL THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own AND is_wildcard IS NOT TRUE;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    ELSIF v_away_own IS NOT NULL THEN
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own AND is_wildcard IS NOT TRUE;
      IF v_ap IS NOT NULL AND v_ap.home_goals=v_match.home_goals AND v_ap.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    END IF;

    -- ── JUGADORES DESTACADOS (propietarios) ──
    FOR v_rec IN (
      SELECT pe.squad_player_id, sp.team_id,
             CASE pe.event_type
               WHEN 'goal'            THEN 3
               WHEN 'goal_extra_time' THEN 3
               WHEN 'penalty_shootout'THEN 2
               WHEN 'own_goal'        THEN -1
               WHEN 'red_card'        THEN -1
               ELSE 0
             END AS pts,
             pe.event_type
      FROM player_events pe
      JOIN squad_players sp ON sp.id = pe.squad_player_id
      WHERE pe.match_id = p_match_id
        AND pe.event_type IN ('goal','goal_extra_time','penalty_shootout','own_goal','red_card')
    ) LOOP
      DECLARE v_owner uuid;
      BEGIN
        -- Propietario del equipo al que pertenece el jugador en esta liga
        SELECT dt.player_id INTO v_owner FROM drafted_teams dt JOIN players p ON p.id=dt.player_id
          WHERE dt.team_id=v_rec.team_id AND p.league_id=v_league_id LIMIT 1;

        IF v_owner IS NOT NULL AND v_rec.pts <> 0 THEN
          INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
          VALUES(v_league_id,v_owner,p_match_id,'player',v_rec.pts,
            CASE v_rec.event_type
              WHEN 'goal'             THEN 'Gol'
              WHEN 'goal_extra_time'  THEN 'Gol (prórroga)'
              WHEN 'penalty_shootout' THEN 'Penalti'
              WHEN 'own_goal'         THEN 'Autogol'
              WHEN 'red_card'         THEN 'Tarjeta roja'
            END);
        END IF;
      END;
    END LOOP;

    -- ── WILDCARD (porras y jugadores de participantes sin equipo) ──
    FOR v_wc IN (
      SELECT we.player_id
      FROM wildcard_entries we
      WHERE we.match_id = p_match_id AND we.league_id = v_league_id
    ) LOOP
      -- Porra wildcard
      SELECT * INTO v_hp FROM predictions
        WHERE match_id=p_match_id AND player_id=v_wc.player_id AND is_wildcard IS TRUE;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'prediction',1,'Porra wildcard acertada');
      END IF;

      -- Jugadores wildcard
      FOR v_rec IN (
        SELECT pe.squad_player_id, sp.team_id,
               CASE pe.event_type
                 WHEN 'goal'            THEN 3
                 WHEN 'goal_extra_time' THEN 3
                 WHEN 'penalty_shootout'THEN 2
                 WHEN 'own_goal'        THEN -1
                 WHEN 'red_card'        THEN -1
                 ELSE 0
               END AS pts,
               pe.event_type
        FROM player_events pe
        JOIN squad_players sp ON sp.id = pe.squad_player_id
        WHERE pe.match_id = p_match_id
          AND pe.event_type IN ('goal','goal_extra_time','penalty_shootout','own_goal','red_card')
      ) LOOP
        DECLARE v_sel boolean;
        BEGIN
          SELECT EXISTS(
            SELECT 1 FROM match_lineups ml
            WHERE ml.match_id=p_match_id AND ml.player_id=v_wc.player_id
              AND ml.squad_player_id=v_rec.squad_player_id AND ml.is_wildcard IS TRUE
          ) INTO v_sel;

          IF v_sel AND v_rec.pts <> 0 THEN
            INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
            VALUES(v_league_id,v_wc.player_id,p_match_id,'player',v_rec.pts,
              CASE v_rec.event_type
                WHEN 'goal'             THEN 'Gol (wildcard)'
                WHEN 'goal_extra_time'  THEN 'Gol prórroga (wildcard)'
                WHEN 'penalty_shootout' THEN 'Penalti (wildcard)'
                WHEN 'own_goal'         THEN 'Autogol (wildcard)'
                WHEN 'red_card'         THEN 'Tarjeta roja (wildcard)'
              END);
          END IF;
        END;
      END LOOP;
    END LOOP;

  END LOOP;

  -- ── ACTUALIZAR scores ──
  FOR v_league_id IN SELECT unnest(v_leagues) LOOP
    INSERT INTO scores(league_id,player_id,points)
    SELECT v_league_id, player_id, COALESCE(SUM(points),0)
    FROM score_log WHERE league_id=v_league_id
    GROUP BY player_id
    ON CONFLICT(league_id,player_id) DO UPDATE SET points=EXCLUDED.points, updated_at=now();
  END LOOP;

END;
$recalc_v20$;
