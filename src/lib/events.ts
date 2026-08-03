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
  // Data Cloud instance URL (offcore) once the token exchange has run.
  ingestUrl?: string;
  // Returns a valid Data Cloud offcore access token (caller handles the
  // core-token → /services/a360/token exchange + caching).
  getAccessToken?: () => Promise<string>;
  sourceApiName?: string; // Ingestion API source connector object name
  live: boolean; // false = Phase 1 simulation, true = real S2S POST
}

let config: D360Config = { live: false, sourceApiName: "MGM_Floor_Events" };

export function configureD360(next: Partial<D360Config>) {
  config = { ...config, ...next };
}

export function getD360Config(): D360Config {
  return config;
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

  // Phase 2: real POST to the Data Cloud Ingestion API with an offcore token.
  try {
    if (!config.ingestUrl || !config.getAccessToken) {
      throw new Error("D360 live mode not fully configured");
    }
    const token = await config.getAccessToken();
    const res = await fetch(
      `${config.ingestUrl}/api/v1/ingest/sources/${config.sourceApiName}/data`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data: [toD360Record(event)] }),
      }
    );
    return {
      ok: res.ok,
      mode: "live",
      detail: res.ok
        ? `Ingested → Data 360 (${res.status})`
        : `D360 rejected (${res.status})`,
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
function toD360Record(e: CasinoEvent) {
  return {
    EventId: e.id,
    EventType: e.type,
    Timestamp: e.ts,
    PlayerId: e.player.id,
    PlayerName: e.player.name,
    PlayerTier: e.player.tier,
    Game: e.game,
    Amount: e.amount ?? 0,
    Zone: e.location?.zone ?? "",
    FloorX: e.location?.x ?? null,
    FloorY: e.location?.y ?? null,
    Severity: e.severity,
    Message: e.message,
  };
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
  const event: CasinoEvent = {
    ...partial,
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
  return { event, result };
}
