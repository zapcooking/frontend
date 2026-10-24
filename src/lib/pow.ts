/**
 * NIP-13 proof of work: mine a nonce into an event until its id carries
 * enough leading zero bits.
 *
 * Ported from Sidecar (dmnyc/sidecar#325). The reasoning that came with it
 * is kept because it is the part that is easy to get wrong twice.
 *
 * It hashes through nostr-tools' `getEventHash` rather than rolling its own
 * serialization. The id this produces has to match the one the signer
 * recomputes byte for byte, or the zeros are lost and the work was wasted;
 * owning a second copy of the NIP-01 serialization is exactly the kind of
 * thing that drifts.
 */
import { getEventHash } from 'nostr-tools';

/** The event fields the id commits to — nothing else affects the hash. */
export interface MinableEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface MineProgress {
  attempts: number;
  /** Most leading zero bits seen so far, for a pane that has to look alive. */
  best: number;
}

export interface MineResult {
  event: MinableEvent;
  attempts: number;
  difficulty: number;
}

/**
 * NIP-13 difficulty as the spec defines it: leading zero BITS, not zero hex
 * characters. A hex digit of 7 or less carries leading zeros of its own,
 * which is the part that is easy to get wrong.
 */
export function leadingZeroBits(hex: string): number {
  let count = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (Number.isNaN(nibble)) break;
    if (nibble === 0) {
      count += 4;
    } else {
      count += Math.clz32(nibble) - 28;
      break;
    }
  }
  return count;
}

/**
 * How often the loop reports back. Frequent enough that an elapsed counter
 * moves like a clock rather than a slideshow, rare enough that postMessage
 * is not itself a measurable share of the work.
 */
const REPORT_EVERY = 20_000;

/**
 * How often the clock is re-read. NIP-13 recommends updating created_at
 * while mining, and a 22-bit mine can outlast a minute, so an event that
 * started before the user's last coffee should not publish carrying that
 * timestamp. Re-stamping also reshuffles the whole search space for free.
 */
const RESTAMP_EVERY = 400_000;

/** Above this, a mine stops being a wait and becomes a hostage situation. */
const MAX_BITS = 40;

/**
 * The mining loop, kept separate from any worker plumbing so it can be run
 * for real in a test rather than only grepped.
 *
 * Mutates and returns the event it is given; callers pass a copy.
 */
export function minePowEvent(
  event: MinableEvent,
  bits: number,
  report?: (p: MineProgress) => void
): MineResult {
  const target = Math.max(0, Math.min(MAX_BITS, Number(bits) || 0));
  const ev = event;
  ev.tags = (ev.tags || []).filter((t) => !Array.isArray(t) || t[0] !== 'nonce');

  // The third entry is the TARGET, which NIP-13 says a miner SHOULD commit
  // to. It is what lets a reader reject a bulk-mined note that got lucky at
  // a difficulty it never aimed for, so a thread demanding 40 bits cannot be
  // answered by spam aiming at 8.
  const nonce = ['nonce', '0', String(target)];
  ev.tags.push(nonce);

  let attempts = 0;
  let best = 0;
  for (;;) {
    nonce[1] = String(attempts++);
    const zeros = leadingZeroBits(getEventHash(ev as never));
    if (zeros > best) best = zeros;
    if (zeros >= target) return { event: ev, attempts, difficulty: zeros };
    if (attempts % REPORT_EVERY === 0 && report) report({ attempts, best });
    if (attempts % RESTAMP_EVERY === 0) ev.created_at = Math.floor(Date.now() / 1000);
  }
}

/**
 * The four rungs offered in the UI, labeled in bits with no adjectives.
 *
 * Each step is two bits, which is four times the work, so the ladder is even
 * wherever you stand on it. A relay asking for proof of work states a
 * number, so someone told "this one needs 20" can act on 20 and cannot act
 * on "High" — and four evenly spaced rungs have no natural four-word ladder
 * anyway. The line under them carries what the rung costs, which is the half
 * a number cannot say.
 *
 * The costs are measured rather than guessed — about 330k hashes a second
 * through this repo's bundled `getEventHash` — and quote the long tail
 * rather than the average, because mining is geometric and the spread is
 * what surprises people: at 22 bits the median is under nine seconds and one
 * run in twenty passes half a minute. They stay deliberately conservative,
 * since that rate was measured on a laptop and a phone is a good deal
 * slower.
 */
export const POW_LEVELS: { bits: number; cost: string }[] = [
  { bits: 16, cost: 'Usually instant.' },
  { bits: 18, cost: 'About a second.' },
  { bits: 20, cost: 'A few seconds, sometimes fifteen.' },
  { bits: 22, cost: 'Ten seconds or so, sometimes a minute.' }
];

export const POW_DEFAULT_BITS = 18;

export function powLevelFor(bits: number) {
  return POW_LEVELS.find((l) => l.bits === bits) || POW_LEVELS[1];
}

/** Whether a stored setting names a rung we actually offer. */
export function isPowBits(value: unknown): value is number {
  return typeof value === 'number' && POW_LEVELS.some((l) => l.bits === value);
}
