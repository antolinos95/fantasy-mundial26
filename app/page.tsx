'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, setPlayerId, setLeagueId } from '../lib/supabase'
import type { Player, League } from '../types'
import RulesModal from '../components/RulesModal'

type PlayerWithLeague = Player & { leagues: League }

export default function Home() {
  const router = useRouter()
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [userLeagues, setUserLeagues] = useState<PlayerWithLeague[]>([])
  const [loadingLeagues, setLoadingLeagues] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Create
  const [leagueName, setLeagueName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [creating, setCreating] = useState(false)

  // Join
  const [code, setCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [joining, setJoining] = useState(false)

  const [error, setError] = useState('')
  const [showRules, setShowRules] = useState(false)

  useEffect(() => {
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session)
      if (session) {
        // ⚠️ Deferir: llamar a supabase.from() dentro del callback de
        // onAuthStateChange provoca deadlock en supabase-js v2
        setTimeout(() => loadUserLeagues(session.user.id), 0)
      } else {
        setUserLeagues([]); setLoadingLeagues(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingLeagues(false); return }
    setIsLoggedIn(true)
    await loadUserLeagues(user.id)
  }

  async function loadUserLeagues(userId: string) {
    const { data, error } = await supabase
      .from('players')
      .select('*, leagues:leagues!players_league_id_fkey(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) console.error('loadUserLeagues:', error.message)
    // Filtrar filas huérfanas (sin liga asociada)
    const valid = (data as PlayerWithLeague[] ?? []).filter(e => e.leagues)
    setUserLeagues(valid)
    setLoadingLeagues(false)
  }

  function goToLeague(entry: PlayerWithLeague) {
    setPlayerId(entry.id)
    setLeagueId(entry.league_id)
    const league = entry.leagues
    if (!league) return
    if (league.status === 'waiting') router.push(`/lobby/${league.id}`)
    else if (league.status === 'drafting') router.push(`/draft/${league.id}`)
    else router.push(`/standings/${league.id}`)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setIsLoggedIn(false)
    setUserLeagues([])
  }

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo:
          process.env.NODE_ENV === 'development'
            ? 'http://localhost:3000'
            : 'https://fantasy-mundial26.vercel.app',
      },
    })
  }

  async function handleCreate() {
    if (!leagueName.trim() || !adminName.trim()) { setError('Rellena todos los campos'); return }
    setCreating(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Inicia sesión con Google primero'); setCreating(false); return }

    const leagueCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .insert({ name: leagueName.trim(), code: leagueCode, admin_user_id: user.id })
      .select()
      .single()

    if (leagueErr || !league) { setError(leagueErr?.message ?? 'Error al crear liga'); setCreating(false); return }

    const { data: player, error: playerErr } = await supabase
      .from('players')
      .insert({ league_id: league.id, name: adminName.trim(), user_id: user.id })
      .select()
      .single()

    if (playerErr || !player) { setError(playerErr?.message ?? 'Error al crear jugador'); setCreating(false); return }

    await supabase.from('leagues').update({ admin_player_id: player.id, admin_user_id: user.id }).eq('id', league.id)

    setPlayerId(player.id)
    setLeagueId(league.id)
    router.push(`/lobby/${league.id}`)
  }

  async function handleJoin() {
    if (!code.trim() || !playerName.trim()) { setError('Rellena todos los campos'); return }
    setJoining(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Inicia sesión con Google primero'); setJoining(false); return }

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .select('*')
      .eq('code', code.trim().toUpperCase())
      .single()

    if (leagueErr || !league) { setError('Liga no encontrada'); setJoining(false); return }

    // Check if already joined
    const { data: existing } = await supabase
      .from('players')
      .select('id')
      .eq('league_id', league.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      setPlayerId(existing.id)
      setLeagueId(league.id)
      if (league.status === 'waiting') router.push(`/lobby/${league.id}`)
      else if (league.status === 'drafting') router.push(`/draft/${league.id}`)
      else router.push(`/standings/${league.id}`)
      return
    }

    const { data: player, error: playerErr } = await supabase
      .from('players')
      .insert({ league_id: league.id, name: playerName.trim(), user_id: user.id })
      .select()
      .single()

    if (playerErr || !player) { setError(playerErr?.message ?? 'Error al unirse'); setJoining(false); return }

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
          IT&apos;S FÚTBOL,<br className="sm:hidden" /> NOT SOCCER
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">Fantasy Mundial 2026</p>
        <button onClick={() => setShowRules(true)}
          className="mt-4 inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-xl px-4 py-2 text-sm font-semibold transition-colors">
          📖 Ver normas
        </button>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* Card */}
      <div className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6">

        {/* Google login */}
        {!isLoggedIn && (
          <button
            onClick={loginWithGoogle}
            className="w-full mb-6 py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuar con Google
          </button>
        )}

        {/* Cargando ligas */}
        {isLoggedIn && loadingLeagues && (
          <div className="mb-6 p-4 rounded-xl border border-[var(--border)] text-center">
            <p className="text-sm text-[var(--text-secondary)]">Cargando tus ligas…</p>
          </div>
        )}

        {/* Mis ligas (usuario logado) */}
        {isLoggedIn && !loadingLeagues && userLeagues.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Mis ligas ({userLeagues.length})
              </p>
              <button onClick={signOut} className="text-xs text-[var(--text-secondary)] hover:text-white transition-colors">
                Cerrar sesión
              </button>
            </div>
            <div className="space-y-2">
              {userLeagues.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => goToLeague(entry)}
                  className="w-full flex items-center gap-3 text-left p-3 rounded-xl bg-[var(--bg-elevated)] hover:border-[var(--accent)] border border-[var(--border)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{entry.leagues?.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                        entry.leagues?.status === 'active' ? 'bg-[var(--green)]/20 text-[var(--green)]' :
                        entry.leagues?.status === 'drafting' ? 'bg-[var(--accent)]/20 text-[var(--accent-glow)]' :
                        'bg-[var(--border)] text-[var(--text-secondary)]'
                      }`}>
                        {entry.leagues?.status === 'active' ? 'En juego' :
                         entry.leagues?.status === 'drafting' ? 'Draft' : 'Espera'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      <span className="font-mono tracking-wider">{entry.leagues?.code}</span>
                      {' · '}Juegas como {entry.name}
                    </p>
                  </div>
                  <span className="text-[var(--text-secondary)] text-lg shrink-0">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isLoggedIn && !loadingLeagues && userLeagues.length === 0 && (
          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">
              ✅ Sesión iniciada — crea o únete a una liga
            </p>
            <button onClick={signOut} className="text-xs text-[var(--text-secondary)] hover:text-white transition-colors shrink-0 ml-2">
              Cerrar sesión
            </button>
          </div>
        )}

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
