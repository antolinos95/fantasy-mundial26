import { supabase } from '../../../lib/supabase'
import { notFound, redirect } from 'next/navigation'
import LobbyClient from './LobbyClient'

export default async function LobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: league } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', id)
    .single()

  if (!league) notFound()

  // Si ya está en draft o activa, redirigir al draft
  if (league.status === 'drafting') redirect(`/draft/${id}`)
  if (league.status === 'active')   redirect(`/standings/${id}`)

  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('league_id', id)
    .order('created_at', { ascending: true })

  return <LobbyClient league={league} initialPlayers={players ?? []} />
}
