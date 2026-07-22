'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEFAULT_PLAYER_IMG } from '../../../lib/supabase'
import type {
  League, Player, Score, DraftedTeam, Match, Prediction,
  SquadPlayer, MatchLineup, PlayerEvent,
} from '../../../types'
import RulesModal from '../../../components/RulesModal'
import PushSubscribeButton from '../../../components/PushSubscribeButton'

type Tab = 'standings' | 'my-teams' | 'matches' | 'mundial' | 'avisos' | 'stats' | 'admin'

const STAGE_LABELS: Record<string, string> = { r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', final: 'Final' }
const STAGE_PTS:   Record<string, number>  = { r16: 1, qf: 3, sf: 5, final: 8 }

const LOCK_BEFORE_MS   = 2 * 60 * 60 * 1000   // se bloquea 2h antes
const REMIND_FROM_MS   = 24 * 60 * 60 * 1000  // recordatorio desde 24h antes
const REVEAL_BEFORE_MS = 1 * 60 * 60 * 1000   // porras y jugadores visibles 1h antes

const EVENT_LABELS: Record<string, string> = {
  goal: '⚽ Gol (reglamentario)',
  goal_extra_time: '⚽ Gol (prórroga)',
  penalty_shootout: '🥅 Penalti (tanda)',
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
  const [tab, setTab]               = useState<Tab>('stats')
  const [myId, setMyId]             = useState<string | null>(null)
  const [isAdmin, setIsAdmin]       = useState(false)
  const playerIds = new Set(players.map(p => p.id))
  const [liveScores, setLiveScores] = useState<Score[]>(scores.filter(s => playerIds.has(s.player_id)))
  const [liveMatches, setLiveMatches] = useState<Match[]>(matches)
  const [matchesUpdatedAt, setMatchesUpdatedAt] = useState<Date | null>(null)
  const [, setTick] = useState(0)
  const [showRules, setShowRules]   = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showWrapped, setShowWrapped] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setIsAdmin(user.id === league.admin_user_id)
      const p = players.find(x => x.user_id === user.id)
      if (p) setMyId(p.id)
    })
  }, [league.admin_user_id, players])

  useEffect(() => {
    async function refetchMatches() {
      const { data } = await supabase.from('matches')
        .select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)')
        .or(`league_id.is.null,league_id.eq.${league.id}`).order('match_date')
      if (data) { setLiveMatches(data); setMatchesUpdatedAt(new Date()) }
    }

    const scoresCh = supabase
      .channel(`standings-scores-${league.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `league_id=eq.${league.id}` }, async () => {
        const { data } = await supabase.from('scores').select('*, player:players(*)').eq('league_id', league.id).order('points', { ascending: false })
        if (data) setLiveScores(data.filter(s => playerIds.has(s.player_id)))
      })
      .subscribe()

    const matchesCh = supabase
      .channel(`standings-matches-${league.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, refetchMatches)
      // Cuando llega un gol (player_events INSERT), refrescar también el marcador y la hora del partido
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'player_events' }, refetchMatches)
      .subscribe()

    return () => { supabase.removeChannel(scoresCh); supabase.removeChannel(matchesCh) }
  }, [league.id])

  // Partido activo: live en BD o dentro de la ventana de 210 min desde el kick-off
  const hasLiveMatch = liveMatches.some(m => {
    if (m.status === 'finished') return false
    if (m.status === 'live') return true
    if (!m.match_date) return false
    const elapsed = (Date.now() - new Date(m.match_date).getTime()) / 60000
    return elapsed >= 0 && elapsed <= 210
  })

  // ¿Hay algún partido que empiece en los próximos 30 min?
  const matchSoonMs = liveMatches
    .filter(m => m.status !== 'finished' && m.match_date)
    .reduce((min, m) => {
      const diff = new Date(m.match_date!).getTime() - Date.now()
      return diff > 0 && diff < min ? diff : min
    }, Infinity)
  const hasSoonMatch = matchSoonMs < 30 * 60 * 1000

  // Fallback polling 30s solo durante partidos activos
  useEffect(() => {
    if (!hasLiveMatch) return
    async function fetchMatches() {
      const { data } = await supabase.from('matches')
        .select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)')
        .or(`league_id.is.null,league_id.eq.${league.id}`).order('match_date')
      if (data) { setLiveMatches(data); setMatchesUpdatedAt(new Date()) }
    }
    const t = setInterval(fetchMatches, 30000)
    return () => clearInterval(t)
  }, [hasLiveMatch, league.id])

  // Tick: 30s si hay partido activo o próximo, 5min si no
  useEffect(() => {
    const interval = (hasLiveMatch || hasSoonMatch) ? 30000 : 5 * 60 * 1000
    const t = setInterval(() => setTick(n => n + 1), interval)
    return () => clearInterval(t)
  }, [hasLiveMatch, hasSoonMatch])

  const [unreadAvisos, setUnreadAvisos] = useState(0)

  useEffect(() => {
    const key = `avisos_read_${league.id}`
    const lastRead = localStorage.getItem(key) ?? '1970-01-01'
    supabase.from('announcements').select('id', { count: 'exact', head: true })
      .eq('league_id', league.id).gt('created_at', lastRead)
      .then(({ count }) => setUnreadAvisos(count ?? 0))
  }, [league.id])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'stats',     label: '📊 Stats' },
    { id: 'standings', label: '🏆 Tabla' },
    { id: 'my-teams',  label: '⚽ Mis equipos' },
    { id: 'matches',   label: '📋 Partidos' },
    { id: 'mundial',   label: '🌍 Mundial' },
    { id: 'avisos',    label: unreadAvisos > 0 ? `📣 Avisos (${unreadAvisos})` : '📣 Avisos' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: '⚙️ Admin' }] : []),
  ]

  return (
    <main className="min-h-dvh flex flex-col max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.code}</p>
          <h1 className="text-2xl font-black">{league.name}</h1>
        </div>
        <div className="flex gap-2 shrink-0 mt-1">
          <button onClick={() => setShowRules(true)}
            className="flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-xl px-3 py-2 text-sm font-semibold transition-colors">
            ❓ FAQ
          </button>
          <button onClick={() => router.refresh()}
            className="flex items-center justify-center bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-xl w-10 py-2 text-sm transition-colors">
            🔄
          </button>
          <button onClick={() => setShowSettings(true)}
            className="flex items-center justify-center bg-[var(--bg-surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-xl w-10 py-2 text-sm transition-colors">
            ⚙️
          </button>
        </div>
      </div>

      {showWrapped && myId && (
        <WrappedModal
          leagueId={league.id} players={players} myId={myId}
          scores={liveScores} onClose={() => setShowWrapped(false)}
        />
      )}
      {showRules && <RulesModal onClose={() => setShowRules(false)} wildcardEnabled={league.wildcard_enabled} />}
      <PushSubscribeButton />
      {showSettings && myId && (
        <PlayerSettingsModal
          leagueId={league.id} playerId={myId}
          currentName={players.find(p => p.id === myId)?.name ?? ''}
          isAdmin={isAdmin}
          onClose={() => setShowSettings(false)}
          onLeft={() => router.push('/')}
        />
      )}

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

      {tab === 'standings' && <StandingsTab scores={liveScores} players={players} myId={myId} leagueId={league.id} draftedTeams={draftedTeams} matches={liveMatches} />}
      {tab === 'my-teams'  && <MyTeamsTab myId={myId} draftedTeams={draftedTeams} players={players} leagueId={league.id} matches={liveMatches} />}
      {tab === 'matches'   && (
        <MatchesTab
          matches={liveMatches} leagueId={league.id}
          myId={myId} draftedTeams={draftedTeams}
          updatedAt={matchesUpdatedAt}
          league={league} players={players}
          scores={liveScores}
        />
      )}
      {tab === 'mundial' && <MundialTab matches={liveMatches} draftedTeams={draftedTeams} players={players} />}
      {tab === 'avisos' && (
        <AvisosTab leagueId={league.id} onRead={() => setUnreadAvisos(0)} />
      )}
      {tab === 'stats' && <StatsTab leagueId={league.id} players={players} myId={myId} scores={liveScores} onOpenWrapped={() => setShowWrapped(true)} />}
      {tab === 'admin' && isAdmin && (
        <AdminTab league={league} matches={liveMatches} players={players} router={router} />
      )}
    </main>
  )
}

// ─── CLASIFICACIÓN ───────────────────────────────────────────

interface TieStats { resultPts: number; hits: number; predPts: number; playerPts: number; bonusPts: number; wcPts: number }

type StatPhase = 'all' | 'ko' | 'r16' | 'qf' | 'sf'
const PHASE_OPTIONS: { value: StatPhase; label: string }[] = [
  { value: 'all', label: 'Todo el torneo' },
  { value: 'ko',  label: 'Eliminatorias' },
  { value: 'r16', label: 'Desde octavos' },
  { value: 'qf',  label: 'Desde cuartos' },
  { value: 'sf',  label: 'Desde semis' },
]
const PHASE_TYPES: Record<StatPhase, string[]> = {
  all: ['group','r32','r16','qf','sf','final','third'],
  ko:  ['r32','r16','qf','sf','final','third'],
  r16: ['r16','qf','sf','final','third'],
  qf:  ['qf','sf','final','third'],
  sf:  ['sf','final','third'],
}

interface TopStat { squad_player_id: string; name: string; flag_emoji: string; photo_url: string | null; count: number; shootout?: number }

function StandingsTab({ scores, players, myId, leagueId, draftedTeams, matches }: { scores: Score[]; players: Player[]; myId: string | null; leagueId: string; draftedTeams: DraftedTeam[]; matches: Match[] }) {
  const [breakdownPlayer, setBreakdownPlayer] = useState<Player | null>(null)
  const [tie, setTie] = useState<Record<string, TieStats>>({})
  const [statPhase, setStatPhase] = useState<StatPhase>('all')
  const [statCat,   setStatCat]   = useState<'goals' | 'assists' | 'clean'>('goals')
  const [topScorers,  setTopScorers]  = useState<TopStat[]>([])
  const [topAssists,  setTopAssists]  = useState<TopStat[]>([])
  const [topClean,    setTopClean]    = useState<TopStat[]>([])

  // Estadísticas de desempate desde el libro mayor
  useEffect(() => {
    supabase.from('score_log').select('player_id, category, points').eq('league_id', leagueId)
      .then(({ data }) => {
        const map: Record<string, TieStats> = {}
        for (const r of (data ?? [])) {
          const t = map[r.player_id] ??= { resultPts: 0, hits: 0, predPts: 0, playerPts: 0, bonusPts: 0, wcPts: 0 }
          const pts = Number(r.points)
          if (r.category === 'result') t.resultPts += pts
          if (r.category === 'prediction' || r.category === 'wildcard_prediction') { t.predPts += pts; if (pts > 0) t.hits++ }
          if (r.category === 'player' || r.category === 'wildcard_player') t.playerPts += pts
          if (r.category === 'bonus' || r.category === 'classified') t.bonusPts += pts
          if (r.category === 'wildcard_entry' || r.category === 'wildcard_qualifier') t.wcPts += pts
        }
        setTie(map)
      })
  }, [leagueId, scores])

  useEffect(() => {
    const types = new Set(PHASE_TYPES[statPhase])
    // Construir set de match_ids válidos desde los partidos ya cargados
    const validMatchIds = new Set(
      matches.filter(m => types.has(m.match_type ?? '')).map(m => m.id)
    )
    supabase
      .from('player_events')
      .select('event_type, squad_player_id, match_id, squad_player:squad_player_id(name, photo_url, team:team_id(flag_emoji))')
      .in('event_type', ['goal','goal_extra_time','penalty_shootout','assist','clean_sheet_gk','clean_sheet_def'])
      .then(({ data }) => {
        const filtered = (data ?? []).filter((e: any) => validMatchIds.has(e.match_id))
        type Acc = Record<string, { name: string; flag_emoji: string; photo_url: string | null; count: number }>
        type GoalAcc = Record<string, { name: string; flag_emoji: string; photo_url: string | null; count: number; shootout: number }>
        const goals: GoalAcc = {}, assists: Acc = {}, clean: Acc = {}
        for (const e of filtered) {
          const sp = e.squad_player as any
          if (!sp) continue
          const key = e.squad_player_id
          const base = { name: sp.name, flag_emoji: sp.team?.flag_emoji ?? '', photo_url: sp.photo_url ?? null }
          if (['goal','goal_extra_time'].includes(e.event_type)) {
            goals[key] ??= { ...base, count: 0, shootout: 0 }; goals[key].count++
          }
          if (e.event_type === 'penalty_shootout') {
            goals[key] ??= { ...base, count: 0, shootout: 0 }; goals[key].shootout++
          }
          if (e.event_type === 'assist') {
            assists[key] ??= { ...base, count: 0 }; assists[key].count++
          }
          if (e.event_type === 'clean_sheet_gk') {
            clean[key] ??= { ...base, count: 0 }; clean[key].count++
          }
        }
        const toList = (acc: Acc): TopStat[] =>
          Object.entries(acc).map(([id, v]) => ({ squad_player_id: id, ...v }))
            .sort((a, b) => b.count - a.count).slice(0, 5)
        const scorerList: TopStat[] = Object.entries(goals)
          .map(([id, v]) => ({ squad_player_id: id, ...v }))
          .filter(v => v.count > 0 || v.shootout > 0)
          .sort((a, b) => b.count - a.count || (b.shootout ?? 0) - (a.shootout ?? 0))
          .slice(0, 5)
        setTopScorers(scorerList)
        setTopAssists(toList(assists))
        setTopClean(toList(clean))
      })
  }, [statPhase, matches])
  // Contador de partidos por jugador: jugados / total de sus equipos
  function matchCount(playerId: string): { played: number; total: number } {
    const teamIds = draftedTeams.filter(dt => dt.player_id === playerId).map(dt => dt.team_id)
    const playerMatches = matches.filter(m => teamIds.includes(m.home_team_id ?? '') || teamIds.includes(m.away_team_id ?? ''))
    const played = playerMatches.filter(m => m.status === 'finished').length
    return { played, total: playerMatches.length }
  }

  const entries = players.map(p => ({
    player: p,
    points: Number(scores.find(s => s.player_id === p.id)?.points ?? 0),
    t: tie[p.id] ?? { resultPts: 0, hits: 0, predPts: 0, playerPts: 0, bonusPts: 0, wcPts: 0 },
    mc: matchCount(p.id),
  })).sort((a, b) =>
    b.points - a.points ||
    b.t.hits - a.t.hits ||           // 1º más porras acertadas
    b.t.playerPts - a.t.playerPts    // 2º más puntos de jugadores destacados
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
              {[
                `🎯 ${fmtPts(e.t.predPts)}${e.t.hits ? ` (${e.t.hits}✓)` : ''}`,
                `⚽ ${fmtPts(e.t.resultPts)}`,
                `⭐ ${fmtPts(e.t.playerPts)}`,
                `🏅 ${fmtPts(e.t.bonusPts)}`,
                `🃏 ${fmtPts(e.t.wcPts)}`,
              ].join(' · ')}
            </span>
          </span>
          <span className="text-right">
            <span className="font-black text-lg">{fmtPts(e.points)}</span>
            <span className="text-xs text-[var(--text-secondary)]"> pts</span>
            <span className="block text-[10px] text-[var(--text-secondary)]">{e.mc.played}/{e.mc.total} partidos</span>
          </span>
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

    {/* Estadísticas de jugadores */}
    {(() => {
      const cats = [
        { key: 'goals'  as const, icon: '⚽', label: 'Goleadores',     list: topScorers },
        { key: 'assists'as const, icon: '👟', label: 'Asistentes',     list: topAssists },
        { key: 'clean'  as const, icon: '🧤', label: 'Port. a cero',   list: topClean   },
      ]
      const active = cats.find(c => c.key === statCat)!
      return (
        <div className="mt-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          {/* Header: tabs de categoría + selector de fase */}
          <div className="px-4 pt-3 pb-0 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex gap-1">
                {cats.map(c => (
                  <button key={c.key} onClick={() => setStatCat(c.key)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${statCat === c.key ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'}`}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
              <select
                value={statPhase}
                onChange={e => setStatPhase(e.target.value as StatPhase)}
                className="text-[10px] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-1.5 py-1 text-[var(--text-secondary)]"
              >
                {PHASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {/* Lista */}
          {active.list.length === 0
            ? <p className="text-xs text-[var(--text-secondary)] text-center py-4">Sin datos</p>
            : active.list.map((s, i) => (
              <div key={s.squad_player_id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] last:border-0">
                <span className="w-5 text-center text-xs text-[var(--text-secondary)]">{i + 1}</span>
                <div className="relative shrink-0">
                  <img src={s.photo_url ?? DEFAULT_PLAYER_IMG} alt="" className="w-9 h-9 rounded-full object-cover bg-[var(--bg-elevated)]"
                    onError={ev => { (ev.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
                  <span className="absolute -bottom-1 -right-1 text-xs">{s.flag_emoji}</span>
                </div>
                <span className="flex-1 text-sm font-medium truncate">{s.name}</span>
                {statCat === 'goals'
                  ? <span className="flex items-center gap-1">
                      <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full text-xs font-bold">⚽ {s.count}</span>
                      {(s.shootout ?? 0) > 0 && <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full text-xs text-[var(--text-secondary)]">🥅 {s.shootout}</span>}
                    </span>
                  : <span className="bg-[var(--bg-elevated)] px-2 py-0.5 rounded-full text-xs font-bold">{active.icon} {s.count}</span>
                }
              </div>
            ))
          }
        </div>
      )
    })()}
  </>
  )
}

// ─── DESGLOSE DE PUNTOS ──────────────────────────────────────

interface LogEntry {
  category: string
  points: number
  detail: string | null
  match_id: string | null
  created_at?: string | null
  match?: { match_date?: string; match_type?: string; home_team_id?: string; away_team_id?: string; home_team?: { name: string; flag_emoji: string }; away_team?: { name: string; flag_emoji: string } } | null
}

const CAT_INFO: Record<string, { label: string; icon: string }> = {
  result:              { label: 'Resultados',           icon: '⚽' },
  prediction:          { label: 'Porras',               icon: '🎯' },
  player:              { label: 'Jugadores destacados',  icon: '⭐' },
  bonus:               { label: 'Bonos de clasificación', icon: '🏅' },
  wildcard_entry:      { label: 'Wildcard entrada',      icon: '🃏' },
  wildcard_qualifier:  { label: 'Wildcard clasificado',  icon: '🃏' },
  wildcard_prediction: { label: 'Wildcard porra',        icon: '🃏' },
  wildcard_player:     { label: 'Wildcard jugadores',    icon: '🃏' },
}

type PlayerEventRow = { name: string; events: string[]; pts: number }

function ScoreBreakdownModal({ player, leagueId, total, onClose }: {
  player: Player
  leagueId: string
  total: number
  onClose: () => void
}) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [breakdowns, setBreakdowns] = useState<Record<string, PlayerEventRow[]>>({})
  const [myTeamIds, setMyTeamIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    Promise.all([
      supabase.from('score_log')
        .select('category, points, detail, match_id, created_at, match:matches(match_date, match_type, home_team_id, away_team_id, home_team:teams!matches_home_team_id_fkey(name,flag_emoji), away_team:teams!matches_away_team_id_fkey(name,flag_emoji))')
        .eq('league_id', leagueId).eq('player_id', player.id)
        .order('created_at', { ascending: true })
        .then(r => r),
      supabase.from('drafted_teams').select('team_id')
        .eq('player_id', player.id).eq('league_id', leagueId)
        .then(r => r),
    ]).then(([{ data, error }, { data: dt }]) => {
      if (error) console.error('score_log:', error.message)
      const sorted = (data as any[] ?? [])
        .map(d => ({ ...d, points: Number(d.points) }))
        .sort((a, b) => {
          const da = a.match?.match_date ?? ''
          const db = b.match?.match_date ?? ''
          if (da !== db) return da < db ? -1 : 1
          const ca = a.created_at ?? ''
          const cb = b.created_at ?? ''
          return ca < cb ? -1 : ca > cb ? 1 : 0
        })
      setEntries(sorted)
      setMyTeamIds(new Set((dt ?? []).map((d: any) => d.team_id)))
      setLoading(false)
    })
  }, [leagueId, player.id])

  const EVENT_PTS: Record<string, number> = {
    goal: 1, goal_extra_time: 1, penalty_shootout: 0.5, assist: 0.5,
    clean_sheet_gk: 2, clean_sheet_def: 1, penalty_missed: -0.5,
    penalty_missed_shootout: -0.25, own_goal: -1, red_card: -1,
  }
  const EVENT_ICON_BD: Record<string, string> = {
    goal: '⚽', goal_extra_time: '⚽', penalty_shootout: '🥅', assist: '👟',
    clean_sheet_gk: '🧤', clean_sheet_def: '🛡️', penalty_missed: '❌',
    penalty_missed_shootout: '❌', own_goal: '🥅', red_card: '🟥',
  }

  async function loadBreakdown(matchId: string, isWc: boolean) {
    const key = `${matchId}-${isWc}`
    if (expanded === key) { setExpanded(null); return }
    setExpanded(key)
    if (breakdowns[key]) return
    const [{ data: lineups }, { data: events }] = await Promise.all([
      supabase.from('match_lineups').select('squad_player_id, squad_player:squad_players(name)')
        .eq('match_id', matchId).eq('player_id', player.id).eq('is_wildcard', isWc),
      supabase.from('player_events').select('squad_player_id, event_type')
        .eq('match_id', matchId),
    ])
    const rows: PlayerEventRow[] = (lineups ?? []).map((l: any) => {
      const evs = (events ?? []).filter((e: any) => e.squad_player_id === l.squad_player_id)
      const pts = evs.reduce((s: number, e: any) => s + (EVENT_PTS[e.event_type] ?? 0), 0)
      return { name: l.squad_player?.name ?? '?', events: evs.map((e: any) => EVENT_ICON_BD[e.event_type] ?? ''), pts }
    })
    setBreakdowns(b => ({ ...b, [key]: rows.filter(r => r.pts !== 0) }))
  }

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
          {!loading && entries.length > 0 && (() => {
            const wcCostPts = (byCat.wildcard_entry ?? 0) + (byCat.wildcard_qualifier ?? 0)
            const summaryGroups = [
              { key: 'prediction', ...CAT_INFO.prediction, pts: (byCat.prediction ?? 0) + (byCat.wildcard_prediction ?? 0) },
              { key: 'result',     ...CAT_INFO.result,     pts: byCat.result ?? 0 },
              { key: 'player',     ...CAT_INFO.player,     pts: (byCat.player ?? 0) + (byCat.wildcard_player ?? 0) },
              { key: 'bonus',      ...CAT_INFO.bonus,      pts: (byCat.bonus ?? 0) + (byCat.classified ?? 0) },
              ...(wcCostPts !== 0 ? [{ key: 'wildcard', label: 'Wildcard', icon: '🃏', pts: wcCostPts }] : []),
            ].filter(g => g.pts !== 0)
            return (
              <div className="grid grid-cols-2 gap-2">
                {summaryGroups.map(g => (
                  <div key={g.key} className="flex items-center gap-2 bg-[var(--bg-elevated)] rounded-xl px-3 py-2.5">
                    <span className="text-lg">{g.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider truncate">{g.label}</p>
                      <p className={`font-black ${g.pts < 0 ? 'text-[var(--red)]' : ''}`}>
                        {g.pts > 0 ? '+' : ''}{fmtPts(g.pts)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Detalle por categoría — porras y jugadores wildcard agrupados con los normales */}
          {!loading && (() => {
            type Group = { label: string; icon: string; items: { e: LogEntry; wc: boolean }[] }
            const groups: Group[] = []

            const addGroup = (label: string, icon: string, cats: string[], sortByDate = false) => {
              let items = entries
                .filter(e => cats.includes(e.category))
                .map(e => ({ e, wc: e.category.startsWith('wildcard') }))
              if (sortByDate) {
                items = [...items].sort((a, b) => {
                  const da = a.e.match?.match_date ?? a.e.created_at ?? ''
                  const db = b.e.match?.match_date ?? b.e.created_at ?? ''
                  return da < db ? -1 : da > db ? 1 : 0
                })
              }
              if (items.length) groups.push({ label, icon, items })
            }

            addGroup('Resultados',            '⚽', ['result'])
            addGroup('Porras',                '🎯', ['prediction', 'wildcard_prediction'])
            addGroup('Jugadores destacados',  '⭐', ['player', 'wildcard_player'])
            addGroup('Bonos de clasificación','🏅', ['bonus', 'classified'], true)
            // Wildcard entrada+clasificado: agrupar por partido en una sola línea
            const wcCostEntries = entries.filter(e => ['wildcard_entry','wildcard_qualifier'].includes(e.category))
            if (wcCostEntries.length) {
              const byMatch: Record<string, LogEntry[]> = {}
              for (const e of wcCostEntries) {
                const key = e.match_id ?? 'none'
                byMatch[key] = byMatch[key] ?? []
                byMatch[key].push(e)
              }
              groups.push({
                label: 'Wildcard', icon: '🃏',
                items: Object.values(byMatch).map(es => ({
                  e: es[0],
                  wc: true,
                  extra: es,
                })) as any,
              })
            }

            return groups.map(({ label, icon, items }) => (
              <div key={label}>
                <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5 mt-1">
                  {icon} {label}
                </p>
                <div className="space-y-1">
                  {items.map(({ e, wc, extra }: any, idx: number) => {
                    const m = e.match
                    const NEXT_STAGE: Record<string, string> = { r32: 'Octavos', r16: 'Cuartos', qf: 'Semifinales', sf: 'Final', final: 'Campeón' }
                    const classifiedTeam = e.category === 'classified' && m
                      ? (myTeamIds.has(m.home_team_id) ? m.home_team : m.away_team)
                      : null
                    const noMatchLabel = wc || e.category === 'bonus' || e.category === 'classified'
                    const matchLabel = m
                      ? `${m.home_team?.flag_emoji ?? ''} ${m.home_team?.name ?? ''} - ${m.away_team?.name ?? ''} ${m.away_team?.flag_emoji ?? ''}`.trim()
                      : ''
                    // Wildcard entrada+clasificado: una línea con partido + detalles + pts totales
                    if (extra) {
                      const totalPts = (extra as LogEntry[]).reduce((s: number, x: LogEntry) => s + x.points, 0)
                      const details = (extra as LogEntry[]).map((x: LogEntry) => x.detail).filter(Boolean).join(' · ')
                      return (
                        <div key={idx} className="bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5">
                          {matchLabel && <p className="text-[10px] text-[var(--text-secondary)] truncate mb-0.5">{matchLabel}</p>}
                          <div className="flex items-center gap-2">
                            <span className="flex-1 truncate text-xs">{details}</span>
                            <span className={`font-bold shrink-0 ${totalPts < 0 ? 'text-[var(--red)]' : totalPts === 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--green)]'}`}>
                              {totalPts > 0 ? '+' : ''}{fmtPts(totalPts)}
                            </span>
                          </div>
                        </div>
                      )
                    }
                    const classifiedLabel = classifiedTeam
                      ? `${classifiedTeam.flag_emoji ?? ''} ${classifiedTeam.name} → ${NEXT_STAGE[m?.match_type ?? ''] ?? 'Siguiente ronda'}`.trim()
                      : (e.detail ?? '')
                    const label2 = (wc && (e.category === 'wildcard_prediction' || e.category === 'wildcard_player'))
                      ? `Wildcard: ${matchLabel}`
                      : e.category === 'classified' ? classifiedLabel
                      : noMatchLabel ? (e.detail ?? '') : matchLabel || (e.detail ?? '')
                    const isPlayerCat = e.category === 'player' || e.category === 'wildcard_player'
                    const bdKey = `${e.match_id}-${wc}`
                    const isOpen = expanded === bdKey
                    return (
                      <div key={idx}>
                        <div
                          className={`flex items-center gap-2 bg-[var(--bg-elevated)] rounded-lg px-3 py-1.5 ${isPlayerCat ? 'cursor-pointer' : ''}`}
                          onClick={isPlayerCat && e.match_id ? () => loadBreakdown(e.match_id!, wc) : undefined}
                        >
                          <span className="flex-1 truncate text-xs">
                            {wc && !['wildcard_prediction','wildcard_player'].includes(e.category) && <span className="text-[var(--yellow)] mr-1">🃏</span>}
                            {e.detail && m && !noMatchLabel && !['wildcard_prediction','wildcard_player'].includes(e.category) ? `${e.detail} · ` : ''}{label2}
                          </span>
                          <span className={`font-bold shrink-0 ${e.points < 0 ? 'text-[var(--red)]' : e.points === 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--green)]'}`}>
                            {e.points > 0 ? '+' : ''}{fmtPts(e.points)}
                          </span>
                          {isPlayerCat && <span className="text-[var(--text-secondary)] text-xs">{isOpen ? '▲' : '▼'}</span>}
                        </div>
                        {isPlayerCat && isOpen && breakdowns[bdKey] && (
                          <div className="ml-3 mt-1 space-y-0.5">
                            {breakdowns[bdKey].map((row, i) => (
                              <div key={i} className="flex items-center gap-2 bg-[var(--bg-surface)] rounded-lg px-3 py-1">
                                <span className="flex-1 text-xs truncate">{row.name}</span>
                                <span className="text-xs">{row.events.join(' ')}</span>
                                <span className={`text-xs font-bold shrink-0 ${row.pts < 0 ? 'text-[var(--red)]' : row.pts > 0 ? 'text-[var(--green)]' : 'text-[var(--text-secondary)]'}`}>
                                  {row.pts > 0 ? '+' : ''}{fmtPts(row.pts)}
                                </span>
                              </div>
                            ))}
                            {breakdowns[bdKey].length === 0 && (
                              <p className="text-xs text-[var(--text-secondary)] px-3">Sin jugadores registrados</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          })()}
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
  photo_url?: string | null
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

function isEliminated(teamId: string, matches: Match[]): boolean {
  // Perdió en eliminatorias
  const koLost = matches.some(m => {
    if (!m.match_type || m.match_type === 'group' || m.status !== 'finished') return false
    if (m.home_team_id !== teamId && m.away_team_id !== teamId) return false
    const winner = (m as any).winner_team_id ??
      (m.home_goals != null && m.away_goals != null
        ? m.home_goals > m.away_goals ? m.home_team_id
        : m.away_goals > m.home_goals ? m.away_team_id
        : null : null)
    return winner !== null && winner !== teamId
  })
  if (koLost) return true

  // No clasificó de grupos: 3 partidos de grupo terminados y ningún partido knockout
  const groupDone = matches.filter(m =>
    m.match_type === 'group' && m.status === 'finished' &&
    (m.home_team_id === teamId || m.away_team_id === teamId)
  ).length >= 3
  if (groupDone) {
    const hasKo = matches.some(m =>
      m.match_type && m.match_type !== 'group' &&
      (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    if (!hasKo) return true
  }

  return false
}

function MyTeamsTab({ myId, draftedTeams, players, leagueId, matches }: {
  myId: string | null
  draftedTeams: DraftedTeam[]
  players: Player[]
  leagueId: string
  matches: Match[]
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
                        {teams.map(dt => {
                          const elim = dt.team_id ? isEliminated(dt.team_id, matches) : false
                          return (
                          <button key={dt.id}
                            onClick={() => setExpanded(e => e === dt.team_id ? null : dt.team_id)}
                            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all
                              ${expanded === dt.team_id
                                ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                                : elim
                                ? 'border-[var(--border)] bg-[var(--bg-elevated)] opacity-35 grayscale'
                                : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50'}`}>
                            <span className="text-3xl leading-none">{dt.team?.flag_emoji}</span>
                            <span className="text-xs font-semibold leading-tight line-clamp-2 w-full text-center">{dt.team?.name}</span>
                          </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {currentTeams.map(dt => {
                  const elim = dt.team_id ? isEliminated(dt.team_id, matches) : false
                  return (
                  <button key={dt.id}
                    onClick={() => setExpanded(e => e === dt.team_id ? null : dt.team_id)}
                    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all
                      ${expanded === dt.team_id
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                        : elim
                        ? 'border-[var(--border)] bg-[var(--bg-elevated)] opacity-35 grayscale'
                        : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent)]/50'}`}>
                    <span className="text-3xl leading-none">{dt.team?.flag_emoji}</span>
                    <span className="text-xs font-semibold leading-tight line-clamp-2 w-full text-center">{dt.team?.name}</span>
                  </button>
                  )
                })}
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

// ─── PORRAS Y JUGADORES DE TODOS (visible 1h antes) ──────────

function AllPredictionsReveal({ match, players, leagueId }: {
  match: Match
  players: Player[]
  leagueId: string
}) {
  const [preds, setPreds]     = useState<{ player_id: string; home_goals: number; away_goals: number; is_wildcard: boolean }[]>([])
  const [lineups, setLineups] = useState<{ player_id: string; squad_player_id: string; squad_player: SquadPlayer; is_wildcard: boolean }[]>([])
  const [events, setEvents]   = useState<{ squad_player_id: string; event_type: string }[]>([])
  const [wcEntries, setWcEntries] = useState<{ player_id: string; qualifier_pick: string | null; cost_charged: boolean }[]>([])
  const [open, setOpen]       = useState(false)
  const [loaded, setLoaded]   = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    Promise.all([
      supabase.from('predictions').select('player_id, home_goals, away_goals, is_wildcard')
        .eq('match_id', match.id),
      supabase.from('match_lineups').select('player_id, squad_player_id, squad_player:squad_players(*), is_wildcard')
        .eq('match_id', match.id),
      supabase.from('player_events').select('squad_player_id, event_type')
        .eq('match_id', match.id),
      supabase.from('wildcard_entries').select('player_id, qualifier_pick, cost_charged')
        .eq('match_id', match.id).eq('league_id', leagueId),
    ]).then(([pr, lu, ev, wc]) => {
      setPreds((pr.data as any[]) ?? [])
      setLineups((lu.data as any[]) ?? [])
      setEvents((ev.data as any[]) ?? [])
      setWcEntries((wc.data as any[]) ?? [])
      setLoaded(true)
    })
  }, [open, loaded, match.id, leagueId])

  const playerName = (id: string) => players.find(p => p.id === id)?.name ?? '?'

  // qualifier_pick team name: look up in match teams
  function qualifierName(teamId: string | null) {
    if (!teamId) return '?'
    if (teamId === match.home_team_id) return match.home_team?.name ?? match.slot_home ?? '?'
    if (teamId === match.away_team_id) return match.away_team?.name ?? match.slot_away ?? '?'
    return '?'
  }

  // winner team id (in 90' or via winner_team_id for KO draws)
  const winnerTeamId: string | null = match.status === 'finished'
    ? ((match as any).winner_team_id ?? (
        match.home_goals != null && match.away_goals != null
          ? match.home_goals > match.away_goals ? match.home_team_id
          : match.away_goals > match.home_goals ? match.away_team_id
          : null
          : null
      ))
    : null

  // All players who participated (regular or wildcard)
  const regularPlayers = players.filter(pl =>
    preds.some(p => p.player_id === pl.id && !p.is_wildcard) ||
    lineups.some(l => l.player_id === pl.id && !l.is_wildcard)
  )
  const wildcardPlayers = wcEntries.map(wc => players.find(p => p.id === wc.player_id)).filter(Boolean) as Player[]

  function renderLineup(plId: string, isWc: boolean) {
    const plLineup = lineups.filter(l => l.player_id === plId && l.is_wildcard === isWc)
    if (!plLineup.length) return null
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {plLineup.map((l, i) => {
          const evs     = events.filter(e => e.squad_player_id === l.squad_player_id)
          const hasGoal = evs.some(e => ['goal', 'goal_extra_time', 'penalty_shootout', 'assist', 'clean_sheet_gk', 'clean_sheet_def'].includes(e.event_type))
          const hasBad  = evs.some(e => ['own_goal', 'red_card', 'penalty_missed', 'penalty_missed_shootout'].includes(e.event_type))
          const cls     = hasBad ? 'bg-red-900/40 border border-[var(--red)]' : hasGoal ? 'bg-green-900/40 border border-[var(--green)]' : 'bg-[var(--bg-surface)]'
          return (
            <span key={i} className={`text-[11px] px-2 py-0.5 rounded-lg ${cls}`}>
              {l.squad_player.name}
            </span>
          )
        })}
      </div>
    )
  }

  const isKo = match.match_type && match.match_type !== 'group'

  return (
    <div className="border-t border-[var(--border)] mt-3 pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-white transition-colors"
      >
        <span>👁 Porras y jugadores</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* Regular players */}
          {regularPlayers.map(pl => {
            const pred = preds.find(p => p.player_id === pl.id && !p.is_wildcard)
            return (
              <div key={pl.id} className="bg-[var(--bg-elevated)] rounded-xl px-3 py-2">
                <p className="text-xs font-bold mb-1.5">{pl.name}</p>
                {pred && (
                  <p className="text-xs text-[var(--text-secondary)] mb-1">
                    🎯 Porra: <span className="text-white font-semibold">{pred.home_goals} - {pred.away_goals}</span>
                    {match.status === 'finished' && match.home_goals !== null && (
                      pred.home_goals === match.home_goals && pred.away_goals === match.away_goals
                        ? <span className="text-[var(--green)] ml-1">✓</span>
                        : <span className="text-[var(--red)] ml-1">✗</span>
                    )}
                  </p>
                )}
                {renderLineup(pl.id, false)}
              </div>
            )
          })}

          {/* Wildcard players */}
          {wildcardPlayers.map(pl => {
            const wc   = wcEntries.find(e => e.player_id === pl.id)!
            const pred = preds.find(p => p.player_id === pl.id && p.is_wildcard)
            const qName = qualifierName(wc.qualifier_pick)
            const qCorrect = match.status === 'finished' && wc.qualifier_pick && winnerTeamId
              ? wc.qualifier_pick === winnerTeamId
              : null
            return (
              <div key={pl.id} className="bg-[var(--bg-elevated)] border border-[var(--yellow)]/30 rounded-xl px-3 py-2">
                <p className="text-xs font-bold mb-1.5">🃏 {pl.name} <span className="text-[var(--yellow)] font-normal">wildcard</span></p>
                {isKo && (
                  <p className="text-xs text-[var(--text-secondary)] mb-1">
                    🏆 Clasificado: <span className="text-white font-semibold">{qName}</span>
                    {qCorrect === true && <span className="text-[var(--green)] ml-1">✓</span>}
                    {qCorrect === false && <span className="text-[var(--red)] ml-1">✗</span>}
                  </p>
                )}
                {pred && (
                  <p className="text-xs text-[var(--text-secondary)] mb-1">
                    🎯 Porra: <span className="text-white font-semibold">{pred.home_goals} - {pred.away_goals}</span>
                    {match.status === 'finished' && match.home_goals !== null && (
                      pred.home_goals === match.home_goals && pred.away_goals === match.away_goals
                        ? <span className="text-[var(--green)] ml-1">✓</span>
                        : <span className="text-[var(--red)] ml-1">✗</span>
                    )}
                  </p>
                )}
                {renderLineup(pl.id, true)}
              </div>
            )
          })}

          {regularPlayers.length === 0 && wildcardPlayers.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">Nadie ha enviado porra o jugadores aún</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RESUMEN DE PARTIDO FINALIZADO ───────────────────────────

function FinishedMatchCard({ match, myId, myTeamIds, prediction, ownerName, players, leagueId }: {
  match: Match
  myId: string
  myTeamIds: string[]
  prediction?: Prediction
  ownerName: (teamId: string) => string | null
  players: Player[]
  leagueId: string
}) {
  const [open, setOpen] = useState(false)
  const [lineup, setLineup] = useState<{ team_id: string; squad_player: SquadPlayer }[]>([])
  const [events, setEvents] = useState<PlayerEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [myWcEntry, setMyWcEntry] = useState<boolean | null>(null)

  const isKo = match.match_type && match.match_type !== 'group'
  const hadMyTeam = myTeamIds.includes(match.home_team_id ?? '') || myTeamIds.includes(match.away_team_id ?? '')

  function toggle() {
    setOpen(o => {
      if (!o && !loaded) {
        setLoading(true)
        Promise.all([
          supabase.from('match_lineups')
            .select('team_id, squad_player:squad_players(*)')
            .eq('match_id', match.id).eq('player_id', myId).then(r => r),
          supabase.from('player_events').select('*').eq('match_id', match.id).then(r => r),
          isKo && !hadMyTeam
            ? supabase.from('wildcard_entries').select('id')
                .eq('match_id', match.id).eq('league_id', leagueId).eq('player_id', myId).then(r => r)
            : Promise.resolve(null),
        ]).then(([lu, ev, wc]) => {
          setLineup(((lu as any).data as any[]) ?? [])
          setEvents(((ev as any).data as PlayerEvent[]) ?? [])
          if (wc !== null) setMyWcEntry(((wc as any).data?.length ?? 0) > 0)
          setLoading(false)
          setLoaded(true)
        })
      }
      return !o
    })
  }

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
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      {/* Cabecera siempre visible — clic para expandir */}
      <button onClick={toggle} className="w-full p-4 text-left">
        <div className="flex items-center justify-between mb-1">
          <TeamBadge team={match.home_team} owner={ownerName(match.home_team_id ?? '')} />
          <span className="font-black text-xl tabular-nums">{match.home_goals} - {match.away_goals}</span>
          <TeamBadge team={match.away_team} owner={ownerName(match.away_team_id ?? '')} right />
        </div>
        <div className="flex items-center justify-between mt-1">
          {match.match_date
            ? <p className="text-xs text-[var(--text-secondary)]">
                {new Date(match.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' } as any)}
              </p>
            : <span />}
          <div className="flex items-center gap-1.5">
            {isKo && !hadMyTeam && myWcEntry !== null && (
              myWcEntry
                ? <span className="text-[10px] bg-green-900/30 text-[var(--green)] border border-[var(--green)]/40 px-1.5 py-0.5 rounded-full font-medium">🃏 Wildcard</span>
                : <span className="text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border)] px-1.5 py-0.5 rounded-full">Sin wildcard</span>
            )}
            <span className="text-xs text-[var(--text-secondary)]">{open ? '▲' : '▼'}</span>
          </div>
        </div>
      </button>

      {/* Detalle: porra, eventos, jugadores */}
      {open && (
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-3">
          {/* Resumen porra */}
          <div>
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

          {/* Eventos del partido */}
          <FinishedMatchEvents matchId={match.id} homeTeamId={match.home_team_id} />

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
                    const hasGoal = evs.some(e => ['goal', 'goal_extra_time', 'penalty_shootout', 'assist', 'clean_sheet_gk', 'clean_sheet_def'].includes(e.event_type))
                    const hasBad  = evs.some(e => ['own_goal', 'red_card', 'penalty_missed', 'penalty_missed_shootout'].includes(e.event_type))
                    const rowCls  = hasBad ? 'bg-red-900/30 border border-[var(--red)]' : hasGoal ? 'bg-green-900/30 border border-[var(--green)]' : 'bg-[var(--bg-elevated)]'
                    return (
                      <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${rowCls}`}>
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

          <AllPredictionsReveal match={match} players={players} leagueId={leagueId} />
        </div>
      )}
    </div>
  )
}

// ─── PARTIDOS + LINEUP ────────────────────────────────────────

function MatchesTab({
  matches, leagueId, myId, draftedTeams, updatedAt, league, players, scores,
}: {
  matches: Match[]
  leagueId: string
  myId: string | null
  draftedTeams: DraftedTeam[]
  updatedAt: Date | null
  league: League
  players: Player[]
  scores: Score[]
}) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [localGoals, setLocalGoals]   = useState<Record<string, string>>({})
  const [visitorGoals, setVisitorGoals] = useState<Record<string, string>>({})
  const [saving, setSaving]           = useState<string | null>(null)
  const [savedPred, setSavedPred]     = useState<string | null>(null)

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
      .then(({ data }) => {
        if (!data) return
        setPredictions(data)
        const newLocal: Record<string, string> = {}
        const newVisitor: Record<string, string> = {}
        data.forEach(p => {
          newLocal[p.match_id] = String(p.home_goals)
          newVisitor[p.match_id] = String(p.away_goals)
        })
        setLocalGoals(newLocal)
        setVisitorGoals(newVisitor)
      })
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

  // Precargar squads de los equipos del usuario para mostrar nombres en el preview
  useEffect(() => {
    if (myTeamIds.length === 0) return
    myTeamIds.forEach(teamId => {
      supabase.from('squad_players').select('*')
        .eq('team_id', teamId).order('position').order('shirt_number')
        .then(({ data }) => {
          if (data) setSquadPlayers(prev => ({ ...prev, [teamId]: data }))
        })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeamIds.join(',')])

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
    if (match && isLocked(match)) { alert('Cerrado: el partido empieza en menos de 2 horas'); return }
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
    if (match && isLocked(match)) { alert('Cerrado: el partido empieza en menos de 2 horas'); return }
    const h = parseInt(localGoals[matchId] ?? '')
    const a = parseInt(visitorGoals[matchId] ?? '')
    if (isNaN(h) || isNaN(a)) { alert('Introduce goles válidos'); return }
    setSaving(matchId)
    await supabase.from('predictions').upsert(
      { match_id: matchId, player_id: myId, home_goals: h, away_goals: a },
      { onConflict: 'match_id,player_id' }
    )
    const { data } = await supabase.from('predictions').select('*').eq('player_id', myId)
    if (data) {
      setPredictions(data)
      // Sincronizar inputs con los valores guardados
      const newLocal: Record<string, string> = {}
      const newVisitor: Record<string, string> = {}
      data.forEach(p => {
        newLocal[p.match_id] = String(p.home_goals)
        newVisitor[p.match_id] = String(p.away_goals)
      })
      setLocalGoals(prev => ({ ...prev, ...newLocal }))
      setVisitorGoals(prev => ({ ...prev, ...newVisitor }))
    }
    setSaving(null)
    setSavedPred(matchId)
    setTimeout(() => setSavedPred(null), 2000)
  }

  function ownerName(teamId: string) {
    const dt = draftedTeams.find(d => d.team_id === teamId)
    return dt?.player?.name ?? null
  }

  // ── Estado en vivo ──────────────────────────────────────────
  function matchLiveState(match: Match): 'upcoming' | 'live' | 'halftime' | 'finished' {
    if (match.status === 'finished') return 'finished'
    if (match.status === 'live') return 'live'
    if (!match.match_date) return 'upcoming'
    const elapsed = (Date.now() - new Date(match.match_date).getTime()) / 60000
    if (elapsed < 0) return 'upcoming'
    // Si han pasado más de 120 min y la BD no lo marca como live/finished, no mostrarlo como en juego
    if (elapsed > 120) return 'upcoming'
    if (elapsed >= 45 && elapsed < 60) return 'halftime'
    return 'live'
  }

  function matchMinute(match: Match): number {
    if (!match.match_date) return 0
    const elapsed = (Date.now() - new Date(match.match_date).getTime()) / 60000
    if (elapsed >= 60) return Math.min(Math.floor(elapsed - 15), 90)
    return Math.min(Math.floor(elapsed), 45)
  }

  // Se bloquea 2h antes del inicio del partido
  function isLocked(match: Match) {
    if (!match.match_date) return false
    return new Date(match.match_date).getTime() - LOCK_BEFORE_MS <= Date.now()
  }

  function canInteract(match: Match) {
    if (!myId || match.status !== 'scheduled') return false
    if (isLocked(match)) return false
    return myTeamIds.includes(match.home_team_id ?? '') || myTeamIds.includes(match.away_team_id ?? '')
  }

  function isRevealed(match: Match) {
    if (match.status === 'finished') return true
    if (!match.match_date) return false
    return new Date(match.match_date).getTime() - REVEAL_BEFORE_MS <= Date.now()
  }

  const [visibleMy, setVisibleMy]             = useState(5)
  const [visibleOther, setVisibleOther]       = useState(5)
  const [visibleOtherDone, setVisibleOtherDone] = useState(5)
  const [myView, setMyView]             = useState<'pending' | 'finished'>('pending')
  const [openMatches, setOpenMatches]   = useState<Record<string, boolean>>({})
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000) // rerender cada 30s
    return () => clearInterval(t)
  }, [])

  const allMyMatches    = myId ? matches.filter(m => myTeamIds.includes(m.home_team_id ?? '') || myTeamIds.includes(m.away_team_id ?? '')) : []
  const allOtherMatches    = matches.filter(m => !myTeamIds.includes(m.home_team_id ?? '') && !myTeamIds.includes(m.away_team_id ?? ''))
  const pendingMy          = allMyMatches.filter(m => m.status !== 'finished')
  const byDateAsc  = (a: Match, b: Match) => new Date(a.match_date ?? 0).getTime() - new Date(b.match_date ?? 0).getTime()
  const byDateDesc = (a: Match, b: Match) => new Date(b.match_date ?? 0).getTime() - new Date(a.match_date ?? 0).getTime()
  const finishedMy         = allMyMatches.filter(m => m.status === 'finished').sort(byDateDesc)
  const pendingOther       = allOtherMatches.filter(m => m.status !== 'finished').sort(byDateAsc)
  const finishedOther      = allOtherMatches.filter(m => m.status === 'finished').sort(byDateDesc)
  const myMatches          = pendingMy.slice(0, visibleMy)
  const otherMatches       = allOtherMatches.slice(0, visibleOther)

  // Recordatorios: partidos en ventana 24h–2h sin porra o sin alineación completa
  const reminders = pendingMy.filter(m => {
    if (!m.match_date) return false
    const start = new Date(m.match_date).getTime()
    const now = Date.now()
    if (start - LOCK_BEFORE_MS <= now) return false   // ya bloqueado
    if (start - REMIND_FROM_MS > now) return false    // aún falta más de 24h
    const noPorra = !predictions.find(p => p.match_id === m.id)
    const myTeamsHere = myTeamIds.filter(id => id === m.home_team_id || id === m.away_team_id)
    const noLineup = myTeamsHere.some(tid => (lineups[`${m.id}-${tid}`]?.length ?? 0) < 3)
    return noPorra || noLineup
  })

  function OtherMatchCard({ m }: { m: Match }) {
    const homeOwner = ownerName(m.home_team_id ?? '')
    const awayOwner = ownerName(m.away_team_id ?? '')
    const state = matchLiveState(m)
    const [open, setOpen] = useState(false)

    const isKoMatch = league.wildcard_enabled && m.match_type && m.match_type !== 'group'
    const isEligibleWc = isKoMatch && myId &&
      m.home_team_id && m.away_team_id &&
      !myTeamIds.includes(m.home_team_id) && !myTeamIds.includes(m.away_team_id)

    function toggle() {
      setOpen(o => !o)
    }

    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        <button onClick={toggle} className="w-full px-4 py-3 text-left">
          <div className="flex items-center gap-3">
            <span className="text-lg">{m.home_team?.flag_emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{m.home_team?.name}</p>
              {homeOwner && <p className="text-xs text-[var(--text-secondary)] truncate">{homeOwner}</p>}
            </div>
            <div className="flex flex-col items-center shrink-0">
              {state === 'finished' ? (
                <span className="font-black tabular-nums text-sm">{m.home_goals} - {m.away_goals}</span>
              ) : state === 'live' ? (
                <>
                  <span className="font-black tabular-nums text-sm">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                  <span className="text-[9px] font-bold text-red-400 animate-pulse"><LiveClock matchDate={m.match_date!} matchClock={m.match_clock} /></span>
                </>
              ) : state === 'halftime' ? (
                <>
                  <span className="font-black tabular-nums text-sm">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                  <span className="text-[9px] font-bold text-[var(--yellow)]">DESC.</span>
                </>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="text-[var(--text-secondary)] font-bold text-sm">vs</span>
                  {m.match_date && (
                    <span className="text-[9px] text-[var(--text-secondary)]">
                      {new Date(m.match_date).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-sm font-medium truncate">{m.away_team?.name}</p>
              {awayOwner && <p className="text-xs text-[var(--text-secondary)] truncate">{awayOwner}</p>}
            </div>
            <span className="text-lg">{m.away_team?.flag_emoji}</span>
          </div>
          <div className="flex items-center justify-end mt-1.5">
            <span className="text-xs text-[var(--text-secondary)]">{open ? '▲' : '▼'}</span>
          </div>
        </button>

        {/* Wildcard siempre visible (fuera del toggle) */}
        {isEligibleWc && m.status !== 'finished' && (
          <div className="px-4 pb-3 border-t border-[var(--border)]">
            <WildcardButton match={m} leagueId={leagueId} myId={myId!} scores={scores} />
          </div>
        )}

        {open && (
          <div className="border-t border-[var(--border)] px-4 pb-3 pt-2">
            {(state === 'live' || state === 'halftime' || m.status === 'finished') && (
              <LiveMatchEvents matchId={m.id} homeTeamId={m.home_team_id} isLive={state === 'live' || state === 'halftime'} />
            )}
            {isKoMatch && isRevealed(m) && (
              <WildcardParticipants matchId={m.id} leagueId={leagueId} players={players} />
            )}
            {isRevealed(m) && (
              <AllPredictionsReveal match={m} players={players} leagueId={league.id} />
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {updatedAt && matches.some(m => matchLiveState(m) === 'live' || matchLiveState(m) === 'halftime') && (
        <p className="text-[10px] text-center text-[var(--text-muted)] -mb-4">
          Última actualización: {updatedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      {/* Recordatorios */}
      {reminders.length > 0 && (
        <div className="bg-[var(--yellow)]/10 border border-[var(--yellow)]/40 rounded-2xl p-4">
          <p className="text-sm font-bold text-[var(--yellow)] mb-1">⏰ Tienes {reminders.length} partido{reminders.length > 1 ? 's' : ''} sin completar</p>
          <p className="text-xs text-[var(--text-secondary)] mb-2">Envía porra y jugadores antes de 2h previas al inicio.</p>
          <div className="space-y-1">
            {reminders.map(m => (
              <p key={m.id} className="text-xs flex items-center gap-2">
                <span>{m.home_team?.flag_emoji} {m.home_team?.name} vs {m.away_team?.name} {m.away_team?.flag_emoji}</span>
                <span className="text-[var(--text-secondary)] ml-auto">
                  {m.match_date && new Date(m.match_date).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

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
                    ownerName={ownerName} players={players} leagueId={leagueId} />
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
                const isOpen = !!openMatches[m.id]
                const toggleMatch = () => setOpenMatches(o => ({ ...o, [m.id]: !o[m.id] }))
                const state = matchLiveState(m)
                // Distintivo: partido editable sin porra o sin jugadores elegidos
                const missingPred = able && !myPred
                const missingLineup = able && [...myHomeTeams, ...myAwayTeams].some(teamId => {
                  const key = `${m.id}-${teamId}`
                  return (lineups[key] ?? []).length === 0
                })
                const incomplete = missingPred || missingLineup
                return (
                  <div key={m.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
                    {/* Cabecera partido — siempre visible */}
                    <button onClick={toggleMatch} className="w-full p-4 text-left">
                      <div className="flex items-center justify-between mb-1">
                        <TeamBadge team={m.home_team} owner={ownerName(m.home_team_id ?? '')} />
                        <div className="flex flex-col items-center gap-0.5">
                          {(() => {
                            if (state === 'finished') return <span className="font-black text-xl tabular-nums">{m.home_goals} - {m.away_goals}</span>
                            if (state === 'live') return (
                              <>
                                <span className="font-black text-xl tabular-nums">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                                <span className="text-[10px] font-bold text-red-400 animate-pulse"><LiveClock matchDate={m.match_date!} matchClock={m.match_clock} /></span>
                              </>
                            )
                            if (state === 'halftime') return (
                              <>
                                <span className="font-black text-xl tabular-nums">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                                <span className="text-[10px] font-bold text-[var(--yellow)]">DESCANSO</span>
                              </>
                            )
                            return <span className="text-[var(--text-secondary)] font-bold text-sm">vs</span>
                          })()}
                        </div>
                        <TeamBadge team={m.away_team} owner={ownerName(m.away_team_id ?? '')} right />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        {m.match_date
                          ? <p className="text-xs text-[var(--text-secondary)]">
                              {state === 'live'
                                ? <span className="text-red-400 font-semibold">🔴 EN VIVO</span>
                                : state === 'halftime'
                                ? <span className="text-[var(--yellow)] font-semibold">⏸ Descanso</span>
                                : new Date(m.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' } as any)
                              }
                              {' · '}{m.match_type === 'group' ? `Grupo ${m.home_team?.group_name ?? ''}` : STAGE_LABELS[m.match_type ?? ''] ?? m.match_type}
                            </p>
                          : <span />}
                        <div className="flex items-center gap-1.5">
                          {incomplete && (
                            <span className="flex gap-1">
                              {missingPred && <span className="text-[10px] bg-[var(--yellow)]/20 text-[var(--yellow)] border border-[var(--yellow)]/40 px-1.5 py-0.5 rounded-full font-medium">Sin porra</span>}
                              {missingLineup && <span className="text-[10px] bg-[var(--yellow)]/20 text-[var(--yellow)] border border-[var(--yellow)]/40 px-1.5 py-0.5 rounded-full font-medium">Sin jugadores</span>}
                            </span>
                          )}
                          <span className="text-xs text-[var(--text-secondary)]">{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </div>
                    </button>

                    {/* Contenido expandible */}
                    {isOpen && (
                    <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">

                    {/* Eventos en vivo y finalizados */}
                    {(state === 'live' || state === 'halftime' || m.status === 'finished') && (
                      <LiveMatchEvents matchId={m.id} homeTeamId={m.home_team_id} isLive={state === 'live' || state === 'halftime'} />
                    )}

                    {/* Wildcard */}
                    {league.wildcard_enabled && m.match_type && m.match_type !== 'group' && m.status !== 'finished' && myId &&
                      !myTeamIds.includes(m.home_team_id ?? '') && !myTeamIds.includes(m.away_team_id ?? '') && (
                      <WildcardButton match={m} leagueId={leagueId} myId={myId} scores={scores} />
                    )}
                    {league.wildcard_enabled && m.match_type && m.match_type !== 'group' && isRevealed(m) && (
                      <WildcardParticipants matchId={m.id} leagueId={leagueId} players={players} />
                    )}

                    {/* Porras y jugadores de todos — visible 1h antes */}
                    {isRevealed(m) && (
                      <AllPredictionsReveal match={m} players={players} leagueId={league.id} />
                    )}

                    {/* Aviso de bloqueo */}
                    {m.status === 'scheduled' && isLocked(m) && (
                      <p className="text-xs text-center text-[var(--yellow)] mb-3">
                        🔒 Cerrado — la porra y la alineación se bloquean 2h antes del partido
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
                              value={localGoals[m.id] ?? ''}
                              onChange={e => setLocalGoals(p => ({ ...p, [m.id]: e.target.value }))}
                              className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]" />
                            <span className="text-[var(--text-secondary)]">-</span>
                            <input type="number" min="0" max="20"
                              value={visitorGoals[m.id] ?? ''}
                              onChange={e => setVisitorGoals(p => ({ ...p, [m.id]: e.target.value }))}
                              className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]" />
                            <button onClick={() => submitPrediction(m.id)} disabled={saving === m.id}
                              className={`ml-auto px-3 py-1.5 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors ${
                                savedPred === m.id ? 'bg-[var(--green)] text-black' : 'bg-[var(--accent)] text-white'
                              }`}>
                              {saving === m.id ? '…' : savedPred === m.id ? '✓ Guardado' : 'Guardar'}
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
                  )}
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

      {/* Otros partidos: próximos primero, finalizados aparte */}
      {allOtherMatches.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider">Otros partidos</h2>

          {/* Próximos / en juego */}
          {pendingOther.length > 0 && (
            <>
              <div className="space-y-2">
                {pendingOther.slice(0, visibleOther).map(m => <OtherMatchCard key={m.id} m={m} />)}
              </div>
              {pendingOther.length > visibleOther && (
                <button onClick={() => setVisibleOther(v => v + 5)}
                  className="w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
                  Ver más próximos ({pendingOther.length - visibleOther} restantes)
                </button>
              )}
            </>
          )}

          {/* Finalizados */}
          {finishedOther.length > 0 && (
            <>
              <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mt-2">Finalizados</p>
              <div className="space-y-2">
                {finishedOther.slice(0, visibleOtherDone).map(m => <OtherMatchCard key={m.id} m={m} />)}
              </div>
              {finishedOther.length > visibleOtherDone && (
                <button onClick={() => setVisibleOtherDone(v => v + 5)}
                  className="w-full py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border)] rounded-xl transition-colors">
                  Ver más finalizados ({finishedOther.length - visibleOtherDone} restantes)
                </button>
              )}
            </>
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

function MundialTab({ matches, draftedTeams, players }: { matches: Match[]; draftedTeams: DraftedTeam[]; players: Player[] }) {
  const [allTeams, setAllTeams] = useState<import('../../../types').Team[]>([])
  const [view, setView] = useState<'groups' | 'knockout'>('knockout')

  const ownerMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const dt of draftedTeams) {
      const name = players.find(p => p.id === dt.player_id)?.name
      if (name) m[dt.team_id] = name
    }
    return m
  }, [draftedTeams, players])

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
      g[name].sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || b.w - a.w)
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

    // Grupos elegibles para ser mejores terceros (solo los que aparecen en algún slot del bracket)
    const eligibleGroups = new Set<string>()
    for (const m of knockoutMatches) {
      for (const slot of [m.slot_home, m.slot_away]) {
        const mm = slot?.match(/3º\(([A-Z/]+)\)/)
        if (mm) mm[1].split('/').forEach(g => eligibleGroups.add(g))
      }
    }

    // Mejores 8 terceros (ranking global), solo de grupos elegibles
    const thirds = groups
      .map(([g, rows]) => rows[2] && (eligibleGroups.size === 0 || eligibleGroups.has(g)) ? { group: g, row: rows[2] } : null)
      .filter((x): x is { group: string; row: GroupRow } => !!x)
      .sort((a, b) =>
        b.row.pts - a.row.pts ||
        (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga) ||
        b.row.gf - a.row.gf ||
        b.row.w - a.row.w
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
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {i < 2 && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />}
                      {i >= 2 && <span className="w-1.5 h-1.5 shrink-0" />}
                      <span className="text-base leading-none">{row.team.flag_emoji}</span>
                      <div className="min-w-0">
                        <span className="font-medium truncate block">{row.team.name}</span>
                        {ownerMap[row.team.id] && (
                          <span className="text-[10px] text-[var(--text-secondary)] truncate block">{ownerMap[row.team.id]}</span>
                        )}
                      </div>
                    </div>
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

          <KnockoutBracket
            knockoutMatches={knockoutMatches}
            slotResolution={slotResolution}
            ownerMap={ownerMap}
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

function KnockoutBracket({ knockoutMatches, slotResolution, ownerMap }: {
  knockoutMatches: Match[]
  slotResolution: Record<string, { name: string; flag_emoji: string; fifa_code?: string | null; id?: string } | null>
  ownerMap: Record<string, string>
}) {
  const columns: { key: string; label: string }[] = [
    { key: 'r32',   label: 'Ronda de 32' },
    { key: 'r16',   label: 'Octavos' },
    { key: 'qf',    label: 'Cuartos' },
    { key: 'sf',    label: 'Semis' },
    { key: 'final', label: 'Final' },
  ]
  const thirdMatch = knockoutMatches.find(m => m.match_type === 'third')

  function side(team: { name: string; flag_emoji: string; fifa_code?: string | null; id?: string } | null | undefined, slot: string | null, projected: boolean) {
    if (team) {
      const owner = team.id ? ownerMap[team.id] : undefined
      return (
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-sm leading-none shrink-0">{team.flag_emoji}</span>
          <span className="flex flex-col min-w-0">
            <span className="text-xs font-semibold truncate leading-tight">{teamShort(team)}</span>
            {owner && <span className="text-[9px] text-[var(--text-secondary)] truncate leading-tight">{owner}</span>}
          </span>
        </span>
      )
    }
    if (slot?.startsWith('r32:')) {
      const r32Id = slot.slice(4)
      const r32m = knockoutMatches.find(m => m.id === r32Id)
      if (r32m) {
        const h = r32m.home_team
        const a = r32m.away_team
        if (h && a) {
          return (
            <span className="text-[10px] text-[var(--text-secondary)] flex items-center gap-0.5 leading-none">
              <span>{h.flag_emoji}</span>
              <span className="font-medium">{h.fifa_code ?? h.name.slice(0,3).toUpperCase()}</span>
              <span>/</span>
              <span>{a.flag_emoji}</span>
              <span className="font-medium">{a.fifa_code ?? a.name.slice(0,3).toUpperCase()}</span>
            </span>
          )
        }
      }
    }
    return (
      <span className={`text-[10px] truncate ${projected ? 'italic' : ''} text-[var(--text-secondary)]`}>
        {slot ?? 'TBD'}
      </span>
    )
  }

  function MatchCard({ m }: { m: Match }) {
    const projHome = m.slot_home ? slotResolution[m.slot_home] : null
    const projAway = m.slot_away ? slotResolution[m.slot_away] : null
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
              {/* 3er y 4º puesto, bajo la Final */}
              {key === 'final' && thirdMatch && (
                <div className="mt-4">
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 text-center">3.er puesto</p>
                  <MatchCard m={thirdMatch} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PenaltiesSection({ leagueId, players }: { leagueId: string; players: Player[] }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<{ id: string; player_id: string; points: number; detail: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [pts, setPts] = useState('-10')
  const [reason, setReason] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('score_log')
      .select('id, player_id, points, detail')
      .eq('league_id', leagueId)
      .eq('category', 'bonus')
      .lt('points', 0)
      .is('match_id', null)
      .order('created_at', { ascending: false })
    setEntries(data ?? [])
    setLoading(false)
  }

  useEffect(() => { if (open) load() }, [open])

  async function add() {
    if (!targetId || !reason.trim() || !pts) return
    const p = parseInt(pts)
    if (isNaN(p) || p >= 0) { alert('Introduce un número negativo'); return }
    const res = await fetch('/api/admin/penalty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId: targetId, points: p, detail: reason.trim() }),
    })
    if (!res.ok) { const d = await res.json(); alert(d.error); return }
    setPts('-10'); setReason(''); setTargetId('')
    load()
  }

  async function remove(entry: { id: string; player_id: string; points: number }) {
    if (!confirm('¿Eliminar esta penalización?')) return
    const res = await fetch('/api/admin/penalty', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, leagueId, playerId: entry.player_id }),
    })
    if (!res.ok) { const d = await res.json(); alert(d.error); return }
    load()
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(o => !o)}>
        <p className="font-bold text-sm">🚨 Penalizaciones manuales</p>
        <span className="text-[var(--text-secondary)] text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {/* Nueva penalización */}
          <div className="space-y-2">
            <select value={targetId} onChange={e => setTargetId(e.target.value)}
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm">
              <option value="">— Selecciona jugador —</option>
              {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="number" value={pts} onChange={e => setPts(e.target.value)} placeholder="-10"
                className="w-24 bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm" />
              <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo"
                className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm" />
            </div>
            <button onClick={add} disabled={!targetId || !reason.trim()}
              className="w-full py-2 rounded-xl bg-red-700 text-white text-sm font-semibold disabled:opacity-40">
              Añadir penalización
            </button>
          </div>
          {/* Lista existente */}
          {loading ? <p className="text-xs text-[var(--text-secondary)]">Cargando…</p> : entries.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">Sin penalizaciones manuales</p>
          ) : (
            <div className="space-y-2">
              {entries.map(e => {
                const p = players.find(pl => pl.id === e.player_id)
                return (
                  <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p?.name ?? '?'}</span>
                      <span className="text-[var(--text-secondary)] ml-2 text-xs truncate">{e.detail}</span>
                    </div>
                    <span className="text-red-400 font-bold shrink-0">{e.points} pts</span>
                    <button onClick={() => remove(e)} className="text-[var(--text-secondary)] hover:text-red-400 shrink-0 text-xs px-2">✕</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AdminTab({ league, matches, players, router }: {
  league: League; matches: Match[]; players: Player[]; router: ReturnType<typeof useRouter>
}) {
  const [allTeams, setAllTeams] = useState<import('../../../types').Team[]>([])
  const [wildcardEnabled, setWildcardEnabled] = useState(league.wildcard_enabled)

  useEffect(() => {
    supabase.from('teams').select('*').order('name').then(({ data }) => { if (data) setAllTeams(data) })
  }, [])

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

      {/* Asignar cruces eliminatorios */}
      <KnockoutAssignSection matches={matches} allTeams={allTeams} onRefresh={() => router.refresh()} />

      {/* Bonificaciones de clasificación */}
      <QualificationBonusSection allTeams={allTeams} onAward={awardBonus} />

      {/* Plantillas */}
      <SquadEditorSection allTeams={allTeams} />

      {/* Anuncio a la liga */}
      <AnnouncementSection players={players} league={league} />

      {/* Penalizaciones */}
      <PenaltiesSection leagueId={league.id} players={players} />

      {/* Modo Wildcard */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-sm">⚡ Modo Wildcard</p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Permite a jugadores sin equipo participar en partidos eliminatorios pagando 2 pts
            </p>
          </div>
          <button
            onClick={async () => {
              const newVal = !wildcardEnabled
              setWildcardEnabled(newVal)
              const res = await fetch('/api/admin/wildcard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leagueId: league.id, enabled: newVal }),
              })
              if (!res.ok) setWildcardEnabled(!newVal) // revertir si falla
            }}
            className={`relative w-12 h-6 rounded-full transition-colors ${wildcardEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${wildcardEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ASIGNAR EQUIPOS A LAS ELIMINATORIAS ─────────────────────

function KnockoutAssignSection({ matches, allTeams, onRefresh }: {
  matches: Match[]
  allTeams: import('../../../types').Team[]
  onRefresh: () => void
}) {
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const ROUNDS: { key: string; label: string }[] = [
    { key: 'r32', label: 'Ronda de 32' }, { key: 'r16', label: 'Octavos' },
    { key: 'qf', label: 'Cuartos' }, { key: 'sf', label: 'Semifinales' },
    { key: 'third', label: 'Tercer puesto' }, { key: 'final', label: 'Final' },
  ]
  const koMatches = matches.filter(m => m.match_type && m.match_type !== 'group')
  if (!koMatches.length) return null

  // Clasificación final de grupos
  function computeGroupRanking() {
    const map: Record<string, { team: any; pts: number; gd: number; gf: number; w: number }> = {}
    for (const t of allTeams) map[t.id] = { team: t, pts: 0, gd: 0, gf: 0, w: 0 }
    for (const m of matches) {
      if (m.match_type !== 'group' || m.status !== 'finished' || m.home_goals == null) continue
      const h = map[m.home_team_id ?? ''], a = map[m.away_team_id ?? '']
      if (!h || !a) continue
      h.gf += m.home_goals; h.gd += m.home_goals - m.away_goals!
      a.gf += m.away_goals!; a.gd += m.away_goals! - m.home_goals
      if (m.home_goals > m.away_goals!) { h.pts += 3; h.w++ }
      else if (m.home_goals === m.away_goals!) { h.pts++; a.pts++ }
      else { a.pts += 3; a.w++ }
    }
    const byGroup: Record<string, any[]> = {}
    for (const row of Object.values(map)) {
      const g = row.team.group_name ?? '?'
      ;(byGroup[g] ??= []).push(row)
    }
    for (const g of Object.keys(byGroup))
      byGroup[g].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.w - a.w)
    return byGroup
  }

  async function autofillR32() {
    if (!confirm('¿Auto-rellenar la Ronda de 32 con la clasificación ACTUAL de grupos?')) return
    setBusy(true)
    const byGroup = computeGroupRanking()
    const thirds = Object.entries(byGroup).map(([g, rows]) => rows[2] ? { g, row: rows[2] } : null)
      .filter(Boolean).sort((a: any, b: any) => b.row.pts - a.row.pts || b.row.gd - a.row.gd || b.row.gf - a.row.gf || b.row.w - a.row.w) as any[]
    const avail = [...thirds]
    function resolve(slot: string | null): string | null {
      if (!slot) return null
      const m1 = slot.match(/^([12])([A-L])$/)
      if (m1) { const rows = byGroup[m1[2]]; const r = rows?.[m1[1] === '1' ? 0 : 1]; return r?.team.id ?? null }
      const m3 = slot.match(/3º\(([A-L/]+)\)/)
      if (m3) {
        const cands = m3[1].split('/')
        const idx = avail.findIndex(t => cands.includes(t.g))
        if (idx === -1) return null
        return avail.splice(idx, 1)[0].row.team.id
      }
      return null
    }
    const r32 = koMatches.filter(m => m.match_type === 'r32')
      .sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))
    for (const m of r32) {
      await supabase.from('matches').update({
        home_team_id: resolve(m.slot_home), away_team_id: resolve(m.slot_away),
      }).eq('id', m.id)
    }
    setBusy(false)
    onRefresh()
  }

  async function assign(matchId: string, side: 'home' | 'away', teamId: string) {
    await supabase.from('matches')
      .update({ [side === 'home' ? 'home_team_id' : 'away_team_id']: teamId || null })
      .eq('id', matchId)
    onRefresh()
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
        <span className="font-bold text-sm">🏆 Asignar cruces eliminatorios</span>
        <span className="text-[var(--text-secondary)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3 space-y-4">
          <button onClick={autofillR32} disabled={busy}
            className="w-full py-2.5 bg-[var(--yellow)] text-black font-bold rounded-xl disabled:opacity-50 text-sm">
            {busy ? 'Asignando…' : '⚡ Auto-rellenar R32 desde la clasificación de grupos'}
          </button>
          <p className="text-xs text-[var(--text-secondary)]">
            Para octavos en adelante, asigna los ganadores manualmente a medida que avancen las rondas.
          </p>
          {ROUNDS.map(({ key, label }) => {
            const rms = koMatches.filter(m => m.match_type === key)
              .sort((a, b) => (a.match_date ?? '').localeCompare(b.match_date ?? ''))
            if (!rms.length) return null
            return (
              <div key={key}>
                <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{label}</p>
                <div className="space-y-2">
                  {rms.map(m => (
                    <div key={m.id} className="flex items-center gap-1.5 text-xs">
                      <select value={m.home_team_id ?? ''} onChange={e => assign(m.id, 'home', e.target.value)}
                        className="flex-1 min-w-0 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-1.5 py-1.5 text-white">
                        <option value="">{m.slot_home ?? '—'}</option>
                        {allTeams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
                      </select>
                      <span className="text-[var(--text-secondary)] shrink-0">vs</span>
                      <select value={m.away_team_id ?? ''} onChange={e => assign(m.id, 'away', e.target.value)}
                        className="flex-1 min-w-0 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-1.5 py-1.5 text-white">
                        <option value="">{m.slot_away ?? '—'}</option>
                        {allTeams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
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
  goal: '⚽', goal_extra_time: '⚽', penalty_shootout: '🥅',
  red_card: '🟥', own_goal: '🥅',
  assist: '👟', clean_sheet_gk: '🧤', clean_sheet_def: '🛡️',
  penalty_missed: '❌', penalty_missed_shootout: '❌',
}

type AddEventType = 'goal' | 'own_goal' | 'penalty_shootout' | 'red_card'
  | 'assist' | 'clean_sheet_gk' | 'clean_sheet_def'
  | 'penalty_missed' | 'penalty_missed_shootout'
const ADD_EVENT_OPTIONS: { value: AddEventType; label: string; hasMinute: boolean }[] = [
  { value: 'goal',                    label: '⚽ Gol',                      hasMinute: true  },
  { value: 'assist',                  label: '👟 Asistencia',               hasMinute: true  },
  { value: 'own_goal',                label: '🥅 Autogol',                  hasMinute: true  },
  { value: 'red_card',                label: '🟥 Expulsión',                hasMinute: true  },
  { value: 'penalty_shootout',        label: '🥅 Penalti (tanda)',          hasMinute: false },
  { value: 'penalty_missed',          label: '❌ Penalti fallado (90\')',   hasMinute: true  },
  { value: 'penalty_missed_shootout', label: '❌ Penalti fallado (tanda)',  hasMinute: false },
  { value: 'clean_sheet_gk',          label: '🧤 Portería a cero (POR)',    hasMinute: false },
  { value: 'clean_sheet_def',         label: '🛡️ Portería a cero (DEF)',    hasMinute: false },
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
  const [winnerTeam, setWinnerTeam] = useState<string>((match as any).winner_team_id ?? '')
  const [savingResult, setSavingResult] = useState(false)
  const [savedOk, setSavedOk]   = useState(false)

  useEffect(() => {
    setHomeG(match.home_goals?.toString() ?? '')
    setAwayG(match.away_goals?.toString() ?? '')
    setWinnerTeam((match as any).winner_team_id ?? '')
  }, [match.home_goals, match.away_goals, (match as any).winner_team_id])

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
    const isKnockout = match.match_type && match.match_type !== 'group'
    const isDraw = h === a
    // En eliminatorias con empate, el ganador es obligatorio
    if (isKnockout && isDraw && !winnerTeam) {
      alert('Es eliminatoria con empate — selecciona qué equipo avanzó (prórroga/penaltis)')
      return
    }
    setSavingResult(true)
    setSavedOk(false)
    // Guardar winner_team_id si aplica
    const winnerId = isKnockout ? (isDraw ? winnerTeam : (h > a ? match.home_team_id : match.away_team_id)) : null
    await supabase.from('matches').update({ winner_team_id: winnerId ?? null }).eq('id', match.id)
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
              {new Date(match.match_date).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' } as any)}
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
            {/* Ganador en prórroga/penaltis — solo eliminatorias con empate */}
            {match.match_type && match.match_type !== 'group' && homeG !== '' && awayG !== '' && parseInt(homeG) === parseInt(awayG) && (
              <div className="mt-2">
                <p className="text-xs text-[var(--text-secondary)] mb-1">Empate → ¿quién avanza? (prórroga/penaltis)</p>
                <div className="flex gap-2">
                  {[match.home_team, match.away_team].map(team => team && (
                    <button key={team.id} onClick={() => setWinnerTeam(w => w === team.id ? '' : team.id)}
                      className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-sm transition-colors ${winnerTeam === team.id ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white' : 'border-[var(--border)] text-[var(--text-secondary)]'}`}>
                      <span>{team.flag_emoji}</span><span className="truncate">{team.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                    ? '⏱ Prórroga → goal_extra_time (+1 pt)'
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

function PlayerSettingsModal({ leagueId, playerId, currentName, isAdmin, onClose, onLeft }: {
  leagueId: string
  playerId: string
  currentName: string
  isAdmin: boolean
  onClose: () => void
  onLeft: () => void
}) {
  const [name, setName]   = useState(currentName)
  const [saving, setSaving] = useState(false)

  async function saveName() {
    if (!name.trim() || name.trim() === currentName) return
    setSaving(true)
    const { error } = await supabase.from('players').update({ name: name.trim() }).eq('id', playerId)
    setSaving(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    onClose()
    location.reload()
  }

  async function leaveLeague() {
    if (isAdmin) { alert('El admin no puede salir. Pasa antes la administración o elimina la liga.'); return }
    if (!confirm('¿Seguro que quieres salir de esta liga? Perderás tus selecciones y puntos.')) return
    await supabase.from('players').delete().eq('id', playerId)
    onLeft()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)]">
          <p className="font-black text-lg">⚙️ Ajustes</p>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Tu nombre en esta liga</label>
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)}
                className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[var(--accent)]" />
              <button onClick={saveName} disabled={saving || !name.trim() || name.trim() === currentName}
                className="px-4 bg-[var(--accent)] text-white font-bold rounded-xl disabled:opacity-40">
                {saving ? '…' : 'Guardar'}
              </button>
            </div>
          </div>
          <div className="border-t border-[var(--border)] pt-4">
            <button onClick={leaveLeague}
              className="w-full py-2.5 border border-[var(--red)]/50 text-[var(--red)] font-semibold rounded-xl hover:bg-[var(--red)]/10 transition-colors">
              Salir de la liga
            </button>
            {isAdmin && <p className="text-xs text-[var(--text-secondary)] mt-2 text-center">Eres admin — no puedes salir de tu propia liga.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function FinishedMatchEvents({ matchId, homeTeamId }: { matchId: string; homeTeamId: string | null }) {
  const [events, setEvents] = useState<any[]>([])

  useEffect(() => {
    supabase.from('player_events').select('*, squad_player:squad_players(name, team_id)')
      .eq('match_id', matchId).order('minute')
      .then(({ data }) => setEvents(data ?? []))
  }, [matchId])

  const VISIBLE_EVENTS = ['goal','goal_extra_time','penalty_shootout','own_goal','red_card','assist','penalty_missed','penalty_missed_shootout']
  const visible = events.filter(e => VISIBLE_EVENTS.includes(e.event_type))
  if (visible.length === 0) return null

  const EVENT_ICON: Record<string, string> = {
    goal: '⚽', goal_extra_time: '⚽', penalty_shootout: '🥅', own_goal: '🥅', red_card: '🟥',
    assist: '👟', penalty_missed: '❌', penalty_missed_shootout: '❌',
  }

  const home = visible.filter(e => e.squad_player?.team_id === homeTeamId)
  const away = visible.filter(e => e.squad_player?.team_id !== homeTeamId)

  return (
    <div className="border-t border-[var(--border)] pt-3 mb-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">📋 Eventos</p>
      <div className="flex justify-between gap-2 text-xs">
        <div className="space-y-0.5">
          {home.map(e => (
            <p key={e.id} className="text-[var(--text-secondary)]">
              {EVENT_ICON[e.event_type]} {e.squad_player?.name}{e.minute ? ` ${e.minute}'` : ''}
            </p>
          ))}
        </div>
        <div className="space-y-0.5 text-right">
          {away.map(e => (
            <p key={e.id} className="text-[var(--text-secondary)]">
              {e.minute ? `${e.minute}' ` : ''}{e.squad_player?.name} {EVENT_ICON[e.event_type]}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

function LiveClock({ matchDate, matchClock }: { matchDate: string; matchClock?: string | null }) {
  // Si el sync ya guardó el reloj de ESPN (incluye tiempo añadido "45+2"), mostrarlo directo
  if (matchClock) {
    // displayClock de ESPN: "67:34" → "67'" | "45+02:34" → "45+2'"
    const raw = matchClock.split(':')[0] // "67" o "45+02"
    const formatted = raw.includes('+')
      ? `${raw.split('+')[0]}+${parseInt(raw.split('+')[1])}'`
      : `${parseInt(raw)}'`
    return <>{formatted}</>
  }
  // Fallback: calcular desde match_date
  const calc = (md: string) => {
    const elapsed = (Date.now() - new Date(md).getTime()) / 60000
    if (elapsed >= 60) return `${Math.min(Math.floor(elapsed - 15), 90)}'`
    return `${Math.min(Math.floor(elapsed), 45)}'`
  }
  const [display, setDisplay] = useState(() => calc(matchDate))
  useEffect(() => {
    setDisplay(calc(matchDate))
    const t = setInterval(() => setDisplay(calc(matchDate)), 60000)
    return () => clearInterval(t)
  }, [matchDate])
  return <>{display}</>
}

function LiveMatchEvents({ matchId, homeTeamId, isLive = false }: { matchId: string; homeTeamId: string | null; isLive?: boolean }) {
  const [events, setEvents] = useState<any[]>([])
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = (matchId: string) =>
    supabase.from('player_events').select('*, squad_player:squad_players(name, team_id)')
      .eq('match_id', matchId).then(({ data }) => { setEvents(data ?? []); setUpdatedAt(new Date()) })

  useEffect(() => {
    load(matchId)
    const ch = supabase.channel(`events-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_events', filter: `match_id=eq.${matchId}` }, () => load(matchId))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [matchId])

  const VISIBLE_EVENTS = ['goal','goal_extra_time','penalty_shootout','own_goal','red_card','assist','penalty_missed','penalty_missed_shootout']
  const visible = events.filter(e => VISIBLE_EVENTS.includes(e.event_type))
  if (visible.length === 0) return null

  const EVENT_ICON: Record<string, string> = {
    goal: '⚽', goal_extra_time: '⚽', penalty_shootout: '🥅', own_goal: '🥅', red_card: '🟥',
    assist: '👟', penalty_missed: '❌', penalty_missed_shootout: '❌',
  }

  const home = visible.filter(e => e.squad_player?.team_id === homeTeamId)
  const away = visible.filter(e => e.squad_player?.team_id !== homeTeamId)

  return (
    <div className="mt-2 mb-1">
    {updatedAt && isLive && (
      <p className="text-[10px] text-center text-[var(--text-muted)] mb-1">
        Actualizado: {updatedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
      </p>
    )}
    <div className="flex justify-between gap-2 text-xs">
      <div className="space-y-0.5">
        {home.map(e => (
          <p key={e.id} className="text-[var(--text-secondary)]">
            {EVENT_ICON[e.event_type]} {e.squad_player?.name}{e.minute ? ` (${e.minute}')` : ''}
          </p>
        ))}
      </div>
      <div className="space-y-0.5 text-right">
        {away.map(e => (
          <p key={e.id} className="text-[var(--text-secondary)]">
            {e.minute ? `(${e.minute}') ` : ''}{e.squad_player?.name} {EVENT_ICON[e.event_type]}
          </p>
        ))}
      </div>
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

// ─── WILDCARD ─────────────────────────────────────────────────

function WildcardParticipants({ matchId, leagueId, players }: {
  matchId: string
  leagueId: string
  players: Player[]
}) {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    supabase.from('wildcard_entries').select('player_id')
      .eq('match_id', matchId).eq('league_id', leagueId)
      .then(({ data }) => {
        if (!data?.length) return
        setNames(data.map(e => players.find(p => p.id === e.player_id)?.name ?? '?'))
      })
  }, [matchId, leagueId, players])

  if (!names.length) return null

  return (
    <p className="text-[11px] text-[var(--text-secondary)] mt-2">
      🃏 Wildcard: <span className="text-white">{names.join(', ')}</span>
    </p>
  )
}

function WildcardButton({ match, leagueId, myId, scores }: {
  match: Match
  leagueId: string
  myId: string
  scores: { player_id: string; points: number }[]
}) {
  const [entry, setEntry] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [preview, setPreview] = useState<{
    qualifierName: string | null
    pred: { home: number; away: number } | null
    players: string[]
  } | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const locked = match.match_date
    ? new Date(match.match_date).getTime() - 2 * 60 * 60 * 1000 <= Date.now()
    : false

  const rank = scores.findIndex(s => s.player_id === myId) + 1
  const entryCost = rank <= 2 ? 2 : rank <= 5 ? 1 : 0

  useEffect(() => {
    supabase.from('wildcard_entries').select('*')
      .eq('match_id', match.id).eq('player_id', myId).maybeSingle()
      .then(async ({ data: entryData }) => {
        setEntry(entryData)
        setLoaded(true)
        if (entryData && !entryData.cost_charged && locked) {
          fetch('/api/wildcard/charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leagueId, playerId: myId, matchId: match.id }),
          }).catch(() => {})
        }
        if (entryData) {
          const [{ data: predData }, { data: luData }] = await Promise.all([
            supabase.from('predictions').select('home_goals, away_goals')
              .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true).maybeSingle(),
            supabase.from('match_lineups').select('squad_player:squad_players(name)')
              .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true),
          ])
          const qId = entryData.qualifier_pick
          const qName = qId === match.home_team_id ? match.home_team?.name
            : qId === match.away_team_id ? match.away_team?.name : null
          setPreview({
            qualifierName: qName ?? null,
            pred: predData ? { home: predData.home_goals, away: predData.away_goals } : null,
            players: (luData ?? []).map((l: any) => l.squad_player?.name).filter(Boolean),
          })
        }
      })
  }, [match.id, myId, leagueId, locked])

  if (!loaded) return null

  async function cancelWildcard() {
    if (!confirm('¿Cancelar tu participación wildcard? No se te cobrará nada.')) return
    setCancelling(true)
    const res = await fetch('/api/wildcard/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, playerId: myId, matchId: match.id }),
    })
    if (res.ok) {
      setEntry(null)
    } else {
      const { error } = await res.json()
      alert(error ?? 'No se pudo cancelar')
    }
    setCancelling(false)
  }

  if (entry) {
    const costLabel = entry.cost_charged
      ? (entryCost === 0 ? '' : ` · −${entryCost} pt${entryCost > 1 ? 's' : ''} cobrados`)
      : ` · coste pendiente al cierre`
    return (
      <>
        <div className="mt-2 border border-[var(--accent)]/20 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setDetailsOpen(o => !o)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
              <p className="text-xs text-[var(--accent)] font-semibold truncate">⚡ Wildcard{costLabel}</p>
              <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{detailsOpen ? '▲' : '▼'}</span>
            </button>
            {!locked && (
              <>
                <button onClick={() => setShowModal(true)}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors shrink-0">
                  ✏️ Editar
                </button>
                <button onClick={cancelWildcard} disabled={cancelling}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--red)] transition-colors disabled:opacity-40 shrink-0">
                  {cancelling ? '…' : '✕'}
                </button>
              </>
            )}
          </div>
          {detailsOpen && preview && (
            <div className="border-t border-[var(--accent)]/20 px-3 py-2 space-y-1">
              {preview.qualifierName && (
                <p className="text-xs text-[var(--text-secondary)]">🏆 <span className="text-white">{preview.qualifierName}</span></p>
              )}
              {preview.pred && (
                <p className="text-xs text-[var(--text-secondary)]">🎯 <span className="text-white font-semibold">{preview.pred.home} - {preview.pred.away}</span></p>
              )}
              {preview.players.length > 0 && (
                <p className="text-xs text-[var(--text-secondary)]">⭐ <span className="text-white">{preview.players.join(', ')}</span></p>
              )}
            </div>
          )}
        </div>
        {showModal && (
          <WildcardModal
            match={match} leagueId={leagueId} myId={myId} entryCost={entryCost} editing
            onClose={() => setShowModal(false)}
            onDone={async (e) => {
              setEntry(e)
              setShowModal(false)
              // Recargar preview tras editar
              const [{ data: predData }, { data: luData }] = await Promise.all([
                supabase.from('predictions').select('home_goals, away_goals')
                  .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true).maybeSingle(),
                supabase.from('match_lineups').select('squad_player:squad_players(name)')
                  .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true),
              ])
              const qId = e?.qualifier_pick
              const qName = qId === match.home_team_id ? match.home_team?.name
                : qId === match.away_team_id ? match.away_team?.name : null
              setPreview({
                qualifierName: qName ?? null,
                pred: predData ? { home: predData.home_goals, away: predData.away_goals } : null,
                players: (luData ?? []).map((l: any) => l.squad_player?.name).filter(Boolean),
              })
            }}
          />
        )}
      </>
    )
  }

  if (locked) return null

  const costLabel = entryCost === 0 ? 'Gratis' : `−${entryCost} pt${entryCost > 1 ? 's' : ''} al cierre`

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="w-full mt-2 py-2 rounded-xl border border-[var(--accent)]/50 text-[var(--accent)] text-sm font-semibold hover:bg-[var(--accent)]/10 transition-colors">
        ⚡ Entrar ({costLabel})
      </button>
      {showModal && (
        <WildcardModal
          match={match} leagueId={leagueId} myId={myId} entryCost={entryCost}
          onClose={() => setShowModal(false)}
          onDone={(e) => { setEntry(e); setShowModal(false) }}
        />
      )}
    </>
  )
}

const POS_ORDER: Record<string, number> = { GK: 0, DF: 1, MF: 2, FW: 3 }
const POS_LABEL: Record<string, string> = { GK: 'PT', DF: 'DF', MF: 'MC', FW: 'DL' }

function WildcardModal({ match, leagueId, myId, entryCost, editing = false, onClose, onDone }: {
  match: Match
  leagueId: string
  myId: string
  entryCost: number
  editing?: boolean
  onClose: () => void
  onDone: (entry: any) => void
}) {
  const ssKey = `wc-${match.id}-${myId}`

  const loadSaved = () => {
    try { return JSON.parse(sessionStorage.getItem(ssKey) ?? 'null') } catch { return null }
  }
  const saved = loadSaved()

  const [qualifierPick, setQualifierPick] = useState<string | null>(saved?.qualifierPick ?? null)
  const [homeGoals, setHomeGoals] = useState<string>(saved?.homeGoals ?? '')
  const [awayGoals, setAwayGoals] = useState<string>(saved?.awayGoals ?? '')
  const [squadPlayers, setSquadPlayers] = useState<SquadPlayer[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>(saved?.selectedPlayers ?? [])
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (!match.home_team_id || !match.away_team_id) return
    Promise.all([
      supabase.from('squad_players').select('*')
        .in('team_id', [match.home_team_id, match.away_team_id]),
      supabase.from('predictions').select('home_goals, away_goals')
        .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true).maybeSingle(),
      supabase.from('match_lineups').select('squad_player_id')
        .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true),
      supabase.from('wildcard_entries').select('qualifier_pick')
        .eq('match_id', match.id).eq('player_id', myId).maybeSingle(),
    ]).then(([{ data: spData }, { data: predData }, { data: luData }, { data: weData }]) => {
      const sorted = (spData ?? []).sort((a: SquadPlayer, b: SquadPlayer) =>
        (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9) ||
        ((a.shirt_number ?? 99) - (b.shirt_number ?? 99))
      )
      setSquadPlayers(sorted)
      // Precargar desde BD si no hay sessionStorage
      const hasSaved = !!sessionStorage.getItem(ssKey)
      if (!hasSaved) {
        if (predData) {
          setHomeGoals(String(predData.home_goals ?? ''))
          setAwayGoals(String(predData.away_goals ?? ''))
        }
        if (luData?.length) setSelectedPlayers(luData.map((l: any) => l.squad_player_id))
        if (weData?.qualifier_pick) setQualifierPick(weData.qualifier_pick)
      }
    })
  }, [match.home_team_id, match.away_team_id, match.id, myId, ssKey])

  // Persistir selecciones en sessionStorage para sobrevivir recargas
  useEffect(() => {
    sessionStorage.setItem(ssKey, JSON.stringify({ qualifierPick, homeGoals, awayGoals, selectedPlayers }))
  }, [qualifierPick, homeGoals, awayGoals, selectedPlayers, ssKey])

  function togglePlayer(id: string) {
    setSelectedPlayers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev
    )
  }

  async function confirm() {
    if (!qualifierPick) { alert('Elige qué equipo pasa'); return }
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      if (!editing) {
        const { error: entryErr } = await supabase.rpc('enter_wildcard', {
          p_league_id: leagueId, p_player_id: myId,
          p_match_id: match.id, p_qualifier_pick: qualifierPick,
        })
        if (entryErr) { alert(entryErr.message); return }
      } else {
        // Actualizar qualifier_pick si cambió
        await supabase.from('wildcard_entries')
          .update({ qualifier_pick: qualifierPick })
          .eq('match_id', match.id).eq('player_id', myId)
      }

      if (homeGoals !== '' && awayGoals !== '') {
        await supabase.from('predictions').upsert({
          match_id: match.id, player_id: myId,
          home_goals: parseInt(homeGoals), away_goals: parseInt(awayGoals),
          is_wildcard: true,
        }, { onConflict: 'match_id,player_id' })
      }

      if (selectedPlayers.length > 0) {
        await supabase.from('match_lineups').delete()
          .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true)
        await supabase.from('match_lineups').insert(
          selectedPlayers.map(spId => ({
            match_id: match.id, player_id: myId,
            team_id: squadPlayers.find(s => s.id === spId)?.team_id,
            squad_player_id: spId, is_wildcard: true,
          }))
        )
      }

      sessionStorage.removeItem(ssKey)
      const { data: entry } = await supabase.from('wildcard_entries')
        .select('*').eq('match_id', match.id).eq('player_id', myId).maybeSingle()
      onDone(entry)
    } finally {
      setSaving(false)
      submitting.current = false
    }
  }

  const homePlayers = squadPlayers.filter(s => s.team_id === match.home_team_id)
  const awayPlayers = squadPlayers.filter(s => s.team_id === match.away_team_id)

  function renderTeamPlayers(players: SquadPlayer[], flag: string, teamName: string) {
    return (
      <div className="mb-4">
        <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">{flag} {teamName}</p>
        <div className="space-y-1">
          {players.map(sp => {
            const selected = selectedPlayers.includes(sp.id)
            const disabled = !selected && selectedPlayers.length >= 3
            return (
              <button key={sp.id} onClick={() => togglePlayer(sp.id)} disabled={disabled}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
                  selected ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                  : disabled ? 'border-[var(--border)] opacity-30 cursor-not-allowed'
                  : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                }`}>
                <span className="text-[10px] font-bold text-[var(--text-muted)] w-5 shrink-0 text-right">
                  {sp.shirt_number ?? '·'}
                </span>
                <span className={`text-[10px] font-bold px-1 rounded shrink-0 ${
                  sp.position === 'GK' ? 'bg-yellow-500/20 text-yellow-400'
                  : sp.position === 'DF' ? 'bg-blue-500/20 text-blue-400'
                  : sp.position === 'MF' ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
                }`}>{POS_LABEL[sp.position] ?? sp.position}</span>
                <span className="text-sm truncate">{sp.name}</span>
                {selected && <span className="ml-auto text-[var(--accent)] shrink-0">✓</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)] shrink-0">
          <p className="font-black text-lg">⚡ Wildcard{' '}
            <span className={`text-sm font-normal ${entryCost === 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
              {entryCost === 0 ? 'Gratis' : `−${entryCost} pt${entryCost > 1 ? 's' : ''}`}
            </span>
          </p>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-5">

          {/* Equipo que pasa */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">¿Quién pasa? <span className="text-[var(--accent)]">+2 pts</span></p>
            <div className="grid grid-cols-2 gap-2">
              {[match.home_team, match.away_team].map(team => team && (
                <button key={team.id} onClick={() => setQualifierPick(team.id)}
                  className={`flex items-center gap-2 p-3 rounded-xl border transition-colors ${qualifierPick === team.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}>
                  <span className="text-xl">{team.flag_emoji}</span>
                  <span className="text-sm font-semibold truncate">{team.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Porra */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Porra <span className="text-[var(--accent)]">+1 pt</span></p>
            <div className="flex items-center gap-3 justify-center">
              <span className="text-sm">{match.home_team?.flag_emoji}</span>
              <input type="number" min={0} max={20} value={homeGoals} onChange={e => setHomeGoals(e.target.value)}
                className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-[var(--text-secondary)]">-</span>
              <input type="number" min={0} max={20} value={awayGoals} onChange={e => setAwayGoals(e.target.value)}
                className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-sm">{match.away_team?.flag_emoji}</span>
            </div>
          </div>

          {/* Jugadores */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
              3 jugadores <span className="text-[var(--text-muted)]">({selectedPlayers.length}/3)</span>
            </p>
            {renderTeamPlayers(homePlayers, match.home_team?.flag_emoji ?? '', match.home_team?.name ?? '')}
            {renderTeamPlayers(awayPlayers, match.away_team?.flag_emoji ?? '', match.away_team?.name ?? '')}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border)] shrink-0">
          <button onClick={confirm} disabled={saving || !qualifierPick}
            className="w-full py-3 bg-[var(--accent)] text-white font-black rounded-xl disabled:opacity-40 transition-opacity">
            {saving ? 'Guardando…' : entryCost === 0 ? '⚡ Confirmar (gratis)' : `⚡ Confirmar (−${entryCost} pt${entryCost > 1 ? 's' : ''} al cierre)`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── EDITOR DE PLANTILLAS ─────────────────────────────────────

function SquadEditorSection({ allTeams }: { allTeams: import('../../../types').Team[] }) {
  const [open, setOpen]       = useState(false)
  const [teamId, setTeamId]   = useState('')
  const [players, setPlayers] = useState<SquadPlayer[]>([])
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPos, setNewPos]   = useState<'GK'|'DF'|'MF'|'FW'>('FW')
  const [newNum, setNewNum]   = useState('')
  const [saving, setSaving]   = useState(false)

  async function loadSquad(tid: string) {
    setLoading(true)
    const { data } = await supabase
      .from('squad_players')
      .select('id, team_id, name, position, shirt_number, api_id, photo_url')
      .eq('team_id', tid)
      .order('position').order('shirt_number', { nullsFirst: false })
    setPlayers((data ?? []) as SquadPlayer[])
    setLoading(false)
  }

  function onTeamChange(tid: string) {
    setTeamId(tid)
    setPlayers([])
    if (tid) loadSquad(tid)
  }

  async function removePlayer(id: string) {
    if (!confirm('¿Eliminar este jugador de la plantilla?')) return
    await supabase.from('squad_players').delete().eq('id', id)
    setPlayers(prev => prev.filter(p => p.id !== id))
  }

  async function addPlayer() {
    if (!newName.trim() || !teamId) return
    setSaving(true)
    const { data, error } = await supabase
      .from('squad_players')
      .insert({ team_id: teamId, name: newName.trim(), position: newPos, shirt_number: newNum ? parseInt(newNum) : null })
      .select('id, team_id, name, position, shirt_number, api_id, photo_url')
      .single()
    setSaving(false)
    if (error) { alert(error.message); return }
    const posOrder = { GK: 0, DF: 1, MF: 2, FW: 3 }
    setPlayers(prev => [...prev, data as SquadPlayer].sort((a, b) =>
      (posOrder[a.position as keyof typeof posOrder] ?? 9) - (posOrder[b.position as keyof typeof posOrder] ?? 9)
    ))
    setNewName(''); setNewNum('')
  }

  const POS_COLORS: Record<string, string> = {
    GK: 'bg-yellow-500/20 text-yellow-400',
    DF: 'bg-blue-500/20 text-blue-400',
    MF: 'bg-green-500/20 text-green-400',
    FW: 'bg-red-500/20 text-red-400',
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
        <p className="font-bold text-sm">👥 Editar plantillas</p>
        <span className="text-[var(--text-secondary)] text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <select value={teamId} onChange={e => onTeamChange(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm">
            <option value="">Selecciona un equipo…</option>
            {allTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {loading && <p className="text-xs text-[var(--text-secondary)] text-center py-2">Cargando…</p>}

          {!loading && teamId && (
            <>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {players.length === 0
                  ? <p className="text-xs text-[var(--text-secondary)] text-center py-3">Sin jugadores registrados</p>
                  : players.map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)]">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${POS_COLORS[p.position] ?? ''}`}>{p.position}</span>
                      {p.shirt_number != null && <span className="text-xs text-[var(--text-secondary)] w-5 text-right">{p.shirt_number}</span>}
                      <span className="flex-1 text-sm">{p.name}</span>
                      <button onClick={() => removePlayer(p.id)}
                        className="text-red-400 hover:text-red-300 text-xs px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors">
                        ✕
                      </button>
                    </div>
                  ))
                }
              </div>

              <div className="border-t border-[var(--border)] pt-3 space-y-2">
                <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Añadir jugador</p>
                <div className="flex gap-2">
                  <select value={newPos} onChange={e => setNewPos(e.target.value as any)}
                    className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm w-20">
                    <option>GK</option><option>DF</option><option>MF</option><option>FW</option>
                  </select>
                  <input value={newNum} onChange={e => setNewNum(e.target.value)} placeholder="Nº"
                    className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm w-14 text-center" />
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPlayer()}
                    placeholder="Nombre del jugador"
                    className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm" />
                  <button onClick={addPlayer} disabled={saving || !newName.trim()}
                    className="bg-[var(--accent)] text-white text-sm font-bold px-3 py-1.5 rounded-lg disabled:opacity-40">
                    {saving ? '…' : '+'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ANUNCIOS A LA LIGA ───────────────────────────────────────

function AnnouncementSection({ players, league }: { players: Player[]; league: League }) {
  const [open, setOpen]       = useState(false)
  const [title, setTitle]     = useState('')
  const [body, setBody]       = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)

  async function send() {
    if (!title.trim() || !body.trim()) return
    setSending(true)
    await fetch('/api/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId: league.id, title: title.trim(), body: body.trim() }),
    })
    setSending(false)
    setSent(true)
    setTimeout(() => { setSent(false); setTitle(''); setBody('') }, 3000)
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors">
        <p className="font-bold text-sm">📣 Enviar anuncio</p>
        <span className="text-[var(--text-secondary)] text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Título"
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm font-semibold"
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Mensaje…"
            rows={3}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm resize-none"
          />
          <button
            onClick={send}
            disabled={sending || !title.trim() || !body.trim()}
            className={`w-full py-2.5 rounded-xl text-sm font-black transition-colors disabled:opacity-40
              ${sent ? 'bg-[var(--green)] text-black' : 'bg-[var(--accent)] text-white'}`}
          >
            {sent ? '✓ Enviado' : sending ? 'Enviando…' : `📣 Enviar a ${players.length} jugadores`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── PESTAÑA AVISOS ───────────────────────────────────────────

interface Announcement { id: string; title: string; body: string; created_at: string }

function AvisosTab({ leagueId, onRead }: { leagueId: string; onRead: () => void }) {
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('announcements')
      .select('id, title, body, created_at')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setItems(data ?? [])
        setLoading(false)
        // Marcar como leídos
        const key = `avisos_read_${leagueId}`
        localStorage.setItem(key, new Date().toISOString())
        onRead()
      })
  }, [leagueId])

  if (loading) return <p className="text-center text-sm text-[var(--text-secondary)] py-10">Cargando…</p>

  if (items.length === 0) return (
    <div className="text-center py-16 text-[var(--text-secondary)]">
      <p className="text-3xl mb-2">📭</p>
      <p className="text-sm">Sin avisos todavía</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <p className="font-black text-sm">{item.title}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5 whitespace-pre-wrap">{item.body}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-2 opacity-60">
            {new Date(item.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      ))}
    </div>
  )
}


// ─── STATS TAB ───────────────────────────────────────────────

interface PlayerStats {
  playerId: string
  playerName: string
  totalPreds: number
  exact: number
  correctResult: number
  wrong: number
  favPred: string | null
  favPredCount: number
  bestMatchLabel: string
  bestMatchPts: number
  worstMatchLabel: string
  worstMatchPts: number
  bestTeamName: string | null
  bestTeamPts: number
  topPlayerName: string | null
  topPlayerPts: number
  topPlayerPhoto: string | null
  streakBest: number
  winsCount: number
  totalPts: number
  rank: number
}

async function loadAllStats(leagueId: string, players: Player[], scores: Score[]): Promise<PlayerStats[]> {
  const [
    { data: scorelog },
    { data: preds },
    { data: matches },
    { data: drafted },
    { data: events },
    { data: wcLineups },
  ] = await Promise.all([
    supabase.from('score_log').select('*').eq('league_id', leagueId),
    supabase.from('predictions').select('*,matches!inner(id,home_goals,away_goals,home_team_id,away_team_id,status,match_type)'),
    supabase.from('matches')
      .select('*,home_team:teams!matches_home_team_id_fkey(name,flag_emoji),away_team:teams!matches_away_team_id_fkey(name,flag_emoji)')
      .or(`league_id.is.null,league_id.eq.${leagueId}`).order('match_date'),
    supabase.from('drafted_teams').select('*,team:teams(id,name,flag_emoji)').eq('league_id', leagueId),
    supabase.from('player_events').select('*,squad_player:squad_players(id,name,team_id,position,photo_url)'),
    supabase.from('match_lineups').select('player_id,squad_player_id,match_id').eq('is_wildcard', true).in('player_id', players.map(p => p.id)),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchMap: Record<string, any> = Object.fromEntries((matches ?? []).map(m => [m.id, m]))

  const sortedScores = [...scores].sort((a, b) => b.points - a.points)

  // KO phase: goals=1, assist=0.5, clean_sheet_gk=2, clean_sheet_def=1, penalty=0.5
  const EVENT_PTS_KO: Record<string, number> = {
    goal: 1, goal_extra_time: 1, penalty_shootout: 0.5,
    assist: 0.5, clean_sheet_gk: 2, clean_sheet_def: 1,
    penalty_missed: -0.5, penalty_missed_shootout: -0.25,
    own_goal: -1, red_card: -1,
  }
  // Group stage: no assists or clean sheets
  const EVENT_PTS_GROUP: Record<string, number> = {
    goal: 1, goal_extra_time: 1, penalty_shootout: 0.5,
    penalty_missed_shootout: -0.25, own_goal: -1, red_card: -1,
  }
  function eventPts(eventType: string, matchType: string): number {
    if (matchType === 'group') return EVENT_PTS_GROUP[eventType] ?? 0
    return EVENT_PTS_KO[eventType] ?? 0
  }

  return players.map(player => {
    const pid = player.id
    const myLog = (scorelog ?? []).filter(s => s.player_id === pid)
    const myDrafted = (drafted ?? []).filter(d => d.player_id === pid)
    const myTeamIds = myDrafted.map(d => d.team_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const myPreds = (preds ?? []).filter((p: any) => p.player_id === pid && p.matches?.status === 'finished')

    // ── Prediction breakdown (for bar chart, exactas, porra favorita)
    let exact = 0, correctResult = 0, wrong = 0
    const predCounts: Record<string, number> = {}
    for (const p of myPreds) {
      const key = `${p.home_goals}-${p.away_goals}`
      predCounts[key] = (predCounts[key] ?? 0) + 1
      const m = p.matches
      if (p.home_goals === m.home_goals && p.away_goals === m.away_goals) {
        exact++
      } else {
        const predSign = Math.sign(p.home_goals - p.away_goals)
        const realSign = Math.sign(m.home_goals - m.away_goals)
        if (predSign === realSign) correctResult++
        else wrong++
      }
    }
    const favEntry = Object.entries(predCounts).sort((a, b) => b[1] - a[1])[0]

    // ── Partidos ganados: Victoria (result=2) + wildcard_qualifier
    const winsCount = myLog.filter(s =>
      (s.category === 'result' && s.points === 2) || s.category === 'wildcard_qualifier'
    ).length

    // ── Racha de victorias: consecutive won matches in chronological order
    const winMatchIds = new Set(myLog.filter(s => s.category === 'result' && s.points === 2).map(s => s.match_id))
    const wildWinMatchIds = new Set(myLog.filter(s => s.category === 'wildcard_qualifier').map(s => s.match_id))
    const involvedMatchIds = [...new Set(
      myLog.filter(s => ['result', 'wildcard_qualifier', 'wildcard_entry'].includes(s.category)).map(s => s.match_id)
    )].filter(mid => mid && matchMap[mid])
      .sort((a, b) => new Date(matchMap[a].match_date).getTime() - new Date(matchMap[b].match_date).getTime())
    let streakBest = 0, cur = 0
    for (const mid of involvedMatchIds) {
      if (winMatchIds.has(mid) || wildWinMatchIds.has(mid)) { cur++; streakBest = Math.max(streakBest, cur) }
      else cur = 0
    }

    // ── Best/worst match: sum ALL score_log categories
    const byMatch: Record<string, number> = {}
    for (const s of myLog) {
      if (s.match_id) byMatch[s.match_id] = (byMatch[s.match_id] ?? 0) + s.points
    }
    const matchEntries = Object.entries(byMatch).sort((a, b) => b[1] - a[1])
    const bestEntry = matchEntries[0]
    const worstEntry = matchEntries[matchEntries.length - 1]

    function matchLabel(mid: string) {
      const m = matchMap[mid]
      if (!m) return '?'
      const h = m.home_team as { name: string; flag_emoji?: string } | null
      const a = m.away_team as { name: string; flag_emoji?: string } | null
      return `${h?.flag_emoji ?? ''} ${h?.name ?? '?'} vs ${a?.flag_emoji ?? ''} ${a?.name ?? '?'}`
    }

    // ── Equipo más valioso: sum ALL score_log categories per team
    const teamPts: Record<string, number> = {}
    for (const s of myLog) {
      if (!s.match_id) continue
      const m = matchMap[s.match_id]
      if (!m) continue
      const tid = myTeamIds.find(t => t === m.home_team_id || t === m.away_team_id)
      if (tid) teamPts[tid] = (teamPts[tid] ?? 0) + s.points
    }
    const bestTeamEntry = Object.entries(teamPts).sort((a, b) => b[1] - a[1])[0]
    const bestTeamData = myDrafted.find(d => d.team_id === bestTeamEntry?.[0])?.team as { name: string } | null

    // ── Jugador estrella: correct event pts based on match_type (group vs KO)
    // Build set of wildcard squad_players for this fantasy player: "spId|matchId"
    const wcSet = new Set(
      (wcLineups ?? []).filter(l => l.player_id === pid).map(l => `${l.squad_player_id}|${l.match_id}`)
    )
    const playerPtsMap: Record<string, { pts: number; name: string; photo: string | null }> = {}
    for (const ev of (events ?? [])) {
      const sp = ev.squad_player as { id: string; name: string; team_id: string; photo_url?: string } | null
      if (!sp) continue
      const isOwned = myTeamIds.includes(sp.team_id)
      const isWildcard = wcSet.has(`${sp.id}|${ev.match_id}`)
      if (!isOwned && !isWildcard) continue
      const match = matchMap[ev.match_id]
      if (!match) continue
      const pts = eventPts(ev.event_type, match.match_type ?? 'group')
      if (pts === 0) continue
      if (!playerPtsMap[sp.id]) playerPtsMap[sp.id] = { pts: 0, name: sp.name, photo: sp.photo_url ?? null }
      playerPtsMap[sp.id].pts += pts
    }
    const topP = Object.values(playerPtsMap).sort((a, b) => b.pts - a.pts)[0]

    const totalPts = scores.find(s => s.player_id === pid)?.points ?? 0
    const rank = sortedScores.findIndex(s => s.player_id === pid) + 1

    return {
      playerId: pid, playerName: player.name,
      totalPreds: myPreds.length, exact, correctResult, wrong,
      favPred: favEntry?.[0] ?? null, favPredCount: favEntry?.[1] ?? 0,
      bestMatchLabel: bestEntry ? matchLabel(bestEntry[0]) : '—',
      bestMatchPts: bestEntry?.[1] ?? 0,
      worstMatchLabel: worstEntry ? matchLabel(worstEntry[0]) : '—',
      worstMatchPts: worstEntry?.[1] ?? 0,
      bestTeamName: bestTeamData?.name ?? null, bestTeamPts: bestTeamEntry?.[1] ?? 0,
      topPlayerName: topP?.name ?? null, topPlayerPts: topP?.pts ?? 0, topPlayerPhoto: topP?.photo ?? null,
      streakBest, winsCount, totalPts, rank,
    }
  })
}

function StatsTab({ leagueId, players, myId, scores, onOpenWrapped }: { leagueId: string; players: Player[]; myId: string | null; scores: Score[]; onOpenWrapped: () => void }) {
  const [stats, setStats] = useState<PlayerStats[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAllStats(leagueId, players, scores).then(result => {
      setStats(result)
      setSelected(myId ?? result[0]?.playerId ?? null)
      setLoading(false)
    })
  }, [leagueId, players, myId, scores])

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
      <span className="text-2xl mr-3 animate-bounce">⏳</span> Cargando estadísticas…
    </div>
  )
  if (!stats) return null

  const s = stats.find(x => x.playerId === selected) ?? stats[0]
  if (!s) return null

  const accuracy = s.totalPreds > 0 ? Math.round(((s.exact + s.correctResult) / s.totalPreds) * 100) : 0
  const mostExact    = [...stats].sort((a, b) => b.exact - a.exact)[0]
  const bestStreak   = [...stats].sort((a, b) => b.streakBest - a.streakBest)[0]
  const mostPreds    = [...stats].sort((a, b) => b.totalPreds - a.totalPreds)[0]
  const bestAccuracy = [...stats].sort((a, b) => {
    const ra = a.totalPreds > 0 ? (a.exact + a.correctResult) / a.totalPreds : 0
    const rb = b.totalPreds > 0 ? (b.exact + b.correctResult) / b.totalPreds : 0
    return rb - ra
  })[0]

  function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1">
        <span className="text-xl">{icon}</span>
        <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wider">{label}</p>
        <p className="text-base font-black leading-tight">{value}</p>
        {sub && <p className="text-xs text-[var(--text-secondary)]">{sub}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {myId && (
        <button
          onClick={onOpenWrapped}
          className="w-full bg-gradient-to-r from-[#7B2D8B] to-[#E8365D] text-white rounded-2xl px-5 py-4 flex items-center justify-between font-black text-base shadow-lg hover:opacity-90 transition-opacity">
          <span className="flex items-center gap-3">
            <span className="text-2xl">🎁</span>
            <span>Ver tu Wrapped 2026</span>
          </span>
          <span className="text-white/70 text-sm font-medium">Tu resumen →</span>
        </button>
      )}
      <div className="flex gap-2 flex-wrap">
        {stats.map(st => (
          <button key={st.playerId} onClick={() => setSelected(st.playerId)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors border ${
              selected === st.playerId
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'
            }`}>
            {st.playerName}
          </button>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-black mb-3">📊 {s.playerName}</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon="🏆" label="Partidos ganados" value={`${s.winsCount}`} sub="Victorias + wildcards acertados" />
          <StatCard icon="🔮" label="Resultado exacto" value={`${s.exact} porras`} sub={s.totalPreds > 0 ? `${Math.round((s.exact / s.totalPreds) * 100)}% del total` : ''} />
          <StatCard icon="🔁" label="Porra favorita" value={s.favPred ?? '—'} sub={s.favPredCount > 1 ? `Jugada ${s.favPredCount} veces` : 'Solo una vez'} />
          <StatCard icon="🔥" label="Racha de victorias" value={`${s.streakBest} seguidos`} sub="Máxima racha consecutiva" />
          <StatCard icon="⭐" label="Mejor partido" value={`+${fmtPts(s.bestMatchPts)} pts`} sub={s.bestMatchLabel} />
          <StatCard icon="💀" label="Peor partido" value={`${fmtPts(s.worstMatchPts)} pts`} sub={s.worstMatchLabel} />
          <StatCard icon="🏅" label="Equipo más valioso" value={s.bestTeamName ?? '—'} sub={s.bestTeamPts > 0 ? `${fmtPts(s.bestTeamPts)} pts acumulados` : ''} />
          {s.topPlayerName && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {s.topPlayerPhoto
                  ? <img src={s.topPlayerPhoto} alt={s.topPlayerName} className="w-8 h-8 rounded-full object-cover" onError={e => { (e.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
                  : <span className="text-xl">🌟</span>}
                <div>
                  <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wider">Jugador estrella</p>
                  <p className="text-base font-black leading-tight">{s.topPlayerName}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{fmtPts(s.topPlayerPts)} pts en eventos</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider mb-3">Desglose de porras</p>
        <div className="flex rounded-full overflow-hidden h-4 mb-2">
          {s.totalPreds > 0 && <>
            <div className="bg-emerald-500" style={{ width: `${(s.exact / s.totalPreds) * 100}%` }} />
            <div className="bg-yellow-400" style={{ width: `${(s.correctResult / s.totalPreds) * 100}%` }} />
            <div className="bg-[var(--border)]" style={{ width: `${(s.wrong / s.totalPreds) * 100}%` }} />
          </>}
        </div>
        <div className="flex gap-4 text-xs text-[var(--text-secondary)]">
          <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Exactas {s.exact}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-yellow-400 mr-1" />Resultado {s.correctResult}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-[var(--border)] mr-1" />Falladas {s.wrong}</span>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-black mb-3">🏆 Records de la liga</h2>
        <div className="flex flex-col gap-2">
          {[
            { icon: '🎯', label: 'Más aciertos exactos', name: mostExact.playerName, value: `${mostExact.exact} exactas` },
            { icon: '🔥', label: 'Mayor racha', name: bestStreak.playerName, value: `${bestStreak.streakBest} seguidos` },
            { icon: '📈', label: 'Mejor % de acierto', name: bestAccuracy.playerName, value: `${Math.round(((bestAccuracy.exact + bestAccuracy.correctResult) / Math.max(1, bestAccuracy.totalPreds)) * 100)}%` },
            { icon: '📋', label: 'Más partidos jugados', name: mostPreds.playerName, value: `${mostPreds.totalPreds} porras` },
          ].map(r => (
            <div key={r.label} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">{r.icon}</span>
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">{r.label}</p>
                  <p className="font-bold text-sm">{r.name}</p>
                </div>
              </div>
              <span className="text-sm font-black text-[var(--accent)]">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-black mb-3">📋 Comparativa</h2>
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--text-secondary)]">
                <th className="text-left px-4 py-2">Jugador</th>
                <th className="text-center px-2 py-2">Exactas</th>
                <th className="text-center px-2 py-2">Aciertos</th>
                <th className="text-center px-2 py-2">Racha</th>
              </tr>
            </thead>
            <tbody>
              {[...stats].sort((a, b) => b.exact - a.exact).map(st => (
                  <tr key={st.playerId} onClick={() => setSelected(st.playerId)}
                    className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition-colors ${selected === st.playerId ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--border)]/30'}`}>
                    <td className="px-4 py-2 font-semibold">{st.playerName}</td>
                    <td className="text-center px-2 py-2 tabular-nums">{st.exact}</td>
                    <td className="text-center px-2 py-2 tabular-nums">{st.exact + st.correctResult}</td>
                    <td className="text-center px-2 py-2 tabular-nums">{st.streakBest}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── WRAPPED MODAL ────────────────────────────────────────────

const WRAPPED_GRADIENTS = [
  'from-[#1DB954] to-[#0a2e14]',
  'from-[#7B2D8B] to-[#1a0a2e]',
  'from-[#E8365D] to-[#2d0a15]',
  'from-[#F59E0B] to-[#1c1000]',
  'from-[#3B82F6] to-[#0a1a3d]',
  'from-[#10B981] to-[#002d1a]',
  'from-[#8B5CF6] to-[#1a0a3d]',
  'from-[#EC4899] to-[#2d0a1a]',
  'from-[#14B8A6] to-[#001a19]',
  'from-[#F97316] to-[#2d0900]',
  'from-[#6366F1] to-[#0a0a2d]',
  'from-[#EF4444] to-[#1a0000]',
]

function rankLabel(rank: number, total: number): string {
  if (rank === 1) return '1º. Sin discusión.'
  if (rank === 2) return '2º. Casi, casi.'
  if (rank === total) return `${rank}º y último.`
  return `${rank}º de ${total}`
}

function WrappedModal({ leagueId, players, myId, scores, onClose }: {
  leagueId: string; players: Player[]; myId: string; scores: Score[]; onClose: () => void
}) {
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [allStats, setAllStats] = useState<PlayerStats[]>([])
  const [slide, setSlide] = useState(0)
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    loadAllStats(leagueId, players, scores).then(result => {
      setAllStats(result)
      const me = result.find(s => s.playerId === myId) ?? result[0]
      setStats(me)
      setLoading(false)
      setTimeout(() => setVisible(true), 30)
    })
  }, [leagueId, players, myId, scores])

  const slides = stats ? buildSlides(stats, allStats) : []

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= slides.length) { onClose(); return }
    setVisible(false)
    setTimeout(() => { setSlide(idx); setVisible(true) }, 200)
  }

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, currentTarget } = e
    const mid = currentTarget.getBoundingClientRect().width / 2
    goTo(clientX > mid ? slide + 1 : slide - 1)
  }

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <div className="text-white text-center">
        <div className="text-5xl mb-4 animate-bounce">🎁</div>
        <p className="text-xl font-black">Preparando tu Wrapped…</p>
      </div>
    </div>
  )
  if (!stats || slides.length === 0) return null

  const current = slides[slide]
  const grad = WRAPPED_GRADIENTS[slide % WRAPPED_GRADIENTS.length]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <div
        className={`relative w-full max-w-sm h-[93dvh] bg-gradient-to-b ${grad} rounded-t-3xl overflow-hidden flex flex-col select-none`}
        onClick={handleTap}
      >
        {/* Progress bar */}
        <div className="flex gap-1 px-4 pt-5 pb-0 shrink-0 z-10">
          {slides.map((_, i) => (
            <div key={i} className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/20">
              <div className={`h-full rounded-full transition-all duration-300 ${i < slide ? 'bg-white' : i === slide ? 'bg-white w-full' : 'bg-transparent w-0'}`} />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-0 shrink-0 z-10">
          <p className="text-white/60 text-xs font-bold uppercase tracking-widest">Tu Wrapped 2026</p>
          <button
            onClick={e => { e.stopPropagation(); onClose() }}
            className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white text-sm">
            ✕
          </button>
        </div>

        {/* Slide content */}
        <div className={`flex-1 flex flex-col items-center justify-center px-8 text-center gap-5 transition-all duration-200 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
          <div className="text-[80px] leading-none drop-shadow-2xl">{current.emoji}</div>
          {current.context && (
            <p className="text-white/50 text-xs uppercase tracking-[0.2em] font-semibold">{current.context}</p>
          )}
          <div className="flex flex-col items-center gap-2">
            {current.pre && <p className="text-white/70 text-lg leading-snug">{current.pre}</p>}
            <p className="text-white font-black leading-tight drop-shadow-lg" style={{ fontSize: 'clamp(1.8rem, 9vw, 3rem)' }}>
              {current.stat}
            </p>
            {current.post && <p className="text-white/70 text-base leading-snug">{current.post}</p>}
          </div>
          {current.sub && (
            <p className="text-white/40 text-sm leading-relaxed max-w-[260px]">{current.sub}</p>
          )}
        </div>

        {/* Tap hint + counter */}
        <div className="flex items-center justify-between px-6 pb-8 shrink-0">
          <p className="text-white/20 text-xs">← toca los lados para navegar →</p>
          <p className="text-white/30 text-xs tabular-nums">{slide + 1}/{slides.length}</p>
        </div>
      </div>
    </div>
  )
}

interface WrappedSlide {
  emoji: string
  context?: string
  pre?: string
  stat: string
  post?: string
  sub?: string
}

function buildSlides(s: PlayerStats, all: PlayerStats[]): WrappedSlide[] {
  const accuracy  = s.totalPreds > 0 ? Math.round(((s.exact + s.correctResult) / s.totalPreds) * 100) : 0
  const exactPct  = s.totalPreds > 0 ? Math.round((s.exact / s.totalPreds) * 100) : 0
  const sorted    = [...all].sort((a, b) => b.totalPts - a.totalPts)
  const champion  = sorted[0]
  const topExact  = [...all].sort((a, b) => b.exact - a.exact)[0]
  const topStreak = [...all].sort((a, b) => b.streakBest - a.streakBest)[0]
  const isBestExact  = topExact.playerId === s.playerId
  const isBestStreak = topStreak.playerId === s.playerId
  const isChampion   = champion.playerId === s.playerId

  const slides: WrappedSlide[] = [
    {
      emoji: '🌍',
      context: 'Fantasy Mundial 2026',
      pre: `${s.playerName},`,
      stat: 'Este fue tu Mundial.',
      sub: 'Toca para descubrir tu resumen del torneo.',
    },
    {
      emoji: '📋',
      context: 'Participación',
      pre: 'Jugaste tu porra en',
      stat: `${s.totalPreds} partidos`,
      sub: s.totalPreds >= 60 ? '¡Sin fallar ni uno! Eso es dedicación.' : s.totalPreds >= 48 ? 'Muy constante. Estuviste en casi todo.' : `Te perdiste algunos. Tampoco pasa nada.`,
    },
    {
      emoji: '🎯',
      context: 'Acierto',
      pre: 'Acertaste el resultado en',
      stat: `${s.exact + s.correctResult} de ${s.totalPreds}`,
      post: `un ${accuracy}% de éxito`,
      sub: accuracy >= 60 ? 'Eso te pone entre los mejores predictores.' : accuracy >= 45 ? 'Cerca de la media. Digno.' : 'Hay margen de mejora. Mucho margen.',
    },
    {
      emoji: '🔮',
      context: 'Resultado exacto',
      pre: 'Adivinaste el marcador exacto',
      stat: `${s.exact} ${s.exact === 1 ? 'vez' : 'veces'}`,
      post: `el ${exactPct}% de tus partidos`,
      sub: isBestExact
        ? '¡El más afinado de la liga! Ojo clínico de primer nivel.'
        : `${topExact.playerName} fue quien más acertó, con ${topExact.exact} exactas.`,
    },
    {
      emoji: '🔁',
      context: 'Tu porra favorita',
      pre: 'La apostaste',
      stat: s.favPred ? `el ${s.favPred}` : '—',
      post: s.favPredCount > 1 ? `${s.favPredCount} veces seguidas` : 'solo una vez',
      sub: s.favPredCount >= 8 ? '¿Trampa mental o convicción total?' : s.favPredCount >= 5 ? 'Claramente tu resultado de cabecera.' : 'Variado el repertorio.',
    },
    {
      emoji: '🔥',
      context: 'Racha de victorias',
      pre: 'Tu mejor racha fue de',
      stat: `${s.streakBest} victorias seguidas`,
      sub: isBestStreak
        ? '¡La mejor racha de toda la liga! Un auténtico ganador.'
        : `La racha más larga del grupo fue de ${topStreak.playerName} con ${topStreak.streakBest} victorias consecutivas.`,
    },
    {
      emoji: '⭐',
      context: 'Tu mejor noche',
      pre: 'Rascaste',
      stat: `+${fmtPts(s.bestMatchPts)} pts`,
      post: s.bestMatchLabel,
      sub: 'Todo salió redondo ese día. Porra, jugadores, resultado... perfecto.',
    },
    {
      emoji: '💀',
      context: 'Tu peor pesadilla',
      stat: s.worstMatchLabel,
      post: `solo ${fmtPts(s.worstMatchPts)} pts`,
      sub: 'No fue tu día. Hay que saberlo aceptar y pasar página.',
    },
    ...(s.bestTeamName ? [{
      emoji: '🏅',
      context: 'Tu equipo fetiche',
      pre: 'Tu mina de oro fue',
      stat: s.bestTeamName,
      post: `${fmtPts(s.bestTeamPts)} pts acumulados`,
      sub: 'Buen draft. Ojo clínico.',
    } as WrappedSlide] : []),
    ...(s.topPlayerName ? [{
      emoji: '🌟',
      context: 'Tu jugador estrella',
      pre: 'El jugador que más te aportó fue',
      stat: s.topPlayerName,
      post: `${fmtPts(s.topPlayerPts)} pts en eventos`,
      sub: 'Goles, asistencias, porterías a cero... Qué temporada.',
    } as WrappedSlide] : []),
    {
      emoji: isChampion ? '👑' : s.rank === all.length ? '🫠' : '🏆',
      context: 'Clasificación final',
      pre: 'Terminaste',
      stat: rankLabel(s.rank, all.length),
      post: `con ${fmtPts(s.totalPts)} puntos`,
      sub: isChampion
        ? '¡Campeón de la liga! El mejor del grupo sin duda.'
        : `La campeona fue ${champion.playerName} con ${fmtPts(champion.totalPts)} pts. El año que viene será tuyo.`,
    },
    {
      emoji: '🎁',
      context: 'Fantasy Mundial 2026',
      pre: 'Gracias por jugar,',
      stat: s.playerName + '.',
      sub: `${s.totalPreds} porras · ${s.exact} exactas · ${s.streakBest} racha máx · ${fmtPts(s.totalPts)} pts`,
    },
  ]

  return slides
}
