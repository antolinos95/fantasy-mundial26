import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world'
const ET_OFFSET_MS = 4 * 60 * 60 * 1000

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

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function parseMinute(displayValue: string): number {
  const m = displayValue.match(/^(\d+)/)
  return m ? parseInt(m[1]) : 0
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-push-secret')
  if (secret !== process.env.PUSH_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: ourMatches } = await supabaseAdmin
    .from('matches')
    .select('id, home_team_id, away_team_id, home_goals, away_goals, match_date')
    .eq('status', 'finished')
    .eq('match_type', 'group')

  if (!ourMatches?.length) {
    return NextResponse.json({ message: 'No finished group matches found' })
  }

  const { data: teams } = await supabaseAdmin.from('teams').select('id, name')
  const teamById: Record<string, string> = {}
  for (const t of teams ?? []) teamById[t.id] = t.name

  // Collect unique ESPN dates to fetch
  const uniqueDates = [...new Set(ourMatches.map(m => {
    const etDate = new Date(new Date(m.match_date).getTime() - ET_OFFSET_MS)
    return etDate.toISOString().slice(0, 10).replace(/-/g, '')
  }))]

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
  let processed = 0

  for (const m of ourMatches) {
    const homeEs = teamById[m.home_team_id]
    const awayEs = teamById[m.away_team_id]

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
      log.push(`⚠ No ESPN event: ${homeEs} vs ${awayEs}`)
      continue
    }

    const comp = espnEv.competitions?.[0]
    const espnHomeId = comp?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.id
    const espnAwayId = comp?.competitors?.find((c: any) => c.homeAway === 'away')?.team?.id
    const details: any[] = comp?.details ?? []

    const { data: squadPlayers } = await supabaseAdmin
      .from('squad_players').select('id, name, team_id, position')
      .in('team_id', [m.home_team_id, m.away_team_id])
    const squad = squadPlayers ?? []

    function resolvePlayer(name: string) {
      const norm = normalize(name)
      return squad.find(sq => {
        const n = normalize(sq.name)
        return n === norm || n.includes(norm) || norm.includes(n) ||
          n.split(' ').at(-1) === norm.split(' ').at(-1)
      })
    }

    // ── Summary: asistencias + porteros titulares ──
    const summRes = await fetch(`${ESPN_BASE}/summary?event=${espnEv.id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store',
    })
    if (!summRes.ok) { log.push(`⚠ No summary: ${homeEs} vs ${awayEs}`); processed++; continue }
    const summData = await summRes.json()

    // Borrar asistencias y porterías previas
    await supabaseAdmin.from('player_events').delete()
      .eq('match_id', m.id).eq('event_type', 'assist')
    await supabaseAdmin.from('player_events').delete()
      .eq('match_id', m.id).in('event_type', ['clean_sheet_gk', 'clean_sheet_def'])

    const toInsert: any[] = []

    // Asistencias y porteros que jugaron desde rosters
    const playedGkNames: { name: string; espnTeamId: string }[] = []
    for (const team of summData.rosters ?? []) {
      for (const p of team.roster ?? []) {
        // Asistencias
        const assists: number = p.stats?.find((s: any) => s.name === 'goalAssists')?.value ?? 0
        if (assists > 0) {
          const sp = resolvePlayer(p.athlete?.displayName ?? '')
          if (!sp) { log.push(`⚠ No player: ${p.athlete?.displayName} (${homeEs} vs ${awayEs})`); continue }
          for (let i = 0; i < assists; i++) {
            toInsert.push({ match_id: m.id, squad_player_id: sp.id, event_type: 'assist', minute: null, notified: true })
          }
        }
        // Portero que jugó: starter o con minutos jugados
        const isGk = p.position?.abbreviation === 'GK' || p.position?.abbreviation === 'G' || p.position?.name === 'Goalkeeper'
        const played = p.starter === true || (p.stats?.find((s: any) => s.name === 'minutesPlayed')?.value ?? 0) > 0
        if (isGk && played) {
          playedGkNames.push({ name: p.athlete?.displayName ?? '', espnTeamId: team.team?.id ?? '' })
        }
      }
    }

    // Porterías a cero: solo al portero que jugó
    const goals90 = details.filter(d =>
      d.scoringPlay && !d.shootout && (parseMinute(d.clock?.displayValue ?? '') || 0) <= 90
    )
    const homeScored90 = goals90.filter(d => d.team?.id === espnHomeId).length
    const awayScored90 = goals90.filter(d => d.team?.id === espnAwayId).length

    for (const { name, espnTeamId } of playedGkNames) {
      const isHome = espnTeamId === espnHomeId
      const conceded = isHome ? awayScored90 : homeScored90
      if (conceded > 0) continue // no portería a cero
      const sp = resolvePlayer(name)
      if (!sp) { log.push(`⚠ GK no encontrado: ${name} (${homeEs} vs ${awayEs})`); continue }
      toInsert.push({ match_id: m.id, squad_player_id: sp.id, event_type: 'clean_sheet_gk', minute: null, notified: true })
    }

    if (toInsert.length > 0) {
      await supabaseAdmin.from('player_events').insert(toInsert)
      const nAssists = toInsert.filter(e => e.event_type === 'assist').length
      const nCs = toInsert.filter(e => e.event_type === 'clean_sheet_gk').length
      const parts = []
      if (nAssists > 0) parts.push(`${nAssists} asistencias`)
      if (nCs > 0) parts.push(`${nCs} portería a cero`)
      log.push(`✓ ${parts.join(', ')}: ${homeEs} vs ${awayEs}`)
    }

    processed++
  }

  return NextResponse.json({ processed, total: ourMatches.length, log })
}
