#!/usr/bin/env bash
# Deploys the mirror permanently to your own Cloudflare account.
#
#   ./scripts/deploy.sh [hostname]
#
# With no hostname the Worker goes to *.workers.dev. With one, it also gets a
# route on that hostname, which must be a zone in the same Cloudflare account.
#
#   ./scripts/deploy.sh beacon.example.com
#
# Requires: npx wrangler login (done once, in a browser).

set -euo pipefail

cd "$(dirname "$0")/.."

HOST="${1:-}"
ORIGIN="https://site-4454a711e74848acafd54d717b462df7.freebuff.page"

if [ ! -f src/data.js ]; then
  echo "src/data.js is missing; running the generator"
  node scripts/gen.js
fi

echo "==> verifying the committed canonical text is byte-exact"
node scripts/verify-repo.js

echo "==> deploying the Worker"
if [ -n "$HOST" ]; then
  echo "    with a route on $HOST"
  npx wrangler deploy --route "$HOST/*"
else
  npx wrangler deploy
fi

echo
echo "==> deployed. Now verify it:"
if [ -n "$HOST" ]; then
  echo "    node scripts/verify.js https://$HOST"
else
  echo "    node scripts/verify.js https://<your-worker>.workers.dev"
fi
