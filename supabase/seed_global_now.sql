-- ============================================================
-- ARREGLO: partidos globales (compartidos por todas las ligas)
-- Ejecutar ENTERO en el SQL Editor de Supabase
-- ============================================================

-- 1. Permitir partidos globales (league_id = NULL)
ALTER TABLE matches ALTER COLUMN league_id DROP NOT NULL;

-- 2. Limpiar partidos globales previos (evita duplicados al reejecutar)
DELETE FROM matches WHERE league_id IS NULL;

-- 3. Cargar los 72 partidos de fase de grupos como GLOBALES
--    (reutiliza la función que ya tienes creada)
SELECT load_group_stage_matches(NULL);
