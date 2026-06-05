-- ============================================================
-- v6: Partidos globales + vista de estadísticas global
-- ⚠️ La función recalculate_scores se define en schema_v7.sql
--    (versión con libro mayor). NO redefinir aquí.
-- ============================================================

-- 1. Partidos globales: league_id nullable
ALTER TABLE matches ALTER COLUMN league_id DROP NOT NULL;

-- 2. Vista de estadísticas global (indiferente del lineup y la liga)
DROP VIEW IF EXISTS player_stats_by_league;

CREATE OR REPLACE VIEW player_stats_global AS
SELECT
  sp.id            AS squad_player_id,
  sp.team_id,
  sp.name,
  sp.position,
  sp.shirt_number,
  sp.photo_url,
  t.flag_emoji,
  t.name           AS team_name,
  COUNT(CASE WHEN pe.event_type IN ('goal','goal_extra_time','penalty_shootout') THEN 1 END) AS goals,
  COUNT(CASE WHEN pe.event_type = 'own_goal'  THEN 1 END) AS own_goals,
  COUNT(CASE WHEN pe.event_type = 'red_card'  THEN 1 END) AS red_cards
FROM squad_players sp
JOIN teams t ON t.id = sp.team_id
LEFT JOIN player_events pe ON pe.squad_player_id = sp.id
GROUP BY sp.id, sp.team_id, sp.name, sp.position, sp.shirt_number, sp.photo_url, t.flag_emoji, t.name;

-- Permisos de lectura pública
GRANT SELECT ON player_stats_global TO anon, authenticated;
