import { supabase } from "../../../lib/supabase";
import StartDraftButton from "../../../components/StartDraftButton";

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("code", code)
    .single();

  if (!league) {
    return <div>Liga no encontrada</div>;
  }

  const { data: players } = await supabase
    .from("players")
    .select("*")
    .eq("league_id", league.id);

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">{league.name}</h1>

      <p>Código: {league.code}</p>

      <h2 className="mt-6 text-xl font-bold">
        Participantes
      </h2>

      <ul className="mt-2">
        {players?.map((player) => (
          <li key={player.id}>
            {player.name}
          </li>
        ))}
      </ul>

      <StartDraftButton leagueId={league.id} />
    </main>
  );
}