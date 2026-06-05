/**
 * Sube solo la imagen por defecto (default.jpg) a Supabase Storage
 * Ejecutar: node --env-file=.env.local scripts/upload-default-image.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dir, '..')
const BUCKET = 'player-images'
const defaultPath = join(ROOT, 'worldcup-images', 'images', 'default.jpg')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  if (!existsSync(defaultPath)) {
    console.error('❌ No existe', defaultPath); process.exit(1)
  }
  const { error } = await supabase.storage.from(BUCKET).upload(
    'default.jpg', readFileSync(defaultPath),
    { contentType: 'image/jpeg', upsert: true }
  )
  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl('default.jpg')
  console.log('✅ Default subida:', data.publicUrl)
}

main()
