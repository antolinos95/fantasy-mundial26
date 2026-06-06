-- schema_v12: pg_cron para sincronizar resultados con football-data.org
-- Ejecutar DESPUÉS de habilitar pg_cron y pg_net
-- Horarios UTC extraídos de seed_matches.sql:
--   Madrugada: 00:00-06:00 (partidos a la 01h, 02h, 03h, 04h)
--   Tarde/noche: 16:00-23:59 (partidos a las 16h, 17h, 19h, 20h-23:30h)

-- Eliminar jobs previos si existen
SELECT cron.unschedule('football-sync-morning') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'football-sync-morning'
);
SELECT cron.unschedule('football-sync-evening') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'football-sync-evening'
);
SELECT cron.unschedule('football-sync') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'football-sync'
);

-- Franja madrugada: cada 5 min de 00:00 a 06:59 UTC
SELECT cron.schedule(
  'football-sync-morning',
  '*/5 0-6 * * *',
  $$
  SELECT net.http_get(
    url := 'https://fantasy-mundial26.vercel.app/api/football/sync',
    headers := '{"x-push-secret":"fm26_push_secret_Aojansdueho97HS9mhs83"}'::jsonb
  );
  $$
);

-- Franja tarde/noche: cada 5 min de 16:00 a 23:59 UTC
SELECT cron.schedule(
  'football-sync-evening',
  '*/5 16-23 * * *',
  $$
  SELECT net.http_get(
    url := 'https://fantasy-mundial26.vercel.app/api/football/sync',
    headers := '{"x-push-secret":"fm26_push_secret_Aojansdueho97HS9mhs83"}'::jsonb
  );
  $$
);
