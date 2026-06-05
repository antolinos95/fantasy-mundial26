-- Añadir minuto a eventos de jugadores
ALTER TABLE player_events ADD COLUMN IF NOT EXISTS minute integer;

-- Vista de estadísticas por jugador y liga
CREATE OR REPLACE VIEW player_stats_by_league AS
SELECT
  pe.squad_player_id,
  sp.team_id,
  sp.name,
  sp.position,
  sp.shirt_number,
  m.league_id,
  COUNT(CASE WHEN pe.event_type IN ('goal','goal_extra_time','penalty_shootout') THEN 1 END) AS goals,
  COUNT(CASE WHEN pe.event_type = 'own_goal'  THEN 1 END) AS own_goals,
  COUNT(CASE WHEN pe.event_type = 'red_card'  THEN 1 END) AS red_cards
FROM player_events pe
JOIN squad_players sp ON sp.id = pe.squad_player_id
JOIN matches       m  ON m.id  = pe.match_id
GROUP BY pe.squad_player_id, sp.team_id, sp.name, sp.position, sp.shirt_number, m.league_id;
