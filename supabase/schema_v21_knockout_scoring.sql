-- schema_v21: nuevo sistema de puntuación fase eliminatoria
-- Cambios respecto a v20:
--   1. Añade winner_team_id a matches (para prórroga/penaltis)
--   2. Nuevos tipos de eventos: assist, clean_sheet_gk, clean_sheet_def,
--      penalty_missed, penalty_missed_shootout
--   3. enter_wildcard: coste variable según clasificación
--   4. recalculate_scores:
--      - Jugadores wildcard puntúan igual que propietarios
--      - Nuevo bonus "equipo clasificado" (+2) en eliminatorias
--      - Todos los nuevos eventos de jugadores

-- 1. Columna winner_team_id en matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner_team_id uuid REFERENCES teams(id);

-- 2. Nuevos tipos de eventos de jugador
ALTER TABLE player_events DROP CONSTRAINT IF EXISTS player_events_event_type_check;
ALTER TABLE player_events ADD CONSTRAINT player_events_event_type_check CHECK (
  event_type IN (
    'goal', 'goal_extra_time', 'penalty_shootout',
    'own_goal', 'red_card',
    'assist', 'clean_sheet_gk', 'clean_sheet_def',
    'penalty_missed', 'penalty_missed_shootout'
  )
);

-- 3. enter_wildcard con coste variable según posición en la clasificación
CREATE OR REPLACE FUNCTION enter_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid, p_qualifier_pick uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rank integer;
  v_cost integer;
BEGIN
  -- Calcular posición del jugador (por puntos, mayor = 1º)
  SELECT pos INTO v_rank FROM (
    SELECT player_id,
      RANK() OVER (ORDER BY points DESC NULLS LAST) AS pos
    FROM scores WHERE league_id = p_league_id
  ) r WHERE player_id = p_player_id;

  v_rank := COALESCE(v_rank, 99);
  v_cost := CASE
    WHEN v_rank <= 2 THEN 2
    WHEN v_rank <= 5 THEN 1
    ELSE 0
  END;

  -- Insertar entrada (falla si ya existe por UNIQUE constraint)
  INSERT INTO wildcard_entries(league_id, player_id, match_id, qualifier_pick)
  VALUES(p_league_id, p_player_id, p_match_id, p_qualifier_pick);

  -- Descontar coste si aplica
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

-- 4. recalculate_scores v21
CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $recalc_v21$
DECLARE
  v_match        matches%ROWTYPE;
  v_league_id    uuid;
  v_home_own     uuid;
  v_away_own     uuid;
  v_hp           predictions%ROWTYPE;
  v_ap           predictions%ROWTYPE;
  v_he           boolean;
  v_ae           boolean;
  v_rec          RECORD;
  v_wc           RECORD;
  v_leagues      uuid[] := ARRAY[]::uuid[];
  v_result_winner uuid;  -- ganador por resultado en 90' (NULL = empate)
  v_classified    uuid;  -- equipo que avanza (puede ser distinto si hubo prórroga)
  v_classified_own uuid;
  v_is_knockout  boolean;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  -- Ganador por resultado (90' o tiempo reglamentario + ET score)
  IF v_match.home_goals > v_match.away_goals THEN
    v_result_winner := v_match.home_team_id;
  ELSIF v_match.away_goals > v_match.home_goals THEN
    v_result_winner := v_match.away_team_id;
  ELSE
    v_result_winner := NULL;
  END IF;

  -- Equipo clasificado (para partidos eliminatorios)
  v_is_knockout := v_match.match_type IS NOT NULL AND v_match.match_type <> 'group';
  IF v_is_knockout THEN
    v_classified := COALESCE(
      -- Si hay empate en marcador, usar winner_team_id (prórroga/penaltis)
      CASE WHEN v_result_winner IS NULL THEN v_match.winner_team_id ELSE NULL END,
      v_result_winner  -- si ganó en tiempo reg, el mismo gana y se clasifica
    );
  ELSE
    v_classified := NULL;
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

    -- ── RESULTADO (por marcador en 90' / marcador final si sin prórroga) ──
    IF v_result_winner = v_match.home_team_id THEN
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',2,'Victoria');
      END IF;
    ELSIF v_result_winner = v_match.away_team_id THEN
      IF v_away_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'result',2,'Victoria');
      END IF;
    ELSE
      -- Empate: cada equipo da 1 pt
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',1,'Empate');
      END IF;
      IF v_away_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'result',1,'Empate');
      END IF;
    END IF;

    -- ── EQUIPO CLASIFICADO +2 (solo eliminatorias) ──
    IF v_is_knockout AND v_classified IS NOT NULL THEN
      IF v_classified = v_match.home_team_id THEN
        v_classified_own := v_home_own;
      ELSE
        v_classified_own := v_away_own;
      END IF;
      IF v_classified_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_classified_own,p_match_id,'classified',2,'Equipo clasificado');
      END IF;
    END IF;

    -- ── PORRA (propietarios) — marcador al finalizar 90'/prórroga ──
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
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',-1,'Porra perdida');
      ELSIF v_ae AND NOT v_he THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',1,'Porra robada');
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',-1,'Porra perdida');
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

    -- ── JUGADORES DESTACADOS (propietarios, puntuación completa) ──
    FOR v_rec IN (
      SELECT ml.player_id,
        SUM(CASE pe.event_type
          WHEN 'goal'                  THEN  1.0
          WHEN 'goal_extra_time'       THEN  1.0
          WHEN 'penalty_shootout'      THEN  0.5
          WHEN 'assist'               THEN  0.5
          WHEN 'clean_sheet_gk'       THEN  2.0
          WHEN 'clean_sheet_def'      THEN  1.0
          WHEN 'penalty_missed'       THEN -0.5
          WHEN 'penalty_missed_shootout' THEN -0.25
          WHEN 'own_goal'             THEN -1.0
          WHEN 'red_card'             THEN -1.0
          ELSE 0 END) AS pts
      FROM match_lineups ml
      JOIN player_events pe ON pe.squad_player_id=ml.squad_player_id AND pe.match_id=ml.match_id
      JOIN players p ON p.id=ml.player_id
      WHERE ml.match_id=p_match_id AND p.league_id=v_league_id
        AND ml.is_wildcard IS NOT TRUE
      GROUP BY ml.player_id
    ) LOOP
      IF v_rec.pts <> 0 THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_rec.player_id,p_match_id,'player',v_rec.pts,'Jugadores destacados');
      END IF;
    END LOOP;

    -- ── WILDCARD ──
    FOR v_wc IN (
      SELECT we.player_id, we.qualifier_pick
      FROM wildcard_entries we
      WHERE we.match_id = p_match_id AND we.league_id = v_league_id
    ) LOOP
      -- Acierto qualifier: el equipo que se clasifica (no solo quien gana en 90')
      DECLARE v_wc_classified uuid;
      BEGIN
        v_wc_classified := COALESCE(v_classified, v_result_winner);
      END;
      IF v_wc_classified IS NOT NULL AND v_wc.qualifier_pick = v_wc_classified THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_qualifier',2,'Wildcard: equipo correcto');
      END IF;

      -- Porra wildcard (+1 si acierta el marcador al 90'/final)
      SELECT * INTO v_hp FROM predictions
        WHERE match_id=p_match_id AND player_id=v_wc.player_id AND is_wildcard = true;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_prediction',1,'Wildcard: porra acertada');
      END IF;

      -- Jugadores wildcard: MISMA puntuación que propietarios (v21, ya no reducida)
      FOR v_rec IN (
        SELECT ml.player_id,
          SUM(CASE pe.event_type
            WHEN 'goal'                  THEN  1.0
            WHEN 'goal_extra_time'       THEN  1.0
            WHEN 'penalty_shootout'      THEN  0.5
            WHEN 'assist'               THEN  0.5
            WHEN 'clean_sheet_gk'       THEN  2.0
            WHEN 'clean_sheet_def'      THEN  1.0
            WHEN 'penalty_missed'       THEN -0.5
            WHEN 'penalty_missed_shootout' THEN -0.25
            WHEN 'own_goal'             THEN -1.0
            WHEN 'red_card'             THEN -1.0
            ELSE 0 END) AS pts
        FROM match_lineups ml
        JOIN player_events pe ON pe.squad_player_id=ml.squad_player_id AND pe.match_id=ml.match_id
        WHERE ml.match_id=p_match_id AND ml.player_id=v_wc.player_id
          AND ml.is_wildcard = true
        GROUP BY ml.player_id
      ) LOOP
        IF v_rec.pts <> 0 THEN
          INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
          VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_player',v_rec.pts,'Wildcard: jugadores');
        END IF;
      END LOOP;
    END LOOP;

  END LOOP;

  -- Reconstruir scores (preservando wildcard_entry que no se borró)
  IF array_length(v_leagues,1) > 0 THEN
    DELETE FROM scores WHERE league_id = ANY(v_leagues);
    INSERT INTO scores(league_id,player_id,points)
    SELECT league_id, player_id, SUM(points)
    FROM score_log WHERE league_id = ANY(v_leagues)
    GROUP BY league_id, player_id;
  END IF;
END;
$recalc_v21$;
