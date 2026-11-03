/**
 * Tests for NIP-89 client tag functionality
 */

import { describe, it, expect } from 'vitest';
import { ensureClientTag, addClientTagToEvent, ZAP_COOKING_HANDLER_ADDRESS } from './nip89';
import { buildHandlerHeadlight } from './nip89Headlight';
import { ORG_PUBKEY } from './landing/curation';
import { CLIENT_TAG_IDENTIFIER } from './consts';
import { NDKEvent } from '@nostr-dev-kit/ndk';

const FULL_TAG = ['client', CLIENT_TAG_IDENTIFIER, ZAP_COOKING_HANDLER_ADDRESS];

// Mock NDK for testing
class MockNDK {
  signer: any = null;
}

describe('NIP-89 Client Tag', () => {
  describe('ensureClientTag', () => {
    it('should add client tag when none exists', () => {
      const tags: string[][] = [
        ['e', 'event-id'],
        ['p', 'pubkey']
      ];
      
      const result = ensureClientTag([...tags]);
      
      expect(result).toHaveLength(3);
      expect(result[2]).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
    });

    it('should not duplicate client tag if already present', () => {
      const tags: string[][] = [
        ['e', 'event-id'],
        ['client', CLIENT_TAG_IDENTIFIER],
        ['p', 'pubkey']
      ];
      
      const result = ensureClientTag([...tags]);
      
      expect(result).toHaveLength(3);
      expect(result.filter(t => t[0] === 'client')).toHaveLength(1);
      expect(result.find(t => t[0] === 'client')).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
    });

    it('should update empty client tag value', () => {
      const tags: string[][] = [
        ['e', 'event-id'],
        ['client', ''], // Empty value
        ['p', 'pubkey']
      ];
      
      const result = ensureClientTag([...tags]);
      
      const clientTag = result.find(t => t[0] === 'client');
      expect(clientTag).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
    });

    it('should preserve existing client tag if it has a value', () => {
      const existingValue = 'other.client';
      const tags: string[][] = [
        ['e', 'event-id'],
        ['client', existingValue],
        ['p', 'pubkey']
      ];
      
      const result = ensureClientTag([...tags]);
      
      const clientTag = result.find(t => t[0] === 'client');
      // Should preserve existing value, not override
      expect(clientTag).toEqual(['client', existingValue]);
    });

    it('should append client tag at the end', () => {
      const tags: string[][] = [
        ['e', 'event-id'],
        ['p', 'pubkey'],
        ['t', 'tag']
      ];
      
      const result = ensureClientTag([...tags]);
      
      expect(result[result.length - 1]).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
    });
  });

  describe('addClientTagToEvent', () => {
    it('should add client tag to kind 1 (note) event', () => {
      const mockNDK = new MockNDK() as any;
      const event = new NDKEvent(mockNDK);
      event.kind = 1;
      event.content = 'Test note';
      event.tags = [['t', 'zapcooking']];
      
      addClientTagToEvent(event);
      
      const clientTag = event.tags.find(t => t[0] === 'client');
      expect(clientTag).toBeDefined();
      expect(clientTag).toEqual(FULL_TAG);
    });

    it('should add client tag to kind 6 (repost) event', () => {
      const mockNDK = new MockNDK() as any;
      const event = new NDKEvent(mockNDK);
      event.kind = 6;
      event.tags = [
        ['e', 'reposted-event-id'],
        ['p', 'author-pubkey']
      ];
      
      addClientTagToEvent(event);
      
      const clientTag = event.tags.find(t => t[0] === 'client');
      expect(clientTag).toBeDefined();
      expect(clientTag).toEqual(FULL_TAG);
    });

    it('should add client tag to kind 7 (reaction) event', () => {
      const mockNDK = new MockNDK() as any;
      const event = new NDKEvent(mockNDK);
      event.kind = 7;
      event.content = '+';
      event.tags = [
        ['e', 'reacted-event-id'],
        ['p', 'author-pubkey']
      ];
      
      addClientTagToEvent(event);
      
      const clientTag = event.tags.find(t => t[0] === 'client');
      expect(clientTag).toBeDefined();
      expect(clientTag).toEqual(FULL_TAG);
    });

    it('should not create duplicate client tags when called twice', () => {
      const mockNDK = new MockNDK() as any;
      const event = new NDKEvent(mockNDK);
      event.kind = 1;
      event.content = 'Test';
      event.tags = [];
      
      addClientTagToEvent(event);
      addClientTagToEvent(event); // Call again
      
      const clientTags = event.tags.filter(t => t[0] === 'client');
      expect(clientTags).toHaveLength(1);
      expect(clientTags[0]).toEqual(FULL_TAG);
    });
  });

  describe('handler address', () => {
    it("points at the org's handler, never the signer's key (anonymous posts stay unlinked)", () => {
      expect(ZAP_COOKING_HANDLER_ADDRESS).toBe(`31990:${ORG_PUBKEY}:zap-cooking`);
      const event = new NDKEvent(new MockNDK() as any);
      event.kind = 1;
      event.pubkey = 'e'.repeat(64);
      event.tags = [];
      addClientTagToEvent(event);
      const tag = event.tags.find((t) => t[0] === 'client')!;
      expect(tag[2]).toBe(ZAP_COOKING_HANDLER_ADDRESS);
      expect(JSON.stringify(event.tags)).not.toContain('e'.repeat(64));
    });

    it("leaves another client's tag unchanged", () => {
      const event = new NDKEvent(new MockNDK() as any);
      event.kind = 10003;
      event.tags = [['client', 'OtherApp']];
      addClientTagToEvent(event);
      expect(event.tags).toEqual([['client', 'OtherApp']]);
    });

    it('keeps an existing handler address on our own tag', () => {
      const event = new NDKEvent(new MockNDK() as any);
      event.kind = 1;
      event.tags = [['client', CLIENT_TAG_IDENTIFIER, '31990:abc:other', 'wss://r']];
      addClientTagToEvent(event);
      expect(event.tags).toEqual([['client', CLIENT_TAG_IDENTIFIER, '31990:abc:other', 'wss://r']]);
    });
  });

  describe('buildHandlerHeadlight', () => {
    const h = buildHandlerHeadlight();

    it('is the replaceable event the client tag points at', () => {
      expect(h.kind).toBe(31990);
      const [, pubkey, d] = ZAP_COOKING_HANDLER_ADDRESS.split(':');
      expect(pubkey).toBe(ORG_PUBKEY);
      expect(h.tags).toContainEqual(['d', d]);
    });

    it('carries the app metadata as kind-0-style JSON in content', () => {
      const meta = JSON.parse(h.content);
      expect(meta.name).toBe(CLIENT_TAG_IDENTIFIER);
      expect(meta.picture).toMatch(/^https:\/\//);
      expect(meta.about).toBeTruthy();
    });

    it('has a <bech32> URL template per entity it opens', () => {
      const web = h.tags.filter((t) => t[0] === 'web');
      expect(web).toEqual([
        ['web', 'https://zap.cooking/recipe/<bech32>', 'naddr'],
        ['web', 'https://zap.cooking/<bech32>', 'nevent']
      ]);
      expect(h.tags.filter((t) => t[0] === 'k').map((t) => t[1])).toEqual(['30023', '1068']);
    });
  });
});
