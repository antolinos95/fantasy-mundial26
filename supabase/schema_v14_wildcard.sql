-- schema_v14: Modo Wildcard
-- Jugadores sin equipo en un partido eliminatorio pueden pagar 2 pts para participar.

-- 1. Activar wildcard por liga
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS wildcard_enabled boolean NOT NULL DEFAULT false;

-- 2. Tabla wildcard_entries
CREATE TABLE IF NOT EXISTS wildcard_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id        uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  qualifier_pick  uuid REFERENCES teams(id),   -- equipo que el jugador cree que pasa
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, match_id)
);

ALTER TABLE wildcard_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wildcard_all" ON wildcard_entries USING (true) WITH CHECK (true);

-- 3. wildcard_lineups: los 3 jugadores elegidos (reutiliza match_lineups con flag)
-- Usamos match_lineups existente pero marcamos con is_wildcard = true
ALTER TABLE match_lineups ADD COLUMN IF NOT EXISTS is_wildcard boolean NOT NULL DEFAULT false;

-- 4. Actualizar recalculate_scores para incluir puntos wildcard
CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
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

  -- Determinar equipo ganador (para wildcard qualifier)
  IF v_match.home_goals > v_match.away_goals THEN
    v_winner_team := v_match.home_team_id;
  ELSIF v_match.away_goals > v_match.home_goals THEN
    v_winner_team := v_match.away_team_id;
  ELSE
    v_winner_team := NULL; -- empate (no aplica en eliminatorias normalmente)
  END IF;

  DELETE FROM score_log WHERE match_id = p_match_id
    AND category NOT IN ('wildcard_entry'); -- preservar el coste de entrada

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
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',1,'Empate');
      END IF;
      IF v_away_own IS NOT NULL AND v_away_own IS DISTINCT FROM v_home_own THEN
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

    -- ── JUGADORES DESTACADOS (propietarios, puntuación normal) ──
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
      -- Acierto qualifier (+2)
      IF v_winner_team IS NOT NULL AND v_wc.qualifier_pick = v_winner_team THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_qualifier',2,'Wildcard: equipo correcto');
      END IF;

      -- Porra wildcard (+1 si acierta)
      SELECT * INTO v_hp FROM predictions
        WHERE match_id=p_match_id AND player_id=v_wc.player_id AND is_wildcard = true;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_prediction',1,'Wildcard: porra acertada');
      END IF;

      -- Jugadores wildcard (0.5x goles, -1 autogoles/rojas)
      FOR v_rec IN (
        SELECT ml.player_id,
          SUM(CASE pe.event_type
            WHEN 'goal' THEN 0.5 WHEN 'goal_extra_time' THEN 0.25
            WHEN 'penalty_shootout' THEN 0.125 WHEN 'own_goal' THEN -1.0
            WHEN 'red_card' THEN -1.0 ELSE 0 END) AS pts
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

  -- Reconstruir scores (incluyendo wildcard_entry que no se borró)
  IF array_length(v_leagues,1) > 0 THEN
    DELETE FROM scores WHERE league_id = ANY(v_leagues);
    INSERT INTO scores(league_id,player_id,points)
    SELECT league_id, player_id, SUM(points)
    FROM score_log WHERE league_id = ANY(v_leagues)
    GROUP BY league_id, player_id;
  END IF;
END;
$func$;

-- 5. Función para registrar entrada wildcard (descuenta 2 pts)
CREATE OR REPLACE FUNCTION enter_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid, p_qualifier_pick uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
  -- Insertar entrada (falla si ya existe por UNIQUE constraint)
  INSERT INTO wildcard_entries(league_id, player_id, match_id, qualifier_pick)
  VALUES(p_league_id, p_player_id, p_match_id, p_qualifier_pick);

  -- Descontar 2 pts en score_log
  INSERT INTO score_log(league_id, player_id, match_id, category, points, detail)
  VALUES(p_league_id, p_player_id, p_match_id, 'wildcard_entry', -2, 'Entrada wildcard');

  -- Actualizar scores
  DELETE FROM scores WHERE league_id=p_league_id AND player_id=p_player_id;
  INSERT INTO scores(league_id, player_id, points)
  SELECT league_id, player_id, SUM(points)
  FROM score_log WHERE league_id=p_league_id AND player_id=p_player_id
  GROUP BY league_id, player_id;
END;
$func$;

-- 6. Columna is_wildcard en predictions
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS is_wildcard boolean NOT NULL DEFAULT false;
