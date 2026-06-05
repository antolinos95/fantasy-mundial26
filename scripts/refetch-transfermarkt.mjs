/**
 * Rehace la foto de UN jugador concreto desde Transfermarkt.
 *
 * Uso:
 *   node --env-file=.env.local scripts/refetch-transfermarkt.mjs "Cho Wi-je"
 *   node --env-file=.env.local scripts/refetch-transfermarkt.mjs "Cho Wi-je" --team "Corea del Sur"
 *   node --env-file=.env.local scripts/refetch-transfermarkt.mjs "Cho Wi-je" --tmid 12345   (id de Transfermarkt directo)
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const BUCKET = 'player-images'
const API_BASE = 'https://transfermarkt-api.fly.dev'
const HEADERS = { 'User-Agent': 'FantasyMundial2026/1.0', 'Accept': 'application/json' }

const NAT = {
  'Estados Unidos':'United States','México':'Mexico','Panamá':'Panama','Canadá':'Canada',
  'Argentina':'Argentina','Brasil':'Brazil','Ecuador':'Ecuador','Colombia':'Colombia',
  'Uruguay':'Uruguay','Paraguay':'Paraguay','Marruecos':'Morocco','Senegal':'Senegal',
  'Egipto':'Egypt','Sudáfrica':'South Africa','Costa de Marfil':"Cote d'Ivoire",
  'Camerún':'Cameroon','DR Congo':'DR Congo','Alemania':'Germany','España':'Spain',
  'Portugal':'Portugal','Francia':'France','Inglaterra':'England','Países Bajos':'Netherlands',
  'Italia':'Italy','Bélgica':'Belgium','Croacia':'Croatia','Suiza':'Switzerland',
  'Austria':'Austria','Turquía':'Turkey','Dinamarca':'Denmark','Escocia':'Scotland',
  'Serbia':'Serbia','Polonia':'Poland','Japón':'Japan','Corea del Sur':'South Korea',
  'Australia':'Australia','Irán':'Iran','Arabia Saudita':'Saudi Arabia','Irak':'Iraq',
  'Qatar':'Qatar','República Checa':'Czech Republic','Bosnia y Herzegovina':'Bosnia-Herzegovina',
  'Haití':'Haiti','Curazao':'Curacao','Suecia':'Sweden','Túnez':'Tunisia','Nueva Zelanda':'New Zealand',
  'Cabo Verde':'Cape Verde','Noruega':'Norway','Argelia':'Algeria','Uzbekistán':'Uzbekistan',
  'Ghana':'Ghana','Jordania':'Jordan',
}

const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'')
const getJson = async url => { const r = await fetch(url, { headers: HEADERS }); if (!r.ok) throw new Error(`${r.status}`); return r.json() }

async function main() {
  const args = process.argv.slice(2)
  const name = args[0]
  if (!name) { console.error('Uso: refetch-transfermarkt.mjs "Nombre" [--team Equipo] [--tmid id]'); process.exit(1) }
  const teamFilter = args.includes('--team') ? args[args.indexOf('--team')+1] : null
  const tmid       = args.includes('--tmid') ? args[args.indexOf('--tmid')+1] : null

  // 1. Localizar jugador en BD
  const { data: players } = await supabase.from('squad_players').select('id, name, teams(name)')
  let matches = (players ?? []).filter(p => norm(p.name) === norm(name))
  if (teamFilter) matches = matches.filter(p => norm(p.teams?.name) === norm(teamFilter))

  if (!matches.length) {
    console.error(`❌ Sin coincidencia exacta para "${name}"`)
    // Coincidencias parciales por nombre
    const partial = (players ?? []).filter(p => {
      const a = norm(p.name), b = norm(name)
      return a.includes(b) || b.includes(a) || a.slice(0,4) === b.slice(0,4)
    })
    if (partial.length) {
      console.error('\n¿Quizá alguno de estos?')
      partial.slice(0, 15).forEach(p => console.error(`   "${p.name}"  (${p.teams?.name})`))
    }
    // Plantilla del equipo si se indicó --team
    if (teamFilter) {
      const roster = (players ?? []).filter(p => norm(p.teams?.name) === norm(teamFilter))
      console.error(`\nPlantilla de ${teamFilter} (${roster.length}):`)
      roster.forEach(p => console.error(`   "${p.name}"`))
    }
    console.error('\nCopia el nombre exacto y vuelve a ejecutar.')
    process.exit(1)
  }
  if (matches.length > 1) {
    console.error('⚠️ Varios, añade --team:'); matches.forEach(m => console.error(`   - ${m.name} (${m.teams?.name})`)); process.exit(1)
  }
  const player = matches[0]
  const wantNat = NAT[player.teams?.name]

  // 2. Obtener id de Transfermarkt
  let pick
  if (tmid) {
    pick = { id: tmid, name: '(manual)' }
  } else {
    const search = await getJson(`${API_BASE}/players/search/${encodeURIComponent(name)}?page_number=1`)
    const results = search.results ?? []
    if (!results.length) { console.error('❌ Sin resultados en Transfermarkt'); process.exit(1) }
    console.log('Resultados:')
    results.slice(0, 8).forEach(r => {
      const nats = Array.isArray(r.nationalities) ? r.nationalities.join('/') : (r.nationality ?? '')
      console.log(`   id=${r.id}  ${r.name}  [${nats}]  ${r.club?.name ?? ''}`)
    })
    pick = results.find(r => {
      const nats = Array.isArray(r.nationalities) ? r.nationalities : [r.nationality].filter(Boolean)
      return wantNat && nats.some(n => norm(n) === norm(wantNat))
    }) ?? results[0]
    console.log(`→ Elegido: ${pick.name} (id=${pick.id})`)
  }

  // 3. Foto del perfil
  const profile = await getJson(`${API_BASE}/players/${pick.id}/profile`)
  const imageUrl = profile.imageUrl
  if (!imageUrl) { console.error('❌ Ese jugador no tiene foto en Transfermarkt'); process.exit(1) }

  const res = await fetch(imageUrl, { headers: HEADERS })
  if (!res.ok) { console.error(`❌ Descarga ${res.status}`); process.exit(1) }
  const buffer = Buffer.from(await res.arrayBuffer())

  // 4. Subir y actualizar (storage path nuevo para invalidar caché)
  const storagePath = `tm-${player.id}.jpg`
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true })
  if (upErr) { console.error('❌', upErr.message); process.exit(1) }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
  await supabase.from('squad_players').update({ photo_url: data.publicUrl }).eq('id', player.id)

  console.log(`✅ ${player.name} (${player.teams?.name}) → ${data.publicUrl}`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
