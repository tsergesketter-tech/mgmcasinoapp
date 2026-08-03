import type { FloorLocation, PlayerTier } from "./events";

export interface Player {
  id: string;
  name: string;
  tier: PlayerTier;
  hostName: string;
  location: FloorLocation;
  avatarSeed: string;
}

// A roster of high-value players a host would be tracking on the floor.
export const PLAYERS: Player[] = [
  {
    id: "P-1001",
    name: "Vivian Cross",
    tier: "NOIR",
    hostName: "Marcus Webb",
    location: { zone: "High Limit Slots", x: 22, y: 30 },
    avatarSeed: "vivian",
  },
  {
    id: "P-1002",
    name: "Desmond Rhee",
    tier: "Platinum",
    hostName: "Marcus Webb",
    location: { zone: "Blackjack Pit 3", x: 68, y: 55 },
    avatarSeed: "desmond",
  },
  {
    id: "P-1003",
    name: "Nadia Sokolov",
    tier: "Platinum",
    hostName: "Elena Ruiz",
    location: { zone: "Baccarat Salon", x: 80, y: 22 },
    avatarSeed: "nadia",
  },
  {
    id: "P-1004",
    name: "Theo Marchetti",
    tier: "Gold",
    hostName: "Elena Ruiz",
    location: { zone: "Main Slots Floor", x: 44, y: 72 },
    avatarSeed: "theo",
  },
  {
    id: "P-1005",
    name: "Priya Anand",
    tier: "Gold",
    hostName: "Marcus Webb",
    location: { zone: "High Limit Slots", x: 30, y: 40 },
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

// Nudge a player's floor coordinates a little, to simulate live movement.
export function driftLocation(loc: FloorLocation): FloorLocation {
  const clamp = (v: number) => Math.max(6, Math.min(94, v));
  return {
    ...loc,
    x: clamp(loc.x + (Math.random() - 0.5) * 6),
    y: clamp(loc.y + (Math.random() - 0.5) * 6),
  };
}
