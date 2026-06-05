-- ============================================================
-- schema_v2.sql — Ejecutar DESPUÉS de schema.sql
-- Añade: squad_players, match_lineups, player_events,
--        qualification_bonuses, match_type en matches
--        y actualiza recalculate_scores con todas las reglas
-- ============================================================

-- Scores ahora soporta decimales (0.5, 0.25)
ALTER TABLE scores ALTER COLUMN points TYPE numeric(10,2) USING points::numeric;

-- ─── NUEVAS TABLAS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS squad_players (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name         text NOT NULL,
  position     text NOT NULL CHECK (position IN ('GK','DF','MF','FW')),
  shirt_number integer,
  api_id       integer,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_squad_players_team ON squad_players(team_id);

-- 3 jugadores por propietario por equipo por partido
CREATE TABLE IF NOT EXISTS match_lineups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id         uuid NOT NULL REFERENCES teams(id),
  squad_player_id uuid NOT NULL REFERENCES squad_players(id),
  created_at      timestamptz DEFAULT now(),
  UNIQUE (match_id, player_id, squad_player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_lineups_match  ON match_lineups(match_id);
CREATE INDEX IF NOT EXISTS idx_match_lineups_player ON match_lineups(player_id);

-- Eventos de jugadores por partido (los introduce el admin)
CREATE TABLE IF NOT EXISTS player_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  squad_player_id uuid NOT NULL REFERENCES squad_players(id),
  event_type      text NOT NULL CHECK (event_type IN
    ('goal','goal_extra_time','penalty_shootout','red_card','own_goal')),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_events_match ON player_events(match_id);

-- Tipo de partido para bonificaciones de fase
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'group'
  CHECK (match_type IN ('group','r16','qf','sf','third_place','final'));

-- Bonificaciones de clasificación (admin las otorga al avanzar de fase)
CREATE TABLE IF NOT EXISTS qualification_bonuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams(id),
  stage      text NOT NULL CHECK (stage IN ('r16','qf','sf','final')),
  awarded_at timestamptz DEFAULT now(),
  UNIQUE (league_id, team_id, stage)
);

-- ─── RLS ─────────────────────────────────────────────────────

ALTER TABLE squad_players         ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_lineups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualification_bonuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "squad_players_select" ON squad_players FOR SELECT USING (true);
CREATE POLICY "squad_players_insert" ON squad_players FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "match_lineups_select" ON match_lineups FOR SELECT USING (true);
CREATE POLICY "match_lineups_insert" ON match_lineups FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "match_lineups_delete" ON match_lineups FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "player_events_select" ON player_events FOR SELECT USING (true);
CREATE POLICY "player_events_insert" ON player_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "player_events_delete" ON player_events FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "qualification_bonuses_select" ON qualification_bonuses FOR SELECT USING (true);
CREATE POLICY "qualification_bonuses_insert" ON qualification_bonuses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "qualification_bonuses_delete" ON qualification_bonuses FOR DELETE USING (auth.uid() IS NOT NULL);

-- Añadir a Realtime (también activa en el panel Database → Replication)
ALTER TABLE squad_players         REPLICA IDENTITY FULL;
ALTER TABLE match_lineups         REPLICA IDENTITY FULL;
ALTER TABLE player_events         REPLICA IDENTITY FULL;
ALTER TABLE qualification_bonuses REPLICA IDENTITY FULL;

-- ─── recalculate_scores ACTUALIZADO ──────────────────────────
-- Incluye: resultado + porra (todos los casos) + jugadores destacados

CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match      matches%ROWTYPE;
  v_home_owner uuid;
  v_away_owner uuid;
  v_home_pred  predictions%ROWTYPE;
  v_away_pred  predictions%ROWTYPE;
  v_home_exact boolean;
  v_away_exact boolean;
  v_event      record;
  v_lineup     record;
  v_pts        numeric(10,2);
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  SELECT player_id INTO v_home_owner FROM drafted_teams
    WHERE team_id = v_match.home_team_id AND league_id = v_match.league_id LIMIT 1;
  SELECT player_id INTO v_away_owner FROM drafted_teams
    WHERE team_id = v_match.away_team_id AND league_id = v_match.league_id LIMIT 1;

  -- ── Puntos por resultado ─────────────────────────────────────
  IF v_match.home_goals > v_match.away_goals THEN
    IF v_home_owner IS NOT NULL THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,2)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2,updated_at=now();
    END IF;
  ELSIF v_match.home_goals < v_match.away_goals THEN
    IF v_away_owner IS NOT NULL THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_away_owner,2)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+2,updated_at=now();
    END IF;
  ELSE
    IF v_home_owner IS NOT NULL THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
    END IF;
    IF v_away_owner IS NOT NULL AND v_away_owner IS DISTINCT FROM v_home_owner THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_away_owner,1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
    END IF;
  END IF;

  -- ── Porra ────────────────────────────────────────────────────
  IF v_home_owner IS NOT NULL THEN
    SELECT * INTO v_home_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_home_owner;
  END IF;
  IF v_away_owner IS NOT NULL THEN
    SELECT * INTO v_away_pred FROM predictions WHERE match_id=p_match_id AND player_id=v_away_owner;
  END IF;

  v_home_exact := (v_home_pred IS NOT NULL
    AND v_home_pred.home_goals=v_match.home_goals
    AND v_home_pred.away_goals=v_match.away_goals);
  v_away_exact := (v_away_pred IS NOT NULL
    AND v_away_pred.home_goals=v_match.home_goals
    AND v_away_pred.away_goals=v_match.away_goals);

  -- Mismo dueño para los dos equipos
  IF v_home_owner IS NOT NULL AND v_home_owner = v_away_owner THEN
    IF v_home_exact THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
    END IF;
  -- Equipo visitante sin dueño
  ELSIF v_home_owner IS NOT NULL AND v_away_owner IS NULL AND v_home_exact THEN
    INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,1)
    ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
  -- Equipo local sin dueño
  ELSIF v_away_owner IS NOT NULL AND v_home_owner IS NULL AND v_away_exact THEN
    INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_away_owner,1)
    ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
  -- Dos dueños distintos
  ELSIF v_home_owner IS NOT NULL AND v_away_owner IS NOT NULL THEN
    IF v_home_exact AND NOT v_away_exact THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_away_owner,-1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1,updated_at=now();
    ELSIF v_away_exact AND NOT v_home_exact THEN
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_away_owner,1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points+1,updated_at=now();
      INSERT INTO scores(league_id,player_id,points) VALUES(v_match.league_id,v_home_owner,-1)
      ON CONFLICT(league_id,player_id) DO UPDATE SET points=scores.points-1,updated_at=now();
    END IF;
  END IF;

  -- ── Jugadores destacados ─────────────────────────────────────
  FOR v_event IN
    SELECT pe.squad_player_id, pe.event_type
    FROM player_events pe WHERE pe.match_id = p_match_id
  LOOP
    v_pts := CASE v_event.event_type
      WHEN 'goal'             THEN  1.00
      WHEN 'goal_extra_time'  THEN  0.50
      WHEN 'penalty_shootout' THEN  0.25
      WHEN 'red_card'         THEN -1.00
      WHEN 'own_goal'         THEN -1.00
      ELSE 0.00
    END;
    FOR v_lineup IN
      SELECT ml.player_id FROM match_lineups ml
      WHERE ml.match_id=p_match_id AND ml.squad_player_id=v_event.squad_player_id
    LOOP
      INSERT INTO scores(league_id,player_id,points)
      VALUES(v_match.league_id,v_lineup.player_id,v_pts)
      ON CONFLICT(league_id,player_id)
      DO UPDATE SET points=scores.points+v_pts,updated_at=now();
    END LOOP;
  END LOOP;
END;
$$;

-- ─── award_qualification_bonus ────────────────────────────────
-- Admin llama a esta función cuando un equipo avanza de fase

CREATE OR REPLACE FUNCTION award_qualification_bonus(
  p_league_id uuid,
  p_team_id   uuid,
  p_stage     text   -- 'r16' | 'qf' | 'sf' | 'final'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner uuid;
  v_pts   integer := CASE p_stage
    WHEN 'r16'   THEN 1
    WHEN 'qf'    THEN 3
    WHEN 'sf'    THEN 5
    WHEN 'final' THEN 8
    ELSE 0
  END;
BEGIN
  IF EXISTS(
    SELECT 1 FROM qualification_bonuses
    WHERE league_id=p_league_id AND team_id=p_team_id AND stage=p_stage
  ) THEN RETURN; END IF;

  SELECT player_id INTO v_owner FROM drafted_teams
  WHERE team_id=p_team_id AND league_id=p_league_id LIMIT 1;

  IF v_owner IS NULL THEN RETURN; END IF;

  INSERT INTO qualification_bonuses(league_id,team_id,stage)
  VALUES(p_league_id,p_team_id,p_stage);

  INSERT INTO scores(league_id,player_id,points)
  VALUES(p_league_id,v_owner,v_pts)
  ON CONFLICT(league_id,player_id)
  DO UPDATE SET points=scores.points+v_pts,updated_at=now();
END;
$$;

-- ─── Actualizar grupos reales del Mundial 2026 ────────────────
-- Fuente: openfootball/worldcup.json (sorteo 5-dic-2025)

UPDATE teams SET group_name='A' WHERE fifa_code IN ('MEX','RSA','KOR','CZE');
UPDATE teams SET group_name='B' WHERE fifa_code IN ('CAN','BIH','QAT','SUI');
UPDATE teams SET group_name='C' WHERE fifa_code IN ('BRA','MAR','HAI','SCO');
UPDATE teams SET group_name='D' WHERE fifa_code IN ('USA','PAR','AUS','TUR');
UPDATE teams SET group_name='E' WHERE fifa_code IN ('GER','CUW','CIV','ECU');
UPDATE teams SET group_name='F' WHERE fifa_code IN ('NED','JPN','SWE','TUN');
UPDATE teams SET group_name='G' WHERE fifa_code IN ('BEL','EGY','IRN','NZL');
UPDATE teams SET group_name='H' WHERE fifa_code IN ('ESP','CPV','KSA','URU');
UPDATE teams SET group_name='I' WHERE fifa_code IN ('FRA','SEN','IRQ','NOR');
UPDATE teams SET group_name='J' WHERE fifa_code IN ('ARG','ALG','AUT','JOR');
UPDATE teams SET group_name='K' WHERE fifa_code IN ('POR','COD','UZB','COL');
UPDATE teams SET group_name='L' WHERE fifa_code IN ('ENG','CRO','GHA','PAN');

-- Insertar equipos que falten en el seed original
INSERT INTO teams(name,flag_emoji,group_name,fifa_code) VALUES
('Bosnia y Herzegovina','🇧🇦','B','BIH'),
('Haití',              '🇭🇹','C','HAI'),
('Curazao',            '🏳️','E','CUW'),
('Suecia',             '🇸🇪','F','SWE'),
('Nueva Zelanda',      '🇳🇿','G','NZL'),
('Cabo Verde',         '🇨🇻','H','CPV'),
('Noruega',            '🇳🇴','I','NOR'),
('Argelia',            '🇩🇿','J','ALG'),
('Uzbekistán',         '🇺🇿','K','UZB'),
('Ghana',              '🇬🇭','L','GHA')
ON CONFLICT(fifa_code) DO UPDATE SET group_name=EXCLUDED.group_name;
