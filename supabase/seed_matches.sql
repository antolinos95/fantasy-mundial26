-- ============================================================
-- Carga los 72 partidos de fase de grupos del Mundial 2026
-- Ejecutar en Supabase SQL Editor, luego usar el botón Admin
-- ============================================================

CREATE OR REPLACE FUNCTION load_group_stage_matches(p_league_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  h uuid; a uuid; inserted integer := 0;
BEGIN

-- MACRO inline: busca IDs y hace INSERT
-- Grupo A
  h := (SELECT id FROM teams WHERE fifa_code='MEX'); a := (SELECT id FROM teams WHERE fifa_code='RSA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-11 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='KOR'); a := (SELECT id FROM teams WHERE fifa_code='CZE');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-12 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CZE'); a := (SELECT id FROM teams WHERE fifa_code='RSA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-18 16:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='MEX'); a := (SELECT id FROM teams WHERE fifa_code='KOR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-19 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CZE'); a := (SELECT id FROM teams WHERE fifa_code='MEX');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='RSA'); a := (SELECT id FROM teams WHERE fifa_code='KOR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo B
  h := (SELECT id FROM teams WHERE fifa_code='CAN'); a := (SELECT id FROM teams WHERE fifa_code='BIH');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-12 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='QAT'); a := (SELECT id FROM teams WHERE fifa_code='SUI');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-13 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SUI'); a := (SELECT id FROM teams WHERE fifa_code='BIH');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-18 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CAN'); a := (SELECT id FROM teams WHERE fifa_code='QAT');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-18 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SUI'); a := (SELECT id FROM teams WHERE fifa_code='CAN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-24 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='BIH'); a := (SELECT id FROM teams WHERE fifa_code='QAT');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-24 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo C
  h := (SELECT id FROM teams WHERE fifa_code='BRA'); a := (SELECT id FROM teams WHERE fifa_code='MAR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-13 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='HAI'); a := (SELECT id FROM teams WHERE fifa_code='SCO');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-14 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SCO'); a := (SELECT id FROM teams WHERE fifa_code='MAR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-19 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='BRA'); a := (SELECT id FROM teams WHERE fifa_code='HAI');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-20 00:30+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SCO'); a := (SELECT id FROM teams WHERE fifa_code='BRA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-24 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='MAR'); a := (SELECT id FROM teams WHERE fifa_code='HAI');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-24 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo D
  h := (SELECT id FROM teams WHERE fifa_code='USA'); a := (SELECT id FROM teams WHERE fifa_code='PAR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-13 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='AUS'); a := (SELECT id FROM teams WHERE fifa_code='TUR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-14 04:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='USA'); a := (SELECT id FROM teams WHERE fifa_code='AUS');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-19 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='TUR'); a := (SELECT id FROM teams WHERE fifa_code='PAR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-20 03:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='TUR'); a := (SELECT id FROM teams WHERE fifa_code='USA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-26 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='PAR'); a := (SELECT id FROM teams WHERE fifa_code='AUS');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-26 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo E
  h := (SELECT id FROM teams WHERE fifa_code='GER'); a := (SELECT id FROM teams WHERE fifa_code='CUW');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-14 17:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CIV'); a := (SELECT id FROM teams WHERE fifa_code='ECU');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-14 23:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='GER'); a := (SELECT id FROM teams WHERE fifa_code='CIV');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-20 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ECU'); a := (SELECT id FROM teams WHERE fifa_code='CUW');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-21 00:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CUW'); a := (SELECT id FROM teams WHERE fifa_code='CIV');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ECU'); a := (SELECT id FROM teams WHERE fifa_code='GER');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo F
  h := (SELECT id FROM teams WHERE fifa_code='NED'); a := (SELECT id FROM teams WHERE fifa_code='JPN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-14 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SWE'); a := (SELECT id FROM teams WHERE fifa_code='TUN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-15 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='NED'); a := (SELECT id FROM teams WHERE fifa_code='SWE');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-20 17:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='TUN'); a := (SELECT id FROM teams WHERE fifa_code='JPN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-21 04:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='JPN'); a := (SELECT id FROM teams WHERE fifa_code='SWE');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 23:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='TUN'); a := (SELECT id FROM teams WHERE fifa_code='NED');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-25 23:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo G
  h := (SELECT id FROM teams WHERE fifa_code='BEL'); a := (SELECT id FROM teams WHERE fifa_code='EGY');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-15 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='IRN'); a := (SELECT id FROM teams WHERE fifa_code='NZL');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-16 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='BEL'); a := (SELECT id FROM teams WHERE fifa_code='IRN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-21 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='NZL'); a := (SELECT id FROM teams WHERE fifa_code='EGY');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-22 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='EGY'); a := (SELECT id FROM teams WHERE fifa_code='IRN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 03:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='NZL'); a := (SELECT id FROM teams WHERE fifa_code='BEL');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 03:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo H
  h := (SELECT id FROM teams WHERE fifa_code='ESP'); a := (SELECT id FROM teams WHERE fifa_code='CPV');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-15 16:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='KSA'); a := (SELECT id FROM teams WHERE fifa_code='URU');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-15 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ESP'); a := (SELECT id FROM teams WHERE fifa_code='KSA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-21 16:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='URU'); a := (SELECT id FROM teams WHERE fifa_code='CPV');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-21 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CPV'); a := (SELECT id FROM teams WHERE fifa_code='KSA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 00:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='URU'); a := (SELECT id FROM teams WHERE fifa_code='ESP');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 00:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo I
  h := (SELECT id FROM teams WHERE fifa_code='FRA'); a := (SELECT id FROM teams WHERE fifa_code='SEN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-16 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='IRQ'); a := (SELECT id FROM teams WHERE fifa_code='NOR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-16 22:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='FRA'); a := (SELECT id FROM teams WHERE fifa_code='IRQ');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-22 21:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='NOR'); a := (SELECT id FROM teams WHERE fifa_code='SEN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-23 00:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='NOR'); a := (SELECT id FROM teams WHERE fifa_code='FRA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-26 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='SEN'); a := (SELECT id FROM teams WHERE fifa_code='IRQ');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-26 19:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo J
  h := (SELECT id FROM teams WHERE fifa_code='ARG'); a := (SELECT id FROM teams WHERE fifa_code='ALG');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-17 01:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='AUT'); a := (SELECT id FROM teams WHERE fifa_code='JOR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-17 04:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ARG'); a := (SELECT id FROM teams WHERE fifa_code='AUT');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-22 17:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='JOR'); a := (SELECT id FROM teams WHERE fifa_code='ALG');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-23 03:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ALG'); a := (SELECT id FROM teams WHERE fifa_code='AUT');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-28 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='JOR'); a := (SELECT id FROM teams WHERE fifa_code='ARG');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-28 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo K
  h := (SELECT id FROM teams WHERE fifa_code='POR'); a := (SELECT id FROM teams WHERE fifa_code='COD');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-17 17:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='UZB'); a := (SELECT id FROM teams WHERE fifa_code='COL');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-18 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='POR'); a := (SELECT id FROM teams WHERE fifa_code='UZB');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-23 17:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='COL'); a := (SELECT id FROM teams WHERE fifa_code='COD');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-24 02:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='COL'); a := (SELECT id FROM teams WHERE fifa_code='POR');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 23:30+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='COD'); a := (SELECT id FROM teams WHERE fifa_code='UZB');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 23:30+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

-- Grupo L
  h := (SELECT id FROM teams WHERE fifa_code='ENG'); a := (SELECT id FROM teams WHERE fifa_code='CRO');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-17 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='GHA'); a := (SELECT id FROM teams WHERE fifa_code='PAN');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-17 23:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='ENG'); a := (SELECT id FROM teams WHERE fifa_code='GHA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-23 20:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='PAN'); a := (SELECT id FROM teams WHERE fifa_code='CRO');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-23 23:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='PAN'); a := (SELECT id FROM teams WHERE fifa_code='ENG');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 21:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  h := (SELECT id FROM teams WHERE fifa_code='CRO'); a := (SELECT id FROM teams WHERE fifa_code='GHA');
  IF h IS NOT NULL AND a IS NOT NULL THEN INSERT INTO matches(league_id,home_team_id,away_team_id,match_date,match_type,status) VALUES(p_league_id,h,a,'2026-06-27 21:00+00','group','scheduled') ON CONFLICT DO NOTHING; inserted:=inserted+1; END IF;

  RETURN inserted;
END;
$$;

