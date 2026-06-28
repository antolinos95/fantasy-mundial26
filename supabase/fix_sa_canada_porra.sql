-- ============================================================
-- FIX: Sudáfrica-Canadá — porra abierta por huso horario incorrecto
--
-- El seed tenía 2026-06-29 02:00+00 en lugar de 2026-06-28 19:00+00.
-- La porra se cerró 7h tarde. Este script:
--   1. Corrige match_date en todos los partidos SA-Canadá (global + ligas)
--   2. Elimina predicciones enviadas DESPUÉS del cierre correcto (17:00 UTC)
--      — esas predicciones son ilegítimas
--   3. Recalcula los puntos afectados
-- ============================================================

DO $$
DECLARE
  v_correct_date   timestamptz := '2026-06-28 19:00:00+00';
  v_lock_cutoff    timestamptz := '2026-06-28 17:00:00+00';  -- T-2h
  v_match          RECORD;
  v_deleted_preds  integer;
BEGIN

  -- 1. Corregir match_date en todos los partidos SA-Canadá
  FOR v_match IN
    SELECT m.id, m.league_id, m.status FROM matches m
    JOIN teams h ON h.id = m.home_team_id
    JOIN teams a ON a.id = m.away_team_id
    WHERE h.name = 'Sudáfrica' AND a.name = 'Canadá'
    UNION ALL
    -- También el global (league_id IS NULL, identificado por slot)
    SELECT m.id, m.league_id, m.status FROM matches m
    WHERE m.league_id IS NULL AND m.slot_home = 'Sudáfrica' AND m.slot_away = 'Canadá'
  LOOP
    UPDATE matches SET match_date = v_correct_date WHERE id = v_match.id;
    RAISE NOTICE 'match_date corregido: match_id=%, league_id=%', v_match.id, v_match.league_id;

    -- 2. Borrar predicciones enviadas después del cierre correcto
    --    (is_wildcard IS NOT TRUE para no tocar las wildcard, que tienen su propia lógica)
    DELETE FROM predictions
    WHERE match_id = v_match.id
      AND is_wildcard IS NOT TRUE
      AND created_at > v_lock_cutoff;

    GET DIAGNOSTICS v_deleted_preds = ROW_COUNT;
    IF v_deleted_preds > 0 THEN
      RAISE NOTICE '  → % predicción(es) tardía(s) eliminada(s)', v_deleted_preds;
    END IF;

    -- 3. Recalcular si el partido ya está terminado
    IF v_match.status = 'finished' THEN
      PERFORM recalculate_scores(v_match.id);
      RAISE NOTICE '  → recalculate_scores ejecutado', v_match.id;
    END IF;
  END LOOP;

END;
$$;
