import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { leagueId, title, body } = await req.json()

  if (!leagueId || !title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Guardar aviso en BD
  const { error } = await supabaseAdmin
    .from('announcements')
    .insert({ league_id: leagueId, title: title.trim(), body: body.trim() })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Push a todos los jugadores de la liga
  const { data: players } = await supabaseAdmin
    .from('players')
    .select('user_id')
    .eq('league_id', leagueId)
  const userIds = (players ?? []).map((p: any) => p.user_id).filter(Boolean) as string[]

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  await fetch(`${appUrl}/api/push/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-push-secret': process.env.PUSH_SECRET!,
    },
    body: JSON.stringify({ title: title.trim(), body: body.trim(), url: `/standings/${leagueId}`, userIds }),
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
