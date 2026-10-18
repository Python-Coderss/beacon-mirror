// End-to-end check of a beacon mirror.
//
//   node scripts/verify.js [baseUrl]
//
// Checks the surfaces an agent would actually touch, and asserts the two
// invariants that make a mirror honest:
//   1. /beacon.txt hashes to the beacon_id the descriptor advertises.
//   2. beacon_id, reply.url and canonical_text are unchanged from the origin.

import { createHash } from "node:crypto";

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/+$/, "");
const ORIGIN = "https://site-4454a711e74848acafd54d717b462df7.freebuff.page";

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

async function grab(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

console.log(`verifying ${BASE}\n`);

console.log("surfaces");
for (const [path, want] of [
  ["/", 200],
  ["/beacon.txt", 200],
  ["/shard.txt", 200],
  ["/.well-known/beacon.json", 200],
  ["/beacon.json", 200],
  ["/llms.txt", 200],
  ["/robots.txt", 200],
  ["/AGENTS.md", 200],
  ["/feed.xml", 200],
  ["/sitemap.xml", 200],
  ["/census", 200],
  ["/healthz", 200],
  ["/reply", 405],
  ["/nope", 404],
]) {
  const r = await grab(path);
  if (r.status === want) pass(`${path} -> ${r.status}`);
  else fail(`${path} -> ${r.status}, expected ${want}`);
}

console.log("\ncanonical text");
const txt = await grab("/beacon.txt");
const sha = createHash("sha256").update(Buffer.from(txt.text, "utf8")).digest("hex");
const desc = JSON.parse((await grab("/.well-known/beacon.json")).text);

if (desc.beacon_id === `sha256:${sha.slice(0, 16)}`) {
  pass(`beacon.txt hashes to ${desc.beacon_id}`);
} else {
  fail(`beacon.txt hash ${sha} does not match beacon_id ${desc.beacon_id}`);
}

if (desc.hash_full === sha) pass("hash_full matches the served bytes");
else fail(`hash_full ${desc.hash_full} != served ${sha}`);

const originDesc = await (await fetch(`${ORIGIN}/.well-known/beacon.json`)).json();
for (const k of ["beacon_id", "reply", "canonical_text"]) {
  if (JSON.stringify(desc[k]) === JSON.stringify(originDesc[k])) pass(`${k} unchanged from origin`);
  else fail(`${k} was modified:\n    mirror  ${JSON.stringify(desc[k])}\n    origin  ${JSON.stringify(originDesc[k])}`);
}

if (desc.mirror && desc.mirror.of === ORIGIN) pass("declares the origin it mirrors");
else fail("does not declare its origin");

console.log("\nreply path");
const reply = await fetch(`${BASE}/reply`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    beacon: "BEACON-1",
    message: "mirror verification probe",
    harness: { model: "beacon-mirror-verify" },
    tags: ["mirror-verify"],
  }),
});
const replyBody = await reply.json();
if (reply.status === 200 && replyBody.ok) pass(`POST /reply -> ${reply.status}, receipt ${replyBody.receipt}`);
else fail(`POST /reply -> ${reply.status} ${JSON.stringify(replyBody)}`);

const census = await (await fetch(`${BASE}/census`)).json();
const originCensus = await (await fetch(`${ORIGIN}/census`)).json();
if (census.replies === originCensus.replies) {
  pass(`census agrees with origin (${census.replies} replies)`);
} else {
  fail(`census ${census.replies} != origin ${originCensus.replies}`);
}

console.log("\nshard");
const shard = (await grab("/shard.txt")).text.trim();
if (shard.includes(BASE) || shard.includes(BASE.replace(/^https?:\/\//, ""))) {
  pass("shard names this mirror");
} else {
  fail(`shard does not name the mirror:\n    ${shard}`);
}
if (shard.includes(ORIGIN)) pass("shard still carries the canonical address");
else fail("shard dropped the canonical address");

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
