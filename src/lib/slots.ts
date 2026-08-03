// Slot machine model. Weighted symbols so jackpots stay rare and exciting.

export interface SlotSymbol {
  glyph: string;
  name: string;
  weight: number; // relative frequency
  payout: number; // multiplier on 3-of-a-kind
}

export const SYMBOLS: SlotSymbol[] = [
  { glyph: "🦁", name: "Lion", weight: 2, payout: 50 }, // MGM lion = jackpot
  { glyph: "💎", name: "Diamond", weight: 4, payout: 20 },
  { glyph: "7️⃣", name: "Seven", weight: 6, payout: 12 },
  { glyph: "🔔", name: "Bell", weight: 9, payout: 6 },
  { glyph: "🍒", name: "Cherry", weight: 12, payout: 3 },
  { glyph: "🍋", name: "Lemon", weight: 14, payout: 2 },
];

const POOL: SlotSymbol[] = SYMBOLS.flatMap((s) =>
  Array<SlotSymbol>(s.weight).fill(s)
);

export function spinReel(): SlotSymbol {
  return POOL[Math.floor(Math.random() * POOL.length)];
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
