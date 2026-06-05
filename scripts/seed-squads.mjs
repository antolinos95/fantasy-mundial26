/**
 * Seed squad players from Wikipedia (gratis, sin API key)
 * Ejecutar: node --env-file=.env.local scripts/seed-squads.mjs
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const NAME_TO_CODE = {
  'mexico': 'MEX', 'south africa': 'RSA', 'south korea': 'KOR',
  'korea republic': 'KOR', 'czech republic': 'CZE', 'czechia': 'CZE',
  'canada': 'CAN', 'bosnia and herzegovina': 'BIH', 'qatar': 'QAT',
  'switzerland': 'SUI', 'brazil': 'BRA', 'morocco': 'MAR',
  'haiti': 'HAI', 'scotland': 'SCO', 'united states': 'USA', 'usa': 'USA',
  'paraguay': 'PAR', 'australia': 'AUS', 'turkey': 'TUR', 'türkiye': 'TUR',
  'germany': 'GER', 'curaçao': 'CUW', 'curacao': 'CUW',
  "côte d'ivoire": 'CIV', 'ivory coast': 'CIV', 'ecuador': 'ECU',
  'netherlands': 'NED', 'japan': 'JPN', 'sweden': 'SWE', 'tunisia': 'TUN',
  'belgium': 'BEL', 'egypt': 'EGY', 'iran': 'IRN', 'new zealand': 'NZL',
  'spain': 'ESP', 'cape verde': 'CPV', 'saudi arabia': 'KSA', 'uruguay': 'URU',
  'france': 'FRA', 'senegal': 'SEN', 'iraq': 'IRQ', 'norway': 'NOR',
  'argentina': 'ARG', 'algeria': 'ALG', 'austria': 'AUT', 'jordan': 'JOR',
  'portugal': 'POR', 'dr congo': 'COD', 'democratic republic of the congo': 'COD',
  'uzbekistan': 'UZB', 'colombia': 'COL', 'england': 'ENG', 'croatia': 'CRO',
  'ghana': 'GHA', 'panama': 'PAN',
}

function mapPos(pos) {
  const p = (pos || '').toUpperCase().trim()
  if (p === 'GK') return 'GK'
  if (p === 'DF') return 'DF'
  if (p === 'MF') return 'MF'
  if (p === 'FW' || p === 'AT') return 'FW'
  return 'MF'
}

function extractName(raw) {
  const m = raw.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/)
  return (m ? m[1] : raw)
    .replace(/\[\[|\]\]/g, '')
    .replace(/\s*\([^)]*\)/g, '')  // quitar aclaraciones entre paréntesis
    .trim()
}

// Extrae todos los {{nat fs g player|...}} respetando llaves anidadas
function extractPlayerTemplates(text) {
  const marker = '{{nat fs g player|'
  const results = []
  let i = 0
  while (i < text.length) {
    const start = text.toLowerCase().indexOf(marker.toLowerCase(), i)
    if (start === -1) break
    let depth = 0, j = start
    while (j < text.length) {
      if (text[j] === '{' && text[j + 1] === '{') { depth++; j += 2; continue }
      if (text[j] === '}' && text[j + 1] === '}') {
        depth--
        if (depth === 0) { results.push(text.slice(start, j + 2)); j += 2; break }
        j += 2; continue
      }
      j++
    }
    i = j
  }
  return results
}

// Parsea parámetros de un template respetando llaves anidadas
function parseTemplateParams(template) {
  const inner = template.slice(2, -2) // quitar {{ y }}
  const parts = []
  let depth = 0, current = ''
  for (const ch of inner) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '|' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  parts.push(current)

  const params = {}
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=')
    if (eq === -1) continue
    params[parts[i].slice(0, eq).trim().toLowerCase()] = parts[i].slice(eq + 1).trim()
  }
  return params
}

// Detecta secciones de equipo: ===Name=== o ====Name====
function findTeamSections(text) {
  const sections = []
  const re = /={2,4}([^=\n]+?)={2,4}/g
  let m
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
      .replace(/\[\[|\]\]/g, '').trim().toLowerCase()
    const code = NAME_TO_CODE[raw]
    if (code) sections.push({ code, index: m.index, end: m.index + m[0].length })
  }
  return sections
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
  }

  console.log('📥 Descargando plantillas de Wikipedia...')
  const res = await fetch(
    'https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads&prop=wikitext&format=json&formatversion=2',
    { headers: { 'User-Agent': 'FantasyMundial2026/1.0 (educational)' } }
  )
  const json = await res.json()
  if (json.error) { console.error('❌ Wikipedia:', json.error.info); process.exit(1) }
  const wikitext = json.parse.wikitext
  console.log(`✓ Wikitext: ${wikitext.length} caracteres`)

  // Encontrar secciones de equipo y sus rangos de texto
  const sections = findTeamSections(wikitext)
  console.log(`✓ ${sections.length} secciones de equipo detectadas`)

  if (sections.length === 0) {
    // Debug: mostrar primeras secciones del wikitext
    const lines = wikitext.split('\n').slice(0, 30)
    console.log('Primeras líneas del wikitext:')
    lines.forEach(l => console.log(' ', JSON.stringify(l)))
    process.exit(1)
  }

  // Para cada sección, extraer jugadores del trozo de texto correspondiente
  const squads = {}
  for (let i = 0; i < sections.length; i++) {
    const sec    = sections[i]
    const nextIdx = sections[i + 1]?.index ?? wikitext.length
    const chunk  = wikitext.slice(sec.end, nextIdx)
    const templates = extractPlayerTemplates(chunk)
    squads[sec.code] = templates.map(t => {
      const p = parseTemplateParams(t)
      return {
        name:         extractName(p.name || ''),
        position:     mapPos(p.pos),
        shirt_number: p.no ? (parseInt(p.no) || null) : null,
      }
    }).filter(p => p.name)
  }

  const totalPlayers = Object.values(squads).reduce((s, a) => s + a.length, 0)
  console.log(`✓ ${Object.keys(squads).length} equipos, ${totalPlayers} jugadores en total`)

  // Insertar en Supabase
  const { data: dbTeams, error } = await supabase.from('teams').select('id, fifa_code, name')
  if (error) { console.error('❌ Supabase:', error.message); process.exit(1) }

  let seeded = 0, skipped = 0
  for (const [code, players] of Object.entries(squads)) {
    if (!players.length) continue
    const dbTeam = dbTeams.find(t => t.fifa_code?.toUpperCase() === code)
    if (!dbTeam) { console.log(`⚠️  Sin equipo en BD: ${code}`); skipped++; continue }

    await supabase.from('squad_players').delete().eq('team_id', dbTeam.id)
    const { error: e } = await supabase.from('squad_players').insert(
      players.map(p => ({ team_id: dbTeam.id, ...p }))
    )
    if (e) console.error(`  ❌ ${dbTeam.name}:`, e.message)
    else { console.log(`  ✓ ${dbTeam.name}: ${players.length} jugadores`); seeded++ }
  }

  console.log(`\n✅ ${seeded} equipos | ${skipped} sin match`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
