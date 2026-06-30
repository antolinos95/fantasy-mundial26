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
  const bearer = req.headers.get('authorization')
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true
  if (process.env.VERCEL_CRON_SECRET && bearer === `Bearer ${process.env.VERCEL_CRON_SECRET}`) return true
  return false
}

interface NewEvent {  // kept for potential future use
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


  // Pre-check: solo consultamos ESPN si hay un partido live ahora o que empiece en ≤5 min
  // Ventana [now - 210min, now + 5min]: cubre 90' + prórroga (30') + penaltis + margen
  const windowStart = new Date(now - 210 * 60 * 1000).toISOString()
  const windowEnd   = new Date(now +   5 * 60 * 1000).toISOString()

  const { data: activeMatches } = await supabaseAdmin
    .from('matches')
    .select('id, status, match_date')
    .neq('status', 'finished')
    .or(`status.eq.live,and(match_date.gte.${windowStart},match_date.lte.${windowEnd})`)

  if (!activeMatches?.length) {
    return NextResponse.json({ message: 'No active match window', skipped: true })
  }

  const today = new Date().toISOString().slice(0, 10)

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

  // Convertir los días ET que pedimos a ESPN al rango UTC equivalente exacto (ET = UTC-4).
  // etYesterday 00:00 ET = etYesterday 04:00 UTC → inicio de la ventana
  // etToday     23:59 ET = etToday+1  03:59 UTC → fin de la ventana
  const etYesterdayISO = `${etYesterday.slice(0,4)}-${etYesterday.slice(4,6)}-${etYesterday.slice(6,8)}`
  const etTodayISO     = `${etToday.slice(0,4)}-${etToday.slice(4,6)}-${etToday.slice(6,8)}`
  const matchWindowStart = new Date(new Date(`${etYesterdayISO}T00:00:00Z`).getTime() + ET_OFFSET_MS).toISOString()
  const matchWindowEnd   = new Date(new Date(`${etTodayISO}T23:59:59Z`).getTime()     + ET_OFFSET_MS).toISOString()

  const [{ data: teams }, { data: ourMatches }] = await Promise.all([
    supabaseAdmin.from('teams').select('id, name'),
    supabaseAdmin
      .from('matches')
      .select('id, league_id, home_team_id, away_team_id, home_goals, away_goals, status, match_date')
      .neq('status', 'finished')   // nunca reprocessar partidos ya finalizados
      .gte('match_date', matchWindowStart)
      .lte('match_date', matchWindowEnd),
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

    // Guardar el reloj real de ESPN (incluye tiempo añadido: "45+2", "90+3") y corregir match_date
    if (isLive) {
      const displayClock: string = comp.status?.displayClock ?? ''
      // Guardar el clock raw para mostrarlo en la UI
      if (displayClock) updates.match_clock = displayClock
      const elapsedMin = parseMinute(displayClock)
      if (elapsedMin > 0) {
        // Añadir descansos: 15' de medio tiempo, y 15' más si es prórroga (>90')
        const realElapsed = elapsedMin > 90 ? elapsedMin + 30
                          : elapsedMin > 45 ? elapsedMin + 15
                          : elapsedMin
        const calculatedKickoff = new Date(now - realElapsed * 60 * 1000)
        const storedKickoff = new Date(ourMatch.match_date)
        const diffMin = Math.abs(calculatedKickoff.getTime() - storedKickoff.getTime()) / 60000
        if (diffMin > 2) {
          updates.match_date = calculatedKickoff.toISOString()
          log.push(`⏰ Kick-off corregido ${Math.round(diffMin)} min: ${homeEs} vs ${awayEs}`)
        }
      }
    }
    if (isFinished) updates.match_clock = null

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabaseAdmin.from('matches').update(updates).eq('id', ourMatch.id)
      if (updateErr) {
        log.push(`✗ Update FAILED ${homeEs} vs ${awayEs}: ${updateErr.message}`)
      } else {
        log.push(`✓ Updated ${homeEs} vs ${awayEs}: ${JSON.stringify(updates)}`)
      }
    }

    if (isLive || isFinished) {
      const details: any[] = comp.details ?? []
      // ESPN team IDs para saber a qué equipo pertenece cada evento
      const espnHomeId = homeComp.team?.id
      const espnAwayId = awayComp.team?.id

      const insertedCount = await syncESPNEvents(
        ourMatch.id, details, homeId, awayId, espnHomeId, espnAwayId, isFinished
      )
      log.push(`✓ Events ${homeEs} vs ${awayEs}: ${details.length} details, ${insertedCount} new`)

      // Notificar eventos pendientes (notified=false) solo si el partido no estaba ya finished
      if (ourMatch.status !== 'finished') {
        const teamNames: Record<string, string> = { [homeId]: homeEs, [awayId]: awayEs }
        const notifCount = await sendEventNotifications(
          ourMatch.id, ourMatch.league_id, homeId, awayId, fdHomeGoals, fdAwayGoals, teamNames
        )
        if (notifCount > 0) log.push(`🔔 ${notifCount} notificaciones enviadas`)
      }

      if (isFinished) {
        await syncCleanSheets(ourMatch.id, homeId, awayId, espnHomeId, espnAwayId, comp.details ?? [])
        const assistCount = await syncAssists(ourMatch.id, ev.id, homeId, awayId)
        if (assistCount > 0) log.push(`✓ Assists sincronizadas: ${assistCount}`)
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
): Promise<number> {
  // Goles (sin tanda — la tanda se sincroniza desde el summary con fallos incluidos), autogoles y tarjetas rojas
  const relevant = details.filter(d =>
    (d.scoringPlay || d.ownGoal || d.redCard) && !d.shootout
  )
  if (relevant.length === 0) return 0

  const { data: squadPlayers } = await supabaseAdmin
    .from('squad_players')
    .select('id, name, team_id')
    .in('team_id', [homeTeamId, awayTeamId])

  if (!squadPlayers?.length) return 0
  const squad = squadPlayers

  if (isFinished) {
    await supabaseAdmin.from('player_events').delete().eq('match_id', matchId)
  }

  function resolvePlayer(name: string, teamId: string) {
    const norm = normalize(name)
    const teamSquad = squad.filter(p => p.team_id === teamId)
    // Intentamos primero en el equipo correcto para evitar falsos positivos por apellido compartido
    const inTeam = teamSquad.find(p => {
      const n = normalize(p.name)
      return n === norm || n.includes(norm) || norm.includes(n) ||
        n.split(' ').at(-1) === norm.split(' ').at(-1)
    })
    if (inTeam) return inTeam
    // Fallback: buscar en ambos equipos (ej: autogol donde el jugador es del equipo contrario)
    return squad.find(p => {
      const n = normalize(p.name)
      return n === norm || n.includes(norm) || norm.includes(n) ||
        n.split(' ').at(-1) === norm.split(' ').at(-1)
    })
  }

  function espnTeamToOurId(espnTeamId: string): string {
    return espnTeamId === espnHomeId ? homeTeamId : awayTeamId
  }

  const toInsert: { match_id: string; squad_player_id: string; event_type: string; minute: number | null; notified: boolean }[] = []

  // Para partidos en juego, cargamos los eventos ya existentes para deduplicar
  const existingEvents = isFinished ? [] : (
    (await supabaseAdmin.from('player_events')
      .select('squad_player_id, event_type, minute, notified')
      .eq('match_id', matchId)).data ?? []
  )

  for (const d of relevant) {
    const playerName: string = d.athletesInvolved?.[0]?.displayName ?? ''
    if (!playerName) continue

    const minute = parseMinute(d.clock?.displayValue ?? '') || null
    // Para autogoles, ESPN marca el team del equipo que recibe el gol;
    // el jugador pertenece al equipo contrario
    const espnEventTeamId = d.team?.id
    const teamId = d.ownGoal
      ? (espnEventTeamId === espnHomeId ? awayTeamId : homeTeamId)
      : espnTeamToOurId(espnEventTeamId)

    let eventType: string
    if (d.ownGoal) {
      eventType = 'own_goal'
    } else if (d.redCard) {
      eventType = 'red_card'
    } else if (d.shootout && d.scoringPlay) {
      eventType = 'penalty_shootout'
    } else if (d.scoringPlay && d.penaltyKick) {
      eventType = 'goal' // penalti en juego normal
    } else if (d.scoringPlay && (minute ?? 0) > 90) {
      eventType = 'goal_extra_time'
    } else {
      eventType = 'goal'
    }

    const sp = resolvePlayer(playerName, teamId)
    if (!sp) continue

    if (!isFinished) {
      const alreadyExists = existingEvents.some(e =>
        e.squad_player_id === sp.id && e.event_type === eventType && e.minute === minute
      )
      if (alreadyExists) continue
    }

    // notified=true en partidos ya finalizados (reinserción limpia, no hay que notificar)
    toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: eventType, minute, notified: isFinished })
  }

  if (toInsert.length > 0) {
    await supabaseAdmin.from('player_events').insert(toInsert)
  }

  return toInsert.length
}

async function syncCleanSheets(
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  espnHomeId: string,
  espnAwayId: string,
  details: any[],
): Promise<void> {
  // Calcular goles en los 90' reglamentarios por equipo (excluir tanda y minuto > 90)
  const goals90 = details.filter(d => d.scoringPlay && !d.shootout && (parseMinute(d.clock?.displayValue ?? '') || 0) <= 90)

  // Goles que benefician a cada equipo en 90' (incluye autogoles que van al marcador contrario)
  const homeScored90 = goals90.filter(d => d.team?.id === espnHomeId).length
  const awayScored90 = goals90.filter(d => d.team?.id === espnAwayId).length

  const cleanSheetTeams: { teamId: string }[] = []
  if (awayScored90 === 0) cleanSheetTeams.push({ teamId: homeTeamId }) // home kept clean sheet
  if (homeScored90 === 0) cleanSheetTeams.push({ teamId: awayTeamId }) // away kept clean sheet

  if (cleanSheetTeams.length === 0) return

  for (const { teamId } of cleanSheetTeams) {
    const { data: players } = await supabaseAdmin
      .from('squad_players')
      .select('id, position')
      .eq('team_id', teamId)
      .in('position', ['GK', 'DF'])

    if (!players?.length) continue

    const toInsert = players.map(p => ({
      match_id: matchId,
      squad_player_id: p.id,
      event_type: p.position === 'GK' ? 'clean_sheet_gk' : 'clean_sheet_def',
      minute: null,
      notified: true,
    }))

    // Evitar duplicados (por si se llama más de una vez)
    const { data: existing } = await supabaseAdmin
      .from('player_events')
      .select('squad_player_id')
      .eq('match_id', matchId)
      .in('event_type', ['clean_sheet_gk', 'clean_sheet_def'])

    const existingIds = new Set((existing ?? []).map(e => e.squad_player_id))
    const newOnes = toInsert.filter(e => !existingIds.has(e.squad_player_id))
    if (newOnes.length > 0) {
      await supabaseAdmin.from('player_events').insert(newOnes)
    }
  }
}

function resolvePlayerFromSquad(name: string, squad: { id: string; name: string; team_id: string }[]) {
  const norm = normalize(name)
  return squad.find(sq => {
    const n = normalize(sq.name)
    return n === norm || n.includes(norm) || norm.includes(n) ||
      n.split(' ').at(-1) === norm.split(' ').at(-1)
  })
}

async function syncAssists(
  matchId: string,
  espnEventId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<number> {
  try {
    const res = await fetch(`${ESPN_BASE}/summary?event=${espnEventId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store',
    })
    if (!res.ok) return 0
    const data = await res.json()

    const { data: squadPlayers } = await supabaseAdmin
      .from('squad_players')
      .select('id, name, team_id')
      .in('team_id', [homeTeamId, awayTeamId])
    if (!squadPlayers?.length) return 0
    const squad = squadPlayers

    // Borrar asistencias y penaltis de tanda previos para reinsertar limpio
    await supabaseAdmin.from('player_events').delete()
      .eq('match_id', matchId)
      .in('event_type', ['assist', 'penalty_shootout', 'penalty_missed_shootout'])

    const toInsert: { match_id: string; squad_player_id: string; event_type: string; minute: null; notified: boolean }[] = []

    // Asistencias desde roster stats
    for (const team of data.rosters ?? []) {
      for (const p of team.roster ?? []) {
        const assists: number = p.stats?.find((s: any) => s.name === 'goalAssists')?.value ?? 0
        if (assists <= 0) continue
        const sp = resolvePlayerFromSquad(p.athlete?.displayName ?? '', squad)
        if (!sp) continue
        for (let i = 0; i < assists; i++) {
          toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: 'assist', minute: null, notified: true })
        }
      }
    }

    // Tanda de penaltis desde la sección shootout
    for (const teamShootout of data.shootout ?? []) {
      for (const shot of teamShootout.shots ?? []) {
        const sp = resolvePlayerFromSquad(shot.player ?? '', squad)
        if (!sp) continue
        const eventType = shot.didScore ? 'penalty_shootout' : 'penalty_missed_shootout'
        toInsert.push({ match_id: matchId, squad_player_id: sp.id, event_type: eventType, minute: null, notified: true })
      }
    }

    if (toInsert.length > 0) {
      await supabaseAdmin.from('player_events').insert(toInsert)
    }
    return toInsert.length
  } catch {
    return 0
  }
}

async function sendEventNotifications(
  matchId: string,
  leagueId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeGoals: number,
  awayGoals: number,
  teamNames: Record<string, string>,
): Promise<number> {
  // Leer solo los eventos aún no notificados
  const { data: pendingEvents } = await supabaseAdmin
    .from('player_events')
    .select('id, squad_player_id, event_type, minute, squad_players!inner(name, team_id)')
    .eq('match_id', matchId)
    .eq('notified', false)

  if (!pendingEvents?.length) return 0

  const [{ data: ownership }, { data: lineups }] = await Promise.all([
    supabaseAdmin
      .from('drafted_teams')
      .select('team_id, player_id, players!inner(user_id, name)')
      .in('team_id', [homeTeamId, awayTeamId])
      .eq('league_id', leagueId),
    supabaseAdmin
      .from('match_lineups')
      .select('player_id, squad_player_id')
      .eq('match_id', matchId),
  ])

  if (!ownership?.length) {
    // Marcar como notified=true para no reintentar en partidos sin dueños
    await supabaseAdmin.from('player_events')
      .update({ notified: true })
      .eq('match_id', matchId).eq('notified', false)
    return 0
  }

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
  const homeName = teamNames[homeTeamId] ?? '?'
  const awayName = teamNames[awayTeamId] ?? '?'

  const pushes: Promise<any>[] = []

  for (const ev of pendingEvents) {
    const sp = ev.squad_players as any
    const teamId: string = sp?.team_id ?? ''
    const playerName: string = sp?.name ?? '?'

    const isGoal = ['goal', 'goal_extra_time'].includes(ev.event_type)
    const isOwn  = ev.event_type === 'own_goal'
    const isRed  = ev.event_type === 'red_card'
    const emoji  = isGoal ? '⚽' : isOwn ? '⚽🙈' : isRed ? '🟥' : '📌'
    const minuteStr = ev.minute ? ` ${ev.minute}'` : ''

    const scoringOwner = ownerByTeam[teamId]
    const scoringOwnerHasPlayer = scoringOwner
      ? lineupSet.has(`${scoringOwner.playerId}:${ev.squad_player_id}`)
      : false

    const body = `${emoji} ${playerName}${minuteStr}${scoringOwnerHasPlayer ? ' ⭐' : ''}`

    const recipients = [homeOwner, awayOwner].filter(Boolean) as NonNullable<typeof homeOwner>[]
    for (const owner of recipients) {
      const homeLabel = homeOwner?.userId === owner.userId ? 'Tú' : (homeOwner?.ownerName ?? null)
      const awayLabel = awayOwner?.userId === owner.userId ? 'Tú' : (awayOwner?.ownerName ?? null)
      const homeStr = homeLabel ? `${homeName} (${homeLabel})` : homeName
      const awayStr = awayLabel ? `${awayName} (${awayLabel})` : awayName
      const title = `${homeStr} ${homeGoals} - ${awayStr} ${awayGoals}`
      pushes.push(
        fetch(`${APP_URL}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-push-secret': process.env.PUSH_SECRET! },
          body: JSON.stringify({ title, body, url: `/standings/${leagueId}`, userIds: [owner.userId] }),
        })
      )
    }
  }

  await Promise.all(pushes)

  // Marcar todos los eventos pendientes como notificados
  const ids = pendingEvents.map(e => e.id)
  await supabaseAdmin.from('player_events').update({ notified: true }).in('id', ids)

  return pushes.length
}
