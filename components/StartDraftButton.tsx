"use client";

import { supabase } from "../lib/supabase";

function shuffleArray<T>(array: T[]) {
  const arr = [...array];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

export default function StartDraftButton({
  leagueId,
}: {
  leagueId: string;
}) {
  async function startDraft() {
    // Evitar iniciar dos veces
    const { data: existingDraft } = await supabase
      .from("draft_state")
      .select("*")
      .eq("league_id", leagueId)
      .maybeSingle();

    if (existingDraft) {
      alert("El draft ya está iniciado");
      return;
    }

    // Obtener jugadores
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("*")
      .eq("league_id", leagueId);

    if (playersError) {
      alert(playersError.message);
      return;
    }

    if (!players || players.length < 2) {
      alert("Se necesitan al menos 2 jugadores");
      return;
    }

    // Orden aleatorio
    const shuffledPlayers = shuffleArray(players);

    const orderRows = shuffledPlayers.map(
      (player: any, index: number) => ({
        league_id: leagueId,
        player_id: player.id,
        draft_position: index + 1,
      })
    );

    const { error: orderError } = await supabase
      .from("draft_order")
      .insert(orderRows);

    if (orderError) {
      alert(orderError.message);
      return;
    }

    const { error: draftError } = await supabase
      .from("draft_state")
      .insert({
        league_id: leagueId,
        current_pick: 1,
        started: true,
        finished: false,
        direction: 1,
      });

    if (draftError) {
      alert(draftError.message);
      return;
    }

    alert("Draft iniciado");
    location.reload();
  }

  return (
    <button
      onClick={startDraft}
      className="mt-6 bg-blue-600 text-white px-4 py-2 rounded"
    >
      Iniciar Draft
    </button>
  );
}