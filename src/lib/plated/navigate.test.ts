import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followPlatedDeepLink, platedIdFromHash, type PlatedDeepLinkDeps } from './navigate';

const ID = 'ab'.repeat(32);

describe('platedIdFromHash', () => {
  it('accepts only #plated-<64 lowercase hex>', () => {
    expect(platedIdFromHash(`#plated-${ID}`)).toBe(ID);
  });

  it('ignores anything else', () => {
    for (const hash of [
      '',
      '#',
      `plated-${ID}`,
      `#plated-${ID.slice(1)}`,
      `#plated-${ID}0`,
      `#plated-${ID.toUpperCase()}`,
      `#plated-${'g'.repeat(64)}`,
      `#plated-${ID}?x=1`,
      `#plated-${ID}#plated-${ID}`,
      `#comments-section`,
      `#plated-<img src=x onerror=alert(1)>`
    ]) {
      expect(platedIdFromHash(hash)).toBeNull();
    }
    expect(platedIdFromHash(null)).toBeNull();
    expect(platedIdFromHash(undefined)).toBeNull();
  });
});

describe('followPlatedDeepLink', () => {
  type Card = { id: string };
  let cards: Map<string, Card>;
  let ready: boolean;
  let scrollCb: (() => void) | null;
  let unlisten: ReturnType<typeof vi.fn>;
  let deps: PlatedDeepLinkDeps<Card> & {
    goToCard: ReturnType<typeof vi.fn>;
    goToComments: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    cards = new Map();
    ready = false;
    scrollCb = null;
    unlisten = vi.fn();
    deps = {
      findCard: (id) => cards.get(id) ?? null,
      isReady: () => ready,
      goToCard: vi.fn(),
      goToComments: vi.fn(),
      onUserScroll: (cb) => {
        scrollCb = cb;
        return unlisten;
      },
      timeoutMs: 2000,
      intervalMs: 100
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes to the card once it renders and moderation is ready', () => {
    ready = true;
    followPlatedDeepLink(ID, deps);
    vi.advanceTimersByTime(500);
    expect(deps.goToCard).not.toHaveBeenCalled();

    const card = { id: ID };
    cards.set(ID, card);
    vi.advanceTimersByTime(100);
    expect(deps.goToCard).toHaveBeenCalledWith(card);
    expect(deps.goToComments).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(deps.goToCard).toHaveBeenCalledOnce();
  });

  it("doesn't go to a card before moderation has settled", () => {
    cards.set(ID, { id: ID });
    followPlatedDeepLink(ID, deps);
    vi.advanceTimersByTime(1000);
    expect(deps.goToCard).not.toHaveBeenCalled();
    ready = true;
    vi.advanceTimersByTime(100);
    expect(deps.goToCard).toHaveBeenCalledOnce();
  });

  it('a blocked plate never reappears: no card in the thread, so it falls back to the comments', () => {
    ready = true; // moderation removed the card from the thread
    followPlatedDeepLink(ID, deps);
    vi.advanceTimersByTime(2100);
    expect(deps.goToCard).not.toHaveBeenCalled();
    expect(deps.goToComments).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(deps.goToComments).toHaveBeenCalledOnce();
  });

  it('falls back to the comments when moderation never becomes ready', () => {
    cards.set(ID, { id: ID });
    followPlatedDeepLink(ID, deps);
    vi.advanceTimersByTime(2100);
    expect(deps.goToCard).not.toHaveBeenCalled();
    expect(deps.goToComments).toHaveBeenCalledOnce();
  });

  it("doesn't jump a visitor who already scrolled", () => {
    ready = true;
    followPlatedDeepLink(ID, deps);
    vi.advanceTimersByTime(300);
    scrollCb!();
    cards.set(ID, { id: ID });
    vi.advanceTimersByTime(5000);
    expect(deps.goToCard).not.toHaveBeenCalled();
    expect(deps.goToComments).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
  });

  it('cancel (navigation / unmount) clears the timer and listeners', () => {
    ready = true;
    const cancel = followPlatedDeepLink(ID, deps);
    cancel();
    expect(unlisten).toHaveBeenCalledOnce();
    cards.set(ID, { id: ID });
    vi.advanceTimersByTime(5000);
    expect(deps.goToCard).not.toHaveBeenCalled();
    expect(deps.goToComments).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
