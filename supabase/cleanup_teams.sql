-- Eliminar equipos que NO clasificaron al Mundial 2026
-- Los 48 equipos reales están en grupos A-L (4 por grupo)
DELETE FROM teams
WHERE fifa_code IN (
  'HON','JAM',  -- CONCACAF no clasificados
  'CHI','PER','BOL','VEN',  -- CONMEBOL no clasificados
  'NGA','CMR',  -- CAF no clasificados
  'ITA','DEN','SRB','POL','ROU','HUN'  -- UEFA no clasificados
);
