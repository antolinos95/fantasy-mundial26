-- ============================================================
-- v7: Libro mayor de puntos (score_log) + desglose
-- Ejecutar ENTERO en el SQL Editor de Supabase
-- ============================================================

-- 1. Tabla libro mayor
CREATE TABLE IF NOT EXISTS score_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id   uuid REFERENCES matches(id) ON DELETE CASCADE,
  category   text NOT NULL,           -- 'result' | 'prediction' | 'player' | 'bonus'
  points     numeric NOT NULL,
  detail     text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_log_league_player ON score_log(league_id, player_id);
CREATE INDEX IF NOT EXISTS idx_score_log_match ON score_log(match_id);

ALTER TABLE score_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "score_log_select" ON score_log;
CREATE POLICY "score_log_select" ON score_log FOR SELECT USING (true);

-- 2. recalculate_scores con libro mayor
CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_match     matches%ROWTYPE;
  v_league_id uuid;
  v_home_own  uuid;
  v_away_own  uuid;
  v_hp        predictions%ROWTYPE;
  v_ap        predictions%ROWTYPE;
  v_he        boolean;
  v_ae        boolean;
  v_rec       RECORD;
  v_leagues   uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  -- Limpiar entradas previas de este partido
  DELETE FROM score_log WHERE match_id = p_match_id;

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

    -- ── PORRA ──
    IF v_home_own IS NOT NULL AND v_away_own IS NOT NULL AND v_home_own = v_away_own THEN
      -- mismo dueño de ambos equipos
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    ELSIF v_home_own IS NOT NULL AND v_away_own IS NOT NULL THEN
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own;
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own;
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
      -- rival sin dueño
      SELECT * INTO v_hp FROM predictions WHERE match_id=p_match_id AND player_id=v_home_own;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    ELSIF v_away_own IS NOT NULL THEN
      SELECT * INTO v_ap FROM predictions WHERE match_id=p_match_id AND player_id=v_away_own;
      IF v_ap IS NOT NULL AND v_ap.home_goals=v_match.home_goals AND v_ap.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'prediction',1,'Porra acertada');
      END IF;
    END IF;

    -- ── JUGADORES DESTACADOS ──
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
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_rec.player_id,p_match_id,'player',v_rec.pts,'Jugadores destacados');
      END IF;
    END LOOP;
  END LOOP;

  -- Reconstruir scores de las ligas afectadas desde el libro mayor
  IF array_length(v_leagues,1) > 0 THEN
    DELETE FROM scores WHERE league_id = ANY(v_leagues);
    INSERT INTO scores(league_id,player_id,points)
    SELECT league_id, player_id, SUM(points)
    FROM score_log WHERE league_id = ANY(v_leagues)
    GROUP BY league_id, player_id;
  END IF;
END;
$func$;

-- 3. award_qualification_bonus con libro mayor
CREATE OR REPLACE FUNCTION award_qualification_bonus(
  p_league_id uuid, p_team_id uuid, p_stage text
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
  VALUES(p_league_id,v_owner,NULL,'bonus',v_pts,'Bono ' || v_label);

  DELETE FROM scores WHERE league_id=p_league_id;
  INSERT INTO scores(league_id,player_id,points)
  SELECT league_id,player_id,SUM(points) FROM score_log WHERE league_id=p_league_id GROUP BY league_id,player_id;
END;
$func$;

-- 4. BACKFILL: reconstruir todo desde cero (fase de debug)
DELETE FROM score_log;
DELETE FROM scores;
DELETE FROM qualification_bonuses;
DO $backfill$
DECLARE m uuid;
BEGIN
  FOR m IN SELECT id FROM matches WHERE status='finished' LOOP
    PERFORM recalculate_scores(m);
  END LOOP;
END
$backfill$;
