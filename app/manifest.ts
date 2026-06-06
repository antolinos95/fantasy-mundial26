import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IT'S FÚTBOL, NOT SOCCER — Fantasy Mundial 2026",
    short_name: 'Fantasy Mundial',
    description: 'Fantasy del Mundial 2026 con tus amigos',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    lang: 'es',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
