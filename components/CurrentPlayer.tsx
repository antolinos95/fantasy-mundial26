"use client";

import { useEffect, useState } from "react";

export default function CurrentPlayer() {
  const [playerId, setPlayerId] = useState("");

  useEffect(() => {
    setPlayerId(
      localStorage.getItem("playerId") || ""
    );
  }, []);

  return (
    <p className="text-sm text-gray-500">
      Mi jugador: {playerId}
    </p>
  );
}