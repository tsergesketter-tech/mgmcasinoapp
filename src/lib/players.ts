import type { FloorLocation, PlayerTier } from "./events";
import { getWaypoint, nextWaypoint } from "./floor";

export interface Player {
  id: string;
  name: string;
  tier: PlayerTier;
  hostName: string;
  location: FloorLocation;
  waypointId: string; // current anchor on the floor waypoint graph
  avatarSeed: string;
}

// Build a player's initial location from a waypoint, keeping the two in sync.
function at(waypointId: string): { waypointId: string; location: FloorLocation } {
  const w = getWaypoint(waypointId)!;
  return {
    waypointId,
    location: { zone: w.name, x: w.x, y: w.y },
  };
}

// A roster of high-value players a host would be tracking on the floor.
export const PLAYERS: Player[] = [
  {
    id: "P-1001",
    name: "Vivian Cross",
    tier: "NOIR",
    hostName: "Marcus Webb",
    ...at("W-HLS"),
    avatarSeed: "vivian",
  },
  {
    id: "P-1002",
    name: "Desmond Rhee",
    tier: "Platinum",
    hostName: "Marcus Webb",
    ...at("W-PIT3"),
    avatarSeed: "desmond",
  },
  {
    id: "P-1003",
    name: "Nadia Sokolov",
    tier: "Platinum",
    hostName: "Elena Ruiz",
    ...at("W-BAC"),
    avatarSeed: "nadia",
  },
  {
    id: "P-1004",
    name: "Theo Marchetti",
    tier: "Gold",
    hostName: "Elena Ruiz",
    ...at("W-MSF"),
    avatarSeed: "theo",
  },
  {
    id: "P-1005",
    name: "Priya Anand",
    tier: "Gold",
    hostName: "Marcus Webb",
    ...at("W-BAR"),
    avatarSeed: "priya",
  },
];

export const TIER_META: Record<
  PlayerTier,
  { color: string; label: string; ring: string }
> = {
  NOIR: { color: "#e9e2d0", label: "NOIR", ring: "#e9e2d0" },
  Platinum: { color: "#cfd4da", label: "Platinum", ring: "#cfd4da" },
  Gold: { color: "#B1812A", label: "Gold", ring: "#d8a94a" },
  Pearl: { color: "#f4ede0", label: "Pearl", ring: "#f4ede0" },
};

export function getPlayer(id: string): Player {
  return PLAYERS.find((p) => p.id === id) ?? PLAYERS[0];
}

// Move a player to an adjacent waypoint along the floor graph, with a small
// random jitter so co-located players don't perfectly overlap. Returns the new
// waypointId + location together so Player state stays consistent.
export function movePlayer(
  p: Player
): { waypointId: string; location: FloorLocation } {
  const next = nextWaypoint(p.waypointId);
  const jitter = () => (Math.random() - 0.5) * 5;
  return {
    waypointId: next.waypointId,
    location: {
      zone: next.name,
      x: Math.max(4, Math.min(96, next.x + jitter())),
      y: Math.max(4, Math.min(96, next.y + jitter())),
    },
  };
}
