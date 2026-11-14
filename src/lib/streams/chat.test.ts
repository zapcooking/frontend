import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ChatMessages, chatTemplate, chatReplyParent, mentionPubkeys } from './chat';
import type { NostrEventLike, EventVerifier } from './types';

const HOST = 'a'.repeat(64);
const STREAMER = 'b'.repeat(64);
const MENTIONED = 'c'.repeat(64);
const ADDRESS = `30311:${HOST}:my-stream`;
const GOOD_SIGNATURE = 'f'.repeat(128);
const verify: EventVerifier = () => true;

function chatEvent(overrides: Partial<NostrEventLike> = {}, tags: string[][] = []): NostrEventLike {
  return {
    id: '1'.repeat(64),
    pubkey: STREAMER,
    created_at: Math.floor(Date.now() / 1000) - 10,
    kind: 1311,
    tags: [['a', ADDRESS], ...tags],
    content: 'hello stream',
    sig: GOOD_SIGNATURE,
    ...overrides
  };
}

describe('chatTemplate', () => {
  it('targets the stream with an a tag and no e tag', () => {
    const tpl = chatTemplate(ADDRESS, 'hello!');
    expect(tpl.kind).toBe(1311);
    expect(tpl.tags[0]).toEqual(['a', ADDRESS]);
    expect(tpl.tags.some((t) => t[0] === 'e')).toBe(false);
    expect(tpl.content).toBe('hello!');
  });

  it('adds e+p tags for a reply', () => {
    const tpl = chatTemplate(ADDRESS, 'nice', { id: '2'.repeat(64), pubkey: HOST });
    expect(tpl.tags).toContainEqual(['e', '2'.repeat(64)]);
    expect(tpl.tags).toContainEqual(['p', HOST]);
  });

  it('adds mention p tags from nostr entities', () => {
    const npub = nip19.npubEncode(MENTIONED);
    const tpl = chatTemplate(ADDRESS, `hey nostr:${npub} look at this`);
    expect(tpl.tags).toContainEqual(['p', MENTIONED]);
  });

  it('rejects a bad address, empty content, and oversized content', () => {
    expect(() => chatTemplate('not-an-address', 'hi')).toThrow('Invalid chat message');
    expect(() => chatTemplate(ADDRESS, '   ')).toThrow('Invalid chat message');
    expect(() => chatTemplate(ADDRESS, 'x'.repeat(4001))).toThrow('Invalid chat message');
  });
});

describe('mentionPubkeys', () => {
  it('extracts npub and nprofile entities, deduped', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: HOST });
    const text = `nostr:${nip19.npubEncode(MENTIONED)} and ${nprofile} and nostr:${nip19.npubEncode(MENTIONED)}`;
    expect(mentionPubkeys(text).sort()).toEqual([HOST, MENTIONED].sort());
  });

  it('ignores non-entity text and malformed entities', () => {
    expect(mentionPubkeys('just #hashtags and https://example.com')).toEqual([]);
    expect(mentionPubkeys('nostr:npub1notreal')).toEqual([]);
  });
});

describe('ChatMessages.accept', () => {
  it('accepts valid messages for the address', () => {
    const model = new ChatMessages(ADDRESS);
    expect(model.accept(chatEvent(), verify)).toBe(true);
    expect(model.size).toBe(1);
    expect(model.rows()[0].content).toBe('hello stream');
  });

  it('rejects other addresses, kinds, oversized content, and future timestamps', () => {
    const model = new ChatMessages(ADDRESS);
    expect(model.accept(chatEvent({ tags: [['a', `30311:${HOST}:other`]] }), verify)).toBe(false);
    expect(model.accept(chatEvent({ kind: 1 }), verify)).toBe(false);
    expect(model.accept(chatEvent({ content: 'x'.repeat(4001) }), verify)).toBe(false);
    expect(model.accept(chatEvent({ created_at: Date.now() / 1000 + 3600 }), verify)).toBe(false);
    expect(model.size).toBe(0);
  });

  it('rejects unverifiable signatures and duplicate ids', () => {
    const model = new ChatMessages(ADDRESS);
    const bad: EventVerifier = () => false;
    expect(model.accept(chatEvent(), bad)).toBe(false);
    expect(model.accept(chatEvent(), verify)).toBe(true);
    expect(model.accept(chatEvent(), verify)).toBe(false);
    expect(model.size).toBe(1);
  });

  it('caps the model at 1000 by dropping the oldest', () => {
    const model = new ChatMessages(ADDRESS);
    for (let i = 0; i < 1001; i++) {
      model.accept(chatEvent({ id: String(i).padStart(64, '0'), created_at: i + 1 }), verify);
    }
    expect(model.size).toBe(1000);
    expect(model.rows()[0].id).toBe(String(1).padStart(64, '0'));
    expect(model.rows()[999].id).toBe(String(1000).padStart(64, '0'));
  });
});

describe('chatReplyParent', () => {
  it('reads the reply parent from e/p tags', () => {
    const reply = chatEvent(undefined, [
      ['e', '2'.repeat(64)],
      ['p', HOST]
    ]);
    expect(chatReplyParent(reply)).toEqual({ id: '2'.repeat(64), pubkey: HOST });
    expect(chatReplyParent(chatEvent())).toBeNull();
  });
});

describe('note chat (Go live "Live now" note)', () => {
  const NOTE = '9'.repeat(64);
  const reply = (overrides: Partial<NostrEventLike> = {}, tags: string[][] = []) =>
    chatEvent({ kind: 1, tags: [['e', NOTE, '', 'root'], ['p', HOST], ...tags], ...overrides }, []);

  it('builds a NIP-10 reply to the note, tagging its author', () => {
    const tpl = chatTemplate(NOTE, 'looks great', null, undefined, HOST);
    expect(tpl.kind).toBe(1);
    expect(tpl.tags).toEqual([
      ['e', NOTE, '', 'root'],
      ['p', HOST]
    ]);
    expect(tpl.tags.some((t) => t[0] === 'a')).toBe(false);
  });

  it('marks a reply to a message as "reply" and tags its author once', () => {
    const tpl = chatTemplate(
      NOTE,
      'agreed',
      { id: '2'.repeat(64), pubkey: STREAMER },
      undefined,
      HOST
    );
    expect(tpl.tags).toEqual([
      ['e', NOTE, '', 'root'],
      ['p', HOST],
      ['e', '2'.repeat(64), '', 'reply'],
      ['p', STREAMER]
    ]);
  });

  it('refuses a note target without its author', () => {
    expect(() => chatTemplate(NOTE, 'hi')).toThrow('Invalid chat message');
  });

  it('accepts kind 1 replies to the note, not the note itself, kind 1311, or other notes', () => {
    const model = new ChatMessages(NOTE);
    expect(model.accept(reply(), verify)).toBe(true);
    expect(model.accept(reply({ id: NOTE, pubkey: HOST }), verify)).toBe(false);
    expect(model.accept(reply({ id: '3'.repeat(64), kind: 1311 }), verify)).toBe(false);
    expect(
      model.accept(
        chatEvent({ id: '4'.repeat(64), kind: 1, tags: [['e', '8'.repeat(64)]] }),
        verify
      )
    ).toBe(false);
    expect(model.size).toBe(1);
  });

  it('does not take the root e tag for a parent', () => {
    expect(chatReplyParent(reply(), NOTE)).toBeNull();
    const nested = reply({}, [
      ['e', '2'.repeat(64), '', 'reply'],
      ['p', STREAMER]
    ]);
    expect(chatReplyParent(nested, NOTE)).toEqual({ id: '2'.repeat(64), pubkey: STREAMER });
  });
});
