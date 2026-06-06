-- schema_v12: pg_cron para sincronizar resultados con football-data.org
-- Ejecutar DESPUÉS de habilitar pg_cron y pg_net

-- Eliminar job previo si existe
SELECT cron.unschedule('football-sync') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'football-sync'
);

-- Cada 5 minutos entre las 14:00 y 00:00 UTC (cubre horarios del Mundial)
SELECT cron.schedule(
  'football-sync',
  '*/5 14-23 * * *',
  $$
  SELECT net.http_get(
    url := 'https://fantasy-mundial26.vercel.app/api/football/sync',
    headers := '{"x-push-secret":"fm26_push_secret_Aojansdueho97HS9mhs83"}'::jsonb
  );
  $$
);
