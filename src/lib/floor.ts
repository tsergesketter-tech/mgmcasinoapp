// ---------------------------------------------------------------------------
// Casino floor model — zones + waypoints.
//
// This is intentionally SIMPLE and record-shaped. Waypoints are the anchor
// points a player can occupy / move between on the floor. Both zones and
// waypoints carry stable IDs and flat fields so they export cleanly to CSV
// (for Databricks) and map 1:1 to Salesforce records / Data 360 DMOs
// (e.g. via zero-copy). Coordinates are normalized 0..100 on both axes.
// ---------------------------------------------------------------------------

export type ZoneCategory = "SLOTS" | "TABLES" | "AMENITY";

export interface FloorZone {
  zoneId: string;
  name: string;
  category: ZoneCategory;
  // Rectangle in normalized floor space (top-left origin), for drawing regions.
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Waypoint {
  waypointId: string;
  name: string;
  zoneId: string;
  x: number; // 0..100
  y: number; // 0..100
  // Ordered neighbors a player can walk to next. Enables realistic pathing and
  // is exactly the adjacency a graph/orchestration would reason over.
  connectsTo: string[];
}

// ---- Zones ------------------------------------------------------------------
export const ZONES: FloorZone[] = [
  { zoneId: "Z-HLS", name: "High Limit Slots", category: "SLOTS", x: 6, y: 12, width: 34, height: 34 },
  { zoneId: "Z-MSF", name: "Main Slots Floor", category: "SLOTS", x: 30, y: 58, width: 38, height: 34 },
  { zoneId: "Z-BJ3", name: "Blackjack Pit 3", category: "TABLES", x: 58, y: 44, width: 26, height: 24 },
  { zoneId: "Z-BAC", name: "Baccarat Salon", category: "TABLES", x: 68, y: 10, width: 26, height: 24 },
  { zoneId: "Z-BAR", name: "Center Bar", category: "AMENITY", x: 42, y: 34, width: 18, height: 16 },
];

// ---- Waypoints (the simple graph) ------------------------------------------
// Layout sketch (normalized):
//
//   HLS ──── BAR ──── BAC
//    │        │        │
//   MSF ──── PIT3 ─────┘
//
export const WAYPOINTS: Waypoint[] = [
  { waypointId: "W-HLS", name: "High Limit Slots", zoneId: "Z-HLS", x: 22, y: 30, connectsTo: ["W-BAR", "W-MSF"] },
  { waypointId: "W-MSF", name: "Main Slots Floor", zoneId: "Z-MSF", x: 46, y: 74, connectsTo: ["W-HLS", "W-PIT3"] },
  { waypointId: "W-PIT3", name: "Blackjack Pit 3", zoneId: "Z-BJ3", x: 70, y: 55, connectsTo: ["W-MSF", "W-BAR", "W-BAC"] },
  { waypointId: "W-BAC", name: "Baccarat Salon", zoneId: "Z-BAC", x: 80, y: 22, connectsTo: ["W-BAR", "W-PIT3"] },
  { waypointId: "W-BAR", name: "Center Bar", zoneId: "Z-BAR", x: 50, y: 42, connectsTo: ["W-HLS", "W-PIT3", "W-BAC"] },
];

const WP_BY_ID = new Map(WAYPOINTS.map((w) => [w.waypointId, w]));

export function getWaypoint(id: string): Waypoint | undefined {
  return WP_BY_ID.get(id);
}

// Pick a random neighbor to move a player to — realistic floor movement along
// the waypoint graph, rather than teleporting to arbitrary coordinates.
export function nextWaypoint(fromId: string): Waypoint {
  const from = WP_BY_ID.get(fromId);
  if (!from || from.connectsTo.length === 0) return WAYPOINTS[0];
  const id = from.connectsTo[Math.floor(Math.random() * from.connectsTo.length)];
  return WP_BY_ID.get(id) ?? WAYPOINTS[0];
}

// ---- CSV export (for Databricks / Salesforce loads) -------------------------

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ];
  return lines.join("\n");
}

export function zonesCsv(): string {
  return toCsv(ZONES as unknown as Record<string, unknown>[]);
}

export function waypointsCsv(): string {
  // Flatten connectsTo (an array) into a pipe-delimited string for CSV.
  return toCsv(
    WAYPOINTS.map((w) => ({ ...w, connectsTo: w.connectsTo.join("|") }))
  );
}

// Trigger a browser download of a CSV file.
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
