export interface League {
  id: string
  name: string
  code: string
  status: 'waiting' | 'drafting' | 'active'
  admin_player_id: string | null
  admin_user_id: string | null
  created_at: string
}

export interface Player {
  id: string
  league_id: string
  name: string
  user_id: string | null
  created_at: string
}

export interface Team {
  id: string
  name: string
  flag_emoji: string
  group_name: string | null
}

export interface DraftOrder {
  id: string
  league_id: string
  player_id: string
  draft_position: number
  player?: Player
}

export interface DraftState {
  id: string
  league_id: string
  current_pick: number
  round: number
  started: boolean
  finished: boolean
  direction: number
  teams_per_player: number
}

export interface DraftedTeam {
  id: string
  league_id: string
  team_id: string
  player_id: string
  pick_number: number
  team?: Team
  player?: Player
}

export interface Match {
  id: string
  league_id: string
  home_team_id: string
  away_team_id: string
  match_date: string | null
  status: 'scheduled' | 'finished'
  match_type: 'group' | 'r16' | 'qf' | 'sf' | 'third_place' | 'final'
  home_goals: number | null
  away_goals: number | null
  home_team?: Team
  away_team?: Team
}

export interface Prediction {
  id: string
  match_id: string
  player_id: string
  home_goals: number
  away_goals: number
  created_at: string
}

export interface Score {
  id: string
  league_id: string
  player_id: string
  points: number
  updated_at: string
  player?: Player
}

export interface SquadPlayer {
  id: string
  team_id: string
  name: string
  position: 'GK' | 'DF' | 'MF' | 'FW'
  shirt_number: number | null
  api_id: number | null
  photo_url: string | null
}

export interface MatchLineup {
  id: string
  match_id: string
  player_id: string
  team_id: string
  squad_player_id: string
  squad_player?: SquadPlayer
}

export interface PlayerEvent {
  id: string
  match_id: string
  squad_player_id: string
  event_type: 'goal' | 'goal_extra_time' | 'penalty_shootout' | 'red_card' | 'own_goal'
  minute: number | null
  squad_player?: SquadPlayer
}
