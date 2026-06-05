-- ============================================================
-- Carga el cuadro eliminatorio del Mundial 2026
-- Ejecutar DESPUÉS de schema_v5.sql
-- Usar el botón "⚽ Cargar fase eliminatoria" en Admin
-- ============================================================

CREATE OR REPLACE FUNCTION load_knockout_matches(p_league_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE inserted integer := 0;

  PROCEDURE ins(sh text, sa text, dt timestamptz, mt text) AS $$
  BEGIN
    INSERT INTO matches(league_id, slot_home, slot_away, match_date, match_type, status)
    VALUES (p_league_id, sh, sa, dt, mt, 'scheduled')
    ON CONFLICT DO NOTHING;
    inserted := inserted + 1;
  END;
  $$;

BEGIN
  -- ── RONDA DE 32 (Octavos de final) ──────────────────────────
  CALL ins('2A',            '2B',            '2026-06-29 02:00+00', 'r32');
  CALL ins('1E',            '3º(A/B/C/D/F)', '2026-06-29 19:00+00', 'r32');
  CALL ins('1F',            '2C',            '2026-06-29 22:00+00', 'r32');
  CALL ins('1C',            '2F',            '2026-06-30 01:00+00', 'r32');
  CALL ins('1I',            '3º(C/D/F/G/H)', '2026-06-30 19:00+00', 'r32');
  CALL ins('2E',            '2I',            '2026-06-30 22:00+00', 'r32');
  CALL ins('1A',            '3º(C/E/F/H/I)', '2026-07-01 01:00+00', 'r32');
  CALL ins('1L',            '3º(E/H/I/J/K)', '2026-07-01 19:00+00', 'r32');
  CALL ins('1D',            '3º(B/E/F/I/J)', '2026-07-01 22:00+00', 'r32');
  CALL ins('1G',            '3º(A/E/H/I/J)', '2026-07-02 01:00+00', 'r32');
  CALL ins('2K',            '2L',            '2026-07-02 19:00+00', 'r32');
  CALL ins('1H',            '2J',            '2026-07-02 22:00+00', 'r32');
  CALL ins('1B',            '3º(E/F/G/I/J)', '2026-07-03 01:00+00', 'r32');
  CALL ins('1J',            '2H',            '2026-07-03 19:00+00', 'r32');
  CALL ins('1K',            '3º(D/E/I/J/L)', '2026-07-03 22:00+00', 'r32');
  CALL ins('2D',            '2G',            '2026-07-04 01:00+00', 'r32');

  -- ── RONDA DE 16 ─────────────────────────────────────────────
  CALL ins('W(1E/3º)',      'W(1I/3º)',      '2026-07-05 19:00+00', 'r16');
  CALL ins('W(2A/2B)',      'W(1F/2C)',      '2026-07-06 00:00+00', 'r16');
  CALL ins('W(1C/2F)',      'W(2E/2I)',      '2026-07-06 19:00+00', 'r16');
  CALL ins('W(1A/3º)',      'W(1L/3º)',      '2026-07-07 00:00+00', 'r16');
  CALL ins('W(1D/3º)',      'W(1G/3º)',      '2026-07-07 19:00+00', 'r16');
  CALL ins('W(2K/2L)',      'W(1H/2J)',      '2026-07-08 00:00+00', 'r16');
  CALL ins('W(1B/3º)',      'W(1J/2H)',      '2026-07-08 19:00+00', 'r16');
  CALL ins('W(1K/3º)',      'W(2D/2G)',      '2026-07-09 00:00+00', 'r16');

  -- ── CUARTOS DE FINAL ────────────────────────────────────────
  CALL ins('W R16-1',       'W R16-2',       '2026-07-09 23:00+00', 'qf');
  CALL ins('W R16-3',       'W R16-4',       '2026-07-10 23:00+00', 'qf');
  CALL ins('W R16-5',       'W R16-6',       '2026-07-11 23:00+00', 'qf');
  CALL ins('W R16-7',       'W R16-8',       '2026-07-12 23:00+00', 'qf');

  -- ── SEMIFINALES ─────────────────────────────────────────────
  CALL ins('W QF-1',        'W QF-2',        '2026-07-14 23:00+00', 'sf');
  CALL ins('W QF-3',        'W QF-4',        '2026-07-15 23:00+00', 'sf');

  -- ── TERCER PUESTO ───────────────────────────────────────────
  CALL ins('L SF-1',        'L SF-2',        '2026-07-18 23:00+00', 'third');

  -- ── FINAL ───────────────────────────────────────────────────
  CALL ins('W SF-1',        'W SF-2',        '2026-07-19 19:00+00', 'final');

  RETURN inserted;
END;
$$;
