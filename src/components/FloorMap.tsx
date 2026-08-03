import type { Player } from "../lib/players";

interface Props {
  players: Player[];
  activeId: string;
  onSelect: (id: string) => void;
}

// Host → color, so blips read as "whose player" at a glance.
const HOST_COLORS: Record<string, string> = {
  "Marcus Webb": "#d8a94a",
  "Elena Ruiz": "#7fb5a0",
};

const ZONES = [
  { name: "High Limit Slots", x: 26, y: 34 },
  { name: "Main Slots Floor", x: 46, y: 74 },
  { name: "Blackjack Pit 3", x: 68, y: 55 },
  { name: "Baccarat Salon", x: 80, y: 22 },
];

export default function FloorMap({ players, activeId, onSelect }: Props) {
  const hosts = Array.from(new Set(players.map((p) => p.hostName)));

  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Live Floor</h2>
        <span className="tag">Real-Time Positioning</span>
      </div>

      <div className="floor">
        {ZONES.map((z) => (
          <div
            key={z.name}
            className="zone-label"
            style={{ left: `${z.x}%`, top: `${z.y}%` }}
          >
            {z.name}
          </div>
        ))}

        {players.map((p) => {
          const color = HOST_COLORS[p.hostName] ?? "#d8a94a";
          const active = p.id === activeId;
          return (
            <button
              key={p.id}
              className="blip"
              onClick={() => onSelect(p.id)}
              aria-label={`${p.name}, ${p.tier}, hosted by ${p.hostName}, at ${p.location.zone}`}
              style={{
                left: `${p.location.x}%`,
                top: `${p.location.y}%`,
                color,
                background: color,
                boxShadow: active
                  ? `0 0 0 3px rgba(216,169,74,0.5), 0 0 16px ${color}`
                  : `0 0 10px ${color}`,
              }}
            >
              <span className="tip">
                <b>{p.name}</b> · {p.tier}
                <br />
                {p.location.zone} — {p.hostName}
              </span>
            </button>
          );
        })}
      </div>

      <div className="host-legend">
        {hosts.map((h) => (
          <div className="k" key={h}>
            <span
              className="sw"
              style={{ background: HOST_COLORS[h] ?? "#d8a94a" }}
            />
            {h}
          </div>
        ))}
        <div className="k" style={{ color: "var(--text-faint)" }}>
          Tap a player to select · positions stream live
        </div>
      </div>
    </div>
  );
}
