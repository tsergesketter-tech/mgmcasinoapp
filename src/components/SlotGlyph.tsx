import type { SymbolId } from "../lib/slots";

// Custom-drawn slot symbols in the MGM palette — no emoji. Each is a 64×64
// viewBox so they scale cleanly on the reels and in the paytable.

const GOLD = "#c79a3f";
const GOLD_HI = "#f0d693";
const GOLD_LO = "#8a6420";
const INK = "#141008";

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-foil`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={GOLD_LO} />
        <stop offset="0.45" stopColor={GOLD_HI} />
        <stop offset="0.6" stopColor={GOLD} />
        <stop offset="1" stopColor={GOLD_LO} />
      </linearGradient>
    </defs>
  );
}

export default function SlotGlyph({
  id,
  size = 72,
}: {
  id: SymbolId;
  size?: number;
}) {
  const uid = `g-${id}`;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    fill: "none" as const,
    role: "img" as const,
    "aria-hidden": true,
  };
  const foil = `url(#${uid}-foil)`;

  switch (id) {
    case "lion":
      // MGM-style lion crest: a maned head in a rounded shield.
      return (
        <svg {...common}>
          <Defs id={uid} />
          <rect x="6" y="6" width="52" height="52" rx="14" fill={INK} stroke={foil} strokeWidth="2" />
          <path
            d="M32 15c-7 0-12 4-12 4s2-1 4-1c-3 2-5 6-5 6s3-2 5-2c-4 4-4 9-4 9l4-2c-1 3 0 6 0 6l3-3c0 4 3 7 3 7l2-4 2 4s3-3 3-7l3 3s1-3 0-6l4 2s0-5-4-9c2 0 5 2 5 2s-2-4-5-6c2 0 4 1 4 1s-5-4-12-4Z"
            fill={foil}
          />
          <circle cx="27" cy="33" r="1.6" fill={INK} />
          <circle cx="37" cy="33" r="1.6" fill={INK} />
          <path d="M29 39c1 1.5 5 1.5 6 0" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <Defs id={uid} />
          <path d="M14 24h36l-18 26z" fill={foil} />
          <path d="M14 24l7-8h22l7 8z" fill={foil} opacity="0.75" />
          <path d="M21 16l4 8h14l4-8M14 24h36M25 24l7 26 7-26" stroke={INK} strokeWidth="1.1" opacity="0.4" />
          <path d="M17 22l6-4M47 22l-6-4" stroke={GOLD_HI} strokeWidth="1" opacity="0.7" />
        </svg>
      );
    case "seven":
      // Art-deco 7.
      return (
        <svg {...common}>
          <Defs id={uid} />
          <path
            d="M20 16h26l-14 34h-9l12-27H20z"
            fill={foil}
            stroke={GOLD_LO}
            strokeWidth="1"
          />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <Defs id={uid} />
          <path
            d="M32 12a4 4 0 0 1 4 4c7 2 8 10 8 16 0 6 3 9 3 9H17s3-3 3-9c0-6 1-14 8-16a4 4 0 0 1 4-4Z"
            fill={foil}
          />
          <path d="M27 45a5 5 0 0 0 10 0z" fill={GOLD_LO} />
          <path d="M24 22c-2 3-2 8-2 11" stroke={GOLD_HI} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case "cherry":
      return (
        <svg {...common}>
          <Defs id={uid} />
          <path d="M40 16c-8 3-14 10-16 18M40 16c2 5 0 9-3 12" stroke={foil} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="23" cy="42" r="8" fill={foil} />
          <circle cx="40" cy="38" r="7" fill={foil} />
          <circle cx="20" cy="39" r="2.2" fill={GOLD_HI} opacity="0.8" />
          <circle cx="37" cy="35" r="2" fill={GOLD_HI} opacity="0.8" />
          <path d="M40 16l6-2" stroke={GOLD_LO} strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    case "lemon":
      return (
        <svg {...common}>
          <Defs id={uid} />
          <ellipse cx="32" cy="34" rx="17" ry="13" fill={foil} transform="rotate(-18 32 34)" />
          <path d="M13 30c2-1 4-1 6 0M45 41c2 0 4-1 5-2" stroke={GOLD_HI} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
          <circle cx="16" cy="30" r="2" fill={GOLD_LO} />
          <circle cx="48" cy="39" r="2" fill={GOLD_LO} />
        </svg>
      );
  }
}
