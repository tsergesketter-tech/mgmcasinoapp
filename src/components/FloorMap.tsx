import type { Player } from "../lib/players";
import {
  ZONES,
  WAYPOINTS,
  getWaypoint,
  zonesCsv,
  waypointsCsv,
  downloadCsv,
} from "../lib/floor";

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

export default function FloorMap({ players, activeId, onSelect }: Props) {
  const hosts = Array.from(new Set(players.map((p) => p.hostName)));

  // De-duplicate waypoint connections into unique edges for drawing.
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  for (const w of WAYPOINTS) {
    for (const to of w.connectsTo) {
      const key = [w.waypointId, to].sort().join("~");
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([w.waypointId, to]);
      }
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">
        <h2>Live Floor</h2>
        <span className="tag">Waypoint Graph</span>
      </div>

      <div className="floor">
        {/* Zone regions */}
        {ZONES.map((z) => (
          <div
            key={z.zoneId}
            className={`zone-region ${z.category.toLowerCase()}`}
            style={{
              left: `${z.x}%`,
              top: `${z.y}%`,
              width: `${z.width}%`,
              height: `${z.height}%`,
            }}
          >
            <span className="zone-region-label">{z.name}</span>
          </div>
        ))}

        {/* Waypoint connection lines */}
        <svg className="floor-edges" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map(([a, b]) => {
            const wa = getWaypoint(a)!;
            const wb = getWaypoint(b)!;
            return (
              <line
                key={`${a}~${b}`}
                x1={wa.x}
                y1={wa.y}
                x2={wb.x}
                y2={wb.y}
              />
            );
          })}
        </svg>

        {/* Waypoint nodes */}
        {WAYPOINTS.map((w) => (
          <span
            key={w.waypointId}
            className="waypoint"
            style={{ left: `${w.x}%`, top: `${w.y}%` }}
            title={`${w.name} (${w.waypointId})`}
          />
        ))}

        {/* Player blips */}
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
          Players move along waypoints · positions stream live
        </div>
      </div>

      {/* Export the floor records for Salesforce / Databricks loads */}
      <div className="export-row">
        <span className="export-label">Export floor records</span>
        <button
          className="export-btn"
          onClick={() => downloadCsv("mgm_floor_zones.csv", zonesCsv())}
        >
          Zones.csv
        </button>
        <button
          className="export-btn"
          onClick={() => downloadCsv("mgm_floor_waypoints.csv", waypointsCsv())}
        >
          Waypoints.csv
        </button>
      </div>
    </div>
  );
}
