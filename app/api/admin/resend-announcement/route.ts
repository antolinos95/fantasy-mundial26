import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { leagueId } = await req.json()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const { data: announcement } = await supabaseAdmin
    .from('announcements')
    .select('title, body')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!announcement) return NextResponse.json({ error: 'No announcements found' }, { status: 404 })

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
    body: JSON.stringify({ title: announcement.title, body: announcement.body, url: `/standings/${leagueId}`, userIds }),
  })

  return NextResponse.json({ ok: true, sent: userIds.length, title: announcement.title })
}
