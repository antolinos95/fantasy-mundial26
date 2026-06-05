import fs from "fs";
import path from "path";

const players = JSON.parse(
  fs.readFileSync("./players.json", "utf8")
);

const OUTPUT_DIR = "./images";

fs.mkdirSync(OUTPUT_DIR, {
  recursive: true,
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url, filepath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Error descargando imagen (${response.status})`
    );
  }

  const buffer = Buffer.from(
    await response.arrayBuffer()
  );

  fs.writeFileSync(filepath, buffer);
}

async function fetchPlayer(playerName) {
  const url =
    `https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=${encodeURIComponent(playerName)}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.log(
          `   ⚠️ Status ${response.status} (intento ${attempt})`
        );

        await sleep(5000);
        continue;
      }

      const text = await response.text();

      if (!text.trim()) {
        console.log(
          `   ⚠️ Respuesta vacía (intento ${attempt})`
        );

        await sleep(5000);
        continue;
      }

      return JSON.parse(text);

    } catch (err) {
      console.log(
        `   ⚠️ Error API (intento ${attempt})`
      );

      await sleep(5000);
    }
  }

  return null;
}

const notFound = [];
const photoMapping = [];

let success = 0;
let failed = 0;

for (const player of players) {
  try {
    console.log(`🔍 ${player.name}`);

    const data = await fetchPlayer(
      player.name
    );

    if (!data?.player?.length) {
      console.log("   ❌ No encontrado");

      notFound.push(player);

      failed++;

      await sleep(2000);

      continue;
    }

    const match = data.player[0];

    const image =
      match.strCutout ||
      match.strRender ||
      match.strThumb;

    if (!image) {
      console.log("   ⚠️ Sin imagen");

      notFound.push(player);

      failed++;

      await sleep(2000);

      continue;
    }

    const extension =
      image.includes(".png")
        ? "png"
        : "jpg";

    const filename =
      `${player.id}.${extension}`;

    const filepath = path.join(
      OUTPUT_DIR,
      filename
    );

    await downloadImage(
      image,
      filepath
    );

    photoMapping.push({
      id: player.id,
      photo_url: filename,
      sportsdb_player: match.strPlayer
    });

    success++;

    console.log(
      `   ✅ ${match.strPlayer}`
    );

    await sleep(2000);

  } catch (err) {
    console.log(
      `   ❌ Error inesperado`
    );

    notFound.push(player);

    failed++;

    await sleep(2000);
  }
}

fs.writeFileSync(
  "./not-found.json",
  JSON.stringify(
    notFound,
    null,
    2
  )
);

fs.writeFileSync(
  "./photo-mapping.json",
  JSON.stringify(
    photoMapping,
    null,
    2
  )
);

console.log("\n====================");
console.log(`✅ Encontrados: ${success}`);
console.log(`❌ Faltan: ${failed}`);
console.log("====================");