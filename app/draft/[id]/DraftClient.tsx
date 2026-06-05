'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getPlayerId } from '../../../lib/supabase'
import type { League, Player, Team, DraftOrder, DraftState, DraftedTeam } from '../../../types'

export default function DraftClient({
  league,
  players,
  allTeams,
  draftOrder,
  initialDraftState,
  initialDraftedTeams,
}: {
  league: League
  players: Player[]
  allTeams: Team[]
  draftOrder: DraftOrder[]
  initialDraftState: DraftState | null
  initialDraftedTeams: DraftedTeam[]
}) {
  const router = useRouter()
  const [draftState, setDraftState] = useState<DraftState | null>(initialDraftState)
  const [draftedTeams, setDraftedTeams] = useState<DraftedTeam[]>(initialDraftedTeams)
  const [myId, setMyId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { setMyId(getPlayerId()) }, [])

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel(`draft-room-${league.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'draft_state',
        filter: `league_id=eq.${league.id}`,
      }, (payload) => {
        setDraftState(payload.new as DraftState)
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'drafted_teams',
        filter: `league_id=eq.${league.id}`,
      }, async () => {
        const { data } = await supabase
          .from('drafted_teams')
          .select('*, team:teams(*), player:players(*)')
          .eq('league_id', league.id)
          .order('pick_number')
        if (data) setDraftedTeams(data)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'leagues',
        filter: `id=eq.${league.id}`,
      }, (payload) => {
        const updated = payload.new as League
        if (updated.status === 'active') router.push(`/standings/${league.id}`)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [league.id, router])

  // ── Lógica del draft en serpiente ──
  const n = draftOrder.length
  const pickedTeamIds = new Set(draftedTeams.map(d => d.team_id))
  const availableTeams = allTeams.filter(t => !pickedTeamIds.has(t.id))
  const filteredTeams = availableTeams.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  function getPlayerAtPick(pick: number): Player | null {
    if (!draftState || n === 0) return null
    const zp = pick - 1
    const round = Math.floor(zp / n)
    const posInRound = zp % n
    const idx = round % 2 === 0 ? posInRound : n - 1 - posInRound
    const ordered = draftOrder[idx]
    return players.find(p => p.id === ordered?.player_id) ?? null
  }

  const currentPlayer = draftState ? getPlayerAtPick(draftState.current_pick) : null
  const isMyTurn = !!myId && currentPlayer?.id === myId
  const isFinished = draftState?.finished || availableTeams.length < players.length

  async function pickTeam(teamId: string) {
    if (!isMyTurn || picking || !draftState) return
    setPicking(true)

    const { error } = await supabase.from('drafted_teams').insert({
      league_id: league.id,
      team_id: teamId,
      player_id: myId,
      pick_number: draftState.current_pick,
    })
    if (error) { alert(error.message); setPicking(false); return }

    const nextPick = draftState.current_pick + 1
    const zp = nextPick - 1
    const nextRound = Math.floor(zp / n) + 1

    // Comprobar si el draft termina
    const remainingAfter = availableTeams.length - 1
    if (remainingAfter < players.length) {
      await supabase.from('draft_state')
        .update({ current_pick: nextPick, round: nextRound, finished: true })
        .eq('league_id', league.id)
      await supabase.from('leagues').update({ status: 'active' }).eq('id', league.id)
    } else {
      await supabase.from('draft_state')
        .update({ current_pick: nextPick, round: nextRound })
        .eq('league_id', league.id)
    }

    setPicking(false)
  }

  return (
    <main className="min-h-dvh flex flex-col px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.name}</p>
        <h1 className="text-2xl font-black mt-0.5">Draft en Serpiente 🐍</h1>
      </div>

      {/* Estado del turno */}
      <div className={`rounded-2xl p-4 mb-6 border ${
        isFinished
          ? 'bg-[var(--green)]/10 border-[var(--green)]/30'
          : isMyTurn
            ? 'bg-[var(--accent)]/10 border-[var(--accent)]/40 animate-pulse'
            : 'bg-[var(--bg-surface)] border-[var(--border)]'
      }`}>
        {isFinished ? (
          <p className="font-bold text-[var(--green)] text-center">✅ Draft finalizado</p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Pick #{draftState?.current_pick} · Ronda {draftState?.round}</p>
              <p className="font-bold text-lg mt-0.5">
                {isMyTurn ? '¡Tu turno! Elige una selección' : `Elige: ${currentPlayer?.name ?? '...'}`}
              </p>
            </div>
            {isMyTurn && <span className="text-2xl">👆</span>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Columna izquierda: picks disponibles */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Disponibles ({availableTeams.length})
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar selección…"
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)] mb-2"
          />
          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {filteredTeams.map(team => (
              <button
                key={team.id}
                onClick={() => pickTeam(team.id)}
                disabled={!isMyTurn || picking || isFinished}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all
                  ${isMyTurn && !picking && !isFinished
                    ? 'border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 cursor-pointer'
                    : 'border-[var(--border)] opacity-50 cursor-not-allowed'
                  }`}
              >
                <span className="text-xl">{team.flag_emoji}</span>
                <span className="font-medium text-sm">{team.name}</span>
                <span className="ml-auto text-xs text-[var(--text-secondary)]">{team.group_name}</span>
              </button>
            ))}
            {filteredTeams.length === 0 && (
              <p className="text-center text-[var(--text-secondary)] text-sm py-4">No hay resultados</p>
            )}
          </div>
        </div>

        {/* Columna derecha: historial */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
            Historial ({draftedTeams.length})
          </p>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {[...draftedTeams].reverse().map(dt => (
              <div key={dt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
                <span className="text-lg">{dt.team?.flag_emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{dt.team?.name}</p>
                  <p className="text-xs text-[var(--text-secondary)] truncate">{dt.player?.name}</p>
                </div>
                <span className="text-xs text-[var(--text-secondary)] shrink-0">#{dt.pick_number}</span>
              </div>
            ))}
            {draftedTeams.length === 0 && (
              <p className="text-center text-[var(--text-secondary)] text-sm py-4">Ningún pick todavía</p>
            )}
          </div>
        </div>
      </div>

      {/* Orden del draft */}
      <div className="mt-6">
        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Orden de picks</p>
        <div className="flex flex-wrap gap-2">
          {draftOrder.map((o, i) => {
            const isCurrent = currentPlayer?.id === o.player_id
            return (
              <span
                key={o.id}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium border ${
                  isCurrent
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)]'
                }`}
              >
                {i + 1}. {o.player?.name}
              </span>
            )
          })}
        </div>
      </div>

      {isFinished && (
        <button
          onClick={() => router.push(`/standings/${league.id}`)}
          className="mt-8 w-full py-3 bg-[var(--green)] text-black font-black rounded-2xl"
        >
          Ver clasificación →
        </button>
      )}
    </main>
  )
}
