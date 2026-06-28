-- schema_v22c: corregir coste wildcard Sudáfrica-Canadá
-- Ejecutar DESPUÉS de schema_v22a y schema_v22b

DO $$
DECLARE
  v_match_id uuid;
BEGIN
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

  DELETE FROM score_log
  WHERE match_id = v_match_id AND category = 'wildcard_entry';

  UPDATE wildcard_entries SET cost_charged = false
  WHERE match_id = v_match_id;

  RAISE NOTICE 'Corrección aplicada (match_id: %)', v_match_id;
END;
$$;
