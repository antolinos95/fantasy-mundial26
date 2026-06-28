-- schema_v22b — PARTE 1: subfunción por liga
-- Pegar primero este bloque, luego la PARTE 2

CREATE OR REPLACE FUNCTION event_pts(p text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'goal' THEN 1.0 WHEN 'goal_extra_time' THEN 1.0
    WHEN 'penalty_shootout' THEN 0.5 WHEN 'assist' THEN 0.5
    WHEN 'clean_sheet_gk' THEN 2.0 WHEN 'clean_sheet_def' THEN 1.0
    WHEN 'penalty_missed' THEN -0.5 WHEN 'penalty_missed_shootout' THEN -0.25
    WHEN 'own_goal' THEN -1.0 WHEN 'red_card' THEN -1.0 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION recalc_league(
  p_mid uuid, p_lid uuid, p_hown uuid, p_aown uuid,
  p_hg int, p_ag int, p_htm uuid, p_atm uuid,
  p_win uuid, p_cls uuid, p_ko boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_hp predictions%ROWTYPE; v_ap predictions%ROWTYPE;
  v_he bool; v_ae bool; v_rec RECORD; v_wc RECORD; v_q uuid;
BEGIN
  IF p_win=p_htm THEN
    IF p_hown IS NOT NULL THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'result',2,'Victoria'); END IF;
  ELSIF p_win=p_atm THEN
    IF p_aown IS NOT NULL THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_aown,p_mid,'result',2,'Victoria'); END IF;
  ELSE
    IF p_hown IS NOT NULL THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'result',1,'Empate'); END IF;
    IF p_aown IS NOT NULL THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_aown,p_mid,'result',1,'Empate'); END IF;
  END IF;
  IF p_ko AND p_cls IS NOT NULL THEN
    DECLARE v_co uuid; BEGIN v_co:=CASE WHEN p_cls=p_htm THEN p_hown ELSE p_aown END;
      IF v_co IS NOT NULL THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,v_co,p_mid,'classified',2,'Equipo clasificado'); END IF;
    END;
  END IF;
  IF p_hown IS NOT NULL AND p_aown IS NOT NULL AND p_hown=p_aown THEN
    SELECT * INTO v_hp FROM predictions WHERE match_id=p_mid AND player_id=p_hown AND is_wildcard IS NOT TRUE;
    IF v_hp IS NOT NULL AND v_hp.home_goals=p_hg AND v_hp.away_goals=p_ag THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'prediction',1,'Porra acertada'); END IF;
  ELSIF p_hown IS NOT NULL AND p_aown IS NOT NULL THEN
    SELECT * INTO v_hp FROM predictions WHERE match_id=p_mid AND player_id=p_hown AND is_wildcard IS NOT TRUE;
    SELECT * INTO v_ap FROM predictions WHERE match_id=p_mid AND player_id=p_aown AND is_wildcard IS NOT TRUE;
    v_he:=v_hp IS NOT NULL AND v_hp.home_goals=p_hg AND v_hp.away_goals=p_ag;
    v_ae:=v_ap IS NOT NULL AND v_ap.home_goals=p_hg AND v_ap.away_goals=p_ag;
    IF v_he AND NOT v_ae THEN
      INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'prediction',1,'Porra robada');
      INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_aown,p_mid,'prediction',-1,'Porra perdida');
    ELSIF v_ae AND NOT v_he THEN
      INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_aown,p_mid,'prediction',1,'Porra robada');
      INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'prediction',-1,'Porra perdida');
    END IF;
  ELSIF p_hown IS NOT NULL THEN
    SELECT * INTO v_hp FROM predictions WHERE match_id=p_mid AND player_id=p_hown AND is_wildcard IS NOT TRUE;
    IF v_hp IS NOT NULL AND v_hp.home_goals=p_hg AND v_hp.away_goals=p_ag THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_hown,p_mid,'prediction',1,'Porra acertada'); END IF;
  ELSIF p_aown IS NOT NULL THEN
    SELECT * INTO v_ap FROM predictions WHERE match_id=p_mid AND player_id=p_aown AND is_wildcard IS NOT TRUE;
    IF v_ap IS NOT NULL AND v_ap.home_goals=p_hg AND v_ap.away_goals=p_ag THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,p_aown,p_mid,'prediction',1,'Porra acertada'); END IF;
  END IF;
  FOR v_rec IN (SELECT ml.player_id,SUM(event_pts(pe.event_type)) AS pts FROM match_lineups ml JOIN player_events pe ON pe.squad_player_id=ml.squad_player_id AND pe.match_id=ml.match_id JOIN players p ON p.id=ml.player_id WHERE ml.match_id=p_mid AND p.league_id=p_lid AND ml.is_wildcard IS NOT TRUE GROUP BY ml.player_id) LOOP
    IF v_rec.pts<>0 THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,v_rec.player_id,p_mid,'player',v_rec.pts,'Jugadores destacados'); END IF;
  END LOOP;
  FOR v_wc IN (SELECT we.player_id,we.qualifier_pick,we.cost_charged FROM wildcard_entries we WHERE we.match_id=p_mid AND we.league_id=p_lid) LOOP
    IF NOT v_wc.cost_charged THEN PERFORM apply_wildcard_cost(p_lid,v_wc.player_id,p_mid); END IF;
    v_q:=COALESCE(p_cls,p_win);
    IF v_q IS NOT NULL AND v_wc.qualifier_pick=v_q THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,v_wc.player_id,p_mid,'wildcard_qualifier',2,'Wildcard: equipo correcto'); END IF;
    SELECT * INTO v_hp FROM predictions WHERE match_id=p_mid AND player_id=v_wc.player_id AND is_wildcard=true;
    IF v_hp IS NOT NULL AND v_hp.home_goals=p_hg AND v_hp.away_goals=p_ag THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,v_wc.player_id,p_mid,'wildcard_prediction',1,'Wildcard: porra acertada'); END IF;
    FOR v_rec IN (SELECT ml.player_id,SUM(event_pts(pe.event_type)) AS pts FROM match_lineups ml JOIN player_events pe ON pe.squad_player_id=ml.squad_player_id AND pe.match_id=ml.match_id WHERE ml.match_id=p_mid AND ml.player_id=v_wc.player_id AND ml.is_wildcard=true GROUP BY ml.player_id) LOOP
      IF v_rec.pts<>0 THEN INSERT INTO score_log(league_id,player_id,match_id,category,points,detail) VALUES(p_lid,v_wc.player_id,p_mid,'wildcard_player',v_rec.pts,'Wildcard: jugadores'); END IF;
    END LOOP;
  END LOOP;
END;
$$;
