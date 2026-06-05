/**
 * Genera worldcup-images/players.json con los jugadores que AÚN no tienen foto.
 * Luego ejecuta:
 *   cd worldcup-images && node downloadPlayers.mjs
 *   cd .. && node --env-file=.env.local scripts/upload-player-images.mjs
 *
 * Ejecutar: node --env-file=.env.local scripts/build-missing-players-json.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')
const JSON_PATH = join(ROOT, 'worldcup-images', 'players.json')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
  }

  // Jugadores sin foto, con nombre de su selección
  const { data, error } = await supabase
    .from('squad_players')
    .select('name, photo_url, teams(name)')
    .is('photo_url', null)
    .order('team_id')

  if (error) { console.error('❌', error.message); process.exit(1) }

  const missing = (data ?? []).map(p => ({
    id: randomUUID(),
    name: p.name,
    team_name: p.teams?.name ?? '',
  }))

  console.log(`📋 ${missing.length} jugadores sin foto`)

  if (missing.length === 0) {
    console.log('✅ Todos los jugadores ya tienen foto, no hay nada que descargar')
    return
  }

  // Backup del players.json anterior
  if (existsSync(JSON_PATH)) {
    copyFileSync(JSON_PATH, JSON_PATH + '.bak')
    console.log('💾 Backup guardado en players.json.bak')
  }

  writeFileSync(JSON_PATH, JSON.stringify(missing, null, 2))
  console.log(`✓ Escrito ${JSON_PATH} con ${missing.length} jugadores`)
  console.log('\nSiguiente paso:')
  console.log('  cd worldcup-images && node downloadPlayers.mjs')
  console.log('  cd .. && node --env-file=.env.local scripts/upload-player-images.mjs')

  // Desglose por selección
  const byTeam = {}
  for (const m of missing) byTeam[m.team_name] = (byTeam[m.team_name] ?? 0) + 1
  console.log('\nPor selección:')
  Object.entries(byTeam).sort((a, b) => b[1] - a[1])
    .forEach(([t, n]) => console.log(`  ${n.toString().padStart(2)} · ${t}`))
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
