import { describe, it, expect, vi } from 'vitest';
import { createSubscriptionSlot } from './subscriptionSlot';

function fakeSub(name: string) {
  return { name, stop: vi.fn() };
}

describe('createSubscriptionSlot', () => {
  it('starts one subscription for a key and reuses it', () => {
    const slot = createSubscriptionSlot<ReturnType<typeof fakeSub>>();
    const make = vi.fn(() => fakeSub('a'));
    const first = slot.retarget('recipe-a', make);
    const again = slot.retarget('recipe-a', make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(again).toBe(first);
    expect(first!.stop).not.toHaveBeenCalled();
  });

  it('stops the old subscription before starting the next on a new key', () => {
    const slot = createSubscriptionSlot<ReturnType<typeof fakeSub>>();
    const order: string[] = [];
    const a = fakeSub('a');
    a.stop.mockImplementation(() => order.push('stop a'));
    slot.retarget('recipe-a', () => a);
    const b = slot.retarget('recipe-b', () => {
      order.push('make b');
      return fakeSub('b');
    });
    expect(order).toEqual(['stop a', 'make b']);
    expect(b!.name).toBe('b');
    expect(slot.current).toBe(b);
  });

  it('a null key stops and holds nothing', () => {
    const slot = createSubscriptionSlot<ReturnType<typeof fakeSub>>();
    const a = slot.retarget('recipe-a', () => fakeSub('a'))!;
    expect(slot.retarget(null, () => fakeSub('never'))).toBeNull();
    expect(a.stop).toHaveBeenCalledTimes(1);
    expect(slot.current).toBeNull();
  });

  it('stop() is idempotent and a later retarget to the same key starts fresh', () => {
    const slot = createSubscriptionSlot<ReturnType<typeof fakeSub>>();
    const a = slot.retarget('recipe-a', () => fakeSub('a'))!;
    slot.stop();
    slot.stop();
    expect(a.stop).toHaveBeenCalledTimes(1);
    const make = vi.fn(() => fakeSub('a2'));
    slot.retarget('recipe-a', make);
    expect(make).toHaveBeenCalledTimes(1);
  });
});
