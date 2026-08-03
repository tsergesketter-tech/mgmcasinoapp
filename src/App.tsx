import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./styles/app.css";
import SlotMachine from "./components/SlotMachine";
import Blackjack from "./components/Blackjack";
import OrchestrationFeed, { type FeedItem } from "./components/OrchestrationFeed";
import FloorMap from "./components/FloorMap";
import { PLAYERS, TIER_META, driftLocation, type Player } from "./lib/players";
import { subscribe, emitEvent, getD360Config } from "./lib/events";

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

  // Subscribe to every emitted event → render in the feed.
  useEffect(() => {
    return subscribe((event, result) => {
      setFeed((f) => [{ event, result }, ...f].slice(0, 40));
    });
  }, []);

  // Simulate live player positioning: periodically drift a random player and
  // emit a PLAYER_POSITION event so hosts can track movement in real time.
  useEffect(() => {
    const id = setInterval(() => {
      setPlayers((prev) => {
        const i = Math.floor(Math.random() * prev.length);
        const moved = { ...prev[i], location: driftLocation(prev[i].location) };
        const next = [...prev];
        next[i] = moved;
        emitEvent({
          type: "PLAYER_POSITION",
          player: { id: moved.id, name: moved.name, tier: moved.tier },
          game: mode === "slots" ? "SLOTS" : "BLACKJACK",
          location: moved.location,
          severity: "info",
          message: `${moved.name} is now near ${moved.location.zone}.`,
        });
        return next;
      });
    }, 7000);
    return () => clearInterval(id);
  }, [mode]);

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
