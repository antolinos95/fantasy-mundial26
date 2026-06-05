import { supabase } from '../../../lib/supabase'
import { notFound } from 'next/navigation'
import DraftClient from './DraftClient'

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [
    { data: league },
    { data: players },
    { data: teams },
    { data: draftOrder },
    { data: draftState },
    { data: draftedTeams },
  ] = await Promise.all([
    supabase.from('leagues').select('*').eq('id', id).single(),
    supabase.from('players').select('*').eq('league_id', id).order('created_at'),
    supabase.from('teams').select('*').order('name'),
    supabase.from('draft_order').select('*, player:players(*)').eq('league_id', id).order('draft_position'),
    supabase.from('draft_state').select('*').eq('league_id', id).single(),
    supabase.from('drafted_teams').select('*, team:teams(*), player:players(*)').eq('league_id', id).order('pick_number'),
  ])

  if (!league) notFound()

  return (
    <DraftClient
      league={league}
      players={players ?? []}
      allTeams={teams ?? []}
      draftOrder={draftOrder ?? []}
      initialDraftState={draftState}
      initialDraftedTeams={draftedTeams ?? []}
    />
  )
}
