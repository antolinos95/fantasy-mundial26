import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const FD_BASE = 'https://api.football-data.org/v4'
const FD_KEY  = process.env.FOOTBALL_DATA_API_KEY!

// Mapeo nombres en español (nuestra BD) → nombres en inglés (football-data.org)
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

// Índice invertido: nombre inglés → nombre español
const EN_TO_ES: Record<string, string> = {}
for (const [es, ens] of Object.entries(TEAM_MAP)) {
  for (const en of ens) EN_TO_ES[en.toLowerCase()] = es
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Obtener partidos IN_PLAY y FINISHED de hoy en el Mundial
  const today = new Date().toISOString().slice(0, 10)

  const [liveRes, finishedRes] = await Promise.all([
    fetch(`${FD_BASE}/competitions/WC/matches?dateFrom=${today}&dateTo=${today}&status=LIVE`,
      { headers: { 'X-Auth-Token': FD_KEY } }),
    fetch(`${FD_BASE}/competitions/WC/matches?dateFrom=${today}&dateTo=${today}&status=FINISHED`,
      { headers: { 'X-Auth-Token': FD_KEY } }),
  ])

  if (!liveRes.ok && !finishedRes.ok) {
    const body = await liveRes.text()
    return NextResponse.json({ error: 'football-data API error', status: liveRes.status, body }, { status: 502 })
  }

  const liveData     = liveRes.ok     ? await liveRes.json()     : { matches: [] }
  const finishedData = finishedRes.ok ? await finishedRes.json() : { matches: [] }
  const fdMatches: any[] = [...(liveData.matches ?? []), ...(finishedData.matches ?? [])]

  if (fdMatches.length === 0) {
    return NextResponse.json({ message: 'No matches today', synced: 0 })
  }

  // 2. Cargar nuestros equipos y partidos de hoy
  const { data: teams } = await supabaseAdmin.from('teams').select('id, name')
  const teamByEs: Record<string, string> = {}
  for (const t of teams ?? []) teamByEs[t.name] = t.id

  // Partidos de hoy en nuestra BD
  const { data: ourMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team_id, away_team_id, home_goals, away_goals, status, match_date')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)

  let synced = 0
  const log: string[] = []

  for (const fm of fdMatches) {
    const homeEn = fm.homeTeam?.name ?? ''
    const awayEn = fm.awayTeam?.name ?? ''
    const homeEs = EN_TO_ES[homeEn.toLowerCase()]
    const awayEs = EN_TO_ES[awayEn.toLowerCase()]

    if (!homeEs || !awayEs) {
      log.push(`⚠ No mapping for: ${homeEn} vs ${awayEn}`)
      continue
    }

    const homeId = teamByEs[homeEs]
    const awayId = teamByEs[awayEs]

    const ourMatch = ourMatches?.find(
      m => m.home_team_id === homeId && m.away_team_id === awayId
    )
    if (!ourMatch) {
      log.push(`⚠ Match not found in DB: ${homeEs} vs ${awayEs}`)
      continue
    }

    const fdStatus   = fm.status
    const fdHomeGoals = fm.score?.fullTime?.home ?? null
    const fdAwayGoals = fm.score?.fullTime?.away ?? null
    const isFinished  = ['FINISHED', 'AWARDED'].includes(fdStatus)

    // 3. Actualizar marcador si cambió
    const updates: Record<string, any> = {}
    if (fdHomeGoals !== null && fdHomeGoals !== ourMatch.home_goals) updates.home_goals = fdHomeGoals
    if (fdAwayGoals !== null && fdAwayGoals !== ourMatch.away_goals) updates.away_goals = fdAwayGoals
    if (isFinished && ourMatch.status !== 'finished') updates.status = 'finished'

    if (Object.keys(updates).length > 0) {
      await supabaseAdmin.from('matches').update(updates).eq('id', ourMatch.id)
      log.push(`✓ Updated ${homeEs} vs ${awayEs}: ${JSON.stringify(updates)}`)
    }

    // 4. Si terminó, sincronizar goleadores y tarjetas rojas
    if (isFinished) {
      await syncEvents(ourMatch.id, fm.goals ?? [], fm.bookings ?? [], homeId, awayId)
      // Recalcular puntos
      await supabaseAdmin.rpc('recalculate_scores', { p_match_id: ourMatch.id })
      log.push(`✓ Scores recalculated for ${homeEs} vs ${awayEs}`)
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
  awayTeamId: string
) {
  if (goals.length === 0 && bookings.length === 0) return

  // Cargar squad_players de los dos equipos
  const { data: squadPlayers } = await supabaseAdmin
    .from('squad_players')
    .select('id, name, team_id')
    .in('team_id', [homeTeamId, awayTeamId])

  if (!squadPlayers?.length) return

  // Borrar eventos previos para re-insertar (idempotente)
  await supabaseAdmin.from('player_events').delete().eq('match_id', matchId)

  const events: { match_id: string; squad_player_id: string; event_type: string; minute: number | null }[] = []

  for (const goal of goals) {
    const scorerName: string = goal.scorer?.name ?? goal.scorer?.shortName ?? ''
    if (!scorerName) continue

    const goalType: string = goal.type ?? 'REGULAR'
    const minute: number   = goal.minute ?? 0

    // Determinar event_type
    let eventType: string
    if (goalType === 'OWN') {
      eventType = 'own_goal'
    } else if (goalType === 'PENALTY' && minute === 0) {
      // Penaltis en tanda (minuto 0 o null en algunos casos)
      eventType = 'penalty_shootout'
    } else if (minute > 90) {
      eventType = 'goal_extra_time'
    } else {
      eventType = 'goal'
    }

    // Buscar el jugador por nombre normalizado
    const normScorer = normalize(scorerName)
    const match = squadPlayers.find(sp => {
      const normSp = normalize(sp.name)
      return normSp === normScorer ||
        normSp.includes(normScorer) ||
        normScorer.includes(normSp) ||
        // Apellido coincide (última palabra)
        normSp.split(' ').pop() === normScorer.split(' ').pop()
    })

    if (!match) continue

    events.push({ match_id: matchId, squad_player_id: match.id, event_type: eventType, minute: minute || null })
  }

  // Tarjetas rojas
  for (const booking of bookings) {
    if (booking.card !== 'RED_CARD' && booking.card !== 'YELLOW_RED_CARD') continue
    const playerName: string = booking.player?.name ?? booking.player?.shortName ?? ''
    if (!playerName) continue

    const normPlayer = normalize(playerName)
    const match = squadPlayers.find(sp => {
      const normSp = normalize(sp.name)
      return normSp === normPlayer ||
        normSp.includes(normPlayer) ||
        normPlayer.includes(normSp) ||
        normSp.split(' ').pop() === normPlayer.split(' ').pop()
    })

    if (!match) continue
    events.push({ match_id: matchId, squad_player_id: match.id, event_type: 'red_card', minute: booking.minute || null })
  }

  if (events.length > 0) {
    await supabaseAdmin.from('player_events').insert(events)
  }
}
