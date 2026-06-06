import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:fantasyworld2026@example.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
  // if provided, only notify these user_ids; otherwise notify all
  userIds?: string[]
}

export async function POST(req: NextRequest) {
  // Simple secret check so this endpoint isn't open to the world
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload: PushPayload = await req.json()

  let query = supabaseAdmin.from('push_subscriptions').select('*')
  if (payload.userIds?.length) {
    query = query.in('user_id', payload.userIds)
  }

  const { data: subs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    icon: payload.icon ?? '/icon.svg',
  })

  const results = await Promise.allSettled(
    (subs ?? []).map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        message
      ).catch(async (err) => {
        // 410 Gone / 404 → subscription expired, remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint)
        }
        throw err
      })
    )
  )

  const sent = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length
  return NextResponse.json({ sent, failed })
}
