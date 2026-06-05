-- Añadir URL de foto a jugadores
ALTER TABLE squad_players ADD COLUMN IF NOT EXISTS photo_url text;
