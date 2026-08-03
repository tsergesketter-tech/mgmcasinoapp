// ---------------------------------------------------------------------------
// Event layer — the seam between the casino-floor UI and Salesforce Data 360.
//
// Phase 1 (now): events are emitted onto an in-app bus and rendered in the
// live Orchestration Feed. `emitEvent` is the single choke point.
// Phase 2 (later): swap the body of `dispatchToD360` to POST to the Data 360
// Ingestion API using an Auth Server-to-Server (S2S) access token. Nothing
// else in the app needs to change.
// ---------------------------------------------------------------------------

export type CasinoEventType =
  | "BIG_WIN"
  | "BIG_LOSS"
  | "PLAYER_POSITION"
  | "SESSION_START"
  | "SESSION_END"
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
  // When wired for real: instance base URL + a getter for a fresh S2S token.
  ingestUrl?: string;
  getAccessToken?: () => Promise<string>;
  connectorName?: string; // Data 360 ingestion connector / object name
  live: boolean; // false = Phase 1 simulation, true = real S2S POST
}

let config: D360Config = { live: false };

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

  // Phase 2: real Auth S2S POST to the Data 360 Ingestion API.
  // POST {ingestUrl}/api/v1/ingest/sources/{connector}/{object}
  //   Authorization: Bearer <s2s-access-token>
  //   Body: { data: [ <mapped event> ] }
  try {
    if (!config.ingestUrl || !config.getAccessToken) {
      throw new Error("D360 live mode not fully configured");
    }
    const token = await config.getAccessToken();
    const res = await fetch(
      `${config.ingestUrl}/api/v1/ingest/sources/${config.connectorName ?? "MGM_Floor"}/CasinoEvent`,
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
// orchestrations key off these.
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

type Listener = (event: CasinoEvent, result: DispatchResult) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/**
 * The single choke point. Every meaningful floor moment flows through here,
 * gets dispatched to D360 (simulated or live), and is broadcast to the UI.
 */
export async function emitEvent(
  partial: Omit<CasinoEvent, "id" | "ts">
): Promise<{ event: CasinoEvent; result: DispatchResult }> {
  const event: CasinoEvent = {
    ...partial,
    id: nextId(partial.type),
    ts: new Date().toISOString(),
  };
  const result = await dispatchToD360(event);
  listeners.forEach((fn) => fn(event, result));
  return { event, result };
}
