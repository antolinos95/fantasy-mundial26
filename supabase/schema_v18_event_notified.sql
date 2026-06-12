-- schema_v18: columna notified en player_events para no re-notificar
ALTER TABLE player_events
  ADD COLUMN IF NOT EXISTS notified boolean NOT NULL DEFAULT false;
