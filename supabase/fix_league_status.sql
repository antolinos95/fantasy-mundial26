-- Corregir el estado de las ligas según el estado real del draft

-- Draft terminado → liga activa (en juego)
UPDATE leagues SET status = 'active'
WHERE id IN (SELECT league_id FROM draft_state WHERE finished = true);

-- Draft iniciado pero no terminado → en draft
UPDATE leagues SET status = 'drafting'
WHERE id IN (
  SELECT league_id FROM draft_state WHERE started = true AND finished = false
) AND status <> 'active';

-- Ligas con equipos ya repartidos pero sin draft_state → activa
UPDATE leagues SET status = 'active'
WHERE id IN (SELECT DISTINCT league_id FROM drafted_teams)
  AND status = 'waiting';
