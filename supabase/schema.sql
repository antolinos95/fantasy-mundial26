-- ============================================================
-- Fantasy Mundial 2026 — Schema completo
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ─── EXTENSIONES ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── TABLAS ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  flag_emoji   text NOT NULL DEFAULT '🏳️',
  group_name   text,
  fifa_code    text NOT NULL DEFAULT '',
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leagues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  code            text UNIQUE NOT NULL,
  status          text NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','drafting','active')),
  admin_player_id uuid,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name       text NOT NULL,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leagues
  ADD CONSTRAINT fk_admin_player
  FOREIGN KEY (admin_player_id) REFERENCES players(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS draft_order (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id      uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  draft_position integer NOT NULL,
  UNIQUE (league_id, player_id),
  UNIQUE (league_id, draft_position)
);

CREATE TABLE IF NOT EXISTS draft_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid UNIQUE NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  current_pick    integer NOT NULL DEFAULT 1,
  round           integer NOT NULL DEFAULT 1,
  started         boolean NOT NULL DEFAULT false,
  finished        boolean NOT NULL DEFAULT false,
  direction       integer NOT NULL DEFAULT 1,
  teams_per_player integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drafted_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL REFERENCES teams(id),
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pick_number integer NOT NULL,
  UNIQUE (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  home_team_id  uuid NOT NULL REFERENCES teams(id),
  away_team_id  uuid NOT NULL REFERENCES teams(id),
  match_date    timestamptz,
  status        text NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','finished')),
  home_goals    integer,
  away_goals    integer,
  created_at    timestamptz DEFAULT now(),
  CHECK (home_team_id <> away_team_id)
);

CREATE TABLE IF NOT EXISTS predictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  home_goals  integer NOT NULL CHECK (home_goals >= 0),
  away_goals  integer NOT NULL CHECK (away_goals >= 0),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS scores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points     integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (league_id, player_id)
);

-- ─── ÍNDICES ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_players_league    ON players(league_id);
CREATE INDEX IF NOT EXISTS idx_players_user      ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_draft_order_league ON draft_order(league_id);
CREATE INDEX IF NOT EXISTS idx_drafted_teams_league ON drafted_teams(league_id);
CREATE INDEX IF NOT EXISTS idx_drafted_teams_player ON drafted_teams(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_league    ON matches(league_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_predictions_player ON predictions(player_id);
CREATE INDEX IF NOT EXISTS idx_scores_league     ON scores(league_id);

-- ─── RLS ────────────────────────────────────────────────────

ALTER TABLE teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_order    ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafted_teams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores         ENABLE ROW LEVEL SECURITY;

-- teams: solo lectura pública
CREATE POLICY "teams_select" ON teams FOR SELECT USING (true);

-- leagues: lectura pública, escritura para autenticados
CREATE POLICY "leagues_select" ON leagues FOR SELECT USING (true);
CREATE POLICY "leagues_insert" ON leagues FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "leagues_update" ON leagues FOR UPDATE USING (auth.uid() IS NOT NULL);

-- players: lectura pública, insert solo propio user_id
CREATE POLICY "players_select" ON players FOR SELECT USING (true);
CREATE POLICY "players_insert" ON players FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR user_id IS NULL));

-- draft_order
CREATE POLICY "draft_order_select" ON draft_order FOR SELECT USING (true);
CREATE POLICY "draft_order_insert" ON draft_order FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- draft_state
CREATE POLICY "draft_state_select" ON draft_state FOR SELECT USING (true);
CREATE POLICY "draft_state_insert" ON draft_state FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "draft_state_update" ON draft_state FOR UPDATE USING (auth.uid() IS NOT NULL);

-- drafted_teams
CREATE POLICY "drafted_teams_select" ON drafted_teams FOR SELECT USING (true);
CREATE POLICY "drafted_teams_insert" ON drafted_teams FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- matches
CREATE POLICY "matches_select" ON matches FOR SELECT USING (true);
CREATE POLICY "matches_insert" ON matches FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "matches_update" ON matches FOR UPDATE USING (auth.uid() IS NOT NULL);

-- predictions
CREATE POLICY "predictions_select" ON predictions FOR SELECT USING (true);
CREATE POLICY "predictions_insert" ON predictions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "predictions_update" ON predictions FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- scores
CREATE POLICY "scores_select" ON scores FOR SELECT USING (true);
CREATE POLICY "scores_insert" ON scores FOR INSERT WITH CHECK (true);
CREATE POLICY "scores_update" ON scores FOR UPDATE USING (true);

-- ─── FUNCIÓN: recalculate_scores ────────────────────────────
-- Llamada tras introducir resultado: calcula puntos de resultado + porras

CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match       matches%ROWTYPE;
  v_home_owner  uuid;
  v_away_owner  uuid;
  v_home_pred   predictions%ROWTYPE;
  v_away_pred   predictions%ROWTYPE;
  v_home_exact  boolean;
  v_away_exact  boolean;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;

  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN
    RETURN;
  END IF;

  -- Propietarios de cada selección en esta liga
  SELECT player_id INTO v_home_owner
  FROM drafted_teams
  WHERE team_id = v_match.home_team_id AND league_id = v_match.league_id
  LIMIT 1;

  SELECT player_id INTO v_away_owner
  FROM drafted_teams
  WHERE team_id = v_match.away_team_id AND league_id = v_match.league_id
  LIMIT 1;

  -- Puntos por resultado
  IF v_match.home_goals > v_match.away_goals THEN
    -- Gana el local
    IF v_home_owner IS NOT NULL THEN
      INSERT INTO scores (league_id, player_id, points)
      VALUES (v_match.league_id, v_home_owner, 2)
      ON CONFLICT (league_id, player_id)
      DO UPDATE SET points = scores.points + 2, updated_at = now();
    END IF;

  ELSIF v_match.home_goals < v_match.away_goals THEN
    -- Gana el visitante
    IF v_away_owner IS NOT NULL THEN
      INSERT INTO scores (league_id, player_id, points)
      VALUES (v_match.league_id, v_away_owner, 2)
      ON CONFLICT (league_id, player_id)
      DO UPDATE SET points = scores.points + 2, updated_at = now();
    END IF;

  ELSE
    -- Empate
    IF v_home_owner IS NOT NULL THEN
      INSERT INTO scores (league_id, player_id, points)
      VALUES (v_match.league_id, v_home_owner, 1)
      ON CONFLICT (league_id, player_id)
      DO UPDATE SET points = scores.points + 1, updated_at = now();
    END IF;
    IF v_away_owner IS NOT NULL AND v_away_owner IS DISTINCT FROM v_home_owner THEN
      INSERT INTO scores (league_id, player_id, points)
      VALUES (v_match.league_id, v_away_owner, 1)
      ON CONFLICT (league_id, player_id)
      DO UPDATE SET points = scores.points + 1, updated_at = now();
    END IF;
  END IF;

  -- Solo aplicar porras si hay dos dueños distintos
  IF v_home_owner IS NULL OR v_away_owner IS NULL OR v_home_owner = v_away_owner THEN
    RETURN;
  END IF;

  SELECT * INTO v_home_pred FROM predictions
  WHERE match_id = p_match_id AND player_id = v_home_owner;

  SELECT * INTO v_away_pred FROM predictions
  WHERE match_id = p_match_id AND player_id = v_away_owner;

  v_home_exact := (
    v_home_pred IS NOT NULL AND
    v_home_pred.home_goals = v_match.home_goals AND
    v_home_pred.away_goals = v_match.away_goals
  );
  v_away_exact := (
    v_away_pred IS NOT NULL AND
    v_away_pred.home_goals = v_match.home_goals AND
    v_away_pred.away_goals = v_match.away_goals
  );

  -- Solo un acertante: gana punto, rival pierde punto
  IF v_home_exact AND NOT v_away_exact THEN
    INSERT INTO scores (league_id, player_id, points)
    VALUES (v_match.league_id, v_home_owner, 1)
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET points = scores.points + 1, updated_at = now();

    INSERT INTO scores (league_id, player_id, points)
    VALUES (v_match.league_id, v_away_owner, -1)
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET points = scores.points - 1, updated_at = now();

  ELSIF v_away_exact AND NOT v_home_exact THEN
    INSERT INTO scores (league_id, player_id, points)
    VALUES (v_match.league_id, v_away_owner, 1)
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET points = scores.points + 1, updated_at = now();

    INSERT INTO scores (league_id, player_id, points)
    VALUES (v_match.league_id, v_home_owner, -1)
    ON CONFLICT (league_id, player_id)
    DO UPDATE SET points = scores.points - 1, updated_at = now();
  END IF;
  -- Ambos aciertan o ambos fallan: sin cambios
END;
$$;

-- ─── SELECCIONES MUNDIAL 2026 (48 equipos) ──────────────────

-- Ver supabase/seed_teams.sql para el INSERT con fifa_code
-- (la tabla ya existe en producción con fifa_code NOT NULL)
