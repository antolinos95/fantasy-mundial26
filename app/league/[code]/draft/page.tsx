import { supabase } from "../../../../lib/supabase";
import TeamPicker from "../../../../components/TeamPicker";

export default async function DraftPage({
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
const firstPlayer = players?.[0];
const { data: draftOrder } = await supabase
  .from("draft_order")
  .select(`
    draft_position,
    player_id
  `)
  .eq("league_id", league.id)
  .order("draft_position");

const { data: draftState } = await supabase
  .from("draft_state")
  .select("*")
  .eq("league_id", league.id)
  .single();

const { data: teams } = await supabase
  .from("teams")
  .select("*")
  .order("name");

const { data: draftedTeams } = await supabase
  .from("drafted_teams")
  .select("team_id")
  .eq("league_id", league.id);

  const { data: draftHistory } = await supabase
  .from("drafted_teams")
  .select("*")
  .eq("league_id", league.id)
  .order("pick_number");

  const { data: draftedTeamsFull } = await supabase
  .from("drafted_teams")
  .select("*")
  .eq("league_id", league.id);

const draftedIds =
  draftedTeams?.map((t) => t.team_id) || [];

const availableTeams =
  teams?.filter(
    (team) => !draftedIds.includes(team.id)
  ) || [];
  const playersMap = Object.fromEntries(
  (players || []).map((p) => [p.id, p.name])
);

const teamsMap = Object.fromEntries(
  (teams || []).map((t) => [t.id, t.name])
);
const currentPick = draftState?.current_pick ?? 1;

const playerCount = draftOrder?.length ?? 0;

let currentPlayer = null;

if (playerCount > 0) {
  const round = Math.floor(
    (currentPick - 1) / playerCount
  );

  const positionInRound =
    (currentPick - 1) % playerCount;

  const snakeIndex =
    round % 2 === 0
      ? positionInRound
      : playerCount - 1 - positionInRound;

  currentPlayer =
    draftOrder?.[snakeIndex];
}
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">
        Draft - {league.name}
      </h1>

      <div className="mt-6">


        <p>
          Estado:{" "}
          <strong>
            {draftState?.started ? "Activo" : "No iniciado"}
          </strong>
        </p>
      </div>
              <p>
          Pick actual: <strong>{draftState?.current_pick ?? 1}</strong>
        </p>
<p className="mt-2">
  Turno de:{" "}
  <strong>
    {
      players?.find(
        (p) => p.id === currentPlayer?.player_id
      )?.name
    }
  </strong>
</p>
      <h2 className="mt-8 text-xl font-bold">
        Participantes
      </h2>
        <ul className="mt-2">
        {players?.map((player) => (
          <li key={player.id}>
            {player.name}
          </li>
        ))}
      </ul>
<h2 className="mt-8 text-xl font-bold">
  Orden del Draft
</h2>

<ul className="mt-2">
  {draftOrder?.map((pick) => {
    const player = players?.find(
      (p) => p.id === pick.player_id
    );

    return (
      <li key={pick.player_id}>
        #{pick.draft_position} - {player?.name}
      </li>
    );
  })}
</ul>
    

      <h2 className="mt-8 text-xl font-bold">
        Equipos disponibles
      </h2>
            {firstPlayer && (
        <TeamPicker
  teams={availableTeams}
  leagueId={league.id}
  playerId={currentPlayer.player_id}
  currentPlayerId={currentPlayer.player_id}
/>
      )}
<h2 className="mt-8 text-xl font-bold">
  Historial del Draft
</h2>
      <ul className="mt-2">
  {draftHistory?.map((pick) => (
    <li key={pick.id}>
      #{pick.pick_number}{" "}
      {playersMap[pick.player_id]} →{" "}
      {teamsMap[pick.team_id]}
    </li>
  ))}
</ul>

<h2 className="mt-8 text-xl font-bold">
  Equipos por jugador
</h2>

{players?.map((player) => {
  const playerTeams =
    draftedTeamsFull?.filter(
      (pick) => pick.player_id === player.id
    ) || [];

  return (
    <div key={player.id} className="mt-4">
      <h3 className="font-bold">
        {player.name}
      </h3>

      <ul>
        {playerTeams.map((pick) => (
          <li key={pick.id}>
            {teamsMap[pick.team_id]}
          </li>
        ))}
      </ul>
    </div>
  );
})}

    </main>
  );
}