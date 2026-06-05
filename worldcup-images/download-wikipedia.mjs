import fs from "fs";
import path from "path";

const players = JSON.parse(
  fs.readFileSync("./players.json", "utf8")
);

const OUTPUT_DIR = "./images";

fs.mkdirSync(OUTPUT_DIR, {
  recursive: true,
});

function normalizeName(name) {
  return encodeURIComponent(name);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SLEEP_MS = 1500;

// Wikimedia exige un User-Agent descriptivo; sin él devuelve 403
const HEADERS = {
  "User-Agent": "FantasyMundial2026/1.0 (proyecto educativo; contacto@example.com)",
};

async function searchWikipedia(player) {
  const query = `${player.name} footballer`;

  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;

  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`Wikipedia search failed (${res.status})`);
  }

  const data = await res.json();

  if (!data.query?.search?.length) {
    return null;
  }

  return data.query.search[0].title;
}

async function getImageUrl(title) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(title)}&format=json`;

  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();

  const pages = data.query?.pages;

  if (!pages) {
    return null;
  }

  const page = Object.values(pages)[0];

  return page?.original?.source || null;
}

async function downloadImage(url, filename) {
  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`Image download failed (${res.status})`);
  }

  const buffer = Buffer.from(
    await res.arrayBuffer()
  );

  fs.writeFileSync(filename, buffer);
}

for (const player of players) {
  try {
    console.log(`Buscando ${player.name}`);

    const title = await searchWikipedia(player);

    if (!title) {
      console.log("❌ No encontrada");
      await sleep(SLEEP_MS);
      continue;
    }

    const imageUrl = await getImageUrl(title);

    if (!imageUrl) {
      console.log("⚠️ Sin foto");
      await sleep(SLEEP_MS);
      continue;
    }

    const extension =
      imageUrl.split(".").pop().split("?")[0];

    const filepath = path.join(
      OUTPUT_DIR,
      `${player.id}.${extension}`
    );

    await downloadImage(
      imageUrl,
      filepath
    );

    console.log(
      `✅ ${player.name}`
    );

    await sleep(SLEEP_MS);

  } catch (error) {
    console.log(
      `❌ ${player.name}`
    );

    await sleep(SLEEP_MS);
  }
}