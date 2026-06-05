import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── helpers de identidad (sin auth) ───────────────────────
export function getPlayerId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('playerId')
}

export function setPlayerId(id: string) {
  localStorage.setItem('playerId', id)
}

export function getLeagueId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('leagueId')
}

export function setLeagueId(id: string) {
  localStorage.setItem('leagueId', id)
}
