// Minimal static file server for the built Vite app (dist/), plus a
// server-side Data 360 ingest proxy (/api/ingest). Uses only Node built-ins
// so it survives Heroku's devDependency pruning (NODE_ENV=production removes
// anything not in "dependencies").
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

// ---- Data 360 S2S config (all secrets stay server-side) --------------------
// Set these as Heroku config vars to enable live ingestion. If any are
// missing, /api/ingest replies 503 and the browser silently falls back to
// simulated mode — the demo still runs.
const SF_LOGIN_URL = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;
const D360_SOURCE = process.env.D360_SOURCE || "mgmFloorEvents";
const D360_LIVE = Boolean(SF_CLIENT_ID && SF_CLIENT_SECRET);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".csv": "text/csv; charset=utf-8",
};

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    // Hashed asset filenames are safe to cache long-term; index.html isn't.
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  res.end(body);
}

// ---- Data Cloud token pipeline ---------------------------------------------
// Two-hop auth, both cached: (1) core OAuth client-credentials token, then
// (2) token exchange for a Data Cloud "offcore" token + DC instance URL.
// An in-flight promise dedupes concurrent refreshes (mirrors Palonia's server).
let dcCache = null; // { token, instanceUrl, exp }
let dcInflight = null;

async function fetchCoreToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });
  const res = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`core token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json(); // { access_token, instance_url, ... }
}

async function exchangeForDataCloudToken(core) {
  // Data Cloud token exchange (RFC 8693-style) at the core instance.
  const body = new URLSearchParams({
    grant_type: "urn:salesforce:grant-type:external:cdp",
    subject_token: core.access_token,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  const res = await fetch(`${core.instance_url}/services/a360/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${core.access_token}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`a360 exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json(); // { access_token, instance_url, expires_in, ... }
}

async function getDataCloudToken() {
  const now = Math.floor(Date.now() / 1000);
  if (dcCache && dcCache.exp - now > 60) return dcCache;
  if (dcInflight) return dcInflight;

  dcInflight = (async () => {
    try {
      const core = await fetchCoreToken();
      const dc = await exchangeForDataCloudToken(core);
      // DC instance_url comes back bare (no scheme) on some editions.
      const raw = dc.instance_url || dc.instanceUrl || "";
      const instanceUrl = raw.startsWith("http") ? raw : `https://${raw}`;
      const ttl = typeof dc.expires_in === "number" ? dc.expires_in : 3600;
      dcCache = {
        token: dc.access_token,
        instanceUrl,
        exp: Math.floor(Date.now() / 1000) + Math.max(60, ttl - 60),
      };
      return dcCache;
    } finally {
      dcInflight = null;
    }
  })();

  return dcInflight;
}

function readJsonBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// POST /api/ingest — the browser posts { data: [ record, ... ] }; we attach a
// fresh Data Cloud token and forward to the Ingestion API. Retries once on 401.
async function handleIngest(req, res) {
  if (!D360_LIVE) {
    return json(res, 503, {
      ok: false,
      detail: "D360 live mode not configured (set SF_CLIENT_ID / SF_CLIENT_SECRET).",
    });
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, detail: `bad body: ${e.message}` });
  }
  if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
    return json(res, 400, { ok: false, detail: "expected { data: [ ... ] }" });
  }

  const ingest = async (dc) =>
    fetch(`${dc.instanceUrl}/api/v1/ingest/sources/${D360_SOURCE}/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dc.token}`,
      },
      body: JSON.stringify({ data: payload.data }),
    });

  try {
    let dc = await getDataCloudToken();
    let upstream = await ingest(dc);
    if (upstream.status === 401) {
      dcCache = null; // force refresh
      dc = await getDataCloudToken();
      upstream = await ingest(dc);
    }
    const text = await upstream.text().catch(() => "");
    return json(res, upstream.ok ? 202 : 502, {
      ok: upstream.ok,
      status: upstream.status,
      detail: upstream.ok
        ? `Ingested ${payload.data.length} record(s) → ${D360_SOURCE}`
        : `D360 rejected (${upstream.status}): ${text.slice(0, 300)}`,
    });
  } catch (err) {
    return json(res, 502, { ok: false, detail: `D360 error: ${err.message}` });
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

    // API routes first — before the static/SPA fallback.
    if (urlPath === "/api/ingest") {
      if (req.method !== "POST") {
        return json(res, 405, { ok: false, detail: "POST only" });
      }
      return await handleIngest(req, res);
    }
    if (urlPath === "/api/health") {
      return json(res, 200, { ok: true, d360Live: D360_LIVE, source: D360_SOURCE });
    }

    // Static files — prevent path traversal outside dist/.
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(DIST, safe);

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }

    if (info?.isFile()) {
      await sendFile(res, filePath);
    } else {
      // SPA fallback — hand any unknown route to index.html.
      await sendFile(res, join(DIST, "index.html"));
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
    console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(
    `MGM Host:Player serving dist/ on port ${PORT} (D360 live: ${D360_LIVE})`
  );
});
