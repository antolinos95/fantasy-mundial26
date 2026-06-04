"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function TeamPicker({
  teams,
  leagueId,
  playerId,
  currentPlayerId,
}: {
  teams: any[];
  leagueId: string;
  playerId: string;
  currentPlayerId: string;
}) {
  const [myPlayerId, setMyPlayerId] = useState("");

  useEffect(() => {
    setMyPlayerId(
      localStorage.getItem("playerId") || ""
    );
  }, []);

  const isMyTurn =
    myPlayerId === currentPlayerId;

  async function pickTeam(teamId: string) {
    if (!isMyTurn) {
      alert("No es tu turno");
      return;
    }

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
        current_pick:
          draftState.current_pick + 1,
      })
      .eq("league_id", leagueId);

    location.reload();
  }

  return (
    <div className="space-y-2">
      {!isMyTurn && (
        <p className="text-red-500 font-bold">
          Esperando tu turno...
        </p>
      )}

      {teams.map((team) => (
        <button
          key={team.id}
          onClick={() => pickTeam(team.id)}
          disabled={!isMyTurn}
          className="block border rounded p-2 w-full text-left disabled:opacity-50"
        >
          {team.name}
        </button>
      ))}
    </div>
  );
}