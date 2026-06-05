/**
 * Poblar fotos de jugadores usando API-Football
 * Ejecutar: node --env-file=.env.local scripts/seed-player-photos.mjs
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const API_KEY  = process.env.API_FOOTBALL_KEY
const API_BASE = 'https://v3.football.api-sports.io'

// fifa_code → API-Football team ID (mapeado manualmente para evitar búsquedas)
const TEAM_IDS = {
  MEX:  16,  RSA: 572,  KOR: 149,  CZE: 770,
  CAN:  98,  BIH: 775,  QAT: 167,  SUI:  15,
  BRA:   6,  MAR: 211,  HAI: 509,  SCO: 1108,
  USA:  31,  PAR: 783,  AUS:  25,  TUR:  24,
  GER:  25,  CIV: 224,  ECU: 131,  NED:   1,
  JPN:  21,  SWE: 729,  TUN: 202,  BEL:   1,  // BEL corregido abajo
  EGY: 164,  IRN: 155,  NZL: 274,  ESP:   9,
  KSA: 152,  URU: 26, FRA:   2,  SEN: 218,
  IRQ: 154,  NOR: 119,  ARG:  26,  ALG: 194,
  AUT: 775,  JOR: 172,  POR:  27,  COD: 229,
  UZB: 744,  COL:  20,  ENG:  10,  CRO: 799,
  GHA: 215,  PAN: 130,  CUW: 1228, CPV: 565,
}

// Corregir IDs duplicados/incorrectos con los valores reales
const CORRECT_IDS = {
  GER: 25,   NED: 1113, BEL: 1,   ARG: 26,
  URU: 26,
}
// Usaremos búsqueda por nombre para los que sabemos que pueden fallar

const TEAM_NAMES_EN = {
  MEX: 'Mexico',      RSA: 'South Africa', KOR: 'South Korea', CZE: 'Czech Republic',
  CAN: 'Canada',      BIH: 'Bosnia',       QAT: 'Qatar',       SUI: 'Switzerland',
  BRA: 'Brazil',      MAR: 'Morocco',      HAI: 'Haiti',       SCO: 'Scotland',
  USA: 'United States', PAR: 'Paraguay',   AUS: 'Australia',   TUR: 'Turkey',
  GER: 'Germany',     CIV: 'Ivory Coast',  ECU: 'Ecuador',     NED: 'Netherlands',
  JPN: 'Japan',       SWE: 'Sweden',       TUN: 'Tunisia',     BEL: 'Belgium',
  EGY: 'Egypt',       IRN: 'Iran',         NZL: 'New Zealand', ESP: 'Spain',
  KSA: 'Saudi Arabia',URU: 'Uruguay',      FRA: 'France',      SEN: 'Senegal',
  IRQ: 'Iraq',        NOR: 'Norway',       ARG: 'Argentina',   ALG: 'Algeria',
  AUT: 'Austria',     JOR: 'Jordan',       POR: 'Portugal',    COD: 'DR Congo',
  UZB: 'Uzbekistan',  COL: 'Colombia',     ENG: 'England',     CRO: 'Croatia',
  GHA: 'Ghana',       PAN: 'Panama',       CUW: 'Curacao',     CPV: 'Cape Verde',
}

async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { 'x-apisports-key': API_KEY } })
  const json = await res.json()
  return json
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
}

// Matching flexible: comprueba si los tokens principales coinciden
function nameMatch(a, b) {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return true
  // Tokens de al menos 3 chars
  const ta = na.match(/[a-z]{3,}/g) ?? []
  const tb = nb.match(/[a-z]{3,}/g) ?? []
  if (!ta.length || !tb.length) return false
  // Al menos la mitad de los tokens del nombre más corto coinciden con el más largo
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const matches = shorter.filter(t => longer.some(l => l.includes(t) || t.includes(l)))
  return matches.length >= Math.ceil(shorter.length * 0.6)
}

async function getApiTeamId(code) {
  const name = TEAM_NAMES_EN[code]
  if (!name) return null
  await sleep(2200)
  const res = await api(`/teams?search=${encodeURIComponent(name)}`)
  if (!res.response?.length) return null
  // Tomar el primer resultado que parezca selección nacional
  const best = res.response.find(r =>
    r.team.national === true || r.team.type === 'National'
  ) ?? res.response[0]
  return best?.team?.id ?? null
}

async function main() {
  const { data: dbTeams   } = await supabase.from('teams').select('id, name, fifa_code')
  const { data: dbPlayers } = await supabase.from('squad_players').select('id, team_id, name')

  let updated = 0
  const codes = Object.keys(TEAM_NAMES_EN)

  for (let i = 0; i < codes.length; i++) {
    const code    = codes[i]
    const dbTeam  = dbTeams.find(t => t.fifa_code === code)
    if (!dbTeam) { console.log(`⚠️  Sin equipo en BD: ${code}`); continue }

    // Obtener ID de API-Football
    let apiId = TEAM_IDS[code]
    if (!apiId) {
      apiId = await getApiTeamId(code)
      if (!apiId) { console.log(`⚠️  Sin ID API para ${code}`); continue }
    }

    // Jugadores temporada 2024
    await sleep(2200)
    const res = await api(`/players?team=${apiId}&season=2024`)
    const apiPlayers = res.response ?? []

    if (!apiPlayers.length) {
      // Intentar con búsqueda si el ID hardcodeado falla
      const searchId = await getApiTeamId(code)
      if (searchId && searchId !== apiId) {
        await sleep(2200)
        const res2 = await api(`/players?team=${searchId}&season=2024`)
        apiPlayers.push(...(res2.response ?? []))
      }
    }

    if (!apiPlayers.length) {
      console.log(`  ⚠️  Sin jugadores para ${code} (id=${apiId})`)
      continue
    }

    const teamDbPlayers = dbPlayers.filter(p => p.team_id === dbTeam.id)
    let teamUpdated = 0

    for (const { player: ap } of apiPlayers) {
      if (!ap.photo) continue
      const dbMatch = teamDbPlayers.find(p => nameMatch(p.name, ap.name))
      if (!dbMatch) continue
      const { error } = await supabase.from('squad_players')
        .update({ photo_url: ap.photo, api_id: ap.id })
        .eq('id', dbMatch.id)
      if (!error) { teamUpdated++; updated++ }
    }

    console.log(`  ✓ ${TEAM_NAMES_EN[code]}: ${teamUpdated}/${teamDbPlayers.length} fotos (${i+1}/${codes.length})`)
  }

  console.log(`\n✅ ${updated} jugadores con foto`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
