import { describe, it, expect } from 'vitest';
import {
  STREAM_RECEIPT_RELAYS,
  chatReceiptRelays,
  goLiveAnnouncementRelays,
  goLiveChatRelays
} from './relays';

describe('Go live chat relays', () => {
  it('are the shared receipt list, so chat and zap receipts meet on the same relays', () => {
    expect(goLiveChatRelays()).toEqual([...STREAM_RECEIPT_RELAYS]);
    expect(chatReceiptRelays()).toEqual(goLiveChatRelays());
  });

  it('hand out a copy: a caller cannot change the shared list', () => {
    const list = goLiveChatRelays();
    list.push('wss://example.invalid');
    expect(goLiveChatRelays()).not.toContain('wss://example.invalid');
  });

  it('are announced without purplepag.es, which stores no chat or receipts', () => {
    const announced = goLiveAnnouncementRelays();
    expect(announced).not.toContain('wss://purplepag.es');
    expect(announced).toEqual(goLiveChatRelays().filter((url) => url !== 'wss://purplepag.es'));
    expect(announced).toContain('wss://relay.damus.io');
    expect(announced.every((url) => url.startsWith('wss://'))).toBe(true);
  });
});
