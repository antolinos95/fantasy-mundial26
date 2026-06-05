export type LeagueStatus = 'waiting' | 'drafting' | 'active' | 'finished'
export type MatchStatus  = 'scheduled' | 'finished'

export interface League {
  id: string
  name: string
  code: string
  status: LeagueStatus
  admin_player_id: string | null
  created_at: string
}

export interface Player {
  id: string
  league_id: string
  name: string
  created_at: string
}

export interface Team {
  id: string
  name: string
  flag_emoji: string | null
  group_name: string | null
}

export interface DraftedTeam {
  id: string
  league_id: string
  team_id: string
  player_id: string
  pick_number: number
  created_at: string
  team?: Team
  player?: Player
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
  direction: number   // 1 = forward, -1 = reverse
  total_rounds: number | null
  updated_at: string
}

export interface Match {
  id: string
  league_id: string
  home_team_id: string
  away_team_id: string
  match_date: string | null
  home_goals: number | null
  away_goals: number | null
  status: MatchStatus
  created_at: string
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
  player?: Player
}

export interface Score {
  id: string
  league_id: string
  player_id: string
  points: number
  updated_at: string
  player?: Player
}
