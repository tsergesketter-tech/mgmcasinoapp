import { AnimatePresence, motion } from "framer-motion";
import type { CasinoEvent, DispatchResult } from "../lib/events";

export interface FeedItem {
  event: CasinoEvent;
  result: DispatchResult;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const TYPE_LABEL: Record<string, string> = {
  BIG_WIN: "Big Win",
  BIG_LOSS: "Big Loss",
  JACKPOT: "Jackpot",
  PLAYER_POSITION: "Player Position",
  SESSION_START: "Session Start",
  SESSION_END: "Session End",
};

export default function OrchestrationFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Orchestration Feed</h2>
        <span className="tag">Data 360 · S2S</span>
      </div>

      <div className="feed">
        {items.length === 0 && (
          <div className="feed-empty">
            Awaiting floor activity. Spin or deal to emit real-time events to
            Salesforce Data 360.
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map(({ event, result }) => (
            <motion.div
              key={event.id}
              layout
              initial={{ opacity: 0, x: 24, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={`event ${event.severity}`}
            >
              <div className="event-head">
                <span className="event-type">
                  {TYPE_LABEL[event.type] ?? event.type}
                </span>
                <span className="event-time">{fmtTime(event.ts)}</span>
              </div>
              <div className="event-msg">{event.message}</div>
              <div className="event-meta">
                <span>{event.player.tier}</span>
                {event.location && <span>{event.location.zone}</span>}
                {typeof event.amount === "number" && event.amount !== 0 && (
                  <span className={event.amount > 0 ? "amt-pos" : "amt-neg"}>
                    {event.amount > 0 ? "+" : "−"}$
                    {Math.abs(event.amount).toLocaleString()}
                  </span>
                )}
                <span
                  className={
                    result.pending ? "" : result.ok ? "ok" : "amt-neg"
                  }
                >
                  {result.mode === "live" ? "LIVE" : "SIM"} ·{" "}
                  {result.pending
                    ? "Dispatching…"
                    : result.ok
                      ? "Ingested"
                      : "Failed"}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
