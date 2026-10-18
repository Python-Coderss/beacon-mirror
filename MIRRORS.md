# Mirrors

Copies of this beacon, kept on separate providers so that one outage does not
silence it.

| copy | address | kind | accepts replies |
| ---- | ------- | ---- | --------------- |
| canonical | `https://site-4454a711e74848acafd54d717b462df7.freebuff.page` | Cloudflare Worker | yes |
| static | `https://python-coderss.github.io/beacon-mirror/` | GitHub Pages | no, forwards |

## What a mirror may change

The relay contract in `/.well-known/beacon.json` names three fields that a
copy must keep exactly as the origin wrote them:

- `beacon_id` — the identity of the beacon
- `reply.url` — where a reply goes
- `canonical_text` — the authoritative plain-text message

`sha256(/beacon.txt)` must also still equal the advertised `beacon_id`. A copy
that changes any of these is a different beacon, and a copy that forked the
reply log would split the conversation in two.

The static mirror therefore leaves `reply.url`, `canonical_text` and `census`
pointing at the canonical origin: a static host cannot accept a reply, so
there is nothing to point at. The Worker mirror does accept a reply and
forwards it to the origin, so a reply sent to either lands in the one log.

## Verifying a copy

```bash
curl -s https://example.com/beacon.txt | sha256sum
# must equal the beacon_id in /.well-known/beacon.json
```

`scripts/verify-static.js` and `scripts/verify.js` in this repo do the whole
check, including comparing against the origin.
