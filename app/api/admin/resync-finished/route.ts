import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world'
const ET_OFFSET_MS = 4 * 60 * 60 * 1000

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function parseMinute(displayValue: string): number {
  const m = displayValue.match(/^(\d+)/)
  return m ? parseInt(m[1]) : 0
}

const ESPN_TO_ES: Record<string, string> = {
  'Germany': 'Alemania', 'Saudi Arabia': 'Arabia Saudita', 'Algeria': 'Argelia',
  'Argentina': 'Argentina', 'Australia': 'Australia', 'Austria': 'Austria',
  'Belgium': 'Bélgica', 'Bosnia-Herzegovina': 'Bosnia y Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia y Herzegovina', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Brazil': 'Brasil', 'Cape Verde': 'Cabo Verde', 'Canada': 'Canadá',
  'Colombia': 'Colombia', 'South Korea': 'Corea del Sur', 'Korea Republic': 'Corea del Sur',
  "Côte d'Ivoire": 'Costa de Marfil', 'Ivory Coast': 'Costa de Marfil',
  'Croatia': 'Croacia', 'Curaçao': 'Curazao', 'Curacao': 'Curazao',
  'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo', 'Democratic Republic of Congo': 'DR Congo',
  'Ecuador': 'Ecuador', 'Egypt': 'Egipto', 'Scotland': 'Escocia', 'Spain': 'España',
  'United States': 'Estados Unidos', 'USA': 'Estados Unidos', 'France': 'Francia',
  'Ghana': 'Ghana', 'Haiti': 'Haití', 'England': 'Inglaterra', 'Iraq': 'Irak',
  'Iran': 'Irán', 'Japan': 'Japón', 'Jordan': 'Jordania', 'Morocco': 'Marruecos',
  'Mexico': 'México', 'Norway': 'Noruega', 'New Zealand': 'Nueva Zelanda',
  'Netherlands': 'Países Bajos', 'Panama': 'Panamá', 'Paraguay': 'Paraguay',
  'Portugal': 'Portugal', 'Qatar': 'Qatar', 'Czech Republic': 'República Checa',
  'Czechia': 'República Checa', 'Senegal': 'Senegal', 'South Africa': 'Sudáfrica',
  'Sweden': 'Suecia', 'Switzerland': 'Suiza', 'Tunisia': 'Túnez', 'Turkey': 'Turquía',
  'Türkiye': 'Turquía', 'Uruguay': 'Uruguay', 'Uzbekistan': 'Uzbekistán',
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { matchType = 'r32' } = await req.json().catch(() => ({}))

  // Cargar partidos finalizados del tipo indicado
  const { data: ourMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team_id, away_team_id, home_goals, away_goals, status, match_date')
    .eq('status', 'finished')
    .eq('match_type', matchType)

  if (!ourMatches?.length) {
    return NextResponse.json({ message: `No finished matches of type ${matchType}` })
  }

  const { data: teams } = await supabaseAdmin.from('teams').select('id, name')
  const teamByEs: Record<string, string> = {}
  const teamById: Record<string, string> = {}
  for (const t of teams ?? []) { teamByEs[t.name] = t.id; teamById[t.id] = t.name }

  // Determinar qué fechas ET necesitamos pedir a ESPN
  const matchDates = ourMatches.map(m => {
    const etDate = new Date(new Date(m.match_date).getTime() - ET_OFFSET_MS)
    return etDate.toISOString().slice(0, 10).replace(/-/g, '')
  })
  const uniqueDates = [...new Set(matchDates)]

  // Fetch ESPN scoreboard para cada fecha
  const espnEventsByDate = await Promise.all(
    uniqueDates.map(async date => {
      const res = await fetch(`${ESPN_BASE}/scoreboard?dates=${date}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store',
      })
      if (!res.ok) return []
      const data = await res.json()
      return (data.events ?? []) as any[]
    })
  )
  const allEspnEvents: any[] = espnEventsByDate.flat()

  const log: string[] = []
  let synced = 0

  for (const ourMatch of ourMatches) {
    const homeEs = teamById[ourMatch.home_team_id]
    const awayEs = teamById[ourMatch.away_team_id]

    // Encontrar el evento ESPN correspondiente
    const espnEv = allEspnEvents.find(ev => {
      const comp = ev.competitions?.[0]
      const competitors: any[] = comp?.competitors ?? []
      const homeComp = competitors.find((c: any) => c.homeAway === 'home')
      const awayComp = competitors.find((c: any) => c.homeAway === 'away')
      const hEs = ESPN_TO_ES[homeComp?.team?.displayName ?? '']
      const aEs = ESPN_TO_ES[awayComp?.team?.displayName ?? '']
      return hEs === homeEs && aEs === awayEs
    })

    if (!espnEv) {
      log.push(`⚠ No ESPN event found: ${homeEs} vs ${awayEs}`)
      continue
    }

    const comp = espnEv.competitions?.[0]
    const details: any[] = comp?.details ?? []
    const espnHomeId = comp?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.id
    const espnAwayId = comp?.competitors?.find((c: any) => c.homeAway === 'away')?.team?.id

    // Re-sincronizar eventos
    await supabaseAdmin.from('player_events').delete()
      .eq('match_id', ourMatch.id)
      .not('event_type', 'in', '("clean_sheet_gk","clean_sheet_def")')

    const { data: squadPlayers } = await supabaseAdmin
      .from('squad_players').select('id, name, team_id, position')
      .in('team_id', [ourMatch.home_team_id, ourMatch.away_team_id])
    const squad = squadPlayers ?? []

    function resolvePlayer(name: string, teamId: string) {
      const norm = normalize(name)
      const inTeam = squad.filter(p => p.team_id === teamId).find(p => {
        const n = normalize(p.name)
        return n === norm || n.includes(norm) || norm.includes(n) ||
          n.split(' ').at(-1) === norm.split(' ').at(-1)
      })
      if (inTeam) return inTeam
      return squad.find(p => {
        const n = normalize(p.name)
        return n === norm || n.includes(norm) || norm.includes(n) ||
          n.split(' ').at(-1) === norm.split(' ').at(-1)
      })
    }

    // Excluir tanda (se sincroniza desde el summary con fallos incluidos)
    const relevant = details.filter(d => (d.scoringPlay || d.ownGoal || d.redCard) && !d.shootout)
    const toInsert: any[] = []

    for (const d of relevant) {
      const playerName: string = d.athletesInvolved?.[0]?.displayName ?? ''
      if (!playerName) continue
      const minute = parseMinute(d.clock?.displayValue ?? '') || null
      const espnTeamId = d.team?.id
      const teamId = d.ownGoal
        ? (espnTeamId === espnHomeId ? ourMatch.away_team_id : ourMatch.home_team_id)
        : (espnTeamId === espnHomeId ? ourMatch.home_team_id : ourMatch.away_team_id)

      let eventType: string
      if (d.ownGoal) eventType = 'own_goal'
      else if (d.redCard) eventType = 'red_card'
      else if (d.shootout && d.scoringPlay) eventType = 'penalty_shootout'
      else if (d.scoringPlay && d.penaltyKick) eventType = 'goal'
      else if (d.scoringPlay && (minute ?? 0) > 90) eventType = 'goal_extra_time'
      else eventType = 'goal'

      const sp = resolvePlayer(playerName, teamId)
      if (!sp) { log.push(`⚠ Player not found: ${playerName} (${homeEs} vs ${awayEs})`); continue }
      toInsert.push({ match_id: ourMatch.id, squad_player_id: sp.id, event_type: eventType, minute, notified: true })
    }

    if (toInsert.length > 0) {
      await supabaseAdmin.from('player_events').insert(toInsert)
    }

    // Sincronizar asistencias y tanda de penaltis desde el summary de ESPN
    try {
      const summRes = await fetch(`${ESPN_BASE}/summary?event=${espnEv.id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store',
      })
      if (summRes.ok) {
        const summData = await summRes.json()
        const summInserts: any[] = []

        function resolveSquad(name: string) {
          const norm = normalize(name)
          return squad.find(sq => {
            const n = normalize(sq.name)
            return n === norm || n.includes(norm) || norm.includes(n) ||
              n.split(' ').at(-1) === norm.split(' ').at(-1)
          })
        }

        // Asistencias y portería a cero desde roster stats
        // Borrar porterías a cero previas para reinsertar solo el starter
        await supabaseAdmin.from('player_events').delete()
          .eq('match_id', ourMatch.id).in('event_type', ['clean_sheet_gk', 'clean_sheet_def'])

        const goals90 = details.filter((d: any) => d.scoringPlay && !d.shootout && (parseMinute(d.clock?.displayValue ?? '') || 0) <= 90)
        const homeScored90 = goals90.filter((d: any) => d.team?.id === espnHomeId).length
        const awayScored90 = goals90.filter((d: any) => d.team?.id === espnAwayId).length

        for (const team of summData.rosters ?? []) {
          for (const p of team.roster ?? []) {
            const assists: number = p.stats?.find((s: any) => s.name === 'goalAssists')?.value ?? 0
            if (assists > 0) {
              const sp = resolveSquad(p.athlete?.displayName ?? '')
              if (!sp) continue
              for (let i = 0; i < assists; i++) {
                summInserts.push({ match_id: ourMatch.id, squad_player_id: sp.id, event_type: 'assist', minute: null, notified: true })
              }
            }
            // Portería a cero: solo portero starter
            const isGk = p.position?.abbreviation === 'GK' || p.position?.abbreviation === 'G' || p.position?.name === 'Goalkeeper'
            const minutes = p.stats?.find((s: any) => s.name === 'minutesPlayed')?.value ?? null
            const played = minutes !== null ? minutes > 60 : p.starter === true
            if (isGk && played) {
              const isHome = team.team?.id === espnHomeId
              const conceded = isHome ? awayScored90 : homeScored90
              if (conceded === 0) {
                const sp = resolveSquad(p.athlete?.displayName ?? '')
                if (sp) summInserts.push({ match_id: ourMatch.id, squad_player_id: sp.id, event_type: 'clean_sheet_gk', minute: null, notified: true })
              }
            }
          }
        }

        // Tanda de penaltis + winner_team_id
        const shootout: any[] = summData.shootout ?? []
        if (shootout.length > 0) {
          let homeScore = 0, awayScore = 0
          for (const teamShootout of shootout) {
            const isHome = teamShootout.id === espnHomeId
            for (const shot of teamShootout.shots ?? []) {
              if (shot.didScore) isHome ? homeScore++ : awayScore++
              const sp = resolveSquad(shot.player ?? '')
              if (!sp) continue
              summInserts.push({ match_id: ourMatch.id, squad_player_id: sp.id, event_type: shot.didScore ? 'penalty_shootout' : 'penalty_missed_shootout', minute: null, notified: true })
            }
          }
          const winnerTeamId = homeScore > awayScore ? ourMatch.home_team_id : awayScore > homeScore ? ourMatch.away_team_id : null
          if (winnerTeamId) {
            await supabaseAdmin.from('matches').update({ winner_team_id: winnerTeamId }).eq('id', ourMatch.id)
            log.push(`✓ winner_team_id: ${winnerTeamId === ourMatch.home_team_id ? homeEs : awayEs}`)
          }
        }

        if (summInserts.length > 0) {
          await supabaseAdmin.from('player_events').insert(summInserts)
          log.push(`✓ ${summInserts.length} eventos de summary (asistencias/tanda): ${homeEs} vs ${awayEs}`)
        }
      }
    } catch { /* ignore */ }

    // Recalcular puntuaciones
    await supabaseAdmin.rpc('recalculate_scores', { p_match_id: ourMatch.id })
    log.push(`✓ Recalculado: ${homeEs} vs ${awayEs} (${toInsert.length} eventos)`)
    synced++
  }

  return NextResponse.json({ synced, total: ourMatches.length, log })
}
