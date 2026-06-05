'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, getPlayerId } from '../../../lib/supabase'
import type { League, Player, Score, DraftedTeam, Match, Prediction } from '../../../types'

type Tab = 'standings' | 'my-teams' | 'matches' | 'admin'

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
  const [tab, setTab] = useState<Tab>('standings')
  const [myId, setMyId] = useState<string | null>(null)
  const [liveScores, setLiveScores] = useState<Score[]>(scores)
  const [liveMatches, setLiveMatches] = useState<Match[]>(matches)

  useEffect(() => { setMyId(getPlayerId()) }, [])

  const isAdmin = myId === league.admin_player_id

  // Realtime scores
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

  const myTeams = draftedTeams.filter(dt => dt.player_id === myId)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'standings',  label: '🏆 Tabla' },
    { id: 'my-teams',   label: '⚽ Mis equipos' },
    { id: 'matches',    label: '📋 Partidos' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: '⚙️ Admin' }] : []),
  ]

  return (
    <main className="min-h-dvh flex flex-col max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-4">
        <p className="text-[var(--text-secondary)] text-xs uppercase tracking-widest">{league.code}</p>
        <h1 className="text-2xl font-black">{league.name}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-1 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-w-max py-2 px-3 text-sm font-semibold rounded-lg whitespace-nowrap transition-colors ${
              tab === t.id ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'standings' && <StandingsTab scores={liveScores} players={players} myId={myId} />}
      {tab === 'my-teams' && <MyTeamsTab myTeams={myTeams} draftedTeams={draftedTeams} />}
      {tab === 'matches' && <MatchesTab matches={liveMatches} leagueId={league.id} myId={myId} players={players} draftedTeams={draftedTeams} />}
      {tab === 'admin' && isAdmin && <AdminTab league={league} matches={liveMatches} players={players} router={router} />}
    </main>
  )
}

// ─── CLASIFICACIÓN ───────────────────────────────────────
function StandingsTab({ scores, players, myId }: { scores: Score[]; players: Player[]; myId: string | null }) {
  // Incluir jugadores sin puntos
  const allEntries = players.map(p => {
    const s = scores.find(s => s.player_id === p.id)
    return { player: p, points: s?.points ?? 0 }
  }).sort((a, b) => b.points - a.points)

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clasificación</p>
      </div>
      {allEntries.map((entry, i) => (
        <div key={entry.player.id} className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0 ${entry.player.id === myId ? 'bg-[var(--accent)]/5' : ''}`}>
          <span className={`w-6 text-center font-bold text-sm ${i === 0 ? 'text-[var(--yellow)]' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-[var(--text-secondary)]'}`}>
            {i + 1}
          </span>
          <span className="flex-1 font-medium">
            {entry.player.name}
            {entry.player.id === myId && <span className="ml-2 text-xs text-[var(--text-secondary)]">(tú)</span>}
          </span>
          <span className="font-black text-lg">{entry.points}</span>
          <span className="text-xs text-[var(--text-secondary)]">pts</span>
        </div>
      ))}
    </div>
  )
}

// ─── MIS EQUIPOS ─────────────────────────────────────────
function MyTeamsTab({ myTeams, draftedTeams }: { myTeams: DraftedTeam[]; draftedTeams: DraftedTeam[] }) {
  // Agrupar todos los equipos por jugador
  const byPlayer = draftedTeams.reduce<Record<string, DraftedTeam[]>>((acc, dt) => {
    const key = dt.player_id
    acc[key] = acc[key] ?? []
    acc[key].push(dt)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Mis selecciones ({myTeams.length})</p>
        </div>
        {myTeams.length === 0 ? (
          <p className="px-4 py-6 text-center text-[var(--text-secondary)]">No tienes selecciones todavía</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {myTeams.map(dt => (
              <div key={dt.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-2xl">{dt.team?.flag_emoji}</span>
                <span className="font-semibold">{dt.team?.name}</span>
                <span className="ml-auto text-xs text-[var(--text-secondary)]">Pick #{dt.pick_number}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Todos los jugadores y sus equipos */}
      {Object.entries(byPlayer).map(([pid, teams]) => {
        const playerName = teams[0]?.player?.name ?? pid
        return (
          <div key={pid} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="text-sm font-bold">{playerName}</p>
            </div>
            <div className="flex flex-wrap gap-2 p-3">
              {teams.map(dt => (
                <span key={dt.id} className="flex items-center gap-1.5 bg-[var(--bg-elevated)] px-2.5 py-1.5 rounded-lg text-sm">
                  <span>{dt.team?.flag_emoji}</span>
                  <span>{dt.team?.name}</span>
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── PARTIDOS Y PORRAS ────────────────────────────────────
function MatchesTab({
  matches, leagueId, myId, players, draftedTeams,
}: {
  matches: Match[]
  leagueId: string
  myId: string | null
  players: Player[]
  draftedTeams: DraftedTeam[]
}) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [localGoals, setLocalGoals] = useState<Record<string, string>>({})
  const [visitorGoals, setVisitorGoals] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!myId) return
    supabase.from('predictions').select('*').eq('player_id', myId)
      .then(({ data }) => { if (data) setPredictions(data) })
  }, [myId])

  // ¿El jugador actual es dueño de alguno de los dos equipos del partido?
  function canPredict(match: Match) {
    if (!myId) return false
    const myTeamIds = draftedTeams.filter(dt => dt.player_id === myId).map(dt => dt.team_id)
    return myTeamIds.includes(match.home_team_id) || myTeamIds.includes(match.away_team_id)
  }

  async function submitPrediction(matchId: string) {
    if (!myId) return
    const h = parseInt(localGoals[matchId] ?? '')
    const a = parseInt(visitorGoals[matchId] ?? '')
    if (isNaN(h) || isNaN(a)) { alert('Introduce goles válidos'); return }
    setSaving(matchId)
    await supabase.from('predictions').upsert({
      match_id: matchId, player_id: myId, home_goals: h, away_goals: a,
    }, { onConflict: 'match_id,player_id' })
    const { data } = await supabase.from('predictions').select('*').eq('player_id', myId)
    if (data) setPredictions(data)
    setSaving(null)
  }

  const scheduled = matches.filter(m => m.status === 'scheduled')
  const finished   = matches.filter(m => m.status === 'finished')

  return (
    <div className="space-y-6">
      {/* Próximos */}
      <section>
        <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Próximos partidos
        </h2>
        {scheduled.length === 0 ? (
          <p className="text-[var(--text-secondary)] text-sm">No hay partidos programados</p>
        ) : (
          <div className="space-y-3">
            {scheduled.map(m => {
              const myPred = predictions.find(p => p.match_id === m.id)
              const able = canPredict(m)
              return (
                <div key={m.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <TeamBadge team={m.home_team} />
                    <span className="text-[var(--text-secondary)] font-bold">vs</span>
                    <TeamBadge team={m.away_team} right />
                  </div>
                  {m.match_date && (
                    <p className="text-xs text-center text-[var(--text-secondary)] mb-3">
                      {new Date(m.match_date).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  )}
                  {able && (
                    <div className="border-t border-[var(--border)] pt-3">
                      <p className="text-xs text-[var(--text-secondary)] mb-2">
                        Tu porra {myPred ? `(actual: ${myPred.home_goals}-${myPred.away_goals})` : ''}
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0" max="20"
                          defaultValue={myPred?.home_goals ?? ''}
                          onChange={e => setLocalGoals(p => ({ ...p, [m.id]: e.target.value }))}
                          className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]"
                        />
                        <span className="text-[var(--text-secondary)]">-</span>
                        <input
                          type="number" min="0" max="20"
                          defaultValue={myPred?.away_goals ?? ''}
                          onChange={e => setVisitorGoals(p => ({ ...p, [m.id]: e.target.value }))}
                          className="w-14 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-center font-bold text-white focus:outline-none focus:border-[var(--accent)]"
                        />
                        <button
                          onClick={() => submitPrediction(m.id)}
                          disabled={saving === m.id}
                          className="ml-auto px-3 py-1.5 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                        >
                          {saving === m.id ? '…' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Finalizados */}
      {finished.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Finalizados</h2>
          <div className="space-y-2">
            {finished.map(m => (
              <div key={m.id} className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                <span className="text-lg">{m.home_team?.flag_emoji}</span>
                <span className="text-sm font-medium flex-1 truncate">{m.home_team?.name}</span>
                <span className="font-black tabular-nums">{m.home_goals} - {m.away_goals}</span>
                <span className="text-sm font-medium flex-1 text-right truncate">{m.away_team?.name}</span>
                <span className="text-lg">{m.away_team?.flag_emoji}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── ADMIN ────────────────────────────────────────────────
function AdminTab({ league, matches, players, router }: {
  league: League; matches: Match[]; players: Player[]; router: ReturnType<typeof useRouter>
}) {
  const [teams, setTeams] = useState<import('../../../types').Team[]>([])
  const [homeId, setHomeId] = useState('')
  const [awayId, setAwayId] = useState('')
  const [date, setDate] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    supabase.from('teams').select('*').order('name').then(({ data }) => { if (data) setTeams(data) })
  }, [])

  async function createMatch() {
    if (!homeId || !awayId || homeId === awayId) { alert('Selecciona dos equipos distintos'); return }
    setCreating(true)
    const { error } = await supabase.from('matches').insert({
      league_id: league.id,
      home_team_id: homeId,
      away_team_id: awayId,
      match_date: date || null,
    })
    if (error) alert(error.message)
    setCreating(false)
    router.refresh()
  }

  async function setResult(matchId: string, h: number, a: number) {
    await supabase.from('matches').update({ home_goals: h, away_goals: a, status: 'finished' }).eq('id', matchId)
    // Llamar a la función de Supabase para recalcular puntos
    await supabase.rpc('recalculate_scores', { p_match_id: matchId })
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Crear partido */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
        <h2 className="font-bold mb-4">Crear partido</h2>
        <div className="space-y-3">
          <select value={homeId} onChange={e => setHomeId(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
            <option value="">Equipo local…</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
          </select>
          <select value={awayId} onChange={e => setAwayId(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none">
            <option value="">Equipo visitante…</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.flag_emoji} {t.name}</option>)}
          </select>
          <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-white focus:outline-none" />
          <button onClick={createMatch} disabled={creating}
            className="w-full py-2.5 bg-[var(--accent)] text-white font-bold rounded-xl disabled:opacity-50">
            {creating ? 'Creando…' : 'Crear partido'}
          </button>
        </div>
      </div>

      {/* Introducir resultados */}
      <div className="space-y-3">
        <h2 className="font-bold text-[var(--text-secondary)] text-sm uppercase tracking-wider">Introducir resultados</h2>
        {matches.filter(m => m.status === 'scheduled').map(m => (
          <MatchResultRow key={m.id} match={m} onSave={setResult} />
        ))}
        {matches.filter(m => m.status === 'scheduled').length === 0 && (
          <p className="text-[var(--text-secondary)] text-sm">No hay partidos pendientes</p>
        )}
      </div>
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
      <button
        onClick={() => onSave(match.id, parseInt(h), parseInt(a))}
        disabled={h === '' || a === ''}
        className="px-3 py-1 bg-[var(--green)] text-black text-sm font-bold rounded-lg disabled:opacity-40"
      >
        ✓
      </button>
    </div>
  )
}

function TeamBadge({ team, right }: { team?: import('../../../types').Team; right?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
      <span className="text-2xl">{team?.flag_emoji}</span>
      <span className="font-semibold text-sm max-w-[80px] truncate">{team?.name}</span>
    </div>
  )
}
