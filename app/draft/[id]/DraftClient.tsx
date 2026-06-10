'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, setPlayerId, DEFAULT_PLAYER_IMG } from '../../../lib/supabase'
import type { League, Player, Team, DraftOrder, DraftState, DraftedTeam, SquadPlayer } from '../../../types'
import DraftQueueEditor from '../../../components/DraftQueueEditor'

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
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [forcingPick, setForcingPick] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const musicStopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    async function resolveMyId() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: player } = await supabase
        .from('players').select('id')
        .eq('league_id', league.id).eq('user_id', user.id)
        .maybeSingle()
      setMyUserId(user.id)
      if (player) { setPlayerId(player.id); setMyId(player.id) }
    }
    resolveMyId()
  }, [league.id])

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
      }, (payload) => {
        const updated = payload.new as League
        if (updated.id === league.id && updated.status === 'active')
          router.push(`/standings/${league.id}`)
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
const isFinished = draftState?.finished ?? false
  const isAdmin =
    (!!myId && myId === league.admin_player_id) ||
    (!!myUserId && myUserId === league.admin_user_id)

  // ── Temporizador / autopick ──
  const timerSecs = league.draft_timer_seconds ?? 0
  const [nowTs, setNowTs] = useState(() => Date.now())
  const lastAutopickRef = useRef<number>(-1)

  useEffect(() => {
    if (!timerSecs || isFinished) return
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timerSecs, isFinished])

  const turnStart  = draftState?.turn_started_at ? new Date(draftState.turn_started_at).getTime() : null
  const deadline   = turnStart && timerSecs ? turnStart + timerSecs * 1000 : null
  const remainingMs = deadline ? deadline - nowTs : null

  useEffect(() => {
    if (!timerSecs || isFinished || !draftState || remainingMs === null) return
    if (remainingMs <= 0 && lastAutopickRef.current !== draftState.current_pick) {
      lastAutopickRef.current = draftState.current_pick
      supabase.rpc('autopick_if_expired', { p_league_id: league.id })
    }
  }, [remainingMs, timerSecs, isFinished, draftState, league.id])

  function fmtRemaining(ms: number) {
    if (ms <= 0) return '0s'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  function playDraftTune() {
    if (typeof window === 'undefined') return
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      // Melodía tipo "es tu turno" — notas en Hz
      const notes = [523, 659, 784, 1047, 784, 659, 523, 0, 659, 784, 880, 784, 659, 523, 0, 0]
      const BPM = 140
      const beat = 60 / BPM
      let stopped = false

      const playLoop = () => {
        if (stopped || ctx.state === 'closed') return
        let t = ctx.currentTime
        notes.forEach((freq) => {
          if (freq > 0) {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.connect(gain); gain.connect(ctx.destination)
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0, t)
            gain.gain.linearRampToValueAtTime(0.12, t + 0.01)
            gain.gain.linearRampToValueAtTime(0, t + beat * 0.8)
            osc.start(t); osc.stop(t + beat)
          }
          t += beat
        })
        const loopDuration = notes.length * beat * 1000
        const tid = setTimeout(() => { if (!stopped) playLoop() }, loopDuration)
        musicStopRef.current = () => { stopped = true; clearTimeout(tid); ctx.close() }
      }
      playLoop()
    } catch { /* autoplay bloqueado o no soportado */ }
  }

  function stopDraftTune() {
    musicStopRef.current?.()
    musicStopRef.current = null
  }

  useEffect(() => {
    if (isMyTurn && !isFinished) {
      playDraftTune()
    } else {
      stopDraftTune()
    }
    return () => stopDraftTune()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, isFinished])

  async function forceAutopick() {
    if (!isAdmin || forcingPick || isFinished) return
    setForcingPick(true)
    await supabase.rpc('force_autopick', { p_league_id: league.id })
    setForcingPick(false)
  }

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

    const limit = draftState.teams_per_player || 0

const picksAfter = draftedTeams.length + 1

const totalNeeded =
  players.length * limit

const draftCompleted =
  picksAfter >= totalNeeded
    const nextPick = draftState.current_pick + 1
    const zp = nextPick - 1
    const nextRound = Math.floor(zp / n) + 1

    const now = new Date().toISOString()
    // Comprobar si el draft termina
    if (draftCompleted) {
  await supabase
    .from('draft_state')
    .update({
      current_pick: nextPick,
      round: nextRound,
      finished: true,
      turn_started_at: now,
    })
    .eq('league_id', league.id)

  await supabase
    .from('leagues')
    .update({
      status: 'active',
    })
    .eq('id', league.id)
} else {
      await supabase.from('draft_state')
        .update({ current_pick: nextPick, round: nextRound, turn_started_at: now })
        .eq('league_id', league.id)
    }

    setPicking(false)
  }

  return (
    <main className="min-h-dvh flex flex-col px-4 py-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.name}</p>
        <h1 className="text-2xl font-black mt-0.5">Draft del Mundial</h1>
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Pick #{draftState?.current_pick} · Ronda {draftState?.round}</p>
              <p className="font-bold text-lg mt-0.5 truncate">
                {isMyTurn ? '¡Tu turno! Elige una selección' : `Elige: ${currentPlayer?.name ?? '...'}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {remainingMs !== null
                ? <span className={`font-black tabular-nums text-lg ${remainingMs < 30000 ? 'text-[var(--red)]' : 'text-[var(--text-secondary)]'}`}>
                    ⏱ {fmtRemaining(remainingMs)}
                  </span>
                : isMyTurn && <span className="text-2xl">👆</span>}
              {isAdmin && (
                <button
                  onClick={forceAutopick}
                  disabled={forcingPick || isMyTurn}
                  title={isMyTurn ? 'Es tu turno, elige tú' : 'Forzar autopick (admin)'}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] hover:bg-[var(--red)]/30 disabled:opacity-40 transition-colors"
                >
                  {forcingPick ? '…' : '⏭ Skip'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Editar mi cola durante el draft */}
      {myId && !isFinished && (
        <DraftQueueEditor
          leagueId={league.id} playerId={myId}
          takenTeamIds={[...pickedTeamIds]}
          onPick={isMyTurn && !picking ? (team) => setSelectedTeam(team) : undefined}
        />
      )}

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
                onClick={() => setSelectedTeam(team)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 text-left transition-all cursor-pointer"
              >
                <span className="text-xl">{team.flag_emoji}</span>
                <span className="font-medium text-sm">{team.name}</span>
                <span className="ml-auto text-xs text-[var(--text-secondary)]">Grupo {team.group_name}</span>
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

      {selectedTeam && (
        <TeamPanel
          team={selectedTeam}
          leagueId={league.id}
          canPick={isMyTurn && !picking && !isFinished}
          onPick={() => { pickTeam(selectedTeam.id); setSelectedTeam(null) }}
          onClose={() => setSelectedTeam(null)}
        />
      )}
    </main>
  )
}

// ─── Panel de equipo ─────────────────────────────────────────

const POS_LABEL: Record<string, string> = { GK: 'Porteros', DF: 'Defensas', MF: 'Centrocampistas', FW: 'Delanteros' }

function PlayerAvatar({ player }: { player: SquadPlayer }) {
  return (
    <img
      src={player.photo_url ?? DEFAULT_PLAYER_IMG}
      alt={player.name}
      className="w-10 h-10 rounded-full object-cover bg-[var(--bg-elevated)]"
      onError={e => { (e.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }}
    />
  )
}

function TeamPanel({ team, leagueId, canPick, onPick, onClose }: {
  team: Team
  leagueId: string
  canPick: boolean
  onPick: () => void
  onClose: () => void
}) {
  const [squad, setSquad]   = useState<SquadPlayer[]>([])
  const [stats, setStats]   = useState<Record<string, { goals: number; own_goals: number; red_cards: number }>>({})
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setDbError(null)
    Promise.all([
      supabase.from('squad_players').select('*')
        .eq('team_id', team.id).order('position').order('shirt_number'),
      supabase.from('player_stats_global').select('squad_player_id,goals,own_goals,red_cards')
        .eq('team_id', team.id),
    ]).then(([squadRes, statsRes]) => {
      if (squadRes.error) setDbError(squadRes.error.message)
      setSquad(squadRes.data ?? [])
      const map: Record<string, { goals: number; own_goals: number; red_cards: number }> = {}
      for (const s of (statsRes.data ?? [])) map[s.squad_player_id] = s
      setStats(map)
      setLoading(false)
    })
  }, [team.id, leagueId])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border)]">
          <span className="text-4xl">{team.flag_emoji}</span>
          <div className="flex-1">
            <p className="font-black text-lg">{team.name}</p>
            <p className="text-xs text-[var(--text-secondary)]">Grupo {team.group_name}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        {/* Squad */}
        <div className="overflow-y-auto flex-1 px-3 py-3">
          {loading && <p className="text-center text-[var(--text-secondary)] py-6 text-sm">Cargando plantilla…</p>}
          {!loading && dbError && <p className="text-center text-[var(--red)] py-4 text-xs px-2">{dbError}</p>}
          {!loading && !dbError && squad.length === 0 && (
            <p className="text-center text-[var(--text-secondary)] py-6 text-sm">
              Sin jugadores — ejecuta el seed de plantillas
            </p>
          )}
          {!loading && (['GK','DF','MF','FW'] as const).map(pos => {
            const group = squad.filter(p => p.position === pos)
            if (!group.length) return null
            return (
              <div key={pos} className="mb-4">
                <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{POS_LABEL[pos]}</p>
                <div className="space-y-1.5">
                  {group.map(player => {
                    const st = stats[player.id]
                    return (
                      <div key={player.id} className="flex items-center gap-3 px-2 py-1.5 rounded-xl bg-[var(--bg-elevated)]">
                        <div className="relative shrink-0">
                          <PlayerAvatar player={player} />
                          {st?.red_cards > 0 && (
                            <span className="absolute -top-1 -right-1 text-[9px] bg-[var(--red)] rounded-full w-4 h-4 flex items-center justify-center">🟥</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{player.name}</p>
                          <div className="flex gap-1.5 mt-0.5 flex-wrap">
                            {st?.goals > 0 && <span className="text-[10px] text-[var(--text-secondary)]">⚽ {st.goals}</span>}
                            {st?.own_goals > 0 && <span className="text-[10px] text-[var(--text-secondary)]">🥅 {st.own_goals}</span>}
                          </div>
                        </div>
                        {player.shirt_number && (
                          <span className="text-sm font-black text-[var(--text-secondary)] w-6 text-right shrink-0">
                            {player.shirt_number}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Pick button */}
        <div className="p-4 border-t border-[var(--border)]">
          {canPick
            ? <button onClick={onPick} className="w-full py-3 bg-[var(--accent)] hover:bg-[var(--accent-glow)] text-white font-black rounded-xl transition-colors">
                ✓ Elegir {team.name}
              </button>
            : <p className="text-center text-sm text-[var(--text-secondary)]">
                {team.name} · Grupo {team.group_name}
              </p>
          }
        </div>
      </div>
    </div>
  )
}
