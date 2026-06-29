import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { leagueId, playerId, points, detail } = await req.json()
  if (!leagueId || !playerId || typeof points !== 'number' || points >= 0 || !detail) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('score_log').insert({
    league_id: leagueId, player_id: playerId, match_id: null,
    category: 'bonus', points, detail,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recalc(leagueId, playerId)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { id, leagueId, playerId } = await req.json()
  if (!id || !leagueId || !playerId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('score_log').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recalc(leagueId, playerId)
  return NextResponse.json({ ok: true })
}

async function recalc(leagueId: string, playerId: string) {
  const { data: sl } = await supabaseAdmin
    .from('score_log').select('points')
    .eq('league_id', leagueId).eq('player_id', playerId)
  const total = (sl ?? []).reduce((s: number, r: any) => s + Number(r.points), 0)
  await supabaseAdmin.from('scores').upsert(
    { league_id: leagueId, player_id: playerId, points: total },
    { onConflict: 'league_id,player_id' }
  )
}
