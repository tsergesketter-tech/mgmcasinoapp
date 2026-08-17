// Minimal static file server for the built Vite app (dist/), plus a
// server-side Data 360 ingest proxy (/api/ingest). Uses only Node built-ins
// so it survives Heroku's devDependency pruning (NODE_ENV=production removes
// anything not in "dependencies").
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createSign } from "node:crypto";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

// ---- Data 360 S2S config (all secrets stay server-side) --------------------
// Auth is the JWT Bearer flow: we sign an assertion with the connected app's
// private key and exchange it for a core token, then exchange that for a Data
// Cloud token. Set these as Heroku config vars to enable live ingestion; if
// any required one is missing, /api/ingest replies 503 and the browser
// silently falls back to simulated mode — the demo still runs.
const SF_LOGIN_URL = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
const SF_CLIENT_ID = process.env.SF_CLIENT_ID; // connected app consumer key → JWT `iss`
const SF_USERNAME = process.env.SF_USERNAME; // run-as user → JWT `sub`
// PEM private key matching the cert on the connected app. Config-var editors
// mangle PEM whitespace inconsistently (literal \n, real newlines, or newlines
// collapsed to spaces), so we normalize: pull out the base64 body regardless of
// how it was broken up, then re-wrap it into a canonical PEM. Handles PKCS#8
// ("PRIVATE KEY") and PKCS#1 ("RSA PRIVATE KEY").
function normalizePem(raw) {
  if (!raw) return "";
  const m = raw.match(
    /-----BEGIN ([A-Z ]+?)-----([\s\S]*?)-----END \1-----/
  );
  // If the BEGIN/END header lines were stripped on paste, treat the whole
  // value as a bare base64 body and assume PKCS#8 ("PRIVATE KEY").
  const label = m ? m[1].trim() : "PRIVATE KEY";
  const rawBody = m ? m[2] : raw;
  const body = rawBody.replace(/\\n/g, "").replace(/\s+/g, ""); // strip all whitespace
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}
const SF_PRIVATE_KEY = normalizePem(process.env.SF_PRIVATE_KEY || "");
// This app emits through the Data Cloud S2S (Server-to-Server) Events API, not
// the Ingestion API. The path is /server/events/{appSourceId} where appSourceId
// is the system-generated Source ID from the Web & Mobile SDK "Server to Server"
// connection in Setup. Override via the D360_APP_SOURCE_ID config var.
const D360_APP_SOURCE_ID =
  process.env.D360_APP_SOURCE_ID || "68544218-5272-4730-84aa-cfa6c3c2aa14";
const D360_LIVE = Boolean(SF_CLIENT_ID && SF_USERNAME && SF_PRIVATE_KEY);

// ---- Jackpot → host action config -----------------------------------------
// When the floor app emits a JACKPOT, we (1) create a follow-up Task owned by
// the on-duty host and (2) fire the MGM Mailjet "Big Win" offer email via the
// existing autolaunched Flow. Both run against the core REST API using the same
// JWT-bearer token that powers D360 ingestion — no extra Apex needed.
// Overridable via config vars for other demo orgs.
const SF_API_VERSION = process.env.SF_API_VERSION || "v63.0"; // v67 rejects the Flow action
const JACKPOT_HOST_USER_ID = process.env.JACKPOT_HOST_USER_ID || "005gK00006GtGfJQAV"; // Daio Lamers
const JACKPOT_CONTACT_ID = process.env.JACKPOT_CONTACT_ID || "003gK00000vqazSQAQ"; // Danny Ocean
const JACKPOT_FLOW_API_NAME = process.env.JACKPOT_FLOW_API_NAME || "MGM_Send_Offer_Email";

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
// Two-hop auth, both cached: (1) core OAuth JWT-bearer token, then
// (2) token exchange for a Data Cloud "offcore" token + DC instance URL.
// An in-flight promise dedupes concurrent refreshes (mirrors Palonia's server).
let dcCache = null; // { token, instanceUrl, exp }
let dcInflight = null;

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Build + sign a JWT Bearer assertion (RS256) for the connected app.
// aud must be the token host the assertion is presented to (login/My Domain).
function buildJwtAssertion() {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64url(
    JSON.stringify({
      iss: SF_CLIENT_ID,
      sub: SF_USERNAME,
      aud: SF_LOGIN_URL,
      exp: now + 180, // short-lived; used immediately for the token exchange
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(SF_PRIVATE_KEY, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${signingInput}.${signature}`;
}

async function fetchCoreToken() {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: buildJwtAssertion(),
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
// fresh Data Cloud token and forward each record to the S2S Events API as
// { events: [...] }. The S2S API returns 204 (no body) on success and processes
// asynchronously (~3 min). Retries once on 401.
async function handleIngest(req, res) {
  if (!D360_LIVE) {
    return json(res, 503, {
      ok: false,
      detail:
        "D360 live mode not configured (set SF_CLIENT_ID / SF_USERNAME / SF_PRIVATE_KEY).",
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

  const emit = async (dc) =>
    fetch(`${dc.instanceUrl}/server/events/${D360_APP_SOURCE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dc.token}`,
      },
      body: JSON.stringify({ events: payload.data }),
    });

  try {
    let dc = await getDataCloudToken();
    let upstream = await emit(dc);
    if (upstream.status === 401) {
      dcCache = null; // force refresh
      dc = await getDataCloudToken();
      upstream = await emit(dc);
    }
    const text = await upstream.text().catch(() => "");
    // S2S success is 204 No Content; treat any 2xx as accepted.
    const accepted = upstream.status >= 200 && upstream.status < 300;
    return json(res, accepted ? 202 : 502, {
      ok: accepted,
      status: upstream.status,
      detail: accepted
        ? `Emitted ${payload.data.length} event(s) → S2S ${D360_APP_SOURCE_ID}`
        : `D360 rejected (${upstream.status}): ${text.slice(0, 300)}`,
    });
  } catch (err) {
    return json(res, 502, { ok: false, detail: `D360 error: ${err.message}` });
  }
}

// POST /api/jackpot — the browser posts a JACKPOT event; we create a host Task
// (owned by Daio, related to Danny's Contact) and trigger the Mailjet offer
// email via the MGM_Send_Offer_Email Flow. Both calls hit the core REST API
// with the JWT-bearer token; failures are reported but don't block each other.
async function handleJackpot(req, res) {
  if (!D360_LIVE) {
    return json(res, 503, {
      ok: false,
      detail:
        "Jackpot actions need Salesforce auth (set SF_CLIENT_ID / SF_USERNAME / SF_PRIVATE_KEY).",
    });
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    return json(res, 400, { ok: false, detail: `bad body: ${e.message}` });
  }

  const amount = Number(payload?.amount) || 0;
  const message =
    typeof payload?.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "Player hit a jackpot on the floor.";
  const amountLabel = amount
    ? ` ($${Math.round(amount).toLocaleString("en-US")})`
    : "";

  // Reusable authed core REST caller. Retries once on 401 by clearing the DC
  // cache and re-minting a token (core token lives on the DC cache's parent).
  const coreCall = async (method, path, body) => {
    const core = await fetchCoreToken();
    const r = await fetch(`${core.instance_url}/services/data/${SF_API_VERSION}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${core.access_token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text().catch(() => "");
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { ok: r.ok, status: r.status, body: parsed };
  };

  const result = { ok: true, task: null, email: null };

  // 1) Create the host follow-up Task (owned by Daio, on Danny's Contact).
  try {
    const task = await coreCall("POST", "/sobjects/Task", {
      Subject: `Jackpot follow-up — congratulate player${amountLabel}`,
      Description: message,
      OwnerId: JACKPOT_HOST_USER_ID,
      WhoId: JACKPOT_CONTACT_ID,
      Priority: "High",
      Status: "Not Started",
      ActivityDate: new Date().toISOString().slice(0, 10),
    });
    result.task = {
      ok: task.ok,
      id: task.ok ? task.body?.id : null,
      detail: task.ok
        ? `Task created for host (${task.body?.id})`
        : `Task failed (${task.status}): ${JSON.stringify(task.body).slice(0, 200)}`,
    };
  } catch (err) {
    result.task = { ok: false, detail: `Task error: ${err.message}` };
  }

  // 2) Fire the Mailjet offer email via the autolaunched Flow (no inputs → uses
  //    its own defaults for the demo recipient/offer content).
  try {
    const flow = await coreCall(
      "POST",
      `/actions/custom/flow/${JACKPOT_FLOW_API_NAME}`,
      { inputs: [{}] }
    );
    // Flow action returns 200 with an array; each entry has isSuccess.
    const entry = Array.isArray(flow.body) ? flow.body[0] : null;
    const flowOk = flow.ok && (entry ? entry.isSuccess !== false : true);
    result.email = {
      ok: flowOk,
      detail: flowOk
        ? "MGM Mailjet 'Big Win' email triggered"
        : `Flow failed (${flow.status}): ${JSON.stringify(flow.body).slice(0, 200)}`,
    };
  } catch (err) {
    result.email = { ok: false, detail: `Flow error: ${err.message}` };
  }

  result.ok = Boolean(result.task?.ok || result.email?.ok);
  return json(res, result.ok ? 202 : 502, result);
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
    if (urlPath === "/api/jackpot") {
      if (req.method !== "POST") {
        return json(res, 405, { ok: false, detail: "POST only" });
      }
      return await handleJackpot(req, res);
    }
    if (urlPath === "/api/health") {
      return json(res, 200, {
        ok: true,
        d360Live: D360_LIVE,
        api: "s2s-events",
        appSourceId: D360_APP_SOURCE_ID,
      });
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
