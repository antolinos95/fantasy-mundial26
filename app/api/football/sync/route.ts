import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FD_BASE = 'https://api.football-data.org/v4'
const FD_KEY  = process.env.FOOTBALL_DATA_API_KEY!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const TEAM_MAP: Record<string, string[]> = {
  'Alemania':              ['Germany'],
  'Arabia Saudita':        ['Saudi Arabia'],
  'Argelia':               ['Algeria'],
  'Argentina':             ['Argentina'],
  'Australia':             ['Australia'],
  'Austria':               ['Austria'],
  'Bélgica':               ['Belgium'],
  'Bosnia y Herzegovina':  ['Bosnia and Herzegovina', 'Bosnia & Herzegovina'],
  'Brasil':                ['Brazil'],
  'Cabo Verde':            ['Cape Verde'],
  'Canadá':                ['Canada'],
  'Colombia':              ['Colombia'],
  'Corea del Sur':         ['Korea Republic', 'South Korea'],
  'Costa de Marfil':       ["Côte d'Ivoire", 'Ivory Coast'],
  'Croacia':               ['Croatia'],
  'Curazao':               ['Curaçao', 'Curacao'],
  'DR Congo':              ['Congo DR', 'DR Congo', 'Democratic Republic of Congo'],
  'Ecuador':               ['Ecuador'],
  'Egipto':                ['Egypt'],
  'Escocia':               ['Scotland'],
  'España':                ['Spain'],
  'Estados Unidos':        ['United States', 'USA'],
  'Francia':               ['France'],
  'Ghana':                 ['Ghana'],
  'Haití':                 ['Haiti'],
  'Inglaterra':            ['England'],
  'Irak':                  ['Iraq'],
  'Irán':                  ['Iran'],
  'Japón':                 ['Japan'],
  'Jordania':              ['Jordan'],
  'Marruecos':             ['Morocco'],
  'México':                ['Mexico'],
  'Noruega':               ['Norway'],
  'Nueva Zelanda':         ['New Zealand'],
  'Países Bajos':          ['Netherlands'],
  'Panamá':                ['Panama'],
  'Paraguay':              ['Paraguay'],
  'Portugal':              ['Portugal'],
  'Qatar':                 ['Qatar'],
  'República Checa':       ['Czech Republic', 'Czechia'],
  'Senegal':               ['Senegal'],
  'Sudáfrica':             ['South Africa'],
  'Suecia':                ['Sweden'],
  'Suiza':                 ['Switzerland'],
  'Túnez':                 ['Tunisia'],
  'Turquía':               ['Turkey', 'Türkiye'],
  'Uruguay':               ['Uruguay'],
  'Uzbekistán':            ['Uzbekistan'],
}

const EN_TO_ES: Record<string, string> = {}
for (const [es, ens] of Object.entries(TEAM_MAP)) {
  for (const en of ens) EN_TO_ES[en.toLowerCase()] = es
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function fdFetch(path: string) {
  return fetch(`${FD_BASE}${path}`, { headers: { 'X-Auth-Token': FD_KEY } })
}

interface NewEvent {
  squad_player_id: string
  player_name: string
  team_id: string
  event_type: string
  minute: number | null
}

// ─── Mejora #3: notified eliminado de player_events, la deduplicación la hace
// el check existencial antes de insertar. Schema v18 ya no es necesario.

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().slice(0, 10)

  const [inPlayRes, pausedRes, finishedRes] = await Promise.all([
    fdFetch(`/competitions/WC/matches?dateFrom=${today}&dateTo=${today}&status=IN_PLAY`),
    fdFetch(`/competitions/WC/matches?dateFrom=${today}&dateTo=${today}&status=PAUSED`),
    fdFetch(`/competitions/WC/matches?dateFrom=${today}&dateTo=${today}&status=FINISHED`),
  ])

  const inPlayData   = inPlayRes.ok   ? await inPlayRes.json()   : { matches: [] }
  const pausedData   = pausedRes.ok   ? await pausedRes.json()   : { matches: [] }
  const finishedData = finishedRes.ok ? await finishedRes.json() : { matches: [] }

  const fdMatches: any[] = [
    ...(inPlayData.matches   ?? []),
    ...(pausedData.matches   ?? []),
    ...(finishedData.matches ?? []),
  ]

  if (fdMatches.length === 0) {
    return NextResponse.json({ message: 'No matches today', synced: 0 })
  }

  const [{ data: teams }, { data: ourMatches }] = await Promise.all([
    supabaseAdmin.from('teams').select('id, name'),
    supabaseAdmin
      .from('matches')
      .select('id, home_team_id, away_team_id, home_goals, away_goals, status, match_date')
      .gte('match_date', `${today}T00:00:00`)
      .lte('match_date', `${today}T23:59:59`),
  ])

  const teamByEs: Record<string, string> = {}
  for (const t of teams ?? []) teamByEs[t.name] = t.id

  let synced = 0
  const log: string[] = []

  // ─── Mejora #4: fetch detalles de todos los partidos en paralelo
  const matchesNeedingDetail = fdMatches.filter(fm => {
    const s = fm.status
    return ['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT', 'FINISHED', 'AWARDED'].includes(s)
  })
  const detailResults = await Promise.all(
    matchesNeedingDetail.map(fm => fdFetch(`/matches/${fm.id}`).then(r => r.ok ? r.json() : null))
  )
  const detailById: Record<number, any> = {}
  matchesNeedingDetail.forEach((fm, i) => { detailById[fm.id] = detailResults[i] })

  for (const fm of fdMatches) {
    const homeEn = fm.homeTeam?.name ?? ''
    const awayEn = fm.awayTeam?.name ?? ''
    const homeEs = EN_TO_ES[homeEn.toLowerCase()]
    const awayEs = EN_TO_ES[awayEn.toLowerCase()]

    if (!homeEs || !awayEs) {
      log.push(`⚠ No mapping: ${homeEn} vs ${awayEn}`)
      continue
    }

    const homeId   = teamByEs[homeEs]
    const awayId   = teamByEs[awayEs]
    const ourMatch = ourMatches?.find(m => m.home_team_id === homeId && m.away_team_id === awayId)
    if (!ourMatch) {
      log.push(`⚠ Not in DB: ${homeEs} vs ${awayEs}`)
      continue
    }

    const fdStatus   = fm.status
    const isLive     = ['IN_PLAY', 'PAUSED', 'EXTRA_TIME', 'PENALTY_SHOOTOUT'].includes(fdStatus)
    const isFinished = ['FINISHED', 'AWARDED'].includes(fdStatus)

    // ─── Mejora #2: score.fullTime refleja el marcador actual también en directo.
    // score.halfTime solo tiene valor al terminar el primer tiempo.
    const score = fm.score ?? {}
    let fdHomeGoals: number | null = null
    let fdAwayGoals: number | null = null

    if (fdStatus === 'EXTRA_TIME') {
      fdHomeGoals = score.extraTime?.home ?? score.fullTime?.home ?? null
      fdAwayGoals = score.extraTime?.away ?? score.fullTime?.away ?? null
    } else if (fdStatus === 'PENALTY_SHOOTOUT') {
      fdHomeGoals = score.penalties?.home ?? score.fullTime?.home ?? null
      fdAwayGoals = score.penalties?.away ?? score.fullTime?.away ?? null
    } else {
      // IN_PLAY, PAUSED, FINISHED: fullTime es el marcador actual
      fdHomeGoals = score.fullTime?.home ?? null
      fdAwayGoals = score.fullTime?.away ?? null
    }

    const updates: Record<string, any> = {}
    if (fdHomeGoals !== null && fdHomeGoals !== ourMatch.home_goals) updates.home_goals = fdHomeGoals
    if (fdAwayGoals !== null && fdAwayGoals !== ourMatch.away_goals) updates.away_goals = fdAwayGoals
    if (isFinished && ourMatch.status !== 'finished') updates.status = 'finished'

    // ─── Mejora #5: solo corregir hora si el partido acaba de pasar a IN_PLAY
    // (nuestro status era 'scheduled' pero la API ya reporta minuto > 0)
    if (
      fdStatus === 'IN_PLAY' &&
      ourMatch.status === 'scheduled' &&
      fm.minute > 0 &&
      fm.minute <= 45
    ) {
      const calculatedKickoff = new Date(Date.now() - fm.minute * 60 * 1000)
      const scheduledKickoff  = new Date(ourMatch.match_date)
      const diffMinutes = Math.abs(calculatedKickoff.getTime() - scheduledKickoff.getTime()) / 60000
      if (diffMinutes > 5) {
        updates.match_date = calculatedKickoff.toISOString()
        log.push(`⏰ Inicio retrasado ${Math.round(diffMinutes)} min: ${homeEs} vs ${awayEs}`)
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('matches').update(updates).eq('id', ourMatch.id)
      log.push(`✓ Updated ${homeEs} vs ${awayEs}: ${JSON.stringify(updates)}`)
    }

    if (isLive || isFinished) {
      const detail = detailById[fm.id]
      if (detail) {
        const goals    = detail.goals    ?? fm.goals    ?? []
        const bookings = detail.bookings ?? fm.bookings ?? []
        const newEvents = await syncEvents(ourMatch.id, goals, bookings, homeId, awayId, isFinished)
        log.push(`✓ Events ${homeEs} vs ${awayEs}: ${goals.length} goals, ${bookings.length} bookings, ${newEvents.length} new`)

        if (newEvents.length > 0) {
          const teamNames: Record<string, string> = { [homeId]: homeEs, [awayId]: awayEs }
          const homeGoals = fdHomeGoals ?? ourMatch.home_goals ?? 0
          const awayGoals = fdAwayGoals ?? ourMatch.away_goals ?? 0
          const notifCount = await sendEventNotifications(ourMatch.id, homeId, awayId, homeGoals, awayGoals, newEvents, teamNames)
          log.push(`🔔 ${notifCount} notificaciones enviadas`)
        }
      }

      if (isFinished) {
        await supabaseAdmin.rpc('recalculate_scores', { p_match_id: ourMatch.id })
        log.push(`✓ Scores recalculated: ${homeEs} vs ${awayEs}`)
      }
    }

    synced++
  }

  return NextResponse.json({ synced, total: fdMatches.length, log })
}

async function syncEvents(
  matchId: string,
  goals: any[],
  bookings: any[],
  homeTeamId: string,
  awayTeamId: string,
  isFinished: boolean,
): Promise<NewEvent[]> {
  if (goals.length === 0 && bookings.length === 0) return []

  const { data: squadPlayers } = await supabaseAdmin
    .from('squad_players')
    .select('id, name, team_id')
    .in('team_id', [homeTeamId, awayTeamId])

  if (!squadPlayers?.length) return []
  const squad = squadPlayers

  if (isFinished) {
    await supabaseAdmin.from('player_events').delete().eq('match_id', matchId)
  }

  const toInsert: { match_id: string; squad_player_id: string; event_type: string; minute: number | null }[] = []
  const newEventsMeta: NewEvent[] = []

  function resolvePlayer(name: string) {
    const norm = normalize(name)
    return squad.find(p => {
      const n = normalize(p.name)
      return n === norm || n.includes(norm) || norm.includes(n) ||
        n.split(' ').at(-1) === norm.split(' ').at(-1)
    })
  }

  for (const goal of goals) {
    const scorerName: string = goal.scorer?.name ?? goal.scorer?.shortName ?? ''
    if (!scorerName) continue

    const minute: number = goal.minute ?? 0
    const goalType: string = goal.type ?? 'REGULAR'

    let eventType: string
    if (goalType === 'OWN') {
      eventType = 'own_goal'
    } else if (goalType === 'PENALTY' && minute === 0) {
      // Penalti en tanda (minute=0 es la convención de la API para tandas)
      eventType = 'penalty_shootout'
    } else if (minute > 90) {
      eventType = 'goal_extra_time'
    } else {
      eventType = 'goal'
    }

    const sp = resolvePlayer(scorerName)
    if (!sp) continue

    if (!isFinished) {
      const { count } = await supabaseAdmin.from('player_events')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', matchId).eq('squad_player_id', sp.id)
        .eq('event_type', eventType).eq('minute', minute)
      if ((count ?? 0) > 0) continue
    }

    toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: eventType, minute: minute || null })
    if (!isFinished) newEventsMeta.push({ squad_player_id: sp.id, player_name: sp.name, team_id: sp.team_id, event_type: eventType, minute: minute || null })
  }

  for (const booking of bookings) {
    if (booking.card !== 'RED_CARD' && booking.card !== 'YELLOW_RED_CARD') continue
    const playerName: string = booking.player?.name ?? booking.player?.shortName ?? ''
    if (!playerName) continue

    const sp = resolvePlayer(playerName)
    if (!sp) continue

    if (!isFinished) {
      const { count } = await supabaseAdmin.from('player_events')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', matchId).eq('squad_player_id', sp.id)
        .eq('event_type', 'red_card')
      if ((count ?? 0) > 0) continue
    }

    toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: 'red_card', minute: booking.minute || null })
    if (!isFinished) newEventsMeta.push({ squad_player_id: sp.id, player_name: sp.name, team_id: sp.team_id, event_type: 'red_card', minute: booking.minute || null })
  }

  if (toInsert.length > 0) {
    await supabaseAdmin.from('player_events').insert(toInsert)
  }

  return newEventsMeta
}

// Una notificación por evento: llega en el momento en que ocurre
async function sendEventNotifications(
  matchId: string,
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

  if (!ownership?.length) return 0

  const { data: lineups } = await supabaseAdmin
    .from('match_lineups')
    .select('player_id, squad_player_id')
    .eq('match_id', matchId)

  const lineupSet = new Set((lineups ?? []).map(l => `${l.player_id}:${l.squad_player_id}`))

  // { teamId → { userId, playerId, ownerName } }
  const ownerByTeam: Record<string, { userId: string; playerId: string; ownerName: string }> = {}
  for (const row of ownership) {
    const p = row.players as any
    if (p?.user_id) {
      ownerByTeam[row.team_id] = {
        userId: p.user_id,
        playerId: row.player_id,
        ownerName: p.name ?? '?',
      }
    }
  }

  const homeOwner = ownerByTeam[homeTeamId]
  const awayOwner = ownerByTeam[awayTeamId]
  if (!homeOwner && !awayOwner) return 0

  const homeName = teamNames[homeTeamId] ?? '?'
  const awayName = teamNames[awayTeamId] ?? '?'

  const pushes: Promise<any>[] = []

  for (const ev of newEvents) {
    const isGoal = ['goal', 'goal_extra_time', 'penalty_shootout'].includes(ev.event_type)
    const isOwn  = ev.event_type === 'own_goal'
    const isRed  = ev.event_type === 'red_card'
    const emoji  = isGoal ? '⚽' : isOwn ? '⚽🙈' : isRed ? '🟥' : '📌'
    const minuteStr = ev.minute ? ` ${ev.minute}'` : ''

    // ¿Tiene el dueño del equipo que protagoniza el evento al jugador seleccionado?
    const scoringOwner = ownerByTeam[ev.team_id]
    const scoringOwnerHasPlayer = scoringOwner
      ? lineupSet.has(`${scoringOwner.playerId}:${ev.squad_player_id}`)
      : false

    // Construir el marcador con nombres de dueños, desde la perspectiva de cada receptor
    function buildTitle(recipientUserId: string) {
      const homeLabel = homeOwner?.userId === recipientUserId ? 'Tú' : (homeOwner?.ownerName ?? null)
      const awayLabel = awayOwner?.userId === recipientUserId ? 'Tú' : (awayOwner?.ownerName ?? null)
      const homeStr = homeLabel ? `${homeName} (${homeLabel})` : homeName
      const awayStr = awayLabel ? `${awayName} (${awayLabel})` : awayName
      return `${homeStr} ${homeGoals} - ${awayStr} ${awayGoals}`
    }

    // Cuerpo: jugador + minuto + ⭐ si el dueño del equipo lo tiene seleccionado
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
