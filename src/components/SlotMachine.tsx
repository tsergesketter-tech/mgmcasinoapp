import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SYMBOLS, spinReel, evaluate, type SlotSymbol } from "../lib/slots";
import { emitEvent } from "../lib/events";
import type { Player } from "../lib/players";

interface Props {
  player: Player;
  onCoins: () => void;
}

const REEL_REPEAT = 8; // symbols stacked per reel for the spin blur

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
  const [result, setResult] = useState<{ text: string; kind: string } | null>(
    null
  );
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

    // Let the reels animate, then settle staggered.
    await new Promise((r) => setTimeout(r, 1500));

    const outcome = evaluate(finals, bet);
    setResult({ text: outcome.label, kind: outcome.kind });

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
    } else if (outcome.win >= bet * 8) {
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

      <div className={`slot-result ${result?.kind ?? ""}`}>
        {result?.text ?? ""}
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
  const cellH = 118;
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
                duration: 1.2 + index * 0.28,
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
