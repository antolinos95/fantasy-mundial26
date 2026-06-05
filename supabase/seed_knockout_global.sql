-- ============================================================
-- Cuadro eliminatorio del Mundial 2026 como partidos GLOBALES
-- Ejecutar ENTERO en el SQL Editor de Supabase
-- Requiere: league_id, home_team_id, away_team_id nullable
--           + columnas slot_home, slot_away (schema_v5/v6)
-- ============================================================

-- Limpiar eliminatorias globales previas (evita duplicados)
DELETE FROM matches WHERE league_id IS NULL AND match_type IN ('r32','r16','qf','sf','third','final');

INSERT INTO matches (league_id, home_team_id, away_team_id, slot_home, slot_away, match_date, match_type, status) VALUES
-- Ronda de 32
(NULL,NULL,NULL,'2A','2B','2026-06-29 02:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1E','3º(A/B/C/D/F)','2026-06-29 19:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1F','2C','2026-06-29 22:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1C','2F','2026-06-30 01:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1I','3º(C/D/F/G/H)','2026-06-30 19:00+00','r32','scheduled'),
(NULL,NULL,NULL,'2E','2I','2026-06-30 22:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1A','3º(C/E/F/H/I)','2026-07-01 01:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1L','3º(E/H/I/J/K)','2026-07-01 19:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1D','3º(B/E/F/I/J)','2026-07-01 22:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1G','3º(A/E/H/I/J)','2026-07-02 01:00+00','r32','scheduled'),
(NULL,NULL,NULL,'2K','2L','2026-07-02 19:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1H','2J','2026-07-02 22:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1B','3º(E/F/G/I/J)','2026-07-03 01:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1J','2H','2026-07-03 19:00+00','r32','scheduled'),
(NULL,NULL,NULL,'1K','3º(D/E/I/J/L)','2026-07-03 22:00+00','r32','scheduled'),
(NULL,NULL,NULL,'2D','2G','2026-07-04 01:00+00','r32','scheduled'),
-- Ronda de 16
(NULL,NULL,NULL,'W(1E/3º)','W(1I/3º)','2026-07-05 19:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(2A/2B)','W(1F/2C)','2026-07-06 00:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(1C/2F)','W(2E/2I)','2026-07-06 19:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(1A/3º)','W(1L/3º)','2026-07-07 00:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(1D/3º)','W(1G/3º)','2026-07-07 19:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(2K/2L)','W(1H/2J)','2026-07-08 00:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(1B/3º)','W(1J/2H)','2026-07-08 19:00+00','r16','scheduled'),
(NULL,NULL,NULL,'W(1K/3º)','W(2D/2G)','2026-07-09 00:00+00','r16','scheduled'),
-- Cuartos
(NULL,NULL,NULL,'W R16-1','W R16-2','2026-07-09 23:00+00','qf','scheduled'),
(NULL,NULL,NULL,'W R16-3','W R16-4','2026-07-10 23:00+00','qf','scheduled'),
(NULL,NULL,NULL,'W R16-5','W R16-6','2026-07-11 23:00+00','qf','scheduled'),
(NULL,NULL,NULL,'W R16-7','W R16-8','2026-07-12 23:00+00','qf','scheduled'),
-- Semifinales
(NULL,NULL,NULL,'W QF-1','W QF-2','2026-07-14 23:00+00','sf','scheduled'),
(NULL,NULL,NULL,'W QF-3','W QF-4','2026-07-15 23:00+00','sf','scheduled'),
-- Tercer puesto
(NULL,NULL,NULL,'L SF-1','L SF-2','2026-07-18 23:00+00','third','scheduled'),
-- Final
(NULL,NULL,NULL,'W SF-1','W SF-2','2026-07-19 19:00+00','final','scheduled');
