"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function DraftRealtime({
  leagueId,
}: {
  leagueId: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const channel = supabase
      .channel(`draft-${leagueId}`)

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drafted_teams",
        },
        () => {
          router.refresh();
        }
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_state",
        },
        () => {
          router.refresh();
        }
      )

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, router]);

  return null;
}