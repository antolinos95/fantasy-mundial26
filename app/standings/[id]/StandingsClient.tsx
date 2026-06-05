'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEFAULT_PLAYER_IMG } from '../../../lib/supabase'
import type {
  League, Player, Score, DraftedTeam, Match, Prediction,
  SquadPlayer, MatchLineup, PlayerEvent,
} from '../../../types'
import RulesModal from '../../../components/RulesModal'

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
  const [showRules, setShowRules]   = useState(false)

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, async () => {
        const { data } = await supabase.from('matches')
          .select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)')
          .or(`league_id.is.null,league_id.eq.${league.id}`).order('match_date')
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
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.code}</p>
          <h1 className="text-2xl font-black">{league.name}</h1>
        </div>
        <button onClick={() => setShowRules(true)}
          className="shrink-0 mt-1 flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-xl px-3 py-2 text-sm font-semibold transition-colors">
          📖 Normas
        </button>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

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

interface TieStats { hits: number; playerPts: number; wins: number }

function StandingsTab({ scores, players, myId, leagueId }: { scores: Score[]; players: Player[]; myId: string | null; leagueId: string }) {
  const [topScorers, setTopScorers] = useState<(PlayerStat & { team_name?: string; flag?: string })[]>([])
  const [breakdownPlayer, setBreakdownPlayer] = useState<Player | null>(null)
  const [tie, setTie] = useState<Record<string, TieStats>>({})

  // Estadísticas de desempate desde el libro mayor
  useEffect(() => {
    supabase.from('score_log').select('player_id, category, points').eq('league_id', leagueId)
      .then(({ data }) => {
        const map: Record<string, TieStats> = {}
        for (const r of (data ?? [])) {
          const t = map[r.player_id] ??= { hits: 0, playerPts: 0, wins: 0 }
          const pts = Number(r.points)
          if (r.category === 'prediction' && pts > 0) t.hits++
          if (r.category === 'player') t.playerPts += pts
          if (r.category === 'result' && pts === 2) t.wins++
        }
        setTie(map)
      })
  }, [leagueId, scores])

  useEffect(() => {
    supabase.from('player_stats_global')
      .select('*')
      .gt('goals', 0)
      .order('goals', { ascending: false })
      .order('own_goals', { ascending: true })  // ante empate, menos autogoles arriba
      .order('red_cards', { ascending: true })
      .limit(5)
      .then(({ data, error }) => {
        if (error) { console.error('player_stats_global:', error.message); return }
        if (data) setTopScorers(data.map((d: any) => ({
          ...d,
          goals:     Number(d.goals)     ?? 0,
          own_goals: Number(d.own_goals) ?? 0,
          red_cards: Number(d.red_cards) ?? 0,
        })))
      })
  }, [leagueId])
  const entries = players.map(p => ({
    player: p,
    points: Number(scores.find(s => s.player_id === p.id)?.points ?? 0),
    t: tie[p.id] ?? { hits: 0, playerPts: 0, wins: 0 },
  })).sort((a, b) =>
    b.points - a.points ||
    b.t.hits - a.t.hits ||             // 1º más porras acertadas
    b.t.playerPts - a.t.playerPts ||   // 2º más puntos de jugadores destacados
    b.t.wins - a.t.wins                // 3º más victorias
  )

  return (
    <>
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clasificación</p>
      </div>
      {entries.map((e, i) => (
        <button key={e.player.id}
          onClick={() => setBreakdownPlayer(e.player)}
          className={`w-full flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0 text-left hover:bg-[var(--bg-elevated)] transition-colors ${e.player.id === myId ? 'bg-[var(--accent)]/5' : ''}`}>
          <span className={`w-6 text-center font-bold text-sm ${i === 0 ? 'text-[var(--yellow)]' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-[var(--text-secondary)]'}`}>
            {i + 1}
          </span>
          <span className="flex-1 min-w-0">
            <span className="font-medium block truncate">
              {e.player.name}
              {e.player.id === myId && <span className="ml-2 text-xs text-[var(--text-secondary)]">(tú)</span>}
            </span>
            <span className="text-[10px] text-[var(--text-secondary)]">
              🎯 {e.t.hits} · ⭐ {fmtPts(e.t.playerPts)} · ✅ {e.t.wins}
            </span>
          </span>
          <span className="font-black text-lg">{fmtPts(e.points)}</span>
          <span className="text-xs text-[var(--text-secondary)]">pts</span>
          <span className="text-[var(--text-secondary)] text-xs ml-1">›</span>
        </button>
      ))}
    </div>

    {breakdownPlayer && (
      <ScoreBreakdownModal
        player={breakdownPlayer}
        leagueId={leagueId}
        total={Number(scores.find(s => s.player_id === breakdownPlayer.id)?.points ?? 0)}
        onClose={() => setBreakdownPlayer(null)}
      />
    )}

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

// ─── DESGLOSE DE PUNTOS ──────────────────────────────────────

interface LogEntry {
  category: string
  points: number
  detail: string | null
  match_id: string | null
  match?: { home_team?: { name: string; flag_emoji: string }; away_team?: { name: string; flag_emoji: string } } | null
}

const CAT_INFO: Record<string, { label: string; icon: string }> = {
  result:     { label: 'Resultados',          icon: '⚽' },
  prediction: { label: 'Porras',              icon: '🎯' },
  player:     { label: 'Jugadores destacados', icon: '⭐' },
  bonus:      { label: 'Bonos de clasificación', icon: '🏅' },
}

function ScoreBreakdownModal({ player, leagueId, total, onClose }: {
  player: Player
  leagueId: string
  total: number
  onClose: () => void
}) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('score_log')
      .select('category, points, detail, match_id, match:matches(home_team:teams!matches_home_team_id_fkey(name,flag_emoji), away_team:teams!matches_away_team_id_fkey(name,flag_emoji))')
      .eq('league_id', leagueId).eq('player_id', player.id)
      .then(({ data, error }) => {
        if (error) console.error('score_log:', error.message)
        setEntries((data as any[] ?? []).map(d => ({ ...d, points: Number(d.points) })))
        setLoading(false)
      })
  }, [leagueId, player.id])

  // Totales por categoría
  const byCat = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.points; return acc
  }, {})

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--border)]">
          <div className="flex-1">
            <p className="font-black text-lg">{player.name}</p>
            <p className="text-xs text-[var(--text-secondary)]">Desglose de puntos</p>
          </div>
          <span className="font-black text-2xl">{fmtPts(total)}</span>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-3">
          {loading && <p className="text-center text-[var(--text-secondary)] py-6 text-sm">Cargando…</p>}
          {!loading && entries.length === 0 && (
            <p className="text-center text-[var(--text-secondary)] py-6 text-sm">Todavía sin puntos</p>
          )}

          {/* Resumen por categoría */}
          {!loading && entries.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CAT_INFO).map(([cat, info]) => (
                <div key={cat} className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-xl px-3 py-2.5">
                  <span className="text-lg">{info.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider truncate">{info.label}</p>
                    <p className={`font-black ${(byCat[cat] ?? 0) < 0 ? 'text-[var(--red)]' : ''}`}>
                      {(byCat[cat] ?? 0) > 0 ? '+' : ''}{fmtPts(byCat[cat] ?? 0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Detalle por categoría */}
          {!loading && (['result','prediction','player','bonus'] as const).map(cat => {
            const items = entries.filter(e => e.category === cat)
            if (!items.length) return null
            return (
              <div key={cat}>
                <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 mt-1">
                  {CAT_INFO[cat].icon} {CAT_INFO[cat].label}
                </p>
                <div className="space-y-1">
                  {items.map((e, idx) => {
                    const m = e.match
                    const label = m
                      ? `${m.home_team?.flag_emoji ?? ''} ${m.home_team?.name ?? ''} - ${m.away_team?.name ?? ''} ${m.away_team?.flag_emoji ?? ''}`.trim()
                      : (e.detail ?? '')
                    return (
                      <div key={idx} className="flex items-center gap-2 text-sm bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5">
                        <span className="flex-1 truncate text-xs">{e.detail && m ? `${e.detail} · ` : ''}{label}</span>
                        <span className={`font-bold shrink-0 ${e.points < 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                          {e.points > 0 ? '+' : ''}{fmtPts(e.points)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
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
      supabase.from('player_stats_global').select('*').eq('team_id', teamId),
    ]).then(([squadRes, statsRes]) => {
      if (squadRes.error) console.error('squad_players:', squadRes.error.message)
      if (statsRes.error) console.error('player_stats_global:', statsRes.error.message)
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
                const avatar = sp.photo_url ?? DEFAULT_PLAYER_IMG
                const st = stats[sp.id]
                return (
                  <div key={sp.id} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-[var(--bg-elevated)] text-center">
                    <div className="relative">
                      <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
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
  const [sortBy,    setSortBy]    = useState<'alpha' | 'group'>('alpha')

  useEffect(() => { if (myId && !viewingId) setViewingId(myId) }, [myId])

  const byPlayer = draftedTeams.reduce<Record<string, DraftedTeam[]>>((acc, dt) => {
    acc[dt.player_id] ??= []; acc[dt.player_id].push(dt); return acc
  }, {})

  const rawTeams     = viewingId ? (byPlayer[viewingId] ?? []) : []
  const viewingPlayer = players.find(p => p.id === viewingId)

  const currentTeams = [...rawTeams].sort((a, b) => {
    if (sortBy === 'group') {
      const gA = a.team?.group_name ?? '', gB = b.team?.group_name ?? ''
      return gA.localeCompare(gB) || (a.team?.name ?? '').localeCompare(b.team?.name ?? '')
    }
    return (a.team?.name ?? '').localeCompare(b.team?.name ?? '')
  })

  // Para vista por grupo: agrupar con cabecera
  const groupedTeams = sortBy === 'group'
    ? currentTeams.reduce<Record<string, DraftedTeam[]>>((acc, dt) => {
        const g = dt.team?.group_name ?? '?'
        acc[g] ??= []; acc[g].push(dt); return acc
      }, {})
    : null

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
        {/* Cabecera con ordenación */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            {viewingPlayer?.name ?? '…'} · {currentTeams.length} selecciones
          </p>
          <div className="flex gap-1">
            {(['alpha', 'group'] as const).map(s => (
              <button key={s} onClick={() => { setSortBy(s); setExpanded(null) }}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors
                  ${sortBy === s
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-white'}`}>
                {s === 'alpha' ? 'A–Z' : 'Grupo'}
              </button>
            ))}
          </div>
        </div>

        {currentTeams.length === 0
          ? <p className="text-center text-[var(--text-secondary)] py-4 text-sm">Sin selecciones</p>
          : <>
              {/* Vista por grupo */}
              {groupedTeams ? (
                <div className="space-y-4">
                  {Object.entries(groupedTeams).sort(([a],[b]) => a.localeCompare(b)).map(([group, teams]) => (
                    <div key={group}>
                      <p className="text-xs font-bold text-[var(--text-secondary)] mb-2">Grupo {group}</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {teams.map(dt => (
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
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
              {/* Panel expandible (ambos modos) */}
              {expanded && (() => {
                const dt = currentTeams.find(d => d.team_id === expanded)
                return dt ? (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{dt.team?.flag_emoji}</span>
                      <span className="font-bold">{dt.team?.name}</span>
                      <span className="text-xs text-[var(--text-secondary)] ml-auto">Grupo {dt.team?.group_name} · Pick #{dt.pick_number}</span>
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

// ─── RESUMEN DE PARTIDO FINALIZADO ───────────────────────────

function FinishedMatchCard({ match, myId, myTeamIds, prediction, ownerName }: {
  match: Match
  myId: string
  myTeamIds: string[]
  prediction?: Prediction
  ownerName: (teamId: string) => string | null
}) {
  const [lineup, setLineup] = useState<{ team_id: string; squad_player: SquadPlayer }[]>([])
  const [events, setEvents] = useState<PlayerEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('match_lineups')
        .select('team_id, squad_player:squad_players(*)')
        .eq('match_id', match.id).eq('player_id', myId),
      supabase.from('player_events').select('*').eq('match_id', match.id),
    ]).then(([lu, ev]) => {
      setLineup((lu.data as any[]) ?? [])
      setEvents((ev.data as PlayerEvent[]) ?? [])
      setLoading(false)
    })
  }, [match.id, myId])

  const predExact = !!prediction &&
    prediction.home_goals === match.home_goals &&
    prediction.away_goals === match.away_goals

  function playerPts(spId: string) {
    return events.filter(e => e.squad_player_id === spId).reduce((s, e) => {
      switch (e.event_type) {
        case 'goal':             return s + 1
        case 'goal_extra_time':  return s + 0.5
        case 'penalty_shootout': return s + 0.25
        case 'own_goal':         return s - 1
        case 'red_card':         return s - 1
        default:                 return s
      }
    }, 0)
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      {/* Cabecera */}
      <div className="flex items-center justify-between mb-2">
        <TeamBadge team={match.home_team} owner={ownerName(match.home_team_id ?? '')} />
        <span className="font-black text-xl tabular-nums">{match.home_goals} - {match.away_goals}</span>
        <TeamBadge team={match.away_team} owner={ownerName(match.away_team_id ?? '')} right />
      </div>
      {match.match_date && (
        <p className="text-xs text-center text-[var(--text-secondary)] mb-3">
          {new Date(match.match_date).toLocaleDateString('es', { dateStyle: 'medium' })}
        </p>
      )}

      {/* Resumen porra */}
      <div className="border-t border-[var(--border)] pt-3 mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">🎯 Tu porra</p>
        {prediction
          ? <p className="text-sm">
              Predijiste <span className="font-bold">{prediction.home_goals}-{prediction.away_goals}</span>{' '}
              {predExact
                ? <span className="text-[var(--green)] font-bold">✓ Acertada</span>
                : <span className="text-[var(--red)]">✗ Fallada</span>}
            </p>
          : <p className="text-sm text-[var(--text-secondary)]">No enviaste porra</p>}
      </div>

      {/* Resumen jugadores */}
      <div className="border-t border-[var(--border)] pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">⭐ Tus jugadores</p>
        {loading
          ? <p className="text-xs text-[var(--text-secondary)]">Cargando…</p>
          : lineup.length === 0
          ? <p className="text-xs text-[var(--text-secondary)]">No elegiste jugadores</p>
          : <div className="space-y-1.5">
              {lineup.map((l, i) => {
                const sp  = l.squad_player
                const pts = playerPts(sp.id)
                const evs = events.filter(e => e.squad_player_id === sp.id)
                return (
                  <div key={i} className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg px-2 py-1.5">
                    <img src={sp.photo_url ?? DEFAULT_PLAYER_IMG} alt="" className="w-7 h-7 rounded-full object-cover shrink-0"
                      onError={e => { (e.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
                    <span className="flex-1 text-sm truncate">{sp.name}</span>
                    <span className="flex gap-0.5 text-xs shrink-0">
                      {evs.map((e, j) => <span key={j}>{EVENT_ICON[e.event_type]}</span>)}
                    </span>
                    {pts !== 0 && (
                      <span className={`text-xs font-bold shrink-0 ${pts < 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                        {pts > 0 ? '+' : ''}{fmtPts(pts)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>}
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
    const match = matches.find(m => m.id === matchId)
    if (match && hasStarted(match)) { alert('El partido ya ha empezado'); return }
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
    const match = matches.find(m => m.id === matchId)
    if (match && hasStarted(match)) { alert('El partido ya ha empezado'); return }
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

  function hasStarted(match: Match) {
    return !!match.match_date && new Date(match.match_date).getTime() <= Date.now()
  }

  function canInteract(match: Match) {
    if (!myId || match.status !== 'scheduled') return false
    if (hasStarted(match)) return false  // bloqueado al empezar el partido
    return myTeamIds.includes(match.home_team_id ?? '') || myTeamIds.includes(match.away_team_id ?? '')
  }

  const [visibleMy, setVisibleMy]       = useState(5)
  const [visibleOther, setVisibleOther] = useState(5)
  const [myView, setMyView]             = useState<'pending' | 'finished'>('pending')

  const allMyMatches    = myId ? matches.filter(m => myTeamIds.includes(m.home_team_id ?? '') || myTeamIds.includes(m.away_team_id ?? '')) : []
  const allOtherMatches = matches.filter(m => !myTeamIds.includes(m.home_team_id ?? '') && !myTeamIds.includes(m.away_team_id ?? ''))
  const pendingMy   = allMyMatches.filter(m => m.status !== 'finished')
  const finishedMy  = allMyMatches.filter(m => m.status === 'finished')
  const myMatches    = pendingMy.slice(0, visibleMy)
  const otherMatches = allOtherMatches.slice(0, visibleOther)

  return (
    <div className="space-y-8">
      {/* Mis partidos */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider">Mis partidos</h2>
          <div className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-0.5">
            {([['pending', `Pendientes (${pendingMy.length})`], ['finished', `Finalizados (${finishedMy.length})`]] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setMyView(v)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  myView === v ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-white'
                }`}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* ── FINALIZADOS ── */}
        {myId && myView === 'finished' && (
          finishedMy.length === 0
            ? <p className="text-[var(--text-secondary)] text-sm">Sin partidos finalizados</p>
            : <div className="space-y-4">
                {finishedMy.map(m => (
                  <FinishedMatchCard key={m.id} match={m} myId={myId}
                    myTeamIds={myTeamIds} prediction={predictions.find(p => p.match_id === m.id)}
                    ownerName={ownerName} />
                ))}
              </div>
        )}

        {/* ── PENDIENTES ── */}
        {!myId
          ? <p className="text-[var(--text-secondary)] text-sm">Cargando…</p>
          : myView !== 'pending'
          ? null
          : myMatches.length === 0
          ? <p className="text-[var(--text-secondary)] text-sm">Sin partidos pendientes</p>
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
                      <TeamBadge team={m.home_team} owner={ownerName(m.home_team_id ?? '')} />
                      {m.status === 'finished'
                        ? <span className="font-black text-xl tabular-nums">{m.home_goals} - {m.away_goals}</span>
                        : <span className="text-[var(--text-secondary)] font-bold text-sm">vs</span>
                      }
                      <TeamBadge team={m.away_team} owner={ownerName(m.away_team_id ?? '')} right />
                    </div>
                    {m.match_date && (
                      <p className="text-xs text-center text-[var(--text-secondary)] mb-3">
                        {new Date(m.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
                        {' · '}{m.match_type === 'group' ? `Grupo ${m.home_team?.group_name ?? ''}` : STAGE_LABELS[m.match_type ?? ''] ?? m.match_type}
                      </p>
                    )}

                    {/* Aviso de bloqueo */}
                    {m.status === 'scheduled' && hasStarted(m) && (
                      <p className="text-xs text-center text-[var(--yellow)] mb-3">
                        🔒 El partido ha empezado — porra y alineación bloqueadas
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
                                            const avatar = sp.photo_url ?? DEFAULT_PLAYER_IMG
                                            return (
                                              <button key={sp.id}
                                                onClick={() => togglePlayer(m.id, teamId, sp.id)}
                                                disabled={disabled}
                                                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition-colors mb-0.5
                                                  ${checked ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'}
                                                  ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-[var(--accent)]/50'}`}>
                                                <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover shrink-0"
                                                  onError={e => { (e.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
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
        {myView === 'pending' && pendingMy.length > visibleMy && (
          <button onClick={() => setVisibleMy(v => v + 5)}
            className="mt-3 w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
            Ver más ({pendingMy.length - visibleMy} restantes)
          </button>
        )}
      </section>

      {/* Todos los partidos */}
      {allOtherMatches.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Otros partidos</h2>
          <div className="space-y-2">
            {otherMatches.map(m => {
              const homeOwner = ownerName(m.home_team_id ?? '')
              const awayOwner = ownerName(m.away_team_id ?? '')
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
  const [view, setView] = useState<'groups' | 'knockout'>('groups')

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
      const h = map[m.home_team_id ?? ''], a = map[m.away_team_id ?? '']
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

  const knockoutMatches = matches.filter(m => m.match_type && m.match_type !== 'group')
  const rounds: { key: string; label: string }[] = [
    { key: 'r32',   label: 'Ronda de 32' },
    { key: 'r16',   label: 'Ronda de 16' },
    { key: 'qf',    label: 'Cuartos de final' },
    { key: 'sf',    label: 'Semifinales' },
    { key: 'third', label: 'Tercer puesto' },
    { key: 'final', label: 'Final' },
  ]

  // ── Resolver slots (1A, 2B, 3º(...)) a equipos según clasificación actual ──
  const slotResolution = useMemo(() => {
    const res: Record<string, GroupRow['team'] | null> = {}

    // 1º y 2º de cada grupo
    for (const [g, rows] of groups) {
      if (rows[0]) res[`1${g}`] = rows[0].team
      if (rows[1]) res[`2${g}`] = rows[1].team
    }

    // Mejores 8 terceros (ranking global)
    const thirds = groups
      .map(([g, rows]) => rows[2] ? { group: g, row: rows[2] } : null)
      .filter((x): x is { group: string; row: GroupRow } => !!x)
      .sort((a, b) =>
        b.row.pts - a.row.pts ||
        (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga) ||
        b.row.gf - a.row.gf
      )
    const qualifiedThirds = thirds.slice(0, 8)

    // Asignación voraz de terceros a los slots "3º(A/B/...)" en orden de partido
    const available = [...qualifiedThirds]
    const r32 = knockoutMatches
      .filter(m => m.match_type === 'r32')
      .sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))

    function resolveThirdSlot(label: string): GroupRow['team'] | null {
      const m = label.match(/3º\(([A-L/]+)\)/)
      if (!m) return null
      const cands = m[1].split('/')
      const idx = available.findIndex(t => cands.includes(t.group))
      if (idx === -1) return null
      const picked = available.splice(idx, 1)[0]
      return picked.row.team
    }

    for (const match of r32) {
      for (const slot of [match.slot_home, match.slot_away]) {
        if (!slot) continue
        if (res[slot] !== undefined) continue
        if (slot.startsWith('3º')) res[slot] = resolveThirdSlot(slot)
      }
    }

    return res
  }, [groups, knockoutMatches])

  // ¿Hay algún resultado de grupos? (para saber si la proyección es significativa)
  const hasGroupResults = matches.some(m => m.match_type === 'group' && m.status === 'finished')

  if (!allTeams.length) return <p className="text-[var(--text-secondary)] text-sm">Cargando…</p>

  return (
    <div className="space-y-4">
      {/* Selector de vista */}
      <div className="flex rounded-xl overflow-hidden border border-[var(--border)]">
        {([['groups', '🏟️ Fase de grupos'], ['knockout', '🏆 Eliminatorias']] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              view === v ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── VISTA GRUPOS ── */}
      {view === 'groups' && groups.map(([groupName, rows]) => (
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
      {view === 'groups' && (
        <p className="text-xs text-[var(--text-secondary)] text-center">● Clasificados (top 2 por grupo)</p>
      )}

      {/* ── VISTA ELIMINATORIAS ── */}
      {view === 'knockout' && knockoutMatches.length === 0 && (
        <p className="text-[var(--text-secondary)] text-sm text-center py-8">
          El cuadro eliminatorio aún no está cargado
        </p>
      )}
      {view === 'knockout' && knockoutMatches.length > 0 && (
        <>
          {hasGroupResults && (
            <p className="text-xs text-center text-[var(--text-secondary)]">
              Cruces proyectados según la clasificación actual · los terceros son aproximados
            </p>
          )}
          <KnockoutBracket
            knockoutMatches={knockoutMatches}
            slotResolution={slotResolution}
            hasGroupResults={hasGroupResults}
          />
        </>
      )}
    </div>
  )
}

// ─── DIAGRAMA DE BRACKET ─────────────────────────────────────

function teamShort(t: { name: string; fifa_code?: string | null }) {
  return t.fifa_code ?? t.name.slice(0, 3).toUpperCase()
}

function KnockoutBracket({ knockoutMatches, slotResolution, hasGroupResults }: {
  knockoutMatches: Match[]
  slotResolution: Record<string, { name: string; flag_emoji: string; fifa_code?: string | null } | null>
  hasGroupResults: boolean
}) {
  const columns: { key: string; label: string }[] = [
    { key: 'r32',   label: 'Ronda de 32' },
    { key: 'r16',   label: 'Octavos' },
    { key: 'qf',    label: 'Cuartos' },
    { key: 'sf',    label: 'Semis' },
    { key: 'final', label: 'Final' },
  ]
  const thirdMatch = knockoutMatches.find(m => m.match_type === 'third')

  function side(team: { name: string; flag_emoji: string; fifa_code?: string | null } | null | undefined, slot: string | null, projected: boolean) {
    if (team) {
      return (
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-sm leading-none">{team.flag_emoji}</span>
          <span className="text-xs font-semibold truncate">{teamShort(team)}</span>
        </span>
      )
    }
    return (
      <span className={`text-[10px] truncate ${projected ? 'italic' : ''} text-[var(--text-secondary)]`}>
        {slot ?? 'TBD'}
      </span>
    )
  }

  function MatchCard({ m }: { m: Match }) {
    const projHome = hasGroupResults && m.slot_home ? slotResolution[m.slot_home] : null
    const projAway = hasGroupResults && m.slot_away ? slotResolution[m.slot_away] : null
    const home = m.home_team ?? projHome
    const away = m.away_team ?? projAway
    const finished = m.status === 'finished'
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg overflow-hidden w-[120px] shrink-0">
        <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-[var(--border)]">
          {side(home, m.slot_home, !m.home_team && !!projHome)}
          <span className="text-xs font-black tabular-nums shrink-0">{finished ? m.home_goals : ''}</span>
        </div>
        <div className="flex items-center justify-between gap-1 px-2 py-1.5">
          {side(away, m.slot_away, !m.away_team && !!projAway)}
          <span className="text-xs font-black tabular-nums shrink-0">{finished ? m.away_goals : ''}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto pb-3 -mx-4 px-4">
      <div className="flex gap-3 min-w-max">
        {columns.map(({ key, label }) => {
          const roundMatches = knockoutMatches
            .filter(m => m.match_type === key)
            .sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))
          if (!roundMatches.length) return null
          return (
            <div key={key} className="flex flex-col">
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 text-center">{label}</p>
              <div className="flex flex-col justify-around gap-2 flex-1">
                {roundMatches.map(m => <MatchCard key={m.id} m={m} />)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tercer puesto */}
      {thirdMatch && (
        <div className="mt-4 flex flex-col items-start">
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Tercer puesto</p>
          <MatchCard m={thirdMatch} />
        </div>
      )}
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

  async function loadKnockout() {
    if (!confirm('¿Cargar el cuadro eliminatorio (32 partidos)? Necesita schema_v5.sql ejecutado.')) return
    setLoadingMatches(true)
    const { data, error } = await supabase.rpc('load_knockout_matches', { p_league_id: league.id })
    if (error) alert(`Error: ${error.message}`)
    else alert(`✅ ${data} partidos eliminatorios cargados`)
    setLoadingMatches(false)
    router.refresh()
  }

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
          <select value={matchType ?? 'group'} onChange={e => setMatchType(e.target.value as NonNullable<Match['match_type']>)}
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
