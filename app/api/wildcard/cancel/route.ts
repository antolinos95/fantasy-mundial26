import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Cancelar entrada wildcard antes de que se bloquee la porra (T-2h).
// No hay penalización si cost_charged = false.
export async function POST(req: NextRequest) {
  const { leagueId, playerId, matchId } = await req.json()
  if (!leagueId || !playerId || !matchId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data: ok, error } = await supabaseAdmin.rpc('cancel_wildcard', {
    p_league_id: leagueId,
    p_player_id: playerId,
    p_match_id: matchId,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ok) return NextResponse.json({ error: 'No se puede cancelar: ya está bloqueado' }, { status: 409 })

  return NextResponse.json({ ok: true })
}
