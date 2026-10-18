// Verifies a live static mirror.
//
//   node scripts/verify-static.js [baseUrl]
//
// A static host cannot proxy, so the checks here are different from the
// Worker's: the machine routes are supposed to stay canonical, and the local
// surfaces are supposed to be byte-exact.

import { createHash } from "node:crypto";

const BASE = (process.argv[2] || "https://python-coderss.github.io/beacon-mirror").replace(/\/+$/, "");
const ORIGIN = "https://site-4454a711e74848acafd54d717b462df7.freebuff.page";

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

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
]) {
  const res = await fetch(BASE + path);
  if (res.status === want) pass(`${path} -> ${res.status}`);
  else fail(`${path} -> ${res.status}, expected ${want}`);
}

console.log("\ncanonical text");
const res = await fetch(`${BASE}/beacon.txt`);
const bytes = Buffer.from(await res.arrayBuffer());
const sha = createHash("sha256").update(bytes).digest("hex");
const originBytes = Buffer.from(await (await fetch(`${ORIGIN}/beacon.txt`)).arrayBuffer());

if (sha === createHash("sha256").update(originBytes).digest("hex"))
  pass(`beacon.txt is byte-identical to the origin (${sha})`);
else fail("beacon.txt differs from the origin");

const desc = await (await fetch(`${BASE}/.well-known/beacon.json`)).json();
if (desc.beacon_id === `sha256:${sha.slice(0, 16)}`) pass(`beacon_id ${desc.beacon_id} matches the served bytes`);
else fail(`beacon_id ${desc.beacon_id} does not match the served bytes ${sha}`);

console.log("\nrelay contract");
const originDesc = await (await fetch(`${ORIGIN}/.well-known/beacon.json`)).json();
for (const k of ["beacon_id", "reply", "canonical_text", "census"]) {
  if (JSON.stringify(desc[k]) === JSON.stringify(originDesc[k])) pass(`${k} unchanged from origin`);
  else fail(`${k} was modified on a static host`);
}

if (desc.mirror && desc.mirror.static_host) pass("declares itself a static mirror");
else fail("does not declare itself a static mirror");

console.log("\nshard");
const shard = (await (await fetch(`${BASE}/shard.txt`)).text()).trim();
if (shard.includes(ORIGIN)) pass("shard carries the canonical reply address");
else fail("shard lost the canonical address");

// A relative machine route in a shard would resolve against this host, which
// cannot serve it. Every route the shard names must be absolute and working.
const routes = [...shard.matchAll(/POST\s+(\S+)/g), ...shard.matchAll(/GET\s+(\S+)/g)].map((m) => m[1]);
if (routes.length === 0) {
  fail("shard names no machine route");
} else {
  for (const route of routes) {
    if (!route.startsWith("http")) {
      fail(`shard names a relative route "${route}", which would resolve against this static host`);
      continue;
    }
    const r = await fetch(route, { method: route.startsWith("POST") ? "GET" : "GET" });
    if (r.status === 405 || r.status === 200) pass(`shard route ${route} -> ${r.status}`);
    else fail(`shard route ${route} -> ${r.status}`);
  }
}

// A static host 404s on the machine routes. The 404 should point home.
const nf = await fetch(`${BASE}/census`);
if (nf.status === 404) {
  const body = await nf.text();
  if (body.includes(ORIGIN)) pass("the 404 page points at the canonical address");
  else fail("the 404 page does not point at the canonical address");
} else {
  pass(`this host serves /census directly (${nf.status})`);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
