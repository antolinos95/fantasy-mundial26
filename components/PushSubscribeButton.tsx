'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type State = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

export default function PushSubscribeButton() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') { setState('denied'); return }

    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) =>
        setState(sub ? 'subscribed' : 'unsubscribed')
      )
    )
  }, [])

  async function subscribe() {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { alert('Inicia sesión primero'); return }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setState('denied'); return }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), userId: user.id }),
      })

      setState('subscribed')
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, userId: user?.id }),
        })
        await sub.unsubscribe()
      }
      setState('unsubscribed')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading' || state === 'unsupported') return null

  if (state === 'denied') {
    return (
      <p className="text-xs text-center text-[var(--text-muted)] mt-2">
        🔕 Notificaciones bloqueadas en tu navegador
      </p>
    )
  }

  if (state === 'subscribed') {
    return (
      <button
        onClick={unsubscribe}
        disabled={busy}
        className="w-full mt-2 py-2 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] transition disabled:opacity-50"
      >
        {busy ? 'Desactivando…' : '🔔 Notificaciones activas — desactivar'}
      </button>
    )
  }

  return (
    <button
      onClick={subscribe}
      disabled={busy}
      className="w-full mt-2 py-2 rounded-xl border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg-surface)] transition disabled:opacity-50"
    >
      {busy ? 'Activando…' : '🔔 Activar notificaciones'}
    </button>
  )
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
