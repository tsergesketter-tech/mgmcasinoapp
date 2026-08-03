import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./styles/app.css";
import SlotMachine from "./components/SlotMachine";
import Blackjack from "./components/Blackjack";
import OrchestrationFeed, { type FeedItem } from "./components/OrchestrationFeed";
import FloorMap from "./components/FloorMap";
import { PLAYERS, TIER_META, movePlayer, type Player } from "./lib/players";
import { subscribe, subscribeResult, emitEvent, getD360Config } from "./lib/events";

type Mode = "slots" | "blackjack";

export default function App() {
  const [mode, setMode] = useState<Mode>("slots");
  const [activeId, setActiveId] = useState(PLAYERS[0].id);
  const [players, setPlayers] = useState<Player[]>(PLAYERS);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [coins, setCoins] = useState<number[]>([]);
  const coinSeq = useRef(0);

  const activePlayer = useMemo(
    () => players.find((p) => p.id === activeId) ?? players[0],
    [players, activeId]
  );

  // Subscribe to emitted events (render immediately) and to their D360 dispatch
  // results (update the same feed row's status when the round-trip resolves).
  useEffect(() => {
    const off1 = subscribe((event, pending) => {
      setFeed((f) => [{ event, result: pending }, ...f].slice(0, 40));
    });
    const off2 = subscribeResult((id, result) => {
      setFeed((f) =>
        f.map((item) => (item.event.id === id ? { ...item, result } : item))
      );
    });
    return () => {
      off1();
      off2();
    };
  }, []);

  // Mirror mode + players in refs so the position interval can read current
  // values without re-subscribing (and resetting its timer) on every change.
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;

  // Simulate live player positioning: periodically drift a random player and
  // emit a PLAYER_POSITION event so hosts can track movement in real time.
  // The move is computed OUTSIDE setState (updaters must be pure — StrictMode
  // double-invokes them, which would otherwise emit duplicate events).
  useEffect(() => {
    const id = setInterval(() => {
      const current = playersRef.current;
      const i = Math.floor(Math.random() * current.length);
      const moved = { ...current[i], ...movePlayer(current[i]) };
      setPlayers((prev) => prev.map((p) => (p.id === moved.id ? moved : p)));
      emitEvent({
        type: "PLAYER_POSITION",
        player: { id: moved.id, name: moved.name, tier: moved.tier },
        game: modeRef.current === "slots" ? "SLOTS" : "BLACKJACK",
        location: moved.location,
        severity: "info",
        message: `${moved.name} is now near ${moved.location.zone}.`,
      });
    }, 7000);
    return () => clearInterval(id);
  }, []);

  const fireCoins = () => {
    const batch = Array.from({ length: 16 }, () => coinSeq.current++);
    setCoins((c) => [...c, ...batch]);
    setTimeout(() => {
      setCoins((c) => c.filter((n) => !batch.includes(n)));
    }, 1700);
  };

  const live = getD360Config().live;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/mgm-logo.png" alt="MGM Resorts International" />
          <span className="sep" />
          <span className="kicker">
            Host&nbsp;·&nbsp;Player
            <small>Real-Time Floor Orchestration</small>
          </span>
        </div>
        <div className={`status-pill ${live ? "live" : ""}`}>
          <span className="dot" />
          {live ? "Data 360 — Live" : "Data 360 — Simulation"}
        </div>
      </header>

      <div className="shell">
        <section className="hero">
          <div className="eyebrow">MGM Grand · Las Vegas</div>
          <h1>
            The Floor, <span className="foil-text">In Real Time</span>
          </h1>
          <p>
            Every jackpot, swing, and step across the floor streams to
            Salesforce Data 360 — so hosts reach their players at the moment
            that matters.
          </p>

          <div className="mode-switch" role="tablist" aria-label="Game mode">
            <button
              role="tab"
              aria-selected={mode === "slots"}
              className={mode === "slots" ? "active" : ""}
              onClick={() => setMode("slots")}
            >
              {mode === "slots" && (
                <motion.span layoutId="glider" className="glider" />
              )}
              <span>Slots</span>
            </button>
            <button
              role="tab"
              aria-selected={mode === "blackjack"}
              className={mode === "blackjack" ? "active" : ""}
              onClick={() => setMode("blackjack")}
            >
              {mode === "blackjack" && (
                <motion.span layoutId="glider" className="glider" />
              )}
              <span>Blackjack</span>
            </button>
          </div>
        </section>

        <div className="stage">
          <div className="panel">
            <div className="panel-title">
              <h2>{mode === "slots" ? "High Limit Slots" : "Blackjack"}</h2>
              <span className="tag">Playing as</span>
            </div>

            <PlayerStrip
              players={players}
              activeId={activeId}
              onSelect={setActiveId}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3 }}
              >
                {mode === "slots" ? (
                  <SlotMachine player={activePlayer} onCoins={fireCoins} />
                ) : (
                  <Blackjack player={activePlayer} onCoins={fireCoins} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="side-col">
            <OrchestrationFeed items={feed} />
            <FloorMap
              players={players}
              activeId={activeId}
              onSelect={setActiveId}
            />
          </div>
        </div>
      </div>

      <footer className="foot">
        MGM Resorts International · Host&nbsp;:&nbsp;Player · Data 360
        Orchestration Demo
      </footer>

      {coins.length > 0 && (
        <div className="burst" aria-hidden>
          {coins.map((n) => (
            <span
              key={n}
              className="coin"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 0.4}s`,
              }}
            >
              {Math.random() > 0.5 ? "🪙" : "💰"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerStrip({
  players,
  activeId,
  onSelect,
}: {
  players: Player[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="player-strip">
      {players.map((p) => {
        const initials = p.name
          .split(" ")
          .map((n) => n[0])
          .join("");
        return (
          <button
            key={p.id}
            className={`player-chip ${p.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(p.id)}
            aria-pressed={p.id === activeId}
          >
            <span
              className="avatar"
              style={{ boxShadow: `0 0 0 1px ${TIER_META[p.tier].ring}` }}
            >
              {initials}
            </span>
            <span className="who">
              <b>{p.name}</b>
              <small>{p.tier}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
