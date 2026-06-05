/**
 * Sube imágenes de jugadores a Supabase Storage y actualiza photo_url
 * Fuente: worldcup-images/players.json + worldcup-images/images/{id}.png
 *
 * Ejecutar: node --env-file=.env.local scripts/upload-player-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BUCKET = 'player-images'
const IMAGES_DIR = join(ROOT, 'worldcup-images', 'images')
const PLAYERS_JSON = join(ROOT, 'worldcup-images', 'players.json')

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
    if (error) throw new Error(`No se pudo crear el bucket: ${error.message}`)
    console.log(`✓ Bucket '${BUCKET}' creado`)
  } else {
    console.log(`✓ Bucket '${BUCKET}' ya existe`)
  }
}

async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
  }

  // Cargar mapa id → nombre+equipo
  const playerMap = JSON.parse(readFileSync(PLAYERS_JSON, 'utf8'))
  console.log(`✓ ${playerMap.length} jugadores en players.json`)

  // Cargar jugadores de la BD
  const { data: dbPlayers, error } = await supabase
    .from('squad_players')
    .select('id, name, team_id, teams(name)')
  if (error) { console.error('❌ Supabase:', error.message); process.exit(1) }
  console.log(`✓ ${dbPlayers.length} jugadores en BD`)

  await ensureBucket()

  // Subir imagen por defecto
  const defaultPath = join(IMAGES_DIR, 'default.png')
  if (existsSync(defaultPath)) {
    await supabase.storage.from(BUCKET).upload('default.png', readFileSync(defaultPath), {
      contentType: 'image/png', upsert: true,
    })
    console.log('✓ Imagen default subida')
  }

  let uploaded = 0, matched = 0, notFound = 0

  for (const entry of playerMap) {
    const imgPath = join(IMAGES_DIR, `${entry.id}.png`)
    if (!existsSync(imgPath)) continue

    // Buscar jugador en BD por nombre normalizado + equipo
    const dbPlayer = dbPlayers.find(p =>
      normalize(p.name) === normalize(entry.name) &&
      normalize(p.teams?.name) === normalize(entry.team_name)
    ) ?? dbPlayers.find(p =>
      normalize(p.name) === normalize(entry.name)
    )

    if (!dbPlayer) {
      notFound++
      continue
    }
    matched++

    // Subir imagen
    const storagePath = `${entry.id}.png`
    const fileBuffer = readFileSync(imgPath)

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadErr) {
      console.error(`  ❌ Upload ${entry.name}:`, uploadErr.message)
      continue
    }

    // Obtener URL pública
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const photoUrl = urlData.publicUrl

    // Actualizar en BD
    await supabase.from('squad_players')
      .update({ photo_url: photoUrl })
      .eq('id', dbPlayer.id)

    uploaded++
    if (uploaded % 50 === 0) console.log(`  … ${uploaded} subidas`)
  }

  console.log(`\n✅ ${uploaded} fotos subidas | ${matched} matches | ${notFound} sin match en BD`)
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
