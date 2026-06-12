import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Proxy autenticado: solo el admin de la liga puede llamar a este endpoint.
// El secret de push nunca sale al cliente.
export async function POST(req: NextRequest) {
  const { title, body, url, userIds, leagueId } = await req.json()

  if (!title || !body || !leagueId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Verificar que el caller es admin de la liga usando el token de sesión
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authErr } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  ).auth.getUser()

  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: league } = await supabaseAdmin
    .from('leagues')
    .select('admin_user_id')
    .eq('id', leagueId)
    .single()

  if (league?.admin_user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/push/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-push-secret': process.env.PUSH_SECRET! },
    body: JSON.stringify({ title, body, url: url ?? '/standings', userIds }),
  })

  const data = await res.json()
  return NextResponse.json(data)
}
