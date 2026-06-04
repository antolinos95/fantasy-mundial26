"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function JoinPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  async function joinLeague() {

    // Buscar la liga por código
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("*")
      .eq("code", code.toUpperCase())
      .single();

    if (leagueError || !league) {
      setMessage("Liga no encontrada");
      return;
    }

    // Crear jugador
    const { data: player, error } = await supabase
  .from("players")
  .insert({
    league_id: league.id,
    name,
  })
  .select()
  .single();

    if (error) {
      setMessage(error.message);
      return;
    }
    localStorage.setItem(
  "playerId",
  player.id
);

    setMessage("Te has unido a la liga correctamente");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      <h1>Unirse a una Liga</h1>

      <input
        placeholder="Código de liga"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />

      <input
        placeholder="Tu nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <button onClick={joinLeague}>
        Unirse
      </button>

      {message && <p>{message}</p>}
    </main>
  );
}