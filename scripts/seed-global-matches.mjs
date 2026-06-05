/**
 * Siembra los 72 partidos de fase de grupos + 32 eliminatorias como partidos GLOBALES
 * (league_id = NULL — compartidos por todas las ligas)
 *
 * Ejecutar UNA SOLA VEZ: node --env-file=.env.local scripts/seed-global-matches.mjs
 * Requiere schema_v5.sql y schema_v6.sql ejecutados en Supabase
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function teamId(code) {
  const { data } = await supabase.from('teams').select('id').eq('fifa_code', code).single()
  return data?.id ?? null
}

const GROUP_MATCHES = [
  // [home_code, away_code, utc_datetime, match_type]
  ['MEX','RSA','2026-06-11T19:00:00Z','group'],
  ['KOR','CZE','2026-06-12T02:00:00Z','group'],
  ['CAN','BIH','2026-06-12T19:00:00Z','group'],
  ['BRA','MAR','2026-06-13T22:00:00Z','group'],
  ['QAT','SUI','2026-06-13T19:00:00Z','group'],
  ['USA','PAR','2026-06-13T01:00:00Z','group'],
  ['HAI','SCO','2026-06-14T01:00:00Z','group'],
  ['GER','CUW','2026-06-14T17:00:00Z','group'],
  ['CIV','ECU','2026-06-14T23:00:00Z','group'],
  ['NED','JPN','2026-06-14T20:00:00Z','group'],
  ['AUS','TUR','2026-06-14T04:00:00Z','group'],
  ['BEL','EGY','2026-06-15T19:00:00Z','group'],
  ['ESP','CPV','2026-06-15T16:00:00Z','group'],
  ['KSA','URU','2026-06-15T22:00:00Z','group'],
  ['SWE','TUN','2026-06-15T02:00:00Z','group'],
  ['FRA','SEN','2026-06-16T19:00:00Z','group'],
  ['IRN','NZL','2026-06-16T01:00:00Z','group'],
  ['IRQ','NOR','2026-06-16T22:00:00Z','group'],
  ['ARG','ALG','2026-06-17T01:00:00Z','group'],
  ['AUT','JOR','2026-06-17T04:00:00Z','group'],
  ['POR','COD','2026-06-17T17:00:00Z','group'],
  ['ENG','CRO','2026-06-17T20:00:00Z','group'],
  ['GHA','PAN','2026-06-17T23:00:00Z','group'],
  ['CZE','RSA','2026-06-18T16:00:00Z','group'],
  ['SUI','BIH','2026-06-18T19:00:00Z','group'],
  ['CAN','QAT','2026-06-18T22:00:00Z','group'],
  ['UZB','COL','2026-06-18T02:00:00Z','group'],
  ['SCO','MAR','2026-06-19T22:00:00Z','group'],
  ['MEX','KOR','2026-06-19T01:00:00Z','group'],
  ['USA','AUS','2026-06-19T19:00:00Z','group'],
  ['BRA','HAI','2026-06-20T00:30:00Z','group'],
  ['GER','CIV','2026-06-20T20:00:00Z','group'],
  ['NED','SWE','2026-06-20T17:00:00Z','group'],
  ['BEL','IRN','2026-06-21T19:00:00Z','group'],
  ['ESP','KSA','2026-06-21T16:00:00Z','group'],
  ['URU','CPV','2026-06-21T22:00:00Z','group'],
  ['ECU','CUW','2026-06-21T00:00:00Z','group'],
  ['FRA','IRQ','2026-06-22T21:00:00Z','group'],
  ['NZL','EGY','2026-06-22T01:00:00Z','group'],
  ['ARG','AUT','2026-06-22T17:00:00Z','group'],
  ['ENG','GHA','2026-06-23T20:00:00Z','group'],
  ['POR','UZB','2026-06-23T17:00:00Z','group'],
  ['PAN','CRO','2026-06-23T23:00:00Z','group'],
  ['SUI','CAN','2026-06-24T19:00:00Z','group'],
  ['BIH','QAT','2026-06-24T19:00:00Z','group'],
  ['COL','COD','2026-06-24T02:00:00Z','group'],
  ['NOR','SEN','2026-06-23T00:00:00Z','group'],
  ['JOR','ALG','2026-06-23T03:00:00Z','group'],
  ['SCO','BRA','2026-06-24T22:00:00Z','group'],
  ['MAR','HAI','2026-06-24T22:00:00Z','group'],
  ['CZE','MEX','2026-06-25T01:00:00Z','group'],
  ['RSA','KOR','2026-06-25T01:00:00Z','group'],
  ['ECU','GER','2026-06-25T20:00:00Z','group'],
  ['CUW','CIV','2026-06-25T20:00:00Z','group'],
  ['JPN','SWE','2026-06-25T23:00:00Z','group'],
  ['TUN','NED','2026-06-25T23:00:00Z','group'],
  ['NOR','FRA','2026-06-26T19:00:00Z','group'],
  ['SEN','IRQ','2026-06-26T19:00:00Z','group'],
  ['TUR','USA','2026-06-26T02:00:00Z','group'],
  ['PAR','AUS','2026-06-26T02:00:00Z','group'],
  ['CPV','KSA','2026-06-27T00:00:00Z','group'],
  ['URU','ESP','2026-06-27T00:00:00Z','group'],
  ['EGY','IRN','2026-06-27T03:00:00Z','group'],
  ['NZL','BEL','2026-06-27T03:00:00Z','group'],
  ['ALG','AUT','2026-06-28T02:00:00Z','group'],
  ['JOR','ARG','2026-06-28T02:00:00Z','group'],
  ['COL','POR','2026-06-27T23:30:00Z','group'],
  ['COD','UZB','2026-06-27T23:30:00Z','group'],
  ['PAN','ENG','2026-06-27T21:00:00Z','group'],
  ['CRO','GHA','2026-06-27T21:00:00Z','group'],
]

const KNOCKOUT_MATCHES = [
  // R32
  [null,null,'2026-06-29T02:00:00Z','r32','2A','2B'],
  [null,null,'2026-06-29T19:00:00Z','r32','1E','3º(A/B/C/D/F)'],
  [null,null,'2026-06-29T22:00:00Z','r32','1F','2C'],
  [null,null,'2026-06-30T01:00:00Z','r32','1C','2F'],
  [null,null,'2026-06-30T19:00:00Z','r32','1I','3º(C/D/F/G/H)'],
  [null,null,'2026-06-30T22:00:00Z','r32','2E','2I'],
  [null,null,'2026-07-01T01:00:00Z','r32','1A','3º(C/E/F/H/I)'],
  [null,null,'2026-07-01T19:00:00Z','r32','1L','3º(E/H/I/J/K)'],
  [null,null,'2026-07-01T22:00:00Z','r32','1D','3º(B/E/F/I/J)'],
  [null,null,'2026-07-02T01:00:00Z','r32','1G','3º(A/E/H/I/J)'],
  [null,null,'2026-07-02T19:00:00Z','r32','2K','2L'],
  [null,null,'2026-07-02T22:00:00Z','r32','1H','2J'],
  [null,null,'2026-07-03T01:00:00Z','r32','1B','3º(E/F/G/I/J)'],
  [null,null,'2026-07-03T19:00:00Z','r32','1J','2H'],
  [null,null,'2026-07-03T22:00:00Z','r32','1K','3º(D/E/I/J/L)'],
  [null,null,'2026-07-04T01:00:00Z','r32','2D','2G'],
  // R16
  [null,null,'2026-07-05T19:00:00Z','r16','W(1E/3º)','W(1I/3º)'],
  [null,null,'2026-07-06T00:00:00Z','r16','W(2A/2B)','W(1F/2C)'],
  [null,null,'2026-07-06T19:00:00Z','r16','W(1C/2F)','W(2E/2I)'],
  [null,null,'2026-07-07T00:00:00Z','r16','W(1A/3º)','W(1L/3º)'],
  [null,null,'2026-07-07T19:00:00Z','r16','W(1D/3º)','W(1G/3º)'],
  [null,null,'2026-07-08T00:00:00Z','r16','W(2K/2L)','W(1H/2J)'],
  [null,null,'2026-07-08T19:00:00Z','r16','W(1B/3º)','W(1J/2H)'],
  [null,null,'2026-07-09T00:00:00Z','r16','W(1K/3º)','W(2D/2G)'],
  // QF
  [null,null,'2026-07-09T23:00:00Z','qf','W R16-1','W R16-2'],
  [null,null,'2026-07-10T23:00:00Z','qf','W R16-3','W R16-4'],
  [null,null,'2026-07-11T23:00:00Z','qf','W R16-5','W R16-6'],
  [null,null,'2026-07-12T23:00:00Z','qf','W R16-7','W R16-8'],
  // SF
  [null,null,'2026-07-14T23:00:00Z','sf','W QF-1','W QF-2'],
  [null,null,'2026-07-15T23:00:00Z','sf','W QF-3','W QF-4'],
  // 3rd + Final
  [null,null,'2026-07-18T23:00:00Z','third','L SF-1','L SF-2'],
  [null,null,'2026-07-19T19:00:00Z','final','W SF-1','W SF-2'],
]

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
  }

  // Verificar que no existan ya partidos globales
  const { count } = await supabase
    .from('matches').select('*', { count: 'exact', head: true })
    .is('league_id', null)

  if (count && count > 0) {
    console.log(`ℹ️  Ya existen ${count} partidos globales. Borrando y re-seedando…`)
    await supabase.from('matches').delete().is('league_id', null)
  }

  // Cachear IDs de equipos
  const cache = {}
  async function tid(code) {
    if (!code) return null
    if (!cache[code]) cache[code] = await teamId(code)
    return cache[code]
  }

  console.log('📥 Seedando partidos de grupos…')
  let groupOk = 0
  for (const [h, a, dt, mt] of GROUP_MATCHES) {
    const hId = await tid(h), aId = await tid(a)
    if (!hId || !aId) { console.log(`⚠️  Sin ID para ${h} o ${a}`); continue }
    const { error } = await supabase.from('matches').insert({
      home_team_id: hId, away_team_id: aId,
      match_date: dt, match_type: mt, status: 'scheduled',
      league_id: null,
    })
    if (error) console.error(`  ❌ ${h} vs ${a}:`, error.message)
    else groupOk++
  }
  console.log(`✓ ${groupOk}/${GROUP_MATCHES.length} partidos de grupos`)

  console.log('📥 Seedando eliminatorias…')
  let koOk = 0
  for (const [h, a, dt, mt, sh, sa] of KNOCKOUT_MATCHES) {
    const { error } = await supabase.from('matches').insert({
      home_team_id: null, away_team_id: null,
      slot_home: sh, slot_away: sa,
      match_date: dt, match_type: mt, status: 'scheduled',
      league_id: null,
    })
    if (error) console.error(`  ❌ ${sh} vs ${sa}:`, error.message)
    else koOk++
  }
  console.log(`✓ ${koOk}/${KNOCKOUT_MATCHES.length} partidos eliminatorios`)

  console.log(`\n✅ Total: ${groupOk + koOk} partidos globales seedados`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
