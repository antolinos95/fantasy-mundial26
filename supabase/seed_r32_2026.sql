-- ============================================================
-- Cruces confirmados Ronda de 32 – Mundial 2026
-- Horarios de ESPN, almacenados en UTC
-- Europe/Madrid (CEST) = UTC+2 en verano
-- Solo inserta cruces que NO existen aún (no borra predicciones)
-- ============================================================

DO $$
DECLARE
  v_home uuid; v_away uuid;

  -- Lista de cruces: (home_name, away_name, slot_home, slot_away, match_date)
  r RECORD;
BEGIN
  FOR r IN (
    SELECT * FROM (VALUES
      ('Sudáfrica',          'Canadá',              'Sudáfrica',    'Canadá',         '2026-06-28 19:00:00+00'::timestamptz),
      ('Brasil',             'Japón',               'Brasil',       'Japón',          '2026-06-29 17:00:00+00'::timestamptz),
      ('Alemania',           'Paraguay',            'Alemania',     'Paraguay',       '2026-06-29 20:30:00+00'::timestamptz),
      ('Países Bajos',       'Marruecos',           'Países Bajos', 'Marruecos',      '2026-06-30 01:00:00+00'::timestamptz),
      ('Costa de Marfil',    'Noruega',             'Costa de Marfil','Noruega',      '2026-06-30 17:00:00+00'::timestamptz),
      ('Francia',            'Suecia',              'Francia',      'Suecia',         '2026-06-30 21:00:00+00'::timestamptz),
      ('México',             'Ecuador',             'México',       'Ecuador',        '2026-07-01 01:00:00+00'::timestamptz),
      ('Inglaterra',         'DR Congo',            'Inglaterra',   'DR Congo',       '2026-07-01 16:00:00+00'::timestamptz),
      ('Bélgica',            'Senegal',             'Bélgica',      'Senegal',        '2026-07-01 20:00:00+00'::timestamptz),
      ('Estados Unidos',     'Bosnia y Herzegovina','Estados Unidos','Bosnia y Herz.','2026-07-02 00:00:00+00'::timestamptz),
      ('España',             'Austria',             'España',       'Austria',        '2026-07-02 19:00:00+00'::timestamptz),
      ('Portugal',           'Croacia',             'Portugal',     'Croacia',        '2026-07-02 23:00:00+00'::timestamptz),
      ('Suiza',              'Argelia',             'Suiza',        'Argelia',        '2026-07-03 03:00:00+00'::timestamptz),
      ('Australia',          'Egipto',              'Australia',    'Egipto',         '2026-07-03 18:00:00+00'::timestamptz),
      ('Argentina',          'Cabo Verde',          'Argentina',    'Cabo Verde',     '2026-07-03 22:00:00+00'::timestamptz),
      ('Colombia',           'Ghana',               'Colombia',     'Ghana',          '2026-07-04 01:30:00+00'::timestamptz)
    ) AS t(home_name, away_name, slot_home, slot_away, match_date)
  ) LOOP
    v_home := (SELECT id FROM teams WHERE name = r.home_name);
    v_away := (SELECT id FROM teams WHERE name = r.away_name);

    IF v_home IS NULL THEN RAISE WARNING 'Equipo no encontrado: %', r.home_name; CONTINUE; END IF;
    IF v_away IS NULL THEN RAISE WARNING 'Equipo no encontrado: %', r.away_name; CONTINUE; END IF;

    -- Si ya existe el partido global r32 entre estos dos equipos, solo actualiza fecha/slot
    IF EXISTS (
      SELECT 1 FROM matches
      WHERE league_id IS NULL AND match_type = 'r32'
        AND home_team_id = v_home AND away_team_id = v_away
    ) THEN
      UPDATE matches
      SET match_date = r.match_date,
          slot_home  = r.slot_home,
          slot_away  = r.slot_away
      WHERE league_id IS NULL AND match_type = 'r32'
        AND home_team_id = v_home AND away_team_id = v_away;
      RAISE NOTICE 'Actualizado: % vs %', r.home_name, r.away_name;
    ELSE
      INSERT INTO matches (league_id, home_team_id, away_team_id, slot_home, slot_away, match_date, match_type, status)
      VALUES (NULL, v_home, v_away, r.slot_home, r.slot_away, r.match_date, 'r32', 'scheduled');
      RAISE NOTICE 'Insertado: % vs %', r.home_name, r.away_name;
    END IF;
  END LOOP;
END;
$$;
