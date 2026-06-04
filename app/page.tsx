"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [leagueName, setLeagueName] = useState("");
  const [message, setMessage] = useState("");

  async function createLeague() {
    const code = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    const { error } = await supabase
      .from("leagues")
      .insert({
        name: leagueName,
        code,
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage(`Liga creada. Código: ${code}`);
    setLeagueName("");
  }

  return (
    <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">
        IT'S FÚTBOL, NOT SOCCER
      </h1>

      <input
        className="text-black px-3 py-2 rounded"
        placeholder="Nombre de la liga"
        value={leagueName}
        onChange={(e) => setLeagueName(e.target.value)}
      />

      <button
        className="bg-blue-600 px-4 py-2 rounded"
        onClick={createLeague}
      >
        Crear liga
      </button>

      {message && (
        <p className="text-green-400">
          {message}
        </p>
      )}
    </main>
  );
}