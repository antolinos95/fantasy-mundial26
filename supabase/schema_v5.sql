-- Soportar partidos eliminatorios (equipos se conocen cuando terminen los grupos)
ALTER TABLE matches ALTER COLUMN home_team_id DROP NOT NULL;
ALTER TABLE matches ALTER COLUMN away_team_id DROP NOT NULL;

-- Etiquetas de posición en el cuadro (ej. "1A", "2B", "W73")
ALTER TABLE matches ADD COLUMN IF NOT EXISTS slot_home text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS slot_away text;
