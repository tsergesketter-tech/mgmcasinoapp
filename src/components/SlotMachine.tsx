import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  SYMBOLS,
  spinReel,
  evaluate,
  symbolOdds,
  BIG_WIN_MULTIPLE,
  type SlotSymbol,
} from "../lib/slots";
import { emitEvent } from "../lib/events";
import type { Player } from "../lib/players";

interface Props {
  player: Player;
  onCoins: () => void;
}

const REEL_REPEAT = 8; // symbols stacked per reel for the spin blur
const REEL_BASE_MS = 1200; // reel 0 spin duration
const REEL_STAGGER_MS = 280; // added per reel index
// Last reel (index 2) finishes at base + 2*stagger; small buffer for settle.
const SPIN_SETTLE_MS = REEL_BASE_MS + 2 * REEL_STAGGER_MS + 120;

function buildStrip(final: SlotSymbol): SlotSymbol[] {
  const strip: SlotSymbol[] = [];
  for (let i = 0; i < REEL_REPEAT; i++) {
    strip.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
  }
  strip.push(final); // landing symbol sits at the bottom (payline)
  return strip;
}

export default function SlotMachine({ player, onCoins }: Props) {
  const [credits, setCredits] = useState(2500);
  const [bet, setBet] = useState(50);
  const [spinning, setSpinning] = useState(false);
  const [strips, setStrips] = useState<SlotSymbol[][]>([
    [SYMBOLS[4]],
    [SYMBOLS[3]],
    [SYMBOLS[2]],
  ]);
  const [result, setResult] = useState<{
    text: string;
    kind: string;
    win: number;
  } | null>(null);
  const busy = useRef(false);

  const changeBet = (dir: number) => {
    setBet((b) => Math.min(500, Math.max(25, b + dir * 25)));
  };

  const spin = useCallback(async () => {
    if (busy.current || spinning || credits < bet) return;
    busy.current = true;
    setSpinning(true);
    setResult(null);
    setCredits((c) => c - bet);

    const finals = [spinReel(), spinReel(), spinReel()];
    setStrips(finals.map((f) => buildStrip(f)));

    // Wait for the LAST reel to visually settle before revealing the outcome.
    // Must match the Reel transition: 1.2 + index * 0.28s (reel 2 = 1.76s).
    await new Promise((r) => setTimeout(r, SPIN_SETTLE_MS));

    const outcome = evaluate(finals, bet);
    setResult({ text: outcome.label, kind: outcome.kind, win: outcome.win });

    if (outcome.win > 0) {
      setCredits((c) => c + outcome.win);
    }

    // Emit floor events → Data 360 seam.
    const net = outcome.win - bet;
    if (outcome.kind === "jackpot") {
      onCoins();
      await emitEvent({
        type: "JACKPOT",
        player: { id: player.id, name: player.name, tier: player.tier },
        game: "SLOTS",
        amount: outcome.win,
        location: player.location,
        severity: "critical",
        message: `${player.name} hit the MGM Grand Jackpot for $${outcome.win.toLocaleString()} on High Limit Slots!`,
      });
    } else if (outcome.win >= bet * BIG_WIN_MULTIPLE) {
      onCoins();
      await emitEvent({
        type: "BIG_WIN",
        player: { id: player.id, name: player.name, tier: player.tier },
        game: "SLOTS",
        amount: outcome.win,
        location: player.location,
        severity: "notable",
        message: `${player.name} landed a big win — $${outcome.win.toLocaleString()} (${outcome.label}).`,
      });
    } else if (net <= -bet && bet >= 100) {
      await emitEvent({
        type: "BIG_LOSS",
        player: { id: player.id, name: player.name, tier: player.tier },
        game: "SLOTS",
        amount: -bet,
        location: player.location,
        severity: "notable",
        message: `${player.name} is down $${bet.toLocaleString()} this spin — consider a courtesy touchpoint.`,
      });
    }

    setSpinning(false);
    busy.current = false;
  }, [bet, credits, player, spinning, onCoins]);

  return (
    <div className="slot">
      <div className="slot-cabinet deco-frame">
        <div className="slot-crown">MGM Grand · High Limit</div>
        <div className="reels">
          {strips.map((strip, i) => (
            <Reel key={i} strip={strip} spinning={spinning} index={i} />
          ))}
          <div className="payline" />
        </div>

        <div className={`slot-result ${result?.kind ?? ""}`}>
          {result ? (
            <>
              <span className="result-label">{result.text}</span>
              {result.win > 0 ? (
                <span className="result-amt">
                  +${result.win.toLocaleString()}
                </span>
              ) : (
                <span className="result-amt muted">−${bet}</span>
              )}
            </>
          ) : (
            <span className="result-hint">Match 3 to win big · any 2 pays back your bet</span>
          )}
        </div>

        <div className="slot-controls">
          <div className="credit-read">
            <small>Credits</small>
            <b>${credits.toLocaleString()}</b>
          </div>

          <div className="bet-row">
            <button onClick={() => changeBet(-1)} disabled={spinning}>
              −
            </button>
            <span>
              Bet <b>${bet}</b>
            </span>
            <button onClick={() => changeBet(1)} disabled={spinning}>
              +
            </button>
          </div>

          <button
            className="spin-btn"
            onClick={spin}
            disabled={spinning || credits < bet}
          >
            {spinning ? "Spinning" : "Spin"}
          </button>
        </div>
      </div>

      <Paytable bet={bet} />
    </div>
  );
}

// Spells out exactly how to win — big and little — for the current bet.
// Driven by the same SYMBOLS/thresholds the game uses, so it's always accurate.
function Paytable({ bet }: { bet: number }) {
  return (
    <div className="paytable">
      <div className="paytable-head">
        <span>How to Win</span>
        <span className="paytable-note">Payouts shown for your ${bet} bet</span>
      </div>

      <div className="paytable-rows">
        {SYMBOLS.map((s) => {
          const win = s.payout * bet;
          const big = s.payout >= BIG_WIN_MULTIPLE;
          const jackpot = s.name === "Lion";
          const payMult = jackpot ? s.payout * 2 : s.payout;
          const payAmt = jackpot ? win * 2 : win;
          return (
            <div
              key={s.name}
              className={`pay-row ${jackpot ? "jackpot" : big ? "big" : ""}`}
            >
              <span className="pay-combo">
                <span className="pay-glyphs">
                  {s.glyph}
                  {s.glyph}
                  {s.glyph}
                </span>
                <span className="pay-name">
                  {jackpot ? "MGM Jackpot" : `${s.name} Triple`}
                </span>
              </span>
              <span className="pay-odds">
                ~1 in {Math.round(1 / Math.pow(symbolOdds(s), 3)).toLocaleString()}
              </span>
              <span className="pay-mult">{payMult}×</span>
              <span className="pay-amt">${payAmt.toLocaleString()}</span>
            </div>
          );
        })}

        <div className="pay-row minor">
          <span className="pay-combo">
            <span className="pay-glyphs">🍒🍒 ·</span>
            <span className="pay-name">Any Matching Pair</span>
          </span>
          <span className="pay-odds">frequent</span>
          <span className="pay-mult">1×</span>
          <span className="pay-amt">${bet.toLocaleString()}</span>
        </div>
      </div>

      <div className="paytable-legend">
        <span className="lg jackpot">◆ Jackpot — critical host alert</span>
        <span className="lg big">● Big win ({BIG_WIN_MULTIPLE}×+) — notable alert</span>
        <span className="lg pair">Pair — returns your bet</span>
      </div>
    </div>
  );
}

function Reel({
  strip,
  spinning,
  index,
}: {
  strip: SlotSymbol[];
  spinning: boolean;
  index: number;
}) {
  const cellH = 150; // must match --reel-h in app.css
  const finalOffset = -(strip.length - 1) * cellH;

  return (
    <div className="reel">
      <motion.div
        className="reel-track"
        initial={false}
        animate={{ y: spinning ? [0, finalOffset] : finalOffset }}
        transition={
          spinning
            ? {
                duration: (REEL_BASE_MS + index * REEL_STAGGER_MS) / 1000,
                ease: [0.15, 0.6, 0.2, 1],
              }
            : { duration: 0 }
        }
      >
        {strip.map((s, i) => (
          <div className="reel-cell" key={i}>
            {s.glyph}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
