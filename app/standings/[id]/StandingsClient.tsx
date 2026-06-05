'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import type {
  League, Player, Score, DraftedTeam, Match, Prediction,
  SquadPlayer, MatchLineup, PlayerEvent,
} from '../../../types'

type Tab = 'standings' | 'my-teams' | 'matches' | 'mundial' | 'admin'

const STAGE_LABELS: Record<string, string> = { r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', final: 'Final' }
const STAGE_PTS:   Record<string, number>  = { r16: 1, qf: 3, sf: 5, final: 8 }

const EVENT_LABELS: Record<string, string> = {
  goal: '⚽ Gol (reglamentario)',
  goal_extra_time: '⚽ Gol (prórroga)',
  penalty_shootout: '⚽ Penalti (tanda)',
  red_card: '🟥 Expulsión',
  own_goal: '🥅 Autogol',
}

function fmtPts(n: number) {
  if (n === Math.floor(n)) return String(n)
  return n.toFixed(2).replace(/0+$/, '')
}

export default function StandingsClient({
  league, players, scores, draftedTeams, matches,
}: {
  league: League
  players: Player[]
  scores: Score[]
  draftedTeams: DraftedTeam[]
  matches: Match[]
}) {
  const router = useRouter()
  const [tab, setTab]               = useState<Tab>('standings')
  const [myId, setMyId]             = useState<string | null>(null)
  const [isAdmin, setIsAdmin]       = useState(false)
  const [liveScores, setLiveScores] = useState<Score[]>(scores)
  const [liveMatches, setLiveMatches] = useState<Match[]>(matches)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setIsAdmin(user.id === league.admin_user_id)
      const p = players.find(x => x.user_id === user.id)
      if (p) setMyId(p.id)
    })
  }, [league.admin_user_id, players])

  useEffect(() => {
    const ch = supabase
      .channel(`standings-${league.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `league_id=eq.${league.id}` }, async () => {
        const { data } = await supabase.from('scores').select('*, player:players(*)').eq('league_id', league.id).order('points', { ascending: false })
        if (data) setLiveScores(data)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `league_id=eq.${league.id}` }, async () => {
        const { data } = await supabase.from('matches')
          .select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)')
          .eq('league_id', league.id).order('match_date')
        if (data) setLiveMatches(data)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [league.id])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'standings', label: '🏆 Tabla' },
    { id: 'my-teams',  label: '⚽ Mis equipos' },
    { id: 'matches',   label: '📋 Partidos' },
    { id: 'mundial',   label: '🌍 Mundial' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: '⚙️ Admin' }] : []),
  ]

  return (
    <main className="min-h-dvh flex flex-col max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4">
        <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.code}</p>
        <h1 className="text-2xl font-black">{league.name}</h1>
      </div>

      <div className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-1 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 min-w-max py-2 px-3 text-sm font-semibold rounded-lg whitespace-nowrap transition-colors ${
              tab === t.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'standings' && <StandingsTab scores={liveScores} players={players} myId={myId} leagueId={league.id} />}
      {tab === 'my-teams'  && <MyTeamsTab myId={myId} draftedTeams={draftedTeams} players={players} leagueId={league.id} />}
      {tab === 'matches'   && (
        <MatchesTab
          matches={liveMatches} leagueId={league.id}
          myId={myId} draftedTeams={draftedTeams}
        />
      )}
      {tab === 'mundial' && <MundialTab matches={liveMatches} />}
      {tab === 'admin' && isAdmin && (
        <AdminTab league={league} matches={liveMatches} players={players} router={router} />
      )}
    </main>
  )
}

// ─── CLASIFICACIÓN ───────────────────────────────────────────

function StandingsTab({ scores, players, myId, leagueId }: { scores: Score[]; players: Player[]; myId: string | null; leagueId: string }) {
  const [topScorers, setTopScorers] = useState<(PlayerStat & { team_name?: string; flag?: string })[]>([])

  useEffect(() => {
    supabase.from('player_stats_by_league')
      .select('*, team:teams(name, flag_emoji)')
      .eq('league_id', leagueId)
      .gt('goals', 0)
      .order('goals', { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (error) { console.error('player_stats_by_league:', error.message); return }
        if (data) setTopScorers(data.map((d: any) => ({
          ...d,
          goals:     Number(d.goals)     ?? 0,
          own_goals: Number(d.own_goals) ?? 0,
          red_cards: Number(d.red_cards) ?? 0,
          team_name: d.team?.name,
          flag:      d.team?.flag_emoji,
        })))
      })
  }, [leagueId])
  const entries = players.map(p => ({
    player: p,
    points: Number(scores.find(s => s.player_id === p.id)?.points ?? 0),
  })).sort((a, b) => b.points - a.points)

  return (
    <>
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clasificación</p>
      </div>
      {entries.map((e, i) => (
        <div key={e.player.id}
          className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0 ${e.player.id === myId ? 'bg-[var(--accent)]/5' : ''}`}>
          <span className={`w-6 text-center font-bold text-sm ${i === 0 ? 'text-[var(--yellow)]' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-[var(--text-secondary)]'}`}>
            {i + 1}
          </span>
          <span className="flex-1 font-medium">
            {e.player.name}
            {e.player.id === myId && <span className="ml-2 text-xs text-[var(--text-secondary)]">(tú)</span>}
          </span>
          <span className="font-black text-lg">{fmtPts(e.points)}</span>
          <span className="text-xs text-[var(--text-secondary)]">pts</span>
        </div>
      ))}
    </div>

    {/* Top Goleadores */}
    {topScorers.length > 0 && (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">⚽ Top Goleadores</p>
        </div>
        {topScorers.map((s, i) => (
          <div key={s.squad_player_id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] last:border-0">
            <span className="w-5 text-center text-xs text-[var(--text-secondary)]">{i + 1}</span>
            <span className="text-lg">{s.flag}</span>
            <span className="flex-1 text-sm font-medium truncate">{s.name}</span>
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">⚽ {s.goals}</span>
              {s.own_goals > 0 && <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">🥅 {s.own_goals}</span>}
              {s.red_cards > 0 && <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full">🟥 {s.red_cards}</span>}
            </div>
          </div>
        ))}
      </div>
    )}
  </>
  )
}

// ─── MIS EQUIPOS ─────────────────────────────────────────────

const POS_LABEL_STANDINGS: Record<string, string> = { GK: 'Porteros', DF: 'Defensas', MF: 'Centrocampistas', FW: 'Delanteros' }

interface PlayerStat {
  squad_player_id: string
  name: string
  goals: number
  own_goals: number
  red_cards: number
  team_name?: string
  flag?: string
}

function TeamSquadExpand({ teamId, pickNumber, leagueId }: { teamId: string; pickNumber: number; leagueId: string }) {
  const [squad, setSquad]   = useState<SquadPlayer[]>([])
  const [stats, setStats]   = useState<Record<string, PlayerStat>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('squad_players').select('*')
        .eq('team_id', teamId).order('position').order('shirt_number'),
      supabase.from('player_stats_by_league').select('*')
        .eq('team_id', teamId).eq('league_id', leagueId),
    ]).then(([squadRes, statsRes]) => {
      if (squadRes.error) console.error('squad_players:', squadRes.error.message)
      if (statsRes.error) console.error('player_stats_by_league:', statsRes.error.message)
      setSquad(squadRes.data ?? [])
      const map: Record<string, PlayerStat> = {}
      for (const s of (statsRes.data ?? [])) {
        map[s.squad_player_id] = {
          ...s,
          // COUNT viene como string desde PostgreSQL — convertir a número
          goals:     Number(s.goals)     ?? 0,
          own_goals: Number(s.own_goals) ?? 0,
          red_cards: Number(s.red_cards) ?? 0,
        }
      }
      setStats(map)
      setLoading(false)
    })
  }, [teamId, leagueId])

  return (
    <div className="px-3 pb-4 pt-1">
      <p className="text-xs text-[var(--text-secondary)] mb-3">Pick #{pickNumber}</p>
      {loading && <p className="text-xs text-[var(--text-secondary)]">Cargando…</p>}
      {!loading && !squad.length && <p className="text-xs text-[var(--text-secondary)]">Sin jugadores</p>}
      {!loading && (['GK','DF','MF','FW'] as const).map(pos => {
        const group = squad.filter(p => p.position === pos)
        if (!group.length) return null
        return (
          <div key={pos} className="mb-3">
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{POS_LABEL_STANDINGS[pos]}</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {group.map(sp => {
                const avatar = sp.photo_url ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(sp.name)}&size=48&background=1f2937&color=fff&bold=true&rounded=true`
                const st = stats[sp.id]
                return (
                  <div key={sp.id} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-[var(--bg-elevated)] text-center">
                    <div className="relative">
                      <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(sp.name)}&size=48&background=1f2937&color=fff&bold=true&rounded=true` }} />
                      {st?.red_cards > 0 && (
                        <span className="absolute -top-1 -right-1 text-[10px] bg-[var(--red)] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                          🟥
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-medium leading-tight line-clamp-2 w-full">{sp.name}</span>
                    {sp.shirt_number && <span className="text-[10px] text-[var(--text-secondary)]">#{sp.shirt_number}</span>}
                    {/* Stats */}
                    {st && (st.goals > 0 || st.own_goals > 0) && (
                      <div className="flex gap-1.5 flex-wrap justify-center">
                        {st.goals > 0 && (
                          <span className="text-[10px] bg-[var(--bg-base)] px-1.5 py-0.5 rounded-full">
                            ⚽ {st.goals}
                          </span>
                        )}
                        {st.own_goals > 0 && (
                          <span className="text-[10px] bg-[var(--bg-base)] px-1.5 py-0.5 rounded-full">
                            🥅 {st.own_goals}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MyTeamsTab({ myId, draftedTeams, players, leagueId }: {
  myId: string | null
  draftedTeams: DraftedTeam[]
  players: Player[]
  leagueId: string
}) {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)

  useEffect(() => { if (myId && !viewingId) setViewingId(myId) }, [myId])

  const byPlayer = draftedTeams.reduce<Record<string, DraftedTeam[]>>((acc, dt) => {
    acc[dt.player_id] ??= []; acc[dt.player_id].push(dt); return acc
  }, {})

  const currentTeams   = viewingId ? (byPlayer[viewingId] ?? []) : []
  const viewingPlayer  = players.find(p => p.id === viewingId)

  return (
    <div className="space-y-4">
      {/* Selector de jugador */}
      <div className="flex flex-wrap gap-2">
        {players.map(p => (
          <button key={p.id}
            onClick={() => { setViewingId(p.id); setExpanded(null) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors
              ${viewingId === p.id
                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white hover:border-[var(--accent)]/50'}`}>
            {p.name}{p.id === myId ? ' (tú)' : ''}
          </button>
        ))}
      </div>

      {/* Grid de equipos */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          {viewingPlayer?.name ?? '…'} · {currentTeams.length} selecciones
        </p>
        {currentTeams.length === 0
          ? <p className="text-center text-[var(--text-secondary)] py-4 text-sm">Sin selecciones</p>
          : <>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {currentTeams.map(dt => (
                  <button key={dt.id}
                    onClick={() => setExpanded(e => e === dt.team_id ? null : dt.team_id)}
                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all
                      ${expanded === dt.team_id
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50'}`}>
                    <span className="text-3xl leading-none">{dt.team?.flag_emoji}</span>
                    <span className="text-xs font-semibold leading-tight line-clamp-2 w-full text-center">{dt.team?.name}</span>
                  </button>
                ))}
              </div>
              {expanded && (() => {
                const dt = currentTeams.find(d => d.team_id === expanded)
                return dt ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{dt.team?.flag_emoji}</span>
                      <span className="font-bold">{dt.team?.name}</span>
                    </div>
                    <TeamSquadExpand teamId={expanded} pickNumber={dt.pick_number} leagueId={leagueId} />
                  </div>
                ) : null
              })()}
            </>
        }
      </div>
    </div>
  )
}

// ─── PARTIDOS + LINEUP ────────────────────────────────────────

function MatchesTab({
  matches, leagueId, myId, draftedTeams,
}: {
  matches: Match[]
  leagueId: string
  myId: string | null
  draftedTeams: DraftedTeam[]
}) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [localGoals, setLocalGoals]   = useState<Record<string, string>>({})
  const [visitorGoals, setVisitorGoals] = useState<Record<string, string>>({})
  const [saving, setSaving]           = useState<string | null>(null)

  // Lineups: key = `${matchId}-${teamId}` → selected squad_player_ids
  const [lineups, setLineups]         = useState<Record<string, string[]>>({})
  const [squadPlayers, setSquadPlayers] = useState<Record<string, SquadPlayer[]>>({})
  const [editingLineup, setEditingLineup] = useState<string | null>(null) // `${matchId}-${teamId}`
  const [savingLineup, setSavingLineup]   = useState<string | null>(null)

  // Esperar a que myId esté resuelto antes de filtrar
  const myTeamIds = myId ? draftedTeams.filter(dt => dt.player_id === myId).map(dt => dt.team_id) : []

  useEffect(() => {
    if (!myId) return
    supabase.from('predictions').select('*').eq('player_id', myId)
      .then(({ data }) => { if (data) setPredictions(data) })
    // Cargar lineups existentes
    supabase.from('match_lineups').select('*').eq('player_id', myId)
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, string[]> = {}
        data.forEach(l => {
          const key = `${l.match_id}-${l.team_id}`
          map[key] = [...(map[key] ?? []), l.squad_player_id]
        })
        setLineups(map)
      })
  }, [myId])

  async function loadSquad(teamId: string) {
    if (squadPlayers[teamId]) return
    const { data } = await supabase.from('squad_players').select('*')
      .eq('team_id', teamId).order('position').order('shirt_number')
    if (data) setSquadPlayers(p => ({ ...p, [teamId]: data }))
  }

  async function openLineup(matchId: string, teamId: string) {
    const key = `${matchId}-${teamId}`
    await loadSquad(teamId)
    setEditingLineup(editingLineup === key ? null : key)
  }

  function togglePlayer(matchId: string, teamId: string, sqId: string) {
    if (!myTeamIds.includes(teamId)) return // solo mis equipos
    const key = `${matchId}-${teamId}`
    const current = lineups[key] ?? []
    if (current.includes(sqId)) {
      setLineups(p => ({ ...p, [key]: current.filter(x => x !== sqId) }))
    } else if (current.length < 3) {
      setLineups(p => ({ ...p, [key]: [...current, sqId] }))
    }
  }

  async function saveLineup(matchId: string, teamId: string) {
    if (!myId || !myTeamIds.includes(teamId)) return
    const key = `${matchId}-${teamId}`
    const selected = lineups[key] ?? []
    setSavingLineup(key)
    await supabase.from('match_lineups').delete()
      .eq('match_id', matchId).eq('player_id', myId).eq('team_id', teamId)
    if (selected.length > 0) {
      await supabase.from('match_lineups').insert(
        selected.map(sid => ({ match_id: matchId, player_id: myId, team_id: teamId, squad_player_id: sid }))
      )
    }
    setSavingLineup(null)
    setEditingLineup(null)
  }

  async function submitPrediction(matchId: string) {
    if (!myId) return
    const h = parseInt(localGoals[matchId] ?? '')
    const a = parseInt(visitorGoals[matchId] ?? '')
    if (isNaN(h) || isNaN(a)) { alert('Introduce goles válidos'); return }
    setSaving(matchId)
    await supabase.from('predictions').upsert(
      { match_id: matchId, player_id: myId, home_goals: h, away_goals: a },
      { onConflict: 'match_id,player_id' }
    )
    const { data } = await supabase.from('predictions').select('*').eq('player_id', myId)
    if (data) setPredictions(data)
    setSaving(null)
  }

  function ownerName(teamId: string) {
    const dt = draftedTeams.find(d => d.team_id === teamId)
    return dt?.player?.name ?? null
  }

  function canInteract(match: Match) {
    if (!myId || match.status !== 'scheduled') return false
    return myTeamIds.includes(match.home_team_id) || myTeamIds.includes(match.away_team_id)
  }

  const [visibleMy, setVisibleMy]       = useState(5)
  const [visibleOther, setVisibleOther] = useState(5)

  const allMyMatches    = myId ? matches.filter(m => myTeamIds.includes(m.home_team_id) || myTeamIds.includes(m.away_team_id)) : []
  const allOtherMatches = matches.filter(m => !myTeamIds.includes(m.home_team_id) && !myTeamIds.includes(m.away_team_id))
  const myMatches    = allMyMatches.slice(0, visibleMy)
  const otherMatches = allOtherMatches.slice(0, visibleOther)

  return (
    <div className="space-y-8">
      {/* Mis partidos */}
      <section>
        <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Mis partidos</h2>
        {!myId
          ? <p className="text-[var(--text-secondary)] text-sm">Cargando…</p>
          : myMatches.length === 0
          ? <p className="text-[var(--text-secondary)] text-sm">Tus equipos no tienen partidos todavía</p>
          : <div className="space-y-4">
              {myMatches.map(m => {
                const myPred = predictions.find(p => p.match_id === m.id)
                const able   = canInteract(m)
                const myHomeTeams = myTeamIds.filter(id => id === m.home_team_id)
                const myAwayTeams = myTeamIds.filter(id => id === m.away_team_id)
                return (
                  <div key={m.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
                    {/* Cabecera partido */}
                    <div className="flex items-center justify-between mb-2">
                      <TeamBadge team={m.home_team} owner={ownerName(m.home_team_id)} />
                      {m.status === 'finished'
                        ? <span className="font-black text-xl tabular-nums">{m.home_goals} - {m.away_goals}</span>
                        : <span className="text-[var(--text-secondary)] font-bold text-sm">vs</span>
                      }
                      <TeamBadge team={m.away_team} owner={ownerName(m.away_team_id)} right />
                    </div>
                    {m.match_date && (
                      <p className="text-xs text-center text-[var(--text-secondary)] mb-3">
                        {new Date(m.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
                        {' · '}{m.match_type === 'group' ? `Grupo ${m.home_team?.group_name ?? ''}` : STAGE_LABELS[m.match_type] ?? m.match_type}
                      </p>
                    )}

                    {/* Porra */}
                    {(able || myPred) && (
                      <div className="border-t border-[var(--border)] pt-3 mb-3">
                        <p className="text-xs text-[var(--text-secondary)] mb-2 font-semibold uppercase tracking-wider">
                          🎯 Porra {myPred && !able ? `(enviada: ${myPred.home_goals}-${myPred.away_goals})` : ''}
                        </p>
                        {able && (
                          <div className="flex items-center gap-2">
                            <input type="number" min="0" max="20"
                              defaultValue={myPred?.home_goals ?? ''}
                              onChange={e => setLocalGoals(p => ({ ...p, [m.id]: e.target.value }))}
                              className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]" />
                            <span className="text-[var(--text-secondary)]">-</span>
                            <input type="number" min="0" max="20"
                              defaultValue={myPred?.away_goals ?? ''}
                              onChange={e => setVisitorGoals(p => ({ ...p, [m.id]: e.target.value }))}
                              className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]" />
                            <button onClick={() => submitPrediction(m.id)} disabled={saving === m.id}
                              className="ml-auto px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                              {saving === m.id ? '…' : 'Guardar'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Lineup por equipo */}
                    {[...myHomeTeams.map(id => ({ id, side: 'home' as const })),
                       ...myAwayTeams.map(id => ({ id, side: 'away' as const }))].map(({ id: teamId }) => {
                      const key      = `${m.id}-${teamId}`
                      const team     = teamId === m.home_team_id ? m.home_team : m.away_team
                      const selected = lineups[key] ?? []
                      const squad    = squadPlayers[teamId] ?? []
                      const isEditing = editingLineup === key

                      return (
                        <div key={teamId} className="border-t border-[var(--border)] pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                              ⭐ Jugadores — {team?.flag_emoji} {team?.name}
                            </p>
                            {able && (
                              <button
                                onClick={() => openLineup(m.id, teamId)}
                                className="text-xs text-[var(--accent-glow)] hover:underline">
                                {isEditing ? 'Cerrar' : selected.length > 0 ? 'Cambiar' : 'Elegir'}
                              </button>
                            )}
                          </div>

                          {/* Jugadores seleccionados */}
                          {selected.length > 0 && !isEditing && (
                            <div className="flex flex-wrap gap-1.5">
                              {selected.map(sid => {
                                const sp = squad.find(p => p.id === sid)
                                return sp
                                  ? <span key={sid} className="text-xs bg-[var(--bg-elevated)] px-2 py-1 rounded-lg">
                                      {sp.shirt_number ? `#${sp.shirt_number} ` : ''}{sp.name}
                                      <span className="ml-1 text-[var(--text-secondary)]">{sp.position}</span>
                                    </span>
                                  : null
                              })}
                            </div>
                          )}

                          {selected.length === 0 && !isEditing && able && (
                            <p className="text-xs text-[var(--text-secondary)]">Elige 3 jugadores antes del partido</p>
                          )}

                          {/* Picker */}
                          {isEditing && (
                            <div className="mt-2">
                              {squad.length === 0
                                ? <p className="text-xs text-[var(--text-secondary)]">Cargando plantilla…</p>
                                : (
                                  <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
                                    {(['GK','DF','MF','FW'] as const).map(pos => {
                                      const byPos = squad.filter(p => p.position === pos)
                                      if (!byPos.length) return null
                                      return (
                                        <div key={pos}>
                                          <p className="text-xs text-[var(--text-secondary)] font-bold mt-2 mb-1">{pos}</p>
                                          {byPos.map(sp => {
                                            const checked = selected.includes(sp.id)
                                            const disabled = !checked && selected.length >= 3
                                            const avatar = sp.photo_url ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(sp.name)}&size=40&background=1f2937&color=fff&bold=true&rounded=true`
                                            return (
                                              <button key={sp.id}
                                                onClick={() => togglePlayer(m.id, teamId, sp.id)}
                                                disabled={disabled}
                                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition-colors mb-0.5
                                                  ${checked ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'}
                                                  ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-[var(--accent)]/50'}`}>
                                                <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0"
                                                  onError={e => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(sp.name)}&size=40&background=1f2937&color=fff&bold=true&rounded=true` }} />
                                                <span className="flex-1 truncate">{sp.name}</span>
                                                {sp.shirt_number && <span className="text-[var(--text-secondary)] text-xs w-5 text-right shrink-0">{sp.shirt_number}</span>}
                                                {checked && <span className="text-[var(--accent-glow)] text-xs shrink-0">✓</span>}
                                              </button>
                                            )
                                          })}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              }
                              <div className="flex items-center justify-between mt-3">
                                <span className="text-xs text-[var(--text-secondary)]">{selected.length}/3 seleccionados</span>
                                <button onClick={() => saveLineup(m.id, teamId)}
                                  disabled={savingLineup === key}
                                  className="px-4 py-1.5 bg-[var(--accent)] text-white text-sm font-bold rounded-lg disabled:opacity-50">
                                  {savingLineup === key ? '…' : 'Guardar'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
        }
        {allMyMatches.length > visibleMy && (
          <button onClick={() => setVisibleMy(v => v + 5)}
            className="mt-3 w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
            Ver más ({allMyMatches.length - visibleMy} restantes)
          </button>
        )}
      </section>

      {/* Todos los partidos */}
      {allOtherMatches.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Otros partidos</h2>
          <div className="space-y-2">
            {otherMatches.map(m => {
              const homeOwner = ownerName(m.home_team_id)
              const awayOwner = ownerName(m.away_team_id)
              return (
                <div key={m.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{m.home_team?.flag_emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.home_team?.name}</p>
                      {homeOwner && <p className="text-xs text-[var(--text-secondary)] truncate">{homeOwner}</p>}
                    </div>
                    <span className="font-black tabular-nums text-sm shrink-0">
                      {m.status === 'finished' ? `${m.home_goals} - ${m.away_goals}` : 'vs'}
                    </span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-sm font-medium truncate">{m.away_team?.name}</p>
                      {awayOwner && <p className="text-xs text-[var(--text-secondary)] truncate">{awayOwner}</p>}
                    </div>
                    <span className="text-lg">{m.away_team?.flag_emoji}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {allOtherMatches.length > visibleOther && (
            <button onClick={() => setVisibleOther(v => v + 5)}
              className="mt-3 w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
              Ver más ({allOtherMatches.length - visibleOther} restantes)
            </button>
          )}
        </section>
      )}
    </div>
  )
}

// ─── ADMIN ────────────────────────────────────────────────────

// ─── MUNDIAL ─────────────────────────────────────────────────

interface GroupRow {
  team: import('../../../types').Team
  p: number; w: number; d: number; l: number
  gf: number; ga: number; pts: number
}

function MundialTab({ matches }: { matches: Match[] }) {
  const [allTeams, setAllTeams] = useState<import('../../../types').Team[]>([])

  useEffect(() => {
    supabase.from('teams').select('*').order('group_name').order('name')
      .then(({ data }) => { if (data) setAllTeams(data) })
  }, [])

  // Calcular clasificación por grupo a partir de partidos finalizados
  const standings = useMemo(() => {
    const map: Record<string, GroupRow> = {}
    for (const t of allTeams) {
      map[t.id] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
    }
    for (const m of matches) {
      if (m.status !== 'finished' || m.home_goals === null || m.away_goals === null) continue
      if (m.match_type !== 'group') continue
      const h = map[m.home_team_id], a = map[m.away_team_id]
      if (!h || !a) continue
      const hg = m.home_goals, ag = m.away_goals
      h.p++; h.gf += hg; h.ga += ag
      a.p++; a.gf += ag; a.ga += hg
      if (hg > ag)       { h.w++; h.pts += 3; a.l++ }
      else if (hg === ag) { h.d++; h.pts++; a.d++; a.pts++ }
      else               { h.l++; a.w++; a.pts += 3 }
    }
    return map
  }, [allTeams, matches])

  const groups = useMemo(() => {
    const g: Record<string, GroupRow[]> = {}
    for (const row of Object.values(standings)) {
      const name = row.team.group_name ?? '?'
      g[name] ??= []
      g[name].push(row)
    }
    for (const name of Object.keys(g)) {
      g[name].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf)
    }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
  }, [standings])

  if (!allTeams.length) return <p className="text-[var(--text-secondary)] text-sm">Cargando…</p>

  return (
    <div className="space-y-4">
      {groups.map(([groupName, rows]) => (
        <div key={groupName} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Grupo {groupName}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-[var(--text-secondary)] uppercase border-b border-[var(--border)]">
                <th className="text-left px-3 py-1.5 font-semibold w-full">Equipo</th>
                <th className="px-2 py-1.5 font-semibold text-center">PJ</th>
                <th className="px-2 py-1.5 font-semibold text-center">G</th>
                <th className="px-2 py-1.5 font-semibold text-center">E</th>
                <th className="px-2 py-1.5 font-semibold text-center">P</th>
                <th className="px-2 py-1.5 font-semibold text-center">GD</th>
                <th className="px-2 py-1.5 font-semibold text-center font-black text-[var(--text-primary)]">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.team.id}
                  className={`border-b border-[var(--border)] last:border-0 ${i < 2 ? 'bg-[var(--accent)]/5' : ''}`}>
                  <td className="px-3 py-2 flex items-center gap-2">
                    {i < 2 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />}
                    {i >= 2 && <span className="w-1.5 h-1.5 shrink-0" />}
                    <span className="text-base leading-none">{row.team.flag_emoji}</span>
                    <span className="font-medium truncate">{row.team.name}</span>
                  </td>
                  <td className="px-2 py-2 text-center text-[var(--text-secondary)]">{row.p}</td>
                  <td className="px-2 py-2 text-center text-[var(--text-secondary)]">{row.w}</td>
                  <td className="px-2 py-2 text-center text-[var(--text-secondary)]">{row.d}</td>
                  <td className="px-2 py-2 text-center text-[var(--text-secondary)]">{row.l}</td>
                  <td className="px-2 py-2 text-center text-[var(--text-secondary)]">{row.gf - row.ga > 0 ? '+' : ''}{row.gf - row.ga}</td>
                  <td className="px-2 py-2 text-center font-black">{row.pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-xs text-[var(--text-secondary)] text-center">● Clasificados a octavos (top 2 por grupo)</p>
    </div>
  )
}

function AdminTab({ league, matches, players, router }: {
  league: League; matches: Match[]; players: Player[]; router: ReturnType<typeof useRouter>
}) {
  const [allTeams, setAllTeams] = useState<import('../../../types').Team[]>([])
  const [homeId, setHomeId]     = useState('')
  const [awayId, setAwayId]     = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [matchType, setMatchType] = useState<Match['match_type']>('group')
  const [creating, setCreating]       = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)

  useEffect(() => {
    supabase.from('teams').select('*').order('name').then(({ data }) => { if (data) setAllTeams(data) })
  }, [])

  async function loadGroupStage() {
    if (!confirm('¿Cargar los 72 partidos de fase de grupos? Se añadirán a esta liga.')) return
    setLoadingMatches(true)
    const { data, error } = await supabase.rpc('load_group_stage_matches', { p_league_id: league.id })
    if (error) {
      alert(`Error: ${error.message}\n\nAsegúrate de haber ejecutado supabase/seed_matches.sql en el SQL Editor de Supabase.`)
    } else {
      alert(`✅ ${data} partidos cargados`)
    }
    setLoadingMatches(false)
    router.refresh()
  }

  async function createMatch() {
    if (!homeId || !awayId || homeId === awayId) { alert('Selecciona dos equipos distintos'); return }
    setCreating(true)
    const { error } = await supabase.from('matches').insert({
      league_id: league.id, home_team_id: homeId, away_team_id: awayId,
      match_date: matchDate || null, match_type: matchType,
    })
    if (error) alert(error.message)
    setCreating(false)
    router.refresh()
  }

  async function setResult(matchId: string, h: number, a: number) {
    const { error: updateErr } = await supabase
      .from('matches')
      .update({ home_goals: h, away_goals: a, status: 'finished' })
      .eq('id', matchId)
    if (updateErr) { alert(`Error al guardar: ${updateErr.message}`); return }

    const { error: rpcErr } = await supabase.rpc('recalculate_scores', { p_match_id: matchId })
    if (rpcErr) console.warn('recalculate_scores:', rpcErr.message)

    router.refresh()
  }

  async function awardBonus(teamId: string, stage: string) {
    const { error } = await supabase.rpc('award_qualification_bonus', {
      p_league_id: league.id, p_team_id: teamId, p_stage: stage,
    })
    if (error) alert(error.message)
    else alert(`✅ Bono de ${STAGE_LABELS[stage]} otorgado (+${STAGE_PTS[stage]} pts)`)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Cargar fase de grupos */}
      <button onClick={loadGroupStage} disabled={loadingMatches}
        className="w-full py-3 bg-[var(--green)] text-black font-black rounded-2xl disabled:opacity-50">
        {loadingMatches ? 'Cargando…' : '⚽ Cargar 72 partidos de fase de grupos'}
      </button>

      {/* Crear partido */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h2 className="font-bold mb-4">Crear partido manualmente</h2>
        <div className="space-y-3">
          <select value={homeId} onChange={e => setHomeId(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
            <option value="">Equipo local…</option>
            {allTeams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
          </select>
          <select value={awayId} onChange={e => setAwayId(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
            <option value="">Equipo visitante…</option>
            {allTeams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
          </select>
          <select value={matchType} onChange={e => setMatchType(e.target.value as Match['match_type'])}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
            <option value="group">Fase de grupos</option>
            <option value="r16">Octavos de final</option>
            <option value="qf">Cuartos de final</option>
            <option value="sf">Semifinal</option>
            <option value="third_place">Tercer puesto</option>
            <option value="final">Final</option>
          </select>
          <input type="datetime-local" value={matchDate} onChange={e => setMatchDate(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none" />
          <button onClick={createMatch} disabled={creating}
            className="w-full py-2.5 bg-[var(--accent)] text-white font-bold rounded-xl disabled:opacity-50">
            {creating ? 'Creando…' : 'Crear partido'}
          </button>
        </div>
      </div>

      {/* Pendientes */}
      <AdminMatchSection
        title="Pendientes"
        matches={[...matches].filter(m => m.status === 'scheduled').sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))}
        empty="No hay partidos pendientes"
        onRecalculate={() => router.refresh()}
        onSetResult={setResult}
        paginate
      />

      {/* Finalizados (colapsados) */}
      <AdminMatchSection
        title="Finalizados"
        matches={[...matches].filter(m => m.status === 'finished').sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))}
        empty="Ningún partido finalizado todavía"
        onRecalculate={() => router.refresh()}
        onSetResult={setResult}
        collapsible
      />

      {/* Bonificaciones de clasificación */}
      <QualificationBonusSection allTeams={allTeams} onAward={awardBonus} />
    </div>
  )
}

function MatchResultRow({ match, onSave }: { match: Match; onSave: (id: string, h: number, a: number) => void }) {
  const [h, setH] = useState('')
  const [a, setA] = useState('')
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-3 flex items-center gap-2">
      <span className="text-sm truncate flex-1">{match.home_team?.flag_emoji} {match.home_team?.name}</span>
      <input type="number" min="0" value={h} onChange={e => setH(e.target.value)}
        className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-1 py-1 text-center text-white text-sm" />
      <span className="text-[var(--text-secondary)]">-</span>
      <input type="number" min="0" value={a} onChange={e => setA(e.target.value)}
        className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-1 py-1 text-center text-white text-sm" />
      <span className="text-sm truncate flex-1 text-right">{match.away_team?.flag_emoji} {match.away_team?.name}</span>
      <button onClick={() => onSave(match.id, parseInt(h), parseInt(a))} disabled={h === '' || a === ''}
        className="px-3 py-1 bg-[var(--green)] text-black text-sm font-bold rounded-lg disabled:opacity-40">✓</button>
    </div>
  )
}

// Clasifica el event_type según minuto
function AdminMatchSection({ title, matches, empty, onRecalculate, onSetResult, collapsible, paginate }: {
  title: string
  matches: Match[]
  empty: string
  onRecalculate: () => void
  onSetResult: (id: string, h: number, a: number) => Promise<void>
  collapsible?: boolean
  paginate?: boolean
}) {
  const [open, setOpen]       = useState(!collapsible)
  const [visible, setVisible] = useState(5)
  const shown    = paginate ? matches.slice(0, visible) : matches
  const remaining = matches.length - shown.length

  return (
    <div className="space-y-2">
      <button
        onClick={() => collapsible && setOpen(o => !o)}
        className={`w-full flex items-center justify-between ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <h2 className="font-bold text-[var(--text-secondary)] text-sm uppercase tracking-wider">
          {title} {matches.length > 0 && <span className="normal-case font-normal">({matches.length})</span>}
        </h2>
        {collapsible && <span className="text-[var(--text-secondary)] text-sm">{open ? '▲' : '▼'}</span>}
      </button>
      {open && (
        <div className="space-y-2">
          {matches.length === 0
            ? <p className="text-[var(--text-secondary)] text-sm">{empty}</p>
            : <>
                {shown.map(m => (
                  <PlayerEventsRow key={m.id} match={m} onRecalculate={onRecalculate} onSetResult={onSetResult} />
                ))}
                {remaining > 0 && (
                  <button onClick={() => setVisible(v => v + 5)}
                    className="w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
                    Ver más ({remaining} restantes)
                  </button>
                )}
              </>
          }
        </div>
      )}
    </div>
  )
}

function classifyGoal(minute: number | null): 'goal' | 'goal_extra_time' {
  if (minute && minute > 90) return 'goal_extra_time'
  return 'goal'
}

const EVENT_ICON: Record<string, string> = {
  goal: '⚽', goal_extra_time: '⚽', penalty_shootout: '⚽',
  red_card: '🟥', own_goal: '🥅',
}

type AddEventType = 'goal' | 'own_goal' | 'penalty_shootout' | 'red_card'
const ADD_EVENT_OPTIONS: { value: AddEventType; label: string; hasMinute: boolean }[] = [
  { value: 'goal',             label: '⚽ Gol',               hasMinute: true  },
  { value: 'own_goal',         label: '🥅 Autogol',           hasMinute: true  },
  { value: 'red_card',         label: '🟥 Expulsión',         hasMinute: true  },
  { value: 'penalty_shootout', label: '⚽ Penalti (tanda)',   hasMinute: false },
]

function PlayerEventsRow({ match, onRecalculate, onSetResult }: {
  match: Match
  onRecalculate: () => void
  onSetResult: (id: string, h: number, a: number) => void
}) {
  const [open, setOpen]         = useState(false)
  const [homeSquad, setHomeSquad] = useState<SquadPlayer[]>([])
  const [awaySquad, setAwaySquad] = useState<SquadPlayer[]>([])
  const [events, setEvents]     = useState<PlayerEvent[]>([])
  const [selPlayer, setSelPlayer] = useState('')
  const [selType, setSelType]   = useState<AddEventType>('goal')
  const [minute, setMinute]     = useState('')
  const [adding, setAdding]     = useState(false)
  // Result entry — sincronizar con prop cuando cambia tras refresh
  const [homeG, setHomeG]       = useState(match.home_goals?.toString() ?? '')
  const [awayG, setAwayG]       = useState(match.away_goals?.toString() ?? '')
  const [savingResult, setSavingResult] = useState(false)
  const [savedOk, setSavedOk]   = useState(false)

  useEffect(() => {
    setHomeG(match.home_goals?.toString() ?? '')
    setAwayG(match.away_goals?.toString() ?? '')
  }, [match.home_goals, match.away_goals])

  async function load() {
    const [sq1, sq2, evts] = await Promise.all([
      supabase.from('squad_players').select('*').eq('team_id', match.home_team_id).order('position').order('shirt_number'),
      supabase.from('squad_players').select('*').eq('team_id', match.away_team_id).order('position').order('shirt_number'),
      supabase.from('player_events').select('*, squad_player:squad_players(*)').eq('match_id', match.id).order('minute'),
    ])
    setHomeSquad(sq1.data ?? [])
    setAwaySquad(sq2.data ?? [])
    setEvents((evts.data as PlayerEvent[]) ?? [])
  }

  function toggle() { if (!open) load(); setOpen(o => !o) }

  const hasMinute = ADD_EVENT_OPTIONS.find(o => o.value === selType)?.hasMinute ?? true
  const allSquad  = [...homeSquad, ...awaySquad]

  function deriveEventType(type: AddEventType, min: string): PlayerEvent['event_type'] {
    if (type === 'goal') return classifyGoal(parseInt(min) || null)
    return type
  }

  async function addEvent() {
    if (!selPlayer) return
    if (hasMinute && !minute) { alert('Introduce el minuto'); return }
    setAdding(true)
    const eventType = deriveEventType(selType, minute)
    await supabase.from('player_events').insert({
      match_id: match.id,
      squad_player_id: selPlayer,
      event_type: eventType,
      minute: hasMinute ? parseInt(minute) || null : null,
    })
    await load()
    await supabase.rpc('recalculate_scores', { p_match_id: match.id })
    setSelPlayer(''); setMinute('')
    setAdding(false)
    onRecalculate()
  }

  async function removeEvent(id: string) {
    await supabase.from('player_events').delete().eq('id', id)
    await load()
    await supabase.rpc('recalculate_scores', { p_match_id: match.id })
    onRecalculate()
  }

  async function saveResult() {
    const h = parseInt(homeG), a = parseInt(awayG)
    if (isNaN(h) || isNaN(a)) { alert('Resultado inválido'); return }
    setSavingResult(true)
    setSavedOk(false)
    await onSetResult(match.id, h, a)
    setSavingResult(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 2000)
  }

  async function recalc() {
    await supabase.rpc('recalculate_scores', { p_match_id: match.id })
    onRecalculate()
  }

  const statusColor = match.status === 'finished' ? 'text-[var(--green)]' : 'text-[var(--text-secondary)]'

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      {/* Header */}
      <button onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-elevated)] transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>{match.home_team?.flag_emoji}</span>
            <span className="truncate">{match.home_team?.name}</span>
            {match.status === 'finished' && (
              <span className="font-black tabular-nums text-[var(--green)]">
                {match.home_goals} - {match.away_goals}
              </span>
            )}
            <span className="truncate">{match.away_team?.name}</span>
            <span>{match.away_team?.flag_emoji}</span>
          </div>
          {match.match_date && (
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {new Date(match.match_date).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          )}
        </div>
        <span className={`text-xs shrink-0 ${statusColor}`}>
          {match.status === 'finished' ? `✓ ${events.length} eventos` : 'Pendiente'}
        </span>
        <span className="text-[var(--text-secondary)] shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-[var(--border)] p-4 space-y-4">

          {/* Resultado */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Resultado</p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{match.home_team?.flag_emoji} {match.home_team?.name}</span>
              <input type="number" min="0" value={homeG} onChange={e => setHomeG(e.target.value)}
                className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-[var(--text-secondary)] font-bold">-</span>
              <input type="number" min="0" value={awayG} onChange={e => setAwayG(e.target.value)}
                className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-sm font-medium">{match.away_team?.flag_emoji} {match.away_team?.name}</span>
              <button onClick={saveResult} disabled={savingResult || homeG === '' || awayG === ''}
                className="ml-auto px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-bold rounded-lg disabled:opacity-40">
                {savingResult ? '…' : savedOk ? '✓ Guardado' : match.status === 'finished' ? 'Actualizar' : 'Finalizar'}
              </button>
            </div>
          </div>

          {/* Añadir evento */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Añadir evento</p>
            <div className="space-y-2">
              {/* Fila 1: tipo + minuto */}
              <div className="flex gap-2">
                <select value={selType} onChange={e => { setSelType(e.target.value as AddEventType); setMinute('') }}
                  className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm text-white focus:outline-none">
                  {ADD_EVENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {hasMinute && (
                  <input type="number" min="1" max="130" value={minute}
                    onChange={e => setMinute(e.target.value)}
                    placeholder="min"
                    className="w-20 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm text-center text-white focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-secondary)]" />
                )}
              </div>
              {/* Fila 2: jugador */}
              <div className="flex gap-2">
                <select value={selPlayer} onChange={e => setSelPlayer(e.target.value)}
                  className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-2 text-sm text-white focus:outline-none">
                  <option value="">Selecciona jugador…</option>
                  <optgroup label={`🏠 ${match.home_team?.name}`}>
                    {homeSquad.map(sp => (
                      <option key={sp.id} value={sp.id}>
                        {sp.shirt_number ? `#${sp.shirt_number} ` : ''}{sp.name} ({sp.position})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={`✈️ ${match.away_team?.name}`}>
                    {awaySquad.map(sp => (
                      <option key={sp.id} value={sp.id}>
                        {sp.shirt_number ? `#${sp.shirt_number} ` : ''}{sp.name} ({sp.position})
                      </option>
                    ))}
                  </optgroup>
                </select>
                <button onClick={addEvent} disabled={adding || !selPlayer}
                  className="px-4 py-2 bg-[var(--accent)] text-white text-sm font-bold rounded-lg disabled:opacity-40">
                  {adding ? '…' : '+ Añadir'}
                </button>
              </div>
              {/* Indicador de clasificación */}
              {selType === 'goal' && minute && (
                <p className="text-xs text-[var(--text-secondary)]">
                  {parseInt(minute) > 90
                    ? '⏱ Prórroga → +0.5 pts'
                    : `⏱ Tiempo ordinario (min ${minute}) → +1 pt`}
                </p>
              )}
            </div>
          </div>

          {/* Lista de eventos */}
          {events.length > 0 && (
            <div>
              <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                Eventos ({events.length})
              </p>
              <div className="space-y-1">
                {[...events].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999)).map(ev => (
                  <div key={ev.id}
                    className="flex items-center gap-2 text-sm bg-[var(--bg-elevated)] px-3 py-2 rounded-lg">
                    <span>{EVENT_ICON[ev.event_type]}</span>
                    {ev.minute && <span className="text-[var(--text-secondary)] w-8 text-xs">{ev.minute}&apos;</span>}
                    <span className="flex-1 truncate">{ev.squad_player?.name}</span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {ev.event_type === 'goal' ? '+1pt'
                        : ev.event_type === 'goal_extra_time' ? '+0.5pt'
                        : ev.event_type === 'penalty_shootout' ? '+0.25pt'
                        : '-1pt'}
                    </span>
                    <button onClick={() => removeEvent(ev.id)}
                      className="text-[var(--red)] hover:opacity-75 ml-1">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

function QualificationBonusSection({ allTeams, onAward }: {
  allTeams: import('../../../types').Team[]
  onAward: (teamId: string, stage: string) => void
}) {
  const [teamId, setTeamId] = useState('')
  const [stage, setStage]   = useState('r16')

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <h2 className="font-bold mb-4">Bonificación de clasificación</h2>
      <p className="text-xs text-[var(--text-secondary)] mb-3">
        Octavos +1 · Cuartos +3 · Semis +5 · Final +8 (acumulativos)
      </p>
      <div className="space-y-3">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
          <option value="">Equipo que avanza…</option>
          {allTeams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
        </select>
        <select value={stage} onChange={e => setStage(e.target.value)}
          className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v} (+{STAGE_PTS[k]} pts)</option>
          ))}
        </select>
        <button onClick={() => { if (teamId) onAward(teamId, stage) }} disabled={!teamId}
          className="w-full py-2.5 bg-[var(--yellow)] text-black font-bold rounded-xl disabled:opacity-40">
          Otorgar bonificación
        </button>
      </div>
    </div>
  )
}

function TeamBadge({ team, owner, right }: { team?: import('../../../types').Team; owner?: string | null; right?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
      <span className="text-2xl shrink-0">{team?.flag_emoji}</span>
      <div className={`min-w-0 ${right ? 'text-right' : ''}`}>
        <p className="font-semibold text-sm max-w-[80px] truncate">{team?.name}</p>
        {owner && <p className="text-xs text-[var(--text-secondary)] max-w-[80px] truncate">{owner}</p>}
      </div>
    </div>
  )
}
