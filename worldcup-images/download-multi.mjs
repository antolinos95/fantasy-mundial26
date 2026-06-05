/**
 * Descarga fotos probando varias ediciones de Wikipedia.
 * Mejor cobertura para jugadores de Panamá, Ghana, Irak, etc.
 *
 * Ejecutar dentro de worldcup-images/:  node download-multi.mjs
 */
import fs from 'fs'
import path from 'path'

const players = JSON.parse(fs.readFileSync('./players.json', 'utf8'))
const OUTPUT_DIR = './images'
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const SLEEP_MS = 1200

const HEADERS = {
  'User-Agent': 'FantasyMundial2026/1.0 (proyecto educativo; contacto@example.com)',
}

// Ediciones a probar, con el sufijo de búsqueda adecuado
const WIKIS = [
  { lang: 'es', suffix: 'futbolista' },
  { lang: 'en', suffix: 'footballer' },
  { lang: 'pt', suffix: 'futebolista' },
  { lang: 'fr', suffix: 'footballeur' },
]

async function searchTitle(lang, query) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`search ${lang} ${res.status}`)
  const data = await res.json()
  return data.query?.search?.[0]?.title ?? null
}

async function getImage(lang, title) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(title)}&format=json`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const data = await res.json()
  const page = Object.values(data.query?.pages ?? {})[0]
  return page?.original?.source ?? null
}

async function downloadImage(url, filepath) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`img ${res.status}`)
  fs.writeFileSync(filepath, Buffer.from(await res.arrayBuffer()))
}

function alreadyHasImage(id) {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif']
    .some(e => fs.existsSync(path.join(OUTPUT_DIR, `${id}.${e}`)))
}

let ok = 0, fail = 0
const stillMissing = []

for (const player of players) {
  if (alreadyHasImage(player.id)) { ok++; continue }

  let imageUrl = null, foundLang = null
  for (const { lang, suffix } of WIKIS) {
    try {
      const title = await searchTitle(lang, `${player.name} ${suffix}`)
      await sleep(SLEEP_MS)
      if (!title) continue
      imageUrl = await getImage(lang, title)
      await sleep(SLEEP_MS)
      if (imageUrl) { foundLang = lang; break }
    } catch (e) {
      console.log(`   ⚠️ ${lang}: ${e.message}`)
      await sleep(SLEEP_MS)
    }
  }

  if (!imageUrl) {
    console.log(`❌ ${player.name}`)
    stillMissing.push(player)
    fail++
    continue
  }

  try {
    const ext = (imageUrl.split('.').pop().split('?')[0] || 'jpg').toLowerCase()
    await downloadImage(imageUrl, path.join(OUTPUT_DIR, `${player.id}.${ext}`))
    console.log(`✅ ${player.name} (${foundLang})`)
    ok++
  } catch (e) {
    console.log(`❌ ${player.name} — descarga falló`)
    stillMissing.push(player)
    fail++
  }
  await sleep(SLEEP_MS)
}

fs.writeFileSync('./still-missing.json', JSON.stringify(stillMissing, null, 2))
console.log(`\n==============`)
console.log(`✅ Con foto: ${ok}`)
console.log(`❌ Sin foto: ${fail}  (ver still-missing.json)`)
