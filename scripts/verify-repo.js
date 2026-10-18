// Verifies that what git has committed is byte-identical to the origin.
//
//   node scripts/verify-repo.js
//
// Reads the blobs straight out of the git object store, so nothing about the
// local filesystem, the shell's text handling, or the platform's line-ending
// defaults can sit between the origin's bytes and the committed bytes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ORIGIN = "https://site-4454a711e74848acafd54d717b462df7.freebuff.page";

const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

const originBytes = Buffer.from(await (await fetch(`${ORIGIN}/beacon.txt`)).arrayBuffer());
const originSha = createHash("sha256").update(originBytes).digest("hex");

// The blob as git stored it.
const blob = git("cat-file", "blob", "HEAD:public/beacon.txt");
const blobSha = createHash("sha256").update(blob).digest("hex");

console.log("committed beacon.txt");
if (blobSha === originSha) pass(`git blob matches the origin (${blobSha})`);
else fail(`git blob ${blobSha} != origin ${originSha}`);

if (blob.equals(originBytes)) pass("bytes are identical, not just the hash");
else fail("blob bytes differ from the origin");

// The hash the descriptor advertises must equal the hash of the committed
// bytes, or a mirror would publish a message that fails its own check.
// The descriptor is generated into src/data.js, so that is where to read it.
const dataSrc = git("cat-file", "blob", "HEAD:src/data.js").toString("utf8");
const m = dataSrc.match(/export const BEACON_JSON = (\{[\s\S]*?\n\});/);
if (!m) {
  fail("could not find BEACON_JSON in src/data.js");
} else {
  const desc = JSON.parse(m[1]);
  if (desc.hash_full === blobSha) pass("advertised hash_full matches the committed bytes");
  else fail(`advertised hash_full ${desc.hash_full} != committed ${blobSha}`);
  if (desc.beacon_id === `sha256:${blobSha.slice(0, 16)}`)
    pass(`beacon_id ${desc.beacon_id} matches the committed bytes`);
  else fail(`beacon_id ${desc.beacon_id} != sha256:${blobSha.slice(0, 16)}`);
}

// No CRLF anywhere in the committed canonical text.
if (!blob.includes(0x0d)) pass("no CRLF in the committed canonical text");
else fail("committed canonical text contains CR bytes");

// Every other text surface should be CRLF-free too, since the catch-all rule
// normalises them.
const files = git("ls-tree", "-r", "--name-only", "HEAD").toString("utf8").trim().split("\n");
let crlf = [];
for (const f of files) {
  if (!/\.(txt|md|html|xml|json|js|toml|yml)$/.test(f)) continue;
  const b = git("cat-file", "blob", `HEAD:${f}`);
  if (b.includes(0x0d)) crlf.push(f);
}
if (crlf.length === 0) pass(`no CRLF in any of the ${files.length} committed files`);
else fail(`CRLF found in: ${crlf.join(", ")}`);

console.log(failures === 0 ? "\nrepository is byte-exact" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
