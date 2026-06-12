'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, DEFAULT_PLAYER_IMG } from '../../../lib/supabase'
import type {
  League, Player, Score, DraftedTeam, Match, Prediction,
  SquadPlayer, MatchLineup, PlayerEvent,
} from '../../../types'
import RulesModal from '../../../components/RulesModal'
import PushSubscribeButton from '../../../components/PushSubscribeButton'

type Tab = 'standings' | 'my-teams' | 'matches' | 'mundial' | 'admin'

const STAGE_LABELS: Record<string, string> = { r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinal', final: 'Final' }
const STAGE_PTS:   Record<string, number>  = { r16: 1, qf: 3, sf: 5, final: 8 }

const LOCK_BEFORE_MS   = 2 * 60 * 60 * 1000   // se bloquea 2h antes
const REMIND_FROM_MS   = 24 * 60 * 60 * 1000  // recordatorio desde 24h antes
const REVEAL_BEFORE_MS = 1 * 60 * 60 * 1000   // porras y jugadores visibles 1h antes

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
  const playerIds = new Set(players.map(p => p.id))
  const [liveScores, setLiveScores] = useState<Score[]>(scores.filter(s => playerIds.has(s.player_id)))
  const [liveMatches, setLiveMatches] = useState<Match[]>(matches)
  const [matchesUpdatedAt, setMatchesUpdatedAt] = useState<Date | null>(null)
  const [showRules, setShowRules]   = useState(false)
  const [showSettings, setShowSettings] = useState(false)

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
        if (data) setLiveScores(data.filter(s => playerIds.has(s.player_id)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, async () => {
        const { data } = await supabase.from('matches')
          .select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)')
          .or(`league_id.is.null,league_id.eq.${league.id}`).order('match_date')
        if (data) { setLiveMatches(data); setMatchesUpdatedAt(new Date()) }
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

      {tab === 'standings' && <StandingsTab scores={liveScores} players={players} myId={myId} leagueId={league.id} />}
      {tab === 'my-teams'  && <MyTeamsTab myId={myId} draftedTeams={draftedTeams} players={players} leagueId={league.id} />}
      {tab === 'matches'   && (
        <MatchesTab
          matches={liveMatches} leagueId={league.id}
          myId={myId} draftedTeams={draftedTeams}
          updatedAt={matchesUpdatedAt}
          league={league} players={players}
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
          flag:      d.flag_emoji,
          photo_url: d.photo_url,
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
            <div className="relative shrink-0">
              <img src={s.photo_url ?? DEFAULT_PLAYER_IMG} alt="" className="w-9 h-9 rounded-full object-cover bg-[var(--bg-elevated)]"
                onError={ev => { (ev.target as HTMLImageElement).src = DEFAULT_PLAYER_IMG }} />
              <span className="absolute -bottom-1 -right-1 text-xs">{s.flag}</span>
            </div>
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

// ─── PORRAS Y JUGADORES DE TODOS (visible 1h antes) ──────────

function AllPredictionsReveal({ match, players, leagueId }: {
  match: Match
  players: Player[]
  leagueId: string
}) {
  const [preds, setPreds]     = useState<{ player_id: string; home_goals: number; away_goals: number }[]>([])
  const [lineups, setLineups] = useState<{ player_id: string; squad_player: SquadPlayer }[]>([])
  const [open, setOpen]       = useState(false)
  const [loaded, setLoaded]   = useState(false)

  useEffect(() => {
    if (!open || loaded) return
    Promise.all([
      supabase.from('predictions').select('player_id, home_goals, away_goals')
        .eq('match_id', match.id).eq('is_wildcard', false),
      supabase.from('match_lineups').select('player_id, squad_player:squad_players(*)')
        .eq('match_id', match.id).eq('is_wildcard', false),
    ]).then(([pr, lu]) => {
      setPreds(pr.data ?? [])
      setLineups((lu.data as any[]) ?? [])
      setLoaded(true)
    })
  }, [open, loaded, match.id])

  const playerName = (id: string) => players.find(p => p.id === id)?.name ?? '?'

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
          {players.map(pl => {
            const pred = preds.find(p => p.player_id === pl.id)
            const plLineup = lineups.filter(l => l.player_id === pl.id)
            if (!pred && plLineup.length === 0) return null
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
                {plLineup.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {plLineup.map((l, i) => (
                      <span key={i} className="text-[11px] bg-[var(--bg-surface)] px-2 py-0.5 rounded-lg">
                        {l.squad_player.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {preds.length === 0 && lineups.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)]">Nadie ha enviado porra o jugadores aún</p>
          )}
        </div>
      )}
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
  matches, leagueId, myId, draftedTeams, updatedAt, league, players,
}: {
  matches: Match[]
  leagueId: string
  myId: string | null
  draftedTeams: DraftedTeam[]
  updatedAt: Date | null
  league: League
  players: Player[]
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
    if (!match.match_date) return 'upcoming'
    const elapsed = (Date.now() - new Date(match.match_date).getTime()) / 60000
    if (elapsed < 0) return 'upcoming'
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

  const [visibleMy, setVisibleMy]       = useState(5)
  const [visibleOther, setVisibleOther] = useState(5)
  const [myView, setMyView]             = useState<'pending' | 'finished'>('pending')
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000) // rerender cada 30s
    return () => clearInterval(t)
  }, [])

  const allMyMatches    = myId ? matches.filter(m => myTeamIds.includes(m.home_team_id ?? '') || myTeamIds.includes(m.away_team_id ?? '')) : []
  const allOtherMatches = matches.filter(m => !myTeamIds.includes(m.home_team_id ?? '') && !myTeamIds.includes(m.away_team_id ?? ''))
  const pendingMy   = allMyMatches.filter(m => m.status !== 'finished')
  const finishedMy  = allMyMatches.filter(m => m.status === 'finished')
  const myMatches    = pendingMy.slice(0, visibleMy)
  const otherMatches = allOtherMatches.slice(0, visibleOther)

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

  return (
    <div className="space-y-8">
      {updatedAt && (
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
                  {m.match_date && new Date(m.match_date).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
                      <div className="flex flex-col items-center gap-0.5">
                        {(() => {
                          const state = matchLiveState(m)
                          if (state === 'finished') return <span className="font-black text-xl tabular-nums">{m.home_goals} - {m.away_goals}</span>
                          if (state === 'live') return (
                            <>
                              <span className="font-black text-xl tabular-nums">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                              <span className="text-[10px] font-bold text-red-400 animate-pulse">{matchMinute(m)}&apos;</span>
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
                    {m.match_date && (
                      <p className="text-xs text-center text-[var(--text-secondary)] mb-3">
                        {matchLiveState(m) === 'live'
                          ? <span className="text-red-400 font-semibold">🔴 EN VIVO</span>
                          : matchLiveState(m) === 'halftime'
                          ? <span className="text-[var(--yellow)] font-semibold">⏸ Descanso</span>
                          : new Date(m.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
                        }
                        {' · '}{m.match_type === 'group' ? `Grupo ${m.home_team?.group_name ?? ''}` : STAGE_LABELS[m.match_type ?? ''] ?? m.match_type}
                      </p>
                    )}

                    {/* Eventos en vivo */}
                    {(matchLiveState(m) === 'live' || matchLiveState(m) === 'halftime') && (
                      <LiveMatchEvents matchId={m.id} homeTeamId={m.home_team_id} />
                    )}

                    {/* Wildcard */}
                    {league.wildcard_enabled && m.match_type && m.match_type !== 'group' && m.status !== 'finished' && myId &&
                      !myTeamIds.includes(m.home_team_id ?? '') && !myTeamIds.includes(m.away_team_id ?? '') && (
                      <WildcardButton match={m} leagueId={leagueId} myId={myId} />
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
                    <div className="flex flex-col items-center shrink-0">
                      {(() => {
                        const state = matchLiveState(m)
                        if (state === 'finished') return <span className="font-black tabular-nums text-sm">{m.home_goals} - {m.away_goals}</span>
                        if (state === 'live') return (
                          <>
                            <span className="font-black tabular-nums text-sm">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                            <span className="text-[9px] font-bold text-red-400 animate-pulse">{matchMinute(m)}&apos;</span>
                          </>
                        )
                        if (state === 'halftime') return (
                          <>
                            <span className="font-black tabular-nums text-sm">{m.home_goals ?? 0} - {m.away_goals ?? 0}</span>
                            <span className="text-[9px] font-bold text-[var(--yellow)]">DESC.</span>
                          </>
                        )
                        return <span className="text-[var(--text-secondary)] font-bold text-sm">vs</span>
                      })()}
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-sm font-medium truncate">{m.away_team?.name}</p>
                      {awayOwner && <p className="text-xs text-[var(--text-secondary)] truncate">{awayOwner}</p>}
                    </div>
                    <span className="text-lg">{m.away_team?.flag_emoji}</span>
                  </div>
                  {(matchLiveState(m) === 'live' || matchLiveState(m) === 'halftime') && (
                    <LiveMatchEvents matchId={m.id} homeTeamId={m.home_team_id} />
                  )}
                  {league.wildcard_enabled && m.match_type && m.match_type !== 'group' && m.status !== 'finished' && myId &&
                    m.home_team_id && m.away_team_id &&
                    !myTeamIds.includes(m.home_team_id) && !myTeamIds.includes(m.away_team_id) && (
                    <WildcardButton match={m} leagueId={leagueId} myId={myId} />
                  )}
                  {isRevealed(m) && (
                    <AllPredictionsReveal match={m} players={players} leagueId={league.id} />
                  )}
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
          <p className="text-xs text-center text-[var(--text-secondary)]">
            {hasGroupResults
              ? 'Cruces proyectados según la clasificación actual · los terceros son aproximados'
              : 'Cruces preliminares según las posiciones provisionales de los grupos'}
          </p>
          <KnockoutBracket
            knockoutMatches={knockoutMatches}
            slotResolution={slotResolution}
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

function KnockoutBracket({ knockoutMatches, slotResolution }: {
  knockoutMatches: Match[]
  slotResolution: Record<string, { name: string; flag_emoji: string; fifa_code?: string | null } | null>
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
              await supabase.from('leagues').update({ wildcard_enabled: newVal }).eq('id', league.id)
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
    const map: Record<string, { team: any; pts: number; gd: number; gf: number }> = {}
    for (const t of allTeams) map[t.id] = { team: t, pts: 0, gd: 0, gf: 0 }
    for (const m of matches) {
      if (m.match_type !== 'group' || m.status !== 'finished' || m.home_goals == null) continue
      const h = map[m.home_team_id ?? ''], a = map[m.away_team_id ?? '']
      if (!h || !a) continue
      h.gf += m.home_goals; h.gd += m.home_goals - m.away_goals!
      a.gf += m.away_goals!; a.gd += m.away_goals! - m.home_goals
      if (m.home_goals > m.away_goals!) h.pts += 3
      else if (m.home_goals === m.away_goals!) { h.pts++; a.pts++ }
      else a.pts += 3
    }
    const byGroup: Record<string, any[]> = {}
    for (const row of Object.values(map)) {
      const g = row.team.group_name ?? '?'
      ;(byGroup[g] ??= []).push(row)
    }
    for (const g of Object.keys(byGroup))
      byGroup[g].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
    return byGroup
  }

  async function autofillR32() {
    if (!confirm('¿Auto-rellenar la Ronda de 32 con la clasificación ACTUAL de grupos?')) return
    setBusy(true)
    const byGroup = computeGroupRanking()
    const thirds = Object.entries(byGroup).map(([g, rows]) => rows[2] ? { g, row: rows[2] } : null)
      .filter(Boolean).sort((a: any, b: any) => b.row.pts - a.row.pts || b.row.gd - a.row.gd) as any[]
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

function LiveMatchEvents({ matchId, homeTeamId }: { matchId: string; homeTeamId: string | null }) {
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

  if (events.length === 0) return null

  const EVENT_ICON: Record<string, string> = {
    goal: '⚽',
    goal_extra_time: '⚽',
    penalty_shootout: '⚽',
    own_goal: '🥅',
    red_card: '🟥',
  }

  const home = events.filter(e => e.squad_player?.team_id === homeTeamId)
  const away = events.filter(e => e.squad_player?.team_id !== homeTeamId)

  return (
    <div className="mt-2 mb-1">
    {updatedAt && (
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

function WildcardButton({ match, leagueId, myId }: {
  match: Match
  leagueId: string
  myId: string
}) {
  const [entry, setEntry] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('wildcard_entries')
      .select('*').eq('match_id', match.id).eq('player_id', myId).maybeSingle()
      .then(({ data }) => { setEntry(data); setLoaded(true) })
  }, [match.id, myId])

  if (!loaded) return null

  // Bloquear 2h antes
  const locked = match.match_date
    ? new Date(match.match_date).getTime() - 2 * 60 * 60 * 1000 <= Date.now()
    : false

  if (entry) {
    return (
      <p className="text-xs text-center text-[var(--accent)] mt-2">
        ⚡ Wildcard activo — equipo elegido: {entry.qualifier_pick ? '✓' : '?'}
      </p>
    )
  }

  if (locked) return null

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="w-full mt-2 py-2 rounded-xl border border-[var(--accent)]/50 text-[var(--accent)] text-sm font-semibold hover:bg-[var(--accent)]/10 transition-colors">
        ⚡ Entrar por 2 pts
      </button>
      {showModal && (
        <WildcardModal
          match={match} leagueId={leagueId} myId={myId}
          onClose={() => setShowModal(false)}
          onDone={(e) => { setEntry(e); setShowModal(false) }}
        />
      )}
    </>
  )
}

function WildcardModal({ match, leagueId, myId, onClose, onDone }: {
  match: Match
  leagueId: string
  myId: string
  onClose: () => void
  onDone: (entry: any) => void
}) {
  const [qualifierPick, setQualifierPick] = useState<string | null>(null)
  const [homeGoals, setHomeGoals] = useState('')
  const [awayGoals, setAwayGoals] = useState('')
  const [squadPlayers, setSquadPlayers] = useState<SquadPlayer[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!match.home_team_id || !match.away_team_id) return
    supabase.from('squad_players').select('*')
      .in('team_id', [match.home_team_id, match.away_team_id])
      .order('name')
      .then(({ data }) => setSquadPlayers(data ?? []))
  }, [match.home_team_id, match.away_team_id])

  function togglePlayer(id: string) {
    setSelectedPlayers(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 3 ? [...prev, id] : prev
    )
  }

  async function confirm() {
    if (!qualifierPick) { alert('Elige qué equipo pasa'); return }
    setSaving(true)
    try {
      // 1. Registrar entrada y descontar 2 pts
      const { error: entryErr } = await supabase.rpc('enter_wildcard', {
        p_league_id: leagueId, p_player_id: myId,
        p_match_id: match.id, p_qualifier_pick: qualifierPick,
      })
      if (entryErr) { alert(entryErr.message); return }

      // 2. Guardar porra wildcard
      if (homeGoals !== '' && awayGoals !== '') {
        await supabase.from('predictions').upsert({
          match_id: match.id, player_id: myId, league_id: leagueId,
          home_goals: parseInt(homeGoals), away_goals: parseInt(awayGoals),
          is_wildcard: true,
        }, { onConflict: 'match_id,player_id' })
      }

      // 3. Guardar alineación wildcard
      if (selectedPlayers.length > 0) {
        await supabase.from('match_lineups').delete()
          .eq('match_id', match.id).eq('player_id', myId).eq('is_wildcard', true)
        await supabase.from('match_lineups').insert(
          selectedPlayers.map(spId => ({
            match_id: match.id, player_id: myId, league_id: leagueId,
            team_id: squadPlayers.find(s => s.id === spId)?.team_id,
            squad_player_id: spId, is_wildcard: true,
          }))
        )
      }

      const { data: entry } = await supabase.from('wildcard_entries')
        .select('*').eq('match_id', match.id).eq('player_id', myId).maybeSingle()
      onDone(entry)
    } finally {
      setSaving(false)
    }
  }

  const homePlayers = squadPlayers.filter(s => s.team_id === match.home_team_id)
  const awayPlayers = squadPlayers.filter(s => s.team_id === match.away_team_id)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-surface)]">
          <p className="font-black text-lg">⚡ Wildcard <span className="text-[var(--red)] text-sm font-normal">-2 pts</span></p>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>
        <div className="p-4 space-y-5">

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
              <span className="text-sm">{match.home_team?.flag_emoji} {match.home_team?.name}</span>
              <input type="number" min={0} max={20} value={homeGoals} onChange={e => setHomeGoals(e.target.value)}
                className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-[var(--text-secondary)]">-</span>
              <input type="number" min={0} max={20} value={awayGoals} onChange={e => setAwayGoals(e.target.value)}
                className="w-12 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-black text-white text-lg focus:outline-none focus:border-[var(--accent)]" />
              <span className="text-sm">{match.away_team?.name} {match.away_team?.flag_emoji}</span>
            </div>
          </div>

          {/* Jugadores */}
          <div>
            <p className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              3 jugadores <span className="text-[var(--text-muted)]">({selectedPlayers.length}/3) — goles ×0.5</span>
            </p>
            {[{ label: match.home_team?.name ?? '', players: homePlayers },
              { label: match.away_team?.name ?? '', players: awayPlayers }].map(group => (
              <div key={group.label} className="mb-3">
                <p className="text-xs text-[var(--text-secondary)] mb-1">{group.label}</p>
                <div className="grid grid-cols-2 gap-1">
                  {group.players.map(sp => (
                    <button key={sp.id} onClick={() => togglePlayer(sp.id)}
                      className={`text-xs px-2 py-1.5 rounded-lg border text-left transition-colors ${
                        selectedPlayers.includes(sp.id)
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                          : selectedPlayers.length >= 3
                          ? 'border-[var(--border)] opacity-40'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50'
                      }`}>
                      {sp.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={confirm} disabled={saving || !qualifierPick}
            className="w-full py-3 bg-[var(--accent)] text-white font-black rounded-xl disabled:opacity-40 transition-opacity">
            {saving ? 'Guardando…' : '⚡ Confirmar (-2 pts)'}
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
    const { data: { session } } = await supabase.auth.getSession()
    const userIds = players.map(p => p.user_id).filter(Boolean) as string[]
    await fetch('/api/push/announce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ title: title.trim(), body: body.trim(), url: '/standings', userIds, leagueId: league.id }),
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
