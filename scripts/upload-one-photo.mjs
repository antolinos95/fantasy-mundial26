/**
 * Sube UNA foto para un jugador buscándolo por nombre.
 *
 * Uso:
 *   node --env-file=.env.local scripts/upload-one-photo.mjs "Aníbal Godoy" ruta/a/foto.jpg
 *   node --env-file=.env.local scripts/upload-one-photo.mjs "Aníbal Godoy" https://url/a/foto.jpg
 *
 * Si hay varios jugadores con ese nombre, los lista para que añadas el equipo:
 *   node --env-file=.env.local scripts/upload-one-photo.mjs "Aníbal Godoy" foto.jpg --team Panamá
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const BUCKET = 'player-images'

const CT = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' }

function norm(s){ return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'') }

async function main() {
  const [name, source, ...rest] = process.argv.slice(2)
  if (!name || !source) {
    console.error('Uso: upload-one-photo.mjs "Nombre Jugador" <archivo|url> [--team Equipo]')
    process.exit(1)
  }
  const teamFlag = rest.indexOf('--team')
  const teamFilter = teamFlag !== -1 ? rest[teamFlag + 1] : null

  // Buscar jugador(es)
  const { data: players } = await supabase
    .from('squad_players').select('id, name, teams(name)')
  let matches = (players ?? []).filter(p => norm(p.name) === norm(name))
  if (teamFilter) matches = matches.filter(p => norm(p.teams?.name) === norm(teamFilter))

  if (matches.length === 0) { console.error(`❌ Sin jugador "${name}"${teamFilter?` en ${teamFilter}`:''}`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`⚠️ Varios jugadores "${name}". Añade --team:`)
    matches.forEach(m => console.error(`   - ${m.name} (${m.teams?.name})`))
    process.exit(1)
  }
  const player = matches[0]

  // Obtener bytes
  let buffer, ext
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { 'User-Agent': 'FantasyMundial2026/1.0' } })
    if (!res.ok) { console.error(`❌ Descarga ${res.status}`); process.exit(1) }
    buffer = Buffer.from(await res.arrayBuffer())
    ext = (extname(new URL(source).pathname) || '.jpg').toLowerCase()
  } else {
    if (!existsSync(source)) { console.error(`❌ No existe ${source}`); process.exit(1) }
    buffer = readFileSync(source)
    ext = extname(source).toLowerCase()
  }
  if (!CT[ext]) ext = '.jpg'

  const storagePath = `manual-${player.id}${ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storagePath, buffer, { contentType: CT[ext], upsert: true })
  if (upErr) { console.error('❌', upErr.message); process.exit(1) }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  await supabase.from('squad_players').update({ photo_url: data.publicUrl }).eq('id', player.id)

  console.log(`✅ ${player.name} (${player.teams?.name}) → ${data.publicUrl}`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
