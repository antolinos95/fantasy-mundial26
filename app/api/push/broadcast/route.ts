import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Envía un anuncio a TODAS las ligas y push a todos los suscriptores.
// Solo accesible con PUSH_SECRET.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, body } = await req.json()
  if (!title || !body) return NextResponse.json({ error: 'Missing title or body' }, { status: 400 })

  // Insertar en todas las ligas
  const { data: leagues } = await supabaseAdmin.from('leagues').select('id')
  if (leagues?.length) {
    await supabaseAdmin.from('announcements').insert(
      leagues.map(l => ({ league_id: l.id, title, body }))
    )
  }

  // Push a todos los suscriptores (sin filtro de userIds)
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const pushRes = await fetch(`${APP_URL}/api/push/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-push-secret': process.env.PUSH_SECRET! },
    body: JSON.stringify({ title, body, url: '/standings' }),
  })
  const pushData = await pushRes.json()

  return NextResponse.json({ leagues: leagues?.length ?? 0, push: pushData })
}
