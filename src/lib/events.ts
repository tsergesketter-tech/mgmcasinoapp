// ---------------------------------------------------------------------------
// Event layer — the seam between the casino-floor UI and Salesforce Data 360.
//
// Phase 1 (now): events broadcast to the live Orchestration Feed immediately,
// then dispatch to D360 in the background; the feed updates each event's status
// (Pending → Ingested/Failed) when the dispatch resolves.
// Phase 2 (later): flip `configureD360({ live: true, ... })`. The dispatch body
// already targets the real Data Cloud Ingestion API and performs the S2S token
// exchange. Nothing in the UI changes — feed rendering is already async-safe.
//
// Real integration (confirmed via data360 research), Phase 2 runtime flow:
//   1. Core OAuth token   — client-credentials / JWT bearer at /services/oauth2/token
//   2. Token exchange     — POST {instanceUrl}/services/a360/token  (Bearer core-token)
//                           → returns a Data Cloud "offcore" token + DC instance URL
//   3. Ingest             — POST {dcInstanceUrl}/api/v1/ingest/sources/{source}/data
//                           Authorization: Bearer <offcore-token>
//                           Body: { data: [ <mapped record> ] }
//   4. A Data Action on the mapped DMO fires a webhook / platform event →
//      Flow orchestration → host notification.
// ---------------------------------------------------------------------------

export type CasinoEventType =
  | "BIG_WIN"
  | "BIG_LOSS"
  | "PLAYER_POSITION"
  | "SESSION_START"
  | "JACKPOT";

export interface CasinoEvent {
  id: string;
  type: CasinoEventType;
  ts: string; // ISO timestamp
  player: {
    id: string;
    name: string;
    tier: PlayerTier;
  };
  game: "SLOTS" | "BLACKJACK";
  // Monetary delta for the play, in USD. Positive = win, negative = loss.
  amount?: number;
  // Where the player is on the floor, when known.
  location?: FloorLocation;
  // Human-readable summary for the feed + orchestration payloads.
  message: string;
  // Severity drives host notification priority in orchestrations.
  severity: "info" | "notable" | "critical";
}

export type PlayerTier = "Pearl" | "Gold" | "Platinum" | "NOIR";

export interface FloorLocation {
  zone: string; // e.g. "High Limit Slots", "Blackjack Pit 3"
  x: number; // 0..100 normalized floor coordinates
  y: number; // 0..100
}

// ---- The D360 dispatch seam -------------------------------------------------

export interface D360Config {
  // Same-origin server endpoint that proxies to the Data Cloud Ingestion API.
  // The server (server.js) holds the OAuth secret + runs the token exchange;
  // the browser never sees a Salesforce token.
  ingestEndpoint?: string;
  live: boolean; // false = Phase 1 simulation, true = real POST via the proxy
}

let config: D360Config = { live: false, ingestEndpoint: "/api/ingest" };

// Every floor event ingested into Data 360 is stamped with Danny Ocean's
// identity — his Salesforce Contact Id (playerId → partyId__c) — so all floor
// activity lands in his Contact context regardless of which on-screen player
// triggered it. The in-app feed still shows the real actor; only the ingested
// record is normalized to Danny. Keep in sync with PLAYERS[0] in players.ts.
const DANNY = {
  id: "003gK00000vqazSQAQ",
  name: "Danny Ocean",
  tier: "NOIR" as PlayerTier,
};

// Stable per-load identifiers for the mandatory Engagement deviceId/sessionId.
// One "device" (this browser/kiosk) and one session per app load.
const DEVICE_ID =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("mgm.deviceId") ||
      (() => {
        const d = `dev-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem("mgm.deviceId", d);
        return d;
      })())) ||
  "dev-server";
const SESSION_ID = `ses-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

export function configureD360(next: Partial<D360Config>) {
  config = { ...config, ...next };
}

export function getD360Config(): D360Config {
  return config;
}

/**
 * Ask the server whether Data 360 ingestion is configured; if so, flip to live
 * mode so events flow through the /api/ingest proxy. Safe to call on startup —
 * on any error it leaves the app in simulation mode. Returns the live flag.
 */
export async function initD360FromServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return false;
    const h = (await res.json()) as { d360Live?: boolean };
    if (h.d360Live) configureD360({ live: true });
    return Boolean(h.d360Live);
  } catch {
    return false;
  }
}

export interface DispatchResult {
  ok: boolean;
  mode: "simulated" | "live";
  detail: string;
  pending?: boolean;
}

async function dispatchToD360(event: CasinoEvent): Promise<DispatchResult> {
  if (!config.live) {
    // Phase 1: pretend-latency so the feed feels real.
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 240));
    return {
      ok: true,
      mode: "simulated",
      detail: `Simulated ingest → Data 360 (${event.type})`,
    };
  }

  // Phase 2: POST to our same-origin proxy, which attaches a Data Cloud token
  // server-side and forwards to the Ingestion API. No secret in the browser.
  try {
    const res = await fetch(config.ingestEndpoint ?? "/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [toD360Record(event)] }),
    });
    const info = (await res.json().catch(() => ({}))) as { detail?: string };
    return {
      ok: res.ok,
      mode: "live",
      detail:
        info.detail ??
        (res.ok
          ? `Ingested → Data 360 (${res.status})`
          : `D360 rejected (${res.status})`),
    };
  } catch (err) {
    return {
      ok: false,
      mode: "live",
      detail: `D360 error: ${(err as Error).message}`,
    };
  }
}

// Flatten our event into a Data 360 ingestion record. Keep field names stable —
// the DMO mapping and Data Action conditions key off these.
// Field names must match the Ingestion API source schema developerNames in
// data/d360/mgm_floor_events_s2s_schema.json exactly. Engagement-category
// schemas REQUIRE these six exact names: eventId, eventType, dateTime,
// category, deviceId, sessionId. `dateTime` (not `timestamp`) — Timestamp is
// a reserved DLO field.
//
// IMPORTANT: `eventType` and `category` are Salesforce PLATFORM-ROUTING fields,
// NOT business fields. The S2S endpoint uses them to route the event to a schema
// definition: `eventType` MUST equal the schema event's developerName
// ("mgmFloorEvents") and `category` MUST be the platform category ("Engagement").
// Sending business values (JACKPOT / SLOTS) → HTTP 204 but the event is silently
// dropped (never routed, never lands in the DLO). The real casino event type
// (JACKPOT / BIG_WIN) rides in `severity` + `message`; to promote it to its own
// column, add a `casinoEventType` field to the S2S schema first (undeclared
// fields are rejected), then map e.type to it here.
function toD360Record(e: CasinoEvent) {
  return {
    // Mandatory Engagement fields — eventType/category are routing values
    eventId: e.id,
    eventType: "mgmFloorEvents", // schema developerName (routing, not business)
    dateTime: e.ts,
    category: "Engagement", // platform category (routing, not business)
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    // Domain fields — every ingested floor event is attributed to Danny Ocean
    // so it ties to his Contact (playerId == Contact Id == partyId__c).
    playerId: DANNY.id,
    playerName: DANNY.name,
    playerTier: DANNY.tier,
    game: e.game,
    amount: e.amount ?? 0,
    zone: e.location?.zone ?? "",
    floorX: e.location?.x ?? null,
    floorY: e.location?.y ?? null,
    severity: e.severity,
    message: e.message,
  };
}

// ---- Jackpot → host action (Task + Mailjet email) --------------------------
// On a JACKPOT, ask the server to create a follow-up Task for the on-duty host
// (Daio) and fire the MGM Mailjet "Big Win" offer email. Fire-and-forget: the
// server holds the Salesforce token and does the REST calls; if it isn't
// configured (503) or errors, the demo continues uninterrupted. Guarded so we
// only fire once per event id.
const firedJackpots = new Set<string>();

async function triggerJackpotActions(event: CasinoEvent): Promise<void> {
  if (event.type !== "JACKPOT") return;
  if (firedJackpots.has(event.id)) return;
  firedJackpots.add(event.id);
  try {
    await fetch("/api/jackpot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: event.id,
        amount: event.amount ?? 0,
        message: event.message,
        playerId: DANNY.id,
      }),
    });
  } catch {
    // Best-effort — never let a host-action failure break the floor UI.
  }
}

// ---- In-app event bus -------------------------------------------------------
// Two channels so the feed renders instantly and the dispatch status settles
// asynchronously — which is what makes the Phase 2 swap non-blocking.

type EventListener = (event: CasinoEvent, pending: DispatchResult) => void;
type ResultListener = (id: string, result: DispatchResult) => void;

const eventListeners = new Set<EventListener>();
const resultListeners = new Set<ResultListener>();

export function subscribe(fn: EventListener): () => void {
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

export function subscribeResult(fn: ResultListener): () => void {
  resultListeners.add(fn);
  return () => {
    resultListeners.delete(fn);
  };
}

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/**
 * The single choke point. Every meaningful floor moment flows through here.
 * The event is broadcast to the feed immediately (with a Pending status), then
 * dispatched to D360; the final status is broadcast when the dispatch resolves.
 */
export async function emitEvent(
  partial: Omit<CasinoEvent, "id" | "ts">
): Promise<{ event: CasinoEvent; result: DispatchResult }> {
  // Danny-only floor activity: every emitted event is attributed to Danny Ocean
  // regardless of which on-screen player triggered it. This is the single choke
  // point, so normalizing here guarantees no foreign-player event can reach the
  // feed OR the D360 ingest — the message text is rewritten to Danny too.
  const normalizedPlayer = { id: DANNY.id, name: DANNY.name, tier: DANNY.tier };
  const message =
    partial.player && partial.player.name !== DANNY.name
      ? partial.message.split(partial.player.name).join(DANNY.name)
      : partial.message;
  const event: CasinoEvent = {
    ...partial,
    player: normalizedPlayer,
    message,
    id: nextId(partial.type),
    ts: new Date().toISOString(),
  };
  const pending: DispatchResult = {
    ok: true,
    mode: config.live ? "live" : "simulated",
    detail: "Dispatching…",
    pending: true,
  };
  eventListeners.forEach((fn) => fn(event, pending));

  const result = await dispatchToD360(event);
  resultListeners.forEach((fn) => fn(event.id, result));

  // A jackpot kicks off the host workflow (Task for Daio + Mailjet offer email)
  // in the background — independent of D360 ingestion mode/result.
  void triggerJackpotActions(event);

  return { event, result };
}
