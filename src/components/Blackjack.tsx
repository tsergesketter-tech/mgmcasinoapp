import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  freshDeck,
  handValue,
  isRed,
  isBlackjack,
  type Card as TCard,
} from "../lib/blackjack";
import { emitEvent } from "../lib/events";
import type { Player } from "../lib/players";

interface Props {
  player: Player;
  onCoins: () => void;
}

type Phase = "idle" | "player" | "dealer" | "done";

export default function Blackjack({ player, onCoins }: Props) {
  const [deck, setDeck] = useState<TCard[]>([]);
  const [player_, setPlayerHand] = useState<TCard[]>([]);
  const [dealer, setDealerHand] = useState<TCard[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<string>("");
  const [bankroll, setBankroll] = useState(5000);
  const [bet, setBet] = useState(100);

  const changeBet = (dir: number) =>
    setBet((b) => Math.min(1000, Math.max(50, b + dir * 50)));

  const pv = useMemo(() => handValue(player_), [player_]);
  const dv = useMemo(() => handValue(dealer), [dealer]);

  const deal = useCallback(() => {
    const d = freshDeck();
    const ph = [d.pop()!, d.pop()!];
    const dh = [d.pop()!, d.pop()!];
    setDeck(d);
    setPlayerHand(ph);
    setDealerHand(dh);
    setOutcome("");
    // A player natural resolves immediately — but only against a dealer who
    // does not also hold a natural (dual naturals push).
    if (isBlackjack(ph)) {
      setPhase("done");
      settle(ph, dh, true);
    } else {
      setPhase("player");
    }
  }, [bet]);

  const hit = useCallback(() => {
    if (phase !== "player") return;
    const d = [...deck];
    const next = [...player_, d.pop()!];
    setDeck(d);
    setPlayerHand(next);
    if (handValue(next) > 21) {
      setPhase("done");
      settle(next, dealer, false);
    }
  }, [deck, player_, dealer, phase, bet]);

  const stand = useCallback(() => {
    if (phase !== "player") return;
    setPhase("dealer");
    const d = [...deck];
    const dh = [...dealer];
    while (handValue(dh) < 17) dh.push(d.pop()!);
    setDeck(d);
    setDealerHand(dh);
    setPhase("done");
    settle(player_, dh, false);
  }, [deck, dealer, player_, phase, bet]);

  function settle(ph: TCard[], dh: TCard[], playerBJ: boolean) {
    const p = handValue(ph);
    const dvv = handValue(dh);
    let text: string;
    let net = 0;

    if (p > 21) {
      text = "Bust — House Wins";
      net = -bet;
    } else if (playerBJ && isBlackjack(dh)) {
      text = "Push — Both Blackjack";
      net = 0;
    } else if (playerBJ) {
      text = "Blackjack! Pays 3:2";
      net = Math.round(bet * 1.5);
    } else if (dvv > 21 || p > dvv) {
      text = "Player Wins";
      net = bet;
    } else if (p === dvv) {
      text = "Push";
      net = 0;
    } else {
      text = "House Wins";
      net = -bet;
    }
    setOutcome(text);

    setBankroll((b) => b + net);

    // Emit to the Data 360 seam. Blackjack "random events" for hosts.
    if (net > 0) {
      onCoins();
      emitEvent({
        // A natural blackjack is the marquee moment → JACKPOT event.
        type: playerBJ ? "JACKPOT" : "BIG_WIN",
        player: { id: player.id, name: player.name, tier: player.tier },
        game: "BLACKJACK",
        amount: net,
        location: player.location,
        severity: playerBJ ? "notable" : "info",
        message: playerBJ
          ? `${player.name} drew a natural blackjack at ${player.location.zone} (+$${net}).`
          : `${player.name} won a hand at ${player.location.zone} (+$${net}).`,
      });
    } else if (net < 0) {
      emitEvent({
        type: "BIG_LOSS",
        player: { id: player.id, name: player.name, tier: player.tier },
        game: "BLACKJACK",
        amount: net,
        location: player.location,
        severity: "info",
        message: `${player.name} lost a hand at ${player.location.zone} ($${net}).`,
      });
    }
  }

  const hideHole = phase === "player" || phase === "idle";

  return (
    <div className="bj-table deco-frame">
      <div className="bj-arc">
        Blackjack pays 3 to 2 · Dealer stands on 17 · Bankroll $
        {bankroll.toLocaleString()}
      </div>

      <div className="bj-seat">
        <div className="seat-label">
          <span>Dealer</span>
          <span className="score">{phase === "idle" ? "" : hideHole ? "?" : dv}</span>
        </div>
        <div className="hand">
          {dealer.map((c, i) => (
            <PlayingCard key={i} card={c} hidden={hideHole && i === 1} delay={i * 0.08} />
          ))}
        </div>
      </div>

      <div className="bj-seat">
        <div className="seat-label">
          <span>{player.name}</span>
          <span className="score">{phase === "idle" ? "" : pv}</span>
        </div>
        <div className="hand">
          {player_.map((c, i) => (
            <PlayingCard key={i} card={c} delay={i * 0.08} />
          ))}
        </div>
      </div>

      <div className="bj-wager">
        <span className="wager-label">Wager</span>
        <div className="bet-row">
          <button
            onClick={() => changeBet(-1)}
            disabled={phase === "player" || phase === "dealer" || bet <= 50}
            aria-label="Lower wager"
          >
            −
          </button>
          <span>
            <b>${bet}</b>
          </span>
          <button
            onClick={() => changeBet(1)}
            disabled={phase === "player" || phase === "dealer" || bet >= 1000}
            aria-label="Raise wager"
          >
            +
          </button>
        </div>
        <div className="chip-rail" aria-hidden>
          {[50, 100, 250, 500].map((c) => (
            <button
              key={c}
              className={`chip c${c} ${bet === c ? "on" : ""}`}
              onClick={() => setBet(c)}
              disabled={phase === "player" || phase === "dealer"}
              aria-label={`Set wager to $${c}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="bj-controls">
        {phase === "idle" || phase === "done" ? (
          <button
            className="bj-btn primary"
            onClick={deal}
            disabled={bet > bankroll}
          >
            Deal
          </button>
        ) : (
          <>
            <button className="bj-btn" onClick={hit} disabled={phase !== "player"}>
              Hit
            </button>
            <button
              className="bj-btn primary"
              onClick={stand}
              disabled={phase !== "player"}
            >
              Stand
            </button>
          </>
        )}
      </div>

      <div className="bj-outcome">{outcome}</div>
    </div>
  );
}

function PlayingCard({
  card,
  hidden,
  delay,
}: {
  card: TCard;
  hidden?: boolean;
  delay?: number;
}) {
  if (hidden) return <div className="card back" />;
  return (
    <motion.div
      className={`card ${isRed(card) ? "red" : ""}`}
      initial={{ rotateY: 90, opacity: 0, y: -10 }}
      animate={{ rotateY: 0, opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <div className="rank">
        {card.rank}
        {card.suit}
      </div>
      <div className="pip">{card.suit}</div>
      <div className="suit">
        {card.rank}
        {card.suit}
      </div>
    </motion.div>
  );
}
