'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, setPlayerId, setLeagueId } from '../lib/supabase'

export default function Home() {
  const router = useRouter()
  const [tab, setTab] = useState<'create' | 'join'>('create')

  // Create
  const [leagueName, setLeagueName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [creating, setCreating] = useState(false)

  // Join
  const [code, setCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [joining, setJoining] = useState(false)

  const [error, setError] = useState('')

  async function handleCreate() {
    if (!leagueName.trim() || !adminName.trim()) {
      setError('Rellena todos los campos')
      return
    }
    setCreating(true)
    setError('')
    const leagueCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .insert({ name: leagueName.trim(), code: leagueCode })
      .select()
      .single()

    if (leagueErr || !league) { setError(leagueErr?.message ?? 'Error'); setCreating(false); return }

    const { data: player, error: playerErr } = await supabase
      .from('players')
      .insert({ league_id: league.id, name: adminName.trim() })
      .select()
      .single()

    if (playerErr || !player) { setError(playerErr?.message ?? 'Error'); setCreating(false); return }

    // Marcar como admin
    await supabase.from('leagues').update({ admin_player_id: player.id }).eq('id', league.id)

    setPlayerId(player.id)
    setLeagueId(league.id)
    router.push(`/lobby/${league.id}`)
  }

  async function handleJoin() {
    if (!code.trim() || !playerName.trim()) { setError('Rellena todos los campos'); return }
    setJoining(true)
    setError('')

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .single()

    if (leagueErr || !league) { setError('Liga no encontrada'); setJoining(false); return }

    const { data: player, error: playerErr } = await supabase
      .from('players')
      .insert({ league_id: league.id, name: playerName.trim() })
      .select()
      .single()

    if (playerErr || !player) { setError(playerErr?.message ?? 'Error'); setJoining(false); return }

    setPlayerId(player.id)
    setLeagueId(league.id)
    router.push(`/lobby/${league.id}`)
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="text-5xl mb-3">⚽</div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
          IT'S FÚTBOL,<br className="sm:hidden" /> NOT SOCCER
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">Fantasy Mundial 2026</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6">
        {/* Tabs */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--border)] mb-6">
          {(['create', 'join'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                tab === t
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-white'
              }`}
            >
              {t === 'create' ? '+ Crear liga' : '→ Unirse'}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <div className="space-y-4">
            <Field label="Nombre de la liga">
              <Input value={leagueName} onChange={setLeagueName} placeholder="Mis Amigotes FC" />
            </Field>
            <Field label="Tu nombre">
              <Input value={adminName} onChange={setAdminName} placeholder="Cómo te llamas" />
            </Field>
            {error && <p className="text-[var(--red)] text-sm">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-glow)] text-white font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              {creating ? 'Creando...' : 'Crear liga'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Código de liga">
              <Input
                value={code}
                onChange={v => setCode(v.toUpperCase())}
                placeholder="ABC123"
                className="uppercase tracking-widest"
              />
            </Field>
            <Field label="Tu nombre">
              <Input value={playerName} onChange={setPlayerName} placeholder="Cómo te llamas" />
            </Field>
            {error && <p className="text-[var(--red)] text-sm">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={joining}
              className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-glow)] text-white font-bold rounded-xl transition-colors disabled:opacity-50"
            >
              {joining ? 'Uniéndome...' : 'Unirse a la liga'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function Input({
  value, onChange, placeholder, className = ''
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] transition-colors ${className}`}
    />
  )
}
