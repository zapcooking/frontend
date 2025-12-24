/**
 * Tests for NIP-89 client tag functionality
 */

import { describe, it, expect } from 'vitest';
import { ensureClientTag, addClientTagToEvent } from './nip89';
import { CLIENT_TAG_IDENTIFIER } from './consts';
import { NDKEvent } from '@nostr-dev-kit/ndk';

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
      
      const result = ensureClientTag(tags);
      
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
      expect(clientTag).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
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
      expect(clientTag).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
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
      expect(clientTag).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
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
      expect(clientTags[0]).toEqual(['client', CLIENT_TAG_IDENTIFIER]);
    });
  });
});

