"use client";

import { supabase } from "../lib/supabase";

export default function TeamPicker({
  teams,
  leagueId,
  playerId,
}: {
  teams: any[];
  leagueId: string;
  playerId: string;
}) {
async function pickTeam(teamId: string) {
  const { data: draftState } = await supabase
    .from("draft_state")
    .select("*")
    .eq("league_id", leagueId)
    .single();

  const { error } = await supabase
    .from("drafted_teams")
    .insert({
      league_id: leagueId,
      team_id: teamId,
      player_id: playerId,
      pick_number: draftState.current_pick,
    });

  if (error) {
    alert(error.message);
    return;
  }

  await supabase
    .from("draft_state")
    .update({
      current_pick: draftState.current_pick + 1,
    })
    .eq("league_id", leagueId);

  location.reload();
}

  return (
    <div className="space-y-2">
      {teams.map((team) => (
        <button
          key={team.id}
          onClick={() => pickTeam(team.id)}
          className="block border rounded p-2 w-full text-left"
        >
          {team.name}
        </button>
      ))}
    </div>
  );
}