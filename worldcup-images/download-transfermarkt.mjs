/**
 * Descarga fotos desde Transfermarkt (vía API pública no oficial).
 * Desambigua por nacionalidad usando el team_name de players.json.
 *
 * Ejecutar dentro de worldcup-images/:  node download-transfermarkt.mjs
 *
 * Nota: usa una instancia pública de transfermarkt-api. Si está caída,
 * cambia API_BASE por otra (ver github.com/felipeall/transfermarkt-api).
 */
import fs from 'fs'
import path from 'path'

const players = JSON.parse(fs.readFileSync('./players.json', 'utf8'))
const OUTPUT_DIR = './images'
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const API_BASE = 'https://transfermarkt-api.fly.dev'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const SLEEP_MS = 1500
const HEADERS = { 'User-Agent': 'FantasyMundial2026/1.0', 'Accept': 'application/json' }

// Selección (español, como en la BD) → nacionalidad (inglés, como en Transfermarkt)
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
  'Catar':'Qatar','Qatar':'Qatar','República Checa':'Czech Republic','Bosnia y Herzegovina':'Bosnia-Herzegovina',
  'Haití':'Haiti','Curazao':'Curacao','Suecia':'Sweden','Túnez':'Tunisia','Nueva Zelanda':'New Zealand',
  'Cabo Verde':'Cape Verde','Noruega':'Norway','Argelia':'Algeria','Uzbekistán':'Uzbekistan',
  'Ghana':'Ghana','Jordania':'Jordan','Honduras':'Honduras','Jamaica':'Jamaica',
}

function norm(s){ return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'') }

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

function hasImage(id){
  return ['png','jpg','jpeg','webp'].some(e => fs.existsSync(path.join(OUTPUT_DIR, `${id}.${e}`)))
}

let ok = 0, fail = 0
const missing = []

for (const player of players) {
  if (hasImage(player.id)) { ok++; continue }
  const wantNat = NAT[player.team_name]

  try {
    const search = await getJson(`${API_BASE}/players/search/${encodeURIComponent(player.name)}?page_number=1`)
    await sleep(SLEEP_MS)
    const results = search.results ?? []
    if (!results.length) { console.log(`❌ ${player.name} — sin resultados`); missing.push(player); fail++; continue }

    // Preferir el que coincida en nacionalidad
    let pick = results.find(r => {
      const nats = Array.isArray(r.nationalities) ? r.nationalities : [r.nationality].filter(Boolean)
      return wantNat && nats.some(n => norm(n) === norm(wantNat))
    }) ?? results[0]

    const profile = await getJson(`${API_BASE}/players/${pick.id}/profile`)
    await sleep(SLEEP_MS)
    const imageUrl = profile.imageUrl
    if (!imageUrl) { console.log(`⚠️ ${player.name} — sin foto`); missing.push(player); fail++; continue }

    const res = await fetch(imageUrl, { headers: HEADERS })
    if (!res.ok) throw new Error(`img ${res.status}`)
    const ext = (imageUrl.split('.').pop().split('?')[0] || 'jpg').toLowerCase()
    fs.writeFileSync(path.join(OUTPUT_DIR, `${player.id}.${ext}`), Buffer.from(await res.arrayBuffer()))
    console.log(`✅ ${player.name} → ${pick.name}`)
    ok++
  } catch (e) {
    console.log(`❌ ${player.name} — ${e.message}`)
    missing.push(player); fail++
    await sleep(SLEEP_MS)
  }
}

fs.writeFileSync('./still-missing.json', JSON.stringify(missing, null, 2))
console.log(`\n==============`)
console.log(`✅ Con foto: ${ok}`)
console.log(`❌ Sin foto: ${fail}  (still-missing.json)`)
