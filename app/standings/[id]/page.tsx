import { supabase } from '../../../lib/supabase'
import { notFound } from 'next/navigation'
import StandingsClient from './StandingsClient'

export default async function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [
    { data: league },
    { data: players },
    { data: scores },
    { data: myTeams },
    { data: matches },
  ] = await Promise.all([
    supabase.from('leagues').select('*').eq('id', id).single(),
    supabase.from('players').select('*').eq('league_id', id),
    supabase.from('scores').select('*, player:players(*)').eq('league_id', id).order('points', { ascending: false }),
    supabase.from('drafted_teams').select('*, team:teams(*), player:players(*)').eq('league_id', id).order('pick_number'),
    supabase.from('matches').select('*, home_team:teams!matches_home_team_id_fkey(*), away_team:teams!matches_away_team_id_fkey(*)').or(`league_id.is.null,league_id.eq.${id}`).order('match_date'),
  ])

  if (!league) notFound()

  return (
    <StandingsClient
      league={league}
      players={players ?? []}
      scores={scores ?? []}
      draftedTeams={myTeams ?? []}
      matches={matches ?? []}
    />
  )
}
