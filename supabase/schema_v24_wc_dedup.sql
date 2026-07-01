-- schema_v24: prevenir entradas duplicadas de wildcard
-- Un único wildcard_entry por (league_id, player_id, match_id) en score_log

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_log_unique_wc_entry
ON score_log(league_id, player_id, match_id)
WHERE category = 'wildcard_entry';
