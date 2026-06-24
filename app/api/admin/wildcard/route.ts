import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { leagueId, enabled } = await req.json()

  if (!leagueId || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Leer estado actual para detectar si es la primera activación
  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('wildcard_enabled')
    .eq('id', leagueId)
    .single()

  const firstActivation = enabled && !league?.wildcard_enabled

  const { error } = await supabaseAdmin
    .from('leagues')
    .update({ wildcard_enabled: enabled })
    .eq('id', leagueId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (firstActivation) {
    const title = '⚡ Modo Wildcard activado'
    const body =
      '¡El admin ha activado el Modo Wildcard! Si no tienes equipo en una eliminatoria puedes entrar pagando 2 puntos: elige resultado y 3 jugadores destacados. Entra en el partido para participar.'

    await supabaseAdmin
      .from('announcements')
      .insert({ league_id: leagueId, title, body })

    // Push a todos los suscriptores de la liga
    const { data: players } = await supabaseAdmin
      .from('players')
      .select('user_id')
      .eq('league_id', leagueId)
    const userIds = (players ?? []).map((p: any) => p.user_id).filter(Boolean) as string[]

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    await fetch(`${appUrl}/api/push/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-push-secret': process.env.PUSH_SECRET!,
      },
      body: JSON.stringify({
        title,
        body,
        url: `/standings/${leagueId}`,
        userIds,
      }),
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, firstActivation })
}
