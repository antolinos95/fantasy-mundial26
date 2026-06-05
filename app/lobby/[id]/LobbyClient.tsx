'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getPlayerId } from '../../../lib/supabase'
import type { League, Player } from '../../../types'

export default function LobbyClient({
  league,
  initialPlayers,
}: {
  league: League
  initialPlayers: Player[]
}) {
  const router = useRouter()
  const [players, setPlayers] = useState<Player[]>(initialPlayers)
  const [myId, setMyId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => { setMyId(getPlayerId()) }, [])

  const isAdmin = myId === league.admin_player_id

  // Realtime: escuchar nuevos jugadores
  useEffect(() => {
    const channel = supabase
      .channel(`lobby-${league.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'players',
        filter: `league_id=eq.${league.id}`,
      }, () => {
        supabase.from('players').select('*').eq('league_id', league.id)
          .order('created_at', { ascending: true })
          .then(({ data }) => { if (data) setPlayers(data) })
      })
      // Escuchar cambio de status de la liga para redirigir
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'leagues',
        filter: `id=eq.${league.id}`,
      }, (payload) => {
        const updated = payload.new as League
        if (updated.status === 'drafting') router.push(`/draft/${league.id}`)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [league.id, router])

  async function startDraft() {
    if (players.length < 2) { alert('Se necesitan al menos 2 jugadores'); return }
    setStarting(true)
    const { count: totalTeams } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true })

    const teamsPerPlayer = Math.floor(
      (totalTeams || 0) / players.length
)
    // Orden aleatorio
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    const orderRows = shuffled.map((p, i) => ({
      league_id: league.id, player_id: p.id, draft_position: i + 1,
    }))

    const { error: orderErr } = await supabase.from('draft_order').insert(orderRows)
    if (orderErr) { alert(orderErr.message); setStarting(false); return }

    const { error: stateErr } = await supabase
    .from('draft_state')
    .insert({
      league_id: league.id,
      current_pick: 1,
      round: 1,
      started: true,
      finished: false,
      direction: 1,
      teams_per_player: teamsPerPlayer,
    })
    if (stateErr) { alert(stateErr.message); setStarting(false); return }

    // Cambiar status de la liga → redirigirá via realtime a todos
    await supabase.from('leagues').update({ status: 'drafting' }).eq('id', league.id)
    router.push(`/draft/${league.id}`)
  }

  return (
    <main className="min-h-dvh flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-[var(--text-secondary)] text-sm uppercase tracking-widest mb-1">Sala de espera</p>
          <h1 className="text-3xl font-black">{league.name}</h1>
          <div className="mt-3 inline-flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] px-4 py-2 rounded-xl">
            <span className="text-[var(--text-secondary)] text-sm">Código</span>
            <span className="font-mono font-bold text-xl tracking-widest text-[var(--accent-glow)]">
              {league.code}
            </span>
          </div>
        </div>

        {/* Players */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Participantes
            </span>
            <span className="bg-[var(--bg-elevated)] text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
              {players.length}
            </span>
          </div>

          {players.length === 0 ? (
            <div className="px-4 py-8 text-center text-[var(--text-secondary)]">
              Nadie se ha unido todavía…
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {players.map((p, i) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-6 text-center text-[var(--text-secondary)] text-sm">{i + 1}</span>
                  <span className="font-medium flex-1">{p.name}</span>
                  {p.id === league.admin_player_id && (
                    <span className="text-xs bg-[var(--accent)]/20 text-[var(--accent-glow)] px-2 py-0.5 rounded-full font-semibold">
                      Admin
                    </span>
                  )}
                  {p.id === myId && (
                    <span className="text-xs text-[var(--text-secondary)]">Tú</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Waiting indicator */}
        <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm mb-6">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--green)]" />
          </span>
          Esperando jugadores — comparte el código para invitar
        </div>

        {/* Start button (only admin) */}
        {isAdmin && (
          <button
            onClick={startDraft}
            disabled={starting || players.length < 2}
            className="w-full py-4 bg-[var(--accent)] hover:bg-[var(--accent-glow)] text-white font-black text-lg rounded-2xl transition-colors disabled:opacity-40"
          >
            {starting ? 'Iniciando...' : '🏁 Iniciar Draft'}
          </button>
        )}
        {!isAdmin && (
          <p className="text-center text-[var(--text-secondary)] text-sm">
            Esperando a que el admin inicie el draft…
          </p>
        )}
      </div>
    </main>
  )
}
