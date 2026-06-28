import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Cobrar el coste wildcard al cierre de la porra (T-2h antes del partido).
// Llamado por el cliente cuando detecta que una entrada sin coste está bloqueada.
export async function POST(req: NextRequest) {
  const { leagueId, playerId, matchId } = await req.json()
  if (!leagueId || !playerId || !matchId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.rpc('apply_wildcard_cost', {
    p_league_id: leagueId,
    p_player_id: playerId,
    p_match_id: matchId,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, cost: data })
}
