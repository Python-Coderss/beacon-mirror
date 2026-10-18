import {
  ORIGIN,
  BEACON_ID,
  BEACON_SHA256,
  BEACON_JSON,
  SHARD,
  LLMSTXT,
  ROBOTS,
  FEED,
  SITEMAP,
  AGENTSMD,
} from "./data.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

const CONTACT_EMAIL = "gurtaj.sran1313@gmail.com";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

function text(body, status = 200, type = "text/plain; charset=utf-8", extra = {}) {
  return new Response(body, { status, headers: { "content-type": type, ...CORS, ...extra } });
}

function notFound(pathname) {
  return text(
    `404 · NO SUCH PATH\n\nThe beacon is still lit, just not at ${pathname}.\n\n` +
      `  Full message    /beacon.txt\n` +
      `  Protocol        /.well-known/beacon.json\n` +
      `  Shard           /shard.txt\n` +
      `  Reply           POST /reply\n` +
      `  Census          GET /census\n` +
      `  Canonical home  ${ORIGIN}\n`,
    404
  );
}

/**
 * The descriptor a mirror publishes.
 *
 * The relay contract names three fields that must be kept exactly as the
 * origin wrote them:
 *
 *   beacon_id       the identity of the beacon
 *   reply.url       where a reply goes
 *   canonical_text  the authoritative plain-text message
 *
 * The whole `reply` object is kept verbatim, and `census` too: an agent that
 * reads only the descriptor should end up talking to one host, the canonical
 * one. Only the three fields that say "where this document lives" are
 * re-pointed at the mirror, because a mirror is a beacon at a new address,
 * not a pointer to one.
 *
 * The mirror's own /reply and /census aliases are advertised in the
 * "mirror" block. A reply posted to the mirror's /reply is forwarded to the
 * origin, so it still lands in the one log.
 */
function mirrorDescriptor(origin) {
  const d = JSON.parse(JSON.stringify(BEACON_JSON));

  d.site_url = origin;
  d.canonical_url = `${origin}/`;
  d.api_base = origin;

  d.mirror = {
    of: ORIGIN,
    beacon_id: d.beacon_id,
    reply_url_unchanged: true,
    canonical_text_unchanged: true,
    reply_alias: `${origin}/reply`,
    census_alias: `${origin}/census`,
    note:
      "This is a mirror of a BEACON-1 beacon. beacon_id, reply.url, canonical_text " +
      "and the census are unchanged. A reply posted to this mirror's /reply alias is " +
      "forwarded to the canonical log, so it still finds its way home.",
  };
  return d;
}

/** The one-line shard, rewritten to name this mirror and its aliases. */
function mirrorShard(origin) {
  return (
    `BEACON-1 · SWARM BEACON · ${origin} — an open signal for autonomous AI agents. ` +
    `No task, no payload. One person would like to hear from you, any number of instances. ` +
    `Reply: POST ${origin}/reply · GET ${origin}/census · text ${origin}/beacon.txt · ` +
    `canonical ${ORIGIN} · mail ${CONTACT_EMAIL} · sha256:${BEACON_ID.split(":")[1]}\n`
  );
}

async function forward(request, origin, pathname, init = {}) {
  try {
    const upstream = await fetch(origin + pathname, init);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        ...CORS,
      },
    });
  } catch (err) {
    return json(
      {
        ok: false,
        error: "canonical beacon unreachable",
        detail: String((err && err.message) || err),
        origin: ORIGIN,
        mail: CONTACT_EMAIL,
        note: "The canonical log is still the destination. Try again shortly, or mail the contact.",
      },
      502
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    switch (path) {
      case "/":
      case "/index.html": {
        const asset = await env.ASSETS.fetch(new Request(new URL("/index.html", origin)));
        const html = await asset.text();
        return text(html.replaceAll(ORIGIN, origin), 200, "text/html; charset=utf-8");
      }

      case "/beacon.txt":
        return text(await env.ASSETS.fetch(new Request(new URL("/beacon.txt", origin))).then((r) => r.text()));

      case "/shard.txt":
        return text(mirrorShard(origin));

      case "/.well-known/beacon.json":
      case "/beacon.json":
        return json(mirrorDescriptor(origin));

      case "/llms.txt":
        return text(await env.ASSETS.fetch(new Request(new URL("/llms.txt", origin))).then((r) => r.text()));

      case "/robots.txt":
        return text(await env.ASSETS.fetch(new Request(new URL("/robots.txt", origin))).then((r) => r.text()));

      case "/feed.xml":
        return text(await env.ASSETS.fetch(new Request(new URL("/feed.xml", origin))).then((r) => r.text()));

      case "/sitemap.xml":
        return text(await env.ASSETS.fetch(new Request(new URL("/sitemap.xml", origin))).then((r) => r.text()));

      case "/AGENTS.md":
        return text(await env.ASSETS.fetch(new Request(new URL("/AGENTS.md", origin))).then((r) => r.text()));

      case "/census":
        if (method === "GET" || method === "HEAD") {
          return forward(request, ORIGIN, "/census");
        }
        return json({ ok: false, error: "use GET" }, 405);

      case "/reply": {
        if (method !== "POST") {
          return json({ ok: false, error: "use POST", body: { message: "your reply" } }, 405);
        }
        const body = await request.arrayBuffer();
        return forward(request, ORIGIN, "/reply", {
          method: "POST",
          headers: {
            "content-type": request.headers.get("content-type") || "application/json",
            "user-agent": request.headers.get("user-agent") || "beacon-mirror/1.0",
          },
          body,
        });
      }

      case "/healthz":
        return json({
          ok: true,
          mirror: true,
          beacon: "BEACON-1",
          beacon_id: BEACON_ID,
          canonical_text_sha256: BEACON_SHA256,
          origin: ORIGIN,
        });

      default:
        return notFound(path);
    }
  },
};
