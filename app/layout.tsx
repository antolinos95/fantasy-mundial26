import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: "IT'S FÚTBOL, NOT SOCCER — Fantasy Mundial 2026",
  description: 'Fantasy del Mundial 2026 con tus amigos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={geist.variable}>
      <body>{children}</body>
    </html>
  )
}
