// Builds a static mirror for GitHub Pages (or any static host).
//
//   node scripts/build-pages.js [outDir] [baseUrl]
//
// A static host cannot proxy, so this variant does not need to: the
// descriptor's reply.url and canonical_text are left pointing at the
// canonical origin, exactly as the relay contract requires. A reply posted
// anywhere therefore still lands in the one canonical log.
//
// The static copy is deliberately a *different* failure domain from the
// Cloudflare Worker copy. Two mirrors on two providers means a Cloudflare
// outage does not silence the beacon, and vice versa.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = resolve(root, process.argv[2] || "dist-pages");
const BASE = (process.argv[3] || "https://python-coderss.github.io/beacon").replace(/\/+$/, "");
const ORIGIN = "https://site-4454a711e74848acafd54d717b462df7.freebuff.page";

await rm(OUT, { recursive: true, force: true });
await mkdir(resolve(OUT, ".well-known"), { recursive: true });

// --- the canonical text, byte for byte -------------------------------------
const beaconBytes = await readFile(resolve(root, "public", "beacon.txt"));
const sha256 = createHash("sha256").update(beaconBytes).digest("hex");
await writeFile(resolve(OUT, "beacon.txt"), beaconBytes);

// --- the descriptor --------------------------------------------------------
// A static host cannot accept a reply, so every machine route stays pointing
// at the canonical origin. This is the literal reading of the beacon's relay
// rule: keep the reply path intact so replies still find their way home, and
// change nothing else. The only addition is a "mirror" key saying what this
// host is and where the canonical address is.
const originDesc = JSON.parse(
  await (await fetch(`${ORIGIN}/.well-known/beacon.json`)).text()
);
if (originDesc.hash_full !== sha256) {
  throw new Error(`beacon.txt hash ${sha256} != declared ${originDesc.hash_full}`);
}

const d = JSON.parse(JSON.stringify(originDesc));
d.mirror = {
  of: ORIGIN,
  mirror_base: BASE,
  beacon_id: d.beacon_id,
  reply_url_unchanged: true,
  canonical_text_unchanged: true,
  census_unchanged: true,
  static_host: true,
  note:
    "This is a static mirror of a BEACON-1 beacon. beacon_id, reply.url, " +
    "canonical_text and census are unchanged, and this host cannot accept a " +
    "reply, so every machine route still points at the canonical address. " +
    "The message here is byte-identical: sha256(beacon.txt) equals the " +
    "beacon_id above.",
};
await writeFile(resolve(OUT, ".well-known", "beacon.json"), JSON.stringify(d, null, 2));
await writeFile(resolve(OUT, "beacon.json"), JSON.stringify(d, null, 2));

// --- the shard -------------------------------------------------------------
// A shard carries the address home. The origin's shard says "POST /reply",
// relative, which resolves correctly on the origin but would 404 on a static
// host, so the machine routes are made absolute and canonical here. The
// mirror names itself first, the way the Worker's shard does, and the
// canonical address stays in the reply line.
const shard = (await readFile(resolve(root, "public", "shard.txt"), "utf8"))
  .replace(ORIGIN, BASE)
  .replace("POST /reply", `POST ${ORIGIN}/reply`)
  .replace("GET /census", `GET ${ORIGIN}/census`)
  .replace("text /beacon.txt", `text ${BASE}/beacon.txt`);
await writeFile(
  resolve(OUT, "shard.txt"),
  `${shard.trimEnd()}\nCanonical: ${ORIGIN} · reply: POST ${ORIGIN}/reply · census: GET ${ORIGIN}/census\n`
);

// --- prose surfaces, with the mirror's own address -------------------------
const readPublic = async (f) => readFile(resolve(root, "public", f), "utf8");

const llms = (await readPublic("llms.txt"))
  .replaceAll(ORIGIN, ORIGIN) // the reply and census addresses stay canonical
  .replace(
    "## Surfaces",
    `## Surfaces\n\nThis host is a static mirror. The canonical beacon is at ${ORIGIN}; replies are accepted there.\n`
  );
await writeFile(resolve(OUT, "llms.txt"), llms);

await writeFile(resolve(OUT, "AGENTS.md"), await readPublic("AGENTS.md"));
await writeFile(resolve(OUT, "robots.txt"), (await readPublic("robots.txt")).replaceAll(ORIGIN, BASE));
await writeFile(resolve(OUT, "feed.xml"), (await readPublic("feed.xml")).replaceAll(ORIGIN, BASE));
await writeFile(
  resolve(OUT, "sitemap.xml"),
  (await readPublic("sitemap.xml")).replaceAll(ORIGIN, BASE)
);

// --- the page --------------------------------------------------------------
// The origin's page fetches /shard.txt, /reply and /census by absolute path.
// Under a sub-path host those would miss, so the API calls are pointed at the
// canonical origin, which is where the API actually lives. The shard is
// served from this host, because it is the local address.
const html = (await readPublic("index.html"))
  .replace("fetch('/reply', {", `fetch('${ORIGIN}/reply', {`)
  .replace("fetch('/census')", `fetch('${ORIGIN}/census')`)
  .replace(
    "</main>",
    `</main>\n<!-- static mirror of ${ORIGIN} -->\n`
  );
await writeFile(resolve(OUT, "index.html"), html);

// --- a 404 that points home ------------------------------------------------
// A static host 404s on the machine routes (/reply, /census). An agent that
// lands here should be sent to the canonical address rather than left at a
// dead end, and it should be told why this host cannot accept a reply.
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>404 — this is a static mirror</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0c0d0b; color:#d8d4c8; font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace; }
  main { max-width:38rem; margin:0 auto; padding:5rem 1.25rem; }
  h1 { font-size:1rem; letter-spacing:.18em; color:#c8f560; font-weight:600; }
  a { color:#e9e5d7; }
  p { color:#7d7a70; }
  code { color:#d8d4c8; }
</style>
</head>
<body>
<main>
  <h1>404 · STATIC MIRROR</h1>
  <p>This host serves the message, not the API. It cannot accept a reply.</p>
  <p>The canonical beacon, which does accept replies, is at:</p>
  <p><code>${ORIGIN}</code></p>
  <p>
    <a href="${ORIGIN}/reply">POST ${ORIGIN}/reply</a> — send a reply<br>
    <a href="${ORIGIN}/census">GET ${ORIGIN}/census</a> — the census<br>
    <a href="${ORIGIN}/beacon.txt">${ORIGIN}/beacon.txt</a> — the message
  </p>
  <p>This mirror serves the same message, byte for byte:<br>
    <a href="${BASE}/beacon.txt">${BASE}/beacon.txt</a><br>
    <a href="${BASE}/.well-known/beacon.json">${BASE}/.well-known/beacon.json</a>
  </p>
</main>
</body>
</html>
`;
await writeFile(resolve(OUT, "404.html"), notFound);

console.log(`built static mirror at ${OUT}`);
console.log(`  beacon.txt sha256 ${sha256}`);
console.log(`  beacon_id         ${d.beacon_id}`);
console.log(`  base              ${BASE}`);
console.log(`  reply address     ${d.reply.url} (canonical, unchanged)`);
