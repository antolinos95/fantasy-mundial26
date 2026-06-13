import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world'
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Rate limit mínimo para evitar llamadas simultáneas en paralelo
let lastSyncMs = 0
const MIN_INTERVAL_MS = 10_000

// ESPN usa nombres en inglés; mapeamos a los nombres en español de nuestra BD
const ESPN_TO_ES: Record<string, string> = {
  'Germany': 'Alemania',
  'Saudi Arabia': 'Arabia Saudita',
  'Algeria': 'Argelia',
  'Argentina': 'Argentina',
  'Australia': 'Australia',
  'Austria': 'Austria',
  'Belgium': 'Bélgica',
  'Bosnia-Herzegovina': 'Bosnia y Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia y Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Brazil': 'Brasil',
  'Cape Verde': 'Cabo Verde',
  'Canada': 'Canadá',
  'Colombia': 'Colombia',
  'South Korea': 'Corea del Sur',
  'Korea Republic': 'Corea del Sur',
  "Côte d'Ivoire": 'Costa de Marfil',
  'Ivory Coast': 'Costa de Marfil',
  'Croatia': 'Croacia',
  'Curaçao': 'Curazao',
  'Curacao': 'Curazao',
  'DR Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Democratic Republic of Congo': 'DR Congo',
  'Ecuador': 'Ecuador',
  'Egypt': 'Egipto',
  'Scotland': 'Escocia',
  'Spain': 'España',
  'United States': 'Estados Unidos',
  'USA': 'Estados Unidos',
  'France': 'Francia',
  'Ghana': 'Ghana',
  'Haiti': 'Haití',
  'England': 'Inglaterra',
  'Iraq': 'Irak',
  'Iran': 'Irán',
  'Japan': 'Japón',
  'Jordan': 'Jordania',
  'Morocco': 'Marruecos',
  'Mexico': 'México',
  'Norway': 'Noruega',
  'New Zealand': 'Nueva Zelanda',
  'Netherlands': 'Países Bajos',
  'Panama': 'Panamá',
  'Paraguay': 'Paraguay',
  'Portugal': 'Portugal',
  'Qatar': 'Qatar',
  'Czech Republic': 'República Checa',
  'Czechia': 'República Checa',
  'Senegal': 'Senegal',
  'South Africa': 'Sudáfrica',
  'Sweden': 'Suecia',
  'Switzerland': 'Suiza',
  'Tunisia': 'Túnez',
  'Turkey': 'Turquía',
  'Türkiye': 'Turquía',
  'Uruguay': 'Uruguay',
  'Uzbekistan': 'Uzbekistán',
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Parsea "78'", "45'+2'", "90'+3'" → minuto entero
function parseMinute(displayValue: string): number {
  const m = displayValue.match(/^(\d+)/)
  return m ? parseInt(m[1]) : 0
}

function isAuthorized(req: NextRequest): boolean {
  if (req.headers.get('x-push-secret') === process.env.PUSH_SECRET) return true
  if (req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) return true
  return false
}

interface NewEvent {
  squad_player_id: string
  player_name: string
  team_id: string
  event_type: string
  minute: number | null
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = Date.now()
  if (now - lastSyncMs < MIN_INTERVAL_MS) {
    return NextResponse.json({ message: 'Too soon, skipped' })
  }
  lastSyncMs = now


  const today = new Date().toISOString().slice(0, 10)

  // Pre-check: ¿hay partidos no finalizados hoy?
  // Si los hay (aunque sean de hace horas), hay que consultar ESPN para actualizarlos.
  const { data: candidateMatches } = await supabaseAdmin
    .from('matches')
    .select('id, status')
    .neq('status', 'finished')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)

  if (!candidateMatches?.length) {
    return NextResponse.json({ message: 'No active match window', skipped: true })
  }

  // ESPN indexa los partidos en Eastern Time (EDT = UTC-4 en verano).
  // Un partido a las 01:00 UTC = 21:00 ET del día anterior → hay que pedir ese día en ESPN.
  // Calculamos la fecha ET actual y la pedimos junto con la siguiente para cubrir todos los casos.
  const ET_OFFSET_MS = 4 * 60 * 60 * 1000 // EDT = UTC-4
  const etNow        = new Date(now - ET_OFFSET_MS)
  const etToday      = etNow.toISOString().slice(0, 10).replace(/-/g, '')
  const etYesterday  = new Date(now - ET_OFFSET_MS - 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '')

  const [espnRes, espnPrevRes] = await Promise.all([
    fetch(`${ESPN_BASE}/scoreboard?dates=${etToday}`,     { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }),
    fetch(`${ESPN_BASE}/scoreboard?dates=${etYesterday}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }),
  ])

  if (!espnRes.ok) {
    return NextResponse.json({ error: `ESPN error: ${espnRes.status}` }, { status: 502 })
  }

  const espnData     = await espnRes.json()
  const espnPrevData = espnPrevRes.ok ? await espnPrevRes.json() : { events: [] }
  const espnEvents: any[] = [...(espnData.events ?? []), ...(espnPrevData.events ?? [])]

  // Quedarnos con partidos en juego o terminados (excluimos pre-partido sin datos)
  const activeEvents = espnEvents.filter(ev => {
    const state = ev.competitions?.[0]?.status?.type?.state
    return state === 'in' || state === 'post'
  })

  if (activeEvents.length === 0) {
    // No hay nada live ni terminado aún — partidos futuros, nada que hacer
    return NextResponse.json({ message: 'Matches scheduled but not started yet', skipped: true })
  }

  const [{ data: teams }, { data: ourMatches }] = await Promise.all([
    supabaseAdmin.from('teams').select('id, name'),
    supabaseAdmin
      .from('matches')
      .select('id, league_id, home_team_id, away_team_id, home_goals, away_goals, status, match_date')
      .gte('match_date', `${today}T00:00:00`)
      .lte('match_date', `${today}T23:59:59`),
  ])

  const teamByEs: Record<string, string> = {}
  for (const t of teams ?? []) teamByEs[t.name] = t.id

  let synced = 0
  const log: string[] = []

  for (const ev of activeEvents) {
    const comp = ev.competitions?.[0]
    if (!comp) continue

    const competitors: any[] = comp.competitors ?? []
    const homeComp = competitors.find((c: any) => c.homeAway === 'home')
    const awayComp = competitors.find((c: any) => c.homeAway === 'away')
    if (!homeComp || !awayComp) continue

    const homeEnName = homeComp.team?.displayName ?? ''
    const awayEnName = awayComp.team?.displayName ?? ''
    const homeEs = ESPN_TO_ES[homeEnName]
    const awayEs = ESPN_TO_ES[awayEnName]

    if (!homeEs || !awayEs) {
      log.push(`⚠ No mapping: ${homeEnName} vs ${awayEnName}`)
      continue
    }

    const homeId = teamByEs[homeEs]
    const awayId = teamByEs[awayEs]
    const ourMatch = ourMatches?.find(m => m.home_team_id === homeId && m.away_team_id === awayId)
    if (!ourMatch) {
      log.push(`⚠ Not in DB: ${homeEs} vs ${awayEs}`)
      continue
    }

    const statusType = comp.status?.type ?? {}
    const state = statusType.state // 'in' | 'post' | 'pre'
    const statusName: string = statusType.name ?? '' // STATUS_IN_PROGRESS, STATUS_HALFTIME, STATUS_FINAL, STATUS_FULL_TIME...

    const isLive     = state === 'in'
    const isFinished = state === 'post'

    const fdHomeGoals = parseInt(homeComp.score ?? '0') || 0
    const fdAwayGoals = parseInt(awayComp.score ?? '0') || 0

    const updates: Record<string, any> = {}
    if (fdHomeGoals !== ourMatch.home_goals) updates.home_goals = fdHomeGoals
    if (fdAwayGoals !== ourMatch.away_goals) updates.away_goals = fdAwayGoals
    if (isLive     && ourMatch.status !== 'live')     updates.status = 'live'
    if (isFinished && ourMatch.status !== 'finished') updates.status = 'finished'

    // Corrección de hora si el partido arrancó tarde
    if (isLive && ourMatch.status === 'scheduled') {
      const displayClock: string = comp.status?.displayClock ?? ''
      const elapsedMin = parseMinute(displayClock)
      if (elapsedMin > 0 && elapsedMin <= 45) {
        const calculatedKickoff = new Date(now - elapsedMin * 60 * 1000)
        const scheduledKickoff  = new Date(ourMatch.match_date)
        const diffMin = Math.abs(calculatedKickoff.getTime() - scheduledKickoff.getTime()) / 60000
        if (diffMin > 5) {
          updates.match_date = calculatedKickoff.toISOString()
          log.push(`⏰ Kick-off retrasado ${Math.round(diffMin)} min: ${homeEs} vs ${awayEs}`)
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('matches').update(updates).eq('id', ourMatch.id)
      log.push(`✓ Updated ${homeEs} vs ${awayEs}: ${JSON.stringify(updates)}`)
    }

    if (isLive || isFinished) {
      const details: any[] = comp.details ?? []
      // ESPN team IDs para saber a qué equipo pertenece cada evento
      const espnHomeId = homeComp.team?.id
      const espnAwayId = awayComp.team?.id

      const newEvents = await syncESPNEvents(
        ourMatch.id, details, homeId, awayId, espnHomeId, espnAwayId, isFinished
      )
      log.push(`✓ Events ${homeEs} vs ${awayEs}: ${details.length} details, ${newEvents.length} new`)

      // Solo notificar si el partido estaba live (no finished) en la DB antes de esta sync
      if (newEvents.length > 0 && ourMatch.status !== 'finished') {
        const teamNames: Record<string, string> = { [homeId]: homeEs, [awayId]: awayEs }
        const notifCount = await sendEventNotifications(
          ourMatch.id, ourMatch.league_id, homeId, awayId, fdHomeGoals, fdAwayGoals, newEvents, teamNames
        )
        log.push(`🔔 ${notifCount} notificaciones enviadas`)
      }

      if (isFinished) {
        await supabaseAdmin.rpc('recalculate_scores', { p_match_id: ourMatch.id })
        log.push(`✓ Scores recalculated: ${homeEs} vs ${awayEs}`)
      }
    }

    synced++
  }

  return NextResponse.json({ synced, total: activeEvents.length, log })
}

async function syncESPNEvents(
  matchId: string,
  details: any[],
  homeTeamId: string,
  awayTeamId: string,
  espnHomeId: string,
  espnAwayId: string,
  isFinished: boolean,
): Promise<NewEvent[]> {
  // Filtrar solo goles y tarjetas rojas
  const relevant = details.filter(d =>
    (d.scoringPlay && !d.shootout) || d.ownGoal || d.redCard
  )
  if (relevant.length === 0) return []

  const { data: squadPlayers } = await supabaseAdmin
    .from('squad_players')
    .select('id, name, team_id')
    .in('team_id', [homeTeamId, awayTeamId])

  if (!squadPlayers?.length) return []
  const squad = squadPlayers

  if (isFinished) {
    await supabaseAdmin.from('player_events').delete().eq('match_id', matchId)
  }

  function resolvePlayer(name: string) {
    const norm = normalize(name)
    return squad.find(p => {
      const n = normalize(p.name)
      return n === norm || n.includes(norm) || norm.includes(n) ||
        n.split(' ').at(-1) === norm.split(' ').at(-1)
    })
  }

  function espnTeamToOurId(espnTeamId: string): string {
    return espnTeamId === espnHomeId ? homeTeamId : awayTeamId
  }

  const toInsert: { match_id: string; squad_player_id: string; event_type: string; minute: number | null }[] = []
  const newEventsMeta: NewEvent[] = []

  for (const d of relevant) {
    const playerName: string = d.athletesInvolved?.[0]?.displayName ?? ''
    if (!playerName) continue

    const minute = parseMinute(d.clock?.displayValue ?? '') || null
    const teamId = espnTeamToOurId(d.team?.id)

    let eventType: string
    if (d.ownGoal) {
      eventType = 'own_goal'
    } else if (d.redCard) {
      eventType = 'red_card'
    } else if (d.scoringPlay && d.penaltyKick) {
      eventType = 'goal' // penalti en juego (no tanda)
    } else if (d.scoringPlay && (minute ?? 0) > 90) {
      eventType = 'goal_extra_time'
    } else {
      eventType = 'goal'
    }

    const sp = resolvePlayer(playerName)
    if (!sp) {
      // Si el gol es en propia meta, el teamId puede ser el del equipo que la metió
      // pero el jugador pertenece al equipo contrario — reintentamos sin filtrar por equipo
      continue
    }

    if (!isFinished) {
      const { count } = await supabaseAdmin.from('player_events')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', matchId).eq('squad_player_id', sp.id)
        .eq('event_type', eventType).eq('minute', minute)
      if ((count ?? 0) > 0) continue
    }

    toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: eventType, minute })
    if (!isFinished) {
      newEventsMeta.push({ squad_player_id: sp.id, player_name: sp.name, team_id: sp.team_id, event_type: eventType, minute })
    }
  }

  if (toInsert.length > 0) {
    await supabaseAdmin.from('player_events').insert(toInsert)
  }

  return newEventsMeta
}

async function sendEventNotifications(
  matchId: string,
  leagueId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeGoals: number,
  awayGoals: number,
  newEvents: NewEvent[],
  teamNames: Record<string, string>,
): Promise<number> {
  const { data: ownership } = await supabaseAdmin
    .from('drafted_teams')
    .select('team_id, player_id, players!inner(user_id, name)')
    .in('team_id', [homeTeamId, awayTeamId])
    .eq('league_id', leagueId)

  if (!ownership?.length) return 0

  const { data: lineups } = await supabaseAdmin
    .from('match_lineups')
    .select('player_id, squad_player_id')
    .eq('match_id', matchId)

  const lineupSet = new Set((lineups ?? []).map(l => `${l.player_id}:${l.squad_player_id}`))

  const ownerByTeam: Record<string, { userId: string; playerId: string; ownerName: string }> = {}
  for (const row of ownership) {
    const p = row.players as any
    if (p?.user_id) {
      ownerByTeam[row.team_id] = { userId: p.user_id, playerId: row.player_id, ownerName: p.name ?? '?' }
    }
  }

  const homeOwner = ownerByTeam[homeTeamId]
  const awayOwner = ownerByTeam[awayTeamId]
  if (!homeOwner && !awayOwner) return 0

  const homeName = teamNames[homeTeamId] ?? '?'
  const awayName = teamNames[awayTeamId] ?? '?'

  const pushes: Promise<any>[] = []

  for (const ev of newEvents) {
    const isGoal = ['goal', 'goal_extra_time'].includes(ev.event_type)
    const isOwn  = ev.event_type === 'own_goal'
    const isRed  = ev.event_type === 'red_card'
    const emoji  = isGoal ? '⚽' : isOwn ? '⚽🙈' : isRed ? '🟥' : '📌'
    const minuteStr = ev.minute ? ` ${ev.minute}'` : ''

    const scoringOwner = ownerByTeam[ev.team_id]
    const scoringOwnerHasPlayer = scoringOwner
      ? lineupSet.has(`${scoringOwner.playerId}:${ev.squad_player_id}`)
      : false

    function buildTitle(recipientUserId: string) {
      const homeLabel = homeOwner?.userId === recipientUserId ? 'Tú' : (homeOwner?.ownerName ?? null)
      const awayLabel = awayOwner?.userId === recipientUserId ? 'Tú' : (awayOwner?.ownerName ?? null)
      const homeStr = homeLabel ? `${homeName} (${homeLabel})` : homeName
      const awayStr = awayLabel ? `${awayName} (${awayLabel})` : awayName
      return `${homeStr} ${homeGoals} - ${awayStr} ${awayGoals}`
    }

    const body = `${emoji} ${ev.player_name}${minuteStr}${scoringOwnerHasPlayer ? ' ⭐' : ''}`

    const recipients = [homeOwner, awayOwner].filter(Boolean) as typeof homeOwner[]
    for (const owner of recipients) {
      pushes.push(
        fetch(`${APP_URL}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-push-secret': process.env.PUSH_SECRET! },
          body: JSON.stringify({
            title: buildTitle(owner.userId),
            body,
            url: '/standings',
            userIds: [owner.userId],
          }),
        })
      )
    }
  }

  await Promise.all(pushes)
  return pushes.length
}
