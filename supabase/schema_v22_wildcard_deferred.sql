-- schema_v22: coste wildcard diferido al cierre de la porra (T-2h)
-- Cambios:
--   1. wildcard_entries: añade cost_charged boolean
--   2. enter_wildcard: ya NO descuenta puntos al entrar
--   3. Nueva función apply_wildcard_cost(p_match_id, p_league_id, p_player_id):
--      calcula el rango actual y descuenta si cost_charged=false
--   4. recalculate_scores actualizado: aplica costes no cobrados como fallback
--   5. Corrección Sudáfrica-Canadá: anula coste cobrado con el sistema antiguo

-- 0. Eliminar función antigua (cambió el tipo de retorno void → integer)
DROP FUNCTION IF EXISTS enter_wildcard(uuid, uuid, uuid, uuid);

-- 1. Columna cost_charged en wildcard_entries
ALTER TABLE wildcard_entries ADD COLUMN IF NOT EXISTS cost_charged boolean NOT NULL DEFAULT false;

-- 2. enter_wildcard v22: solo guarda la entrada, sin descuento inmediato
CREATE OR REPLACE FUNCTION enter_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid, p_qualifier_pick uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Insertar entrada (falla si ya existe por UNIQUE constraint)
  INSERT INTO wildcard_entries(league_id, player_id, match_id, qualifier_pick, cost_charged)
  VALUES(p_league_id, p_player_id, p_match_id, p_qualifier_pick, false);
  RETURN 0;  -- coste se aplica al cierre de la porra via apply_wildcard_cost
END;
$$;

-- 3. apply_wildcard_cost: descuenta el coste según rango actual
--    Llamado por la API cuando se cierra la porra (T-2h) o como fallback en recalculate
CREATE OR REPLACE FUNCTION apply_wildcard_cost(
  p_league_id uuid, p_player_id uuid, p_match_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_rank   integer;
  v_cost   integer;
  v_charged boolean;
BEGIN
  -- ¿Ya cobrado?
  SELECT cost_charged INTO v_charged FROM wildcard_entries
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;
  IF NOT FOUND OR v_charged THEN RETURN 0; END IF;

  -- Calcular rango
  SELECT pos INTO v_rank FROM (
    SELECT player_id, RANK() OVER (ORDER BY points DESC NULLS LAST) AS pos
    FROM scores WHERE league_id = p_league_id
  ) r WHERE player_id = p_player_id;

  v_cost := CASE
    WHEN COALESCE(v_rank, 99) <= 2 THEN 2
    WHEN COALESCE(v_rank, 99) <= 5 THEN 1
    ELSE 0
  END;

  -- Marcar como cobrado
  UPDATE wildcard_entries SET cost_charged = true
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;

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

-- 4. cancel_wildcard: cancela la entrada si el coste no ha sido cobrado aún
CREATE OR REPLACE FUNCTION cancel_wildcard(
  p_league_id uuid, p_player_id uuid, p_match_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_charged boolean;
BEGIN
  SELECT cost_charged INTO v_charged FROM wildcard_entries
  WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;

  IF NOT FOUND THEN RETURN false; END IF;

  -- Si ya se cobró, no se puede cancelar gratis: devolver false
  -- El cliente comprueba T-2h antes de llamar
  IF v_charged THEN RETURN false; END IF;

  -- Borrar entrada y datos relacionados
  DELETE FROM wildcard_entries WHERE league_id=p_league_id AND player_id=p_player_id AND match_id=p_match_id;
  DELETE FROM match_lineups WHERE match_id=p_match_id AND player_id=p_player_id AND is_wildcard=true;
  DELETE FROM predictions WHERE match_id=p_match_id AND player_id=p_player_id AND is_wildcard=true;

  RETURN true;
END;
$$;

-- 5. recalculate_scores v22: igual que v21 + aplica costes pendientes como fallback
CREATE OR REPLACE FUNCTION recalculate_scores(p_match_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $recalc_v22$
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
  v_result_winner uuid;
  v_classified    uuid;
  v_classified_own uuid;
  v_is_knockout  boolean;
  v_wc_qualified  uuid;
BEGIN
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'finished' OR v_match.home_goals IS NULL THEN RETURN; END IF;

  IF v_match.home_goals > v_match.away_goals THEN
    v_result_winner := v_match.home_team_id;
  ELSIF v_match.away_goals > v_match.home_goals THEN
    v_result_winner := v_match.away_team_id;
  ELSE
    v_result_winner := NULL;
  END IF;

  v_is_knockout := v_match.match_type IS NOT NULL AND v_match.match_type <> 'group';
  IF v_is_knockout THEN
    v_classified := COALESCE(
      CASE WHEN v_result_winner IS NULL THEN v_match.winner_team_id ELSE NULL END,
      v_result_winner
    );
  ELSE
    v_classified := NULL;
  END IF;

  -- No borrar wildcard_entry; los costes son persistentes
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
      IF v_home_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_home_own,p_match_id,'result',1,'Empate');
      END IF;
      IF v_away_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_away_own,p_match_id,'result',1,'Empate');
      END IF;
    END IF;

    -- ── EQUIPO CLASIFICADO +2 (eliminatorias) ──
    IF v_is_knockout AND v_classified IS NOT NULL THEN
      v_classified_own := CASE
        WHEN v_classified = v_match.home_team_id THEN v_home_own
        ELSE v_away_own
      END;
      IF v_classified_own IS NOT NULL THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_classified_own,p_match_id,'classified',2,'Equipo clasificado');
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

    -- ── JUGADORES (propietarios) ──
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
      SELECT we.player_id, we.qualifier_pick, we.cost_charged
      FROM wildcard_entries we
      WHERE we.match_id = p_match_id AND we.league_id = v_league_id
    ) LOOP
      -- Fallback: cobrar coste si no se hizo en T-2h (cliente no abrió la app)
      IF NOT v_wc.cost_charged THEN
        PERFORM apply_wildcard_cost(v_league_id, v_wc.player_id, p_match_id);
      END IF;

      -- Acierto qualifier
      v_wc_qualified := COALESCE(v_classified, v_result_winner);
      IF v_wc_qualified IS NOT NULL AND v_wc.qualifier_pick = v_wc_qualified THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_qualifier',2,'Wildcard: equipo correcto');
      END IF;

      -- Porra wildcard
      SELECT * INTO v_hp FROM predictions
        WHERE match_id=p_match_id AND player_id=v_wc.player_id AND is_wildcard = true;
      IF v_hp IS NOT NULL AND v_hp.home_goals=v_match.home_goals AND v_hp.away_goals=v_match.away_goals THEN
        INSERT INTO score_log(league_id,player_id,match_id,category,points,detail)
        VALUES(v_league_id,v_wc.player_id,p_match_id,'wildcard_prediction',1,'Wildcard: porra acertada');
      END IF;

      -- Jugadores wildcard (puntuación completa)
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

  -- Reconstruir scores
  IF array_length(v_leagues,1) > 0 THEN
    DELETE FROM scores WHERE league_id = ANY(v_leagues);
    INSERT INTO scores(league_id,player_id,points)
    SELECT league_id, player_id, SUM(points)
    FROM score_log WHERE league_id = ANY(v_leagues)
    GROUP BY league_id, player_id;
  END IF;
END;
$recalc_v22$;

-- ── CORRECCIÓN Sudáfrica-Canadá ──────────────────────────────────────────
-- Elimina el coste antiguo (sistema viejo: -2 pts fijos al entrar)
-- y fuerza recálculo con el nuevo sistema (coste por rango).
-- Ejecutar SOLO si Sudáfrica-Canadá ya tiene resultado en la BD.

DO $$
DECLARE
  v_match_id uuid;
BEGIN
  -- Buscar el partido en las ligas (con resultado)
  SELECT m.id INTO v_match_id
  FROM matches m
  JOIN teams h ON h.id = m.home_team_id
  JOIN teams a ON a.id = m.away_team_id
  WHERE h.name = 'Sudáfrica' AND a.name = 'Canadá'
    AND m.status = 'finished'
    AND m.league_id IS NOT NULL
  LIMIT 1;

  IF v_match_id IS NULL THEN
    RAISE NOTICE 'Sudáfrica-Canadá no encontrado o no terminado; nada que corregir.';
    RETURN;
  END IF;

  -- Eliminar costes cobrados con el sistema viejo
  DELETE FROM score_log
  WHERE match_id = v_match_id AND category = 'wildcard_entry';

  -- Resetear cost_charged para que apply_wildcard_cost los recalcule
  UPDATE wildcard_entries SET cost_charged = false
  WHERE match_id = v_match_id;

  -- Recalcular (aplica nuevo coste por rango + resultados)
  PERFORM recalculate_scores(v_match_id);

  RAISE NOTICE 'Sudáfrica-Canadá recalculado correctamente (match_id: %)', v_match_id;
END;
$$;
