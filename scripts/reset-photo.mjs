/**
 * Pone la foto por defecto a un jugador (photo_url = NULL → la app usa default.jpg).
 * Acepta coincidencia parcial de nombre.
 *
 * Uso:
 *   node --env-file=.env.local scripts/reset-photo.mjs "Cho Wi"
 *   node --env-file=.env.local scripts/reset-photo.mjs "Cho Wi" --team "Corea del Sur"
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'')

async function main() {
  const args = process.argv.slice(2)
  const name = args[0]
  if (!name) { console.error('Uso: reset-photo.mjs "Nombre" [--team Equipo]'); process.exit(1) }
  const teamFilter = args.includes('--team') ? args[args.indexOf('--team')+1] : null

  const { data: players } = await supabase.from('squad_players').select('id, name, teams(name)')
  let matches = (players ?? []).filter(p => norm(p.name).includes(norm(name)) || norm(name).includes(norm(p.name)))
  if (teamFilter) matches = matches.filter(p => norm(p.teams?.name) === norm(teamFilter))

  if (!matches.length) { console.error(`❌ Sin jugador que contenga "${name}"`); process.exit(1) }
  if (matches.length > 1) {
    console.error('⚠️ Varios coinciden, afina el nombre o añade --team:')
    matches.forEach(m => console.error(`   "${m.name}" (${m.teams?.name})`))
    process.exit(1)
  }

  const player = matches[0]
  await supabase.from('squad_players').update({ photo_url: null }).eq('id', player.id)
  console.log(`✅ ${player.name} (${player.teams?.name}) → foto por defecto`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
