// Slot machine model. Weighted symbols so jackpots stay rare and exciting.

export type SymbolId =
  | "lion"
  | "diamond"
  | "seven"
  | "bell"
  | "cherry"
  | "lemon";

export interface SlotSymbol {
  id: SymbolId; // stable key used by the SVG renderer
  name: string;
  weight: number; // relative frequency
  payout: number; // multiplier on 3-of-a-kind
}

export const SYMBOLS: SlotSymbol[] = [
  { id: "lion", name: "Lion", weight: 2, payout: 50 }, // MGM lion = jackpot
  { id: "diamond", name: "Diamond", weight: 4, payout: 20 },
  { id: "seven", name: "Seven", weight: 6, payout: 12 },
  { id: "bell", name: "Bell", weight: 9, payout: 6 },
  { id: "cherry", name: "Cherry", weight: 12, payout: 3 },
  { id: "lemon", name: "Lemon", weight: 14, payout: 2 },
];

function sym(id: SymbolId): SlotSymbol {
  return SYMBOLS.find((s) => s.id === id)!;
}

// A triple paying at least this multiple of the bet counts as a "big win"
// (fires a notable host alert). Used by both the paytable and the emitter so
// they can never disagree.
export const BIG_WIN_MULTIPLE = 8;

const POOL: SlotSymbol[] = SYMBOLS.flatMap((s) =>
  Array<SlotSymbol>(s.weight).fill(s)
);

// Odds of a single reel landing on a given symbol, for the paytable display.
const POOL_SIZE = POOL.length;
export function symbolOdds(s: SlotSymbol): number {
  return s.weight / POOL_SIZE;
}

export function spinReel(): SlotSymbol {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

// ---- Demo rigging -----------------------------------------------------------
// Lets a presenter force the next spin's outcome so orchestration events fire
// on cue during a live demo, instead of relying on ~1-in-13,000 odds.

export type RigTarget = "jackpot" | "bigwin" | "pair" | "loss" | null;

// Produce a concrete 3-reel result that evaluates to the requested outcome.
export function riggedReels(target: Exclude<RigTarget, null>): SlotSymbol[] {
  switch (target) {
    case "jackpot":
      return [sym("lion"), sym("lion"), sym("lion")];
    case "bigwin":
      // Diamond triple = 20× → comfortably above BIG_WIN_MULTIPLE.
      return [sym("diamond"), sym("diamond"), sym("diamond")];
    case "pair":
      return [sym("cherry"), sym("cherry"), sym("lemon")];
    case "loss":
      return [sym("cherry"), sym("bell"), sym("seven")];
  }
}

export interface SpinOutcome {
  reels: SlotSymbol[];
  win: number; // credits won
  kind: "loss" | "pair" | "win" | "jackpot";
  label: string;
}

export function evaluate(reels: SlotSymbol[], bet: number): SpinOutcome {
  const [a, b, c] = reels;
  const allSame = a.name === b.name && b.name === c.name;

  if (allSame) {
    const win = a.payout * bet;
    if (a.name === "Lion") {
      return { reels, win: win * 2, kind: "jackpot", label: "MGM GRAND JACKPOT" };
    }
    return { reels, win, kind: "win", label: `${a.name} Triple — ${a.payout}×` };
  }

  // Any two matching pays back the bet (small win to keep it lively).
  const pair =
    a.name === b.name || b.name === c.name || a.name === c.name;
  if (pair) {
    return { reels, win: bet, kind: "pair", label: "Matched Pair" };
  }

  return { reels, win: 0, kind: "loss", label: "No Match" };
}
