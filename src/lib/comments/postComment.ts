/**
 * postComment — spec-grounded NIP-22/NIP-10 comment publication.
 *
 * Responsibilities:
 *  - Detect parent type (addressable → NIP-22 kind 1111, regular → NIP-10 kind 1).
 *  - Delegate tag-building to `buildNip22CommentTags` (already spec-compliant
 *    for the cases this project handles; see its JSDoc + NIP-22 / NIP-10).
 *  - Merge caller-supplied extra tags (@-mention p-tags, poll tags) without
 *    creating duplicate p-tags.
 *  - Append the NIP-89 client tag via the existing `addClientTagToEvent`.
 *  - Sign + publish per the requested strategy; surface typed errors.
 *
 * Out of scope (Stage 5 unifies, Stage 3 owns composer UI):
 *  - Unifying signing strategies across callers
 *  - Replacing alert() with toast UI
 *  - Contenteditable / mention autocomplete wiring
 *  - Media upload handlers
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, type NDKRelay } from '@nostr-dev-kit/ndk';
import { buildNip22CommentTags } from '$lib/tagUtils';
import { addClientTagToEvent } from '$lib/nip89';
import { isAddressableRoot } from '$lib/commentFilters';
import { buildInboxAwareRelaySet } from '$lib/nip65Routing';

export type SigningStrategy = 'explicit-with-timeout' | 'implicit';

export type PostCommentErrorCode =
  | 'sign-failed'
  | 'publish-timeout'
  | 'publish-failed'
  | 'invalid-parent';

export interface PostCommentErrorOptions {
  cause?: unknown;
  /**
   * Populated for `publish-timeout` / `publish-failed` when the event was
   * signed (has a valid `.id` and `.sig`) but the relay round-trip failed.
   * Callers that want partial-success recovery can inspect the event.
   */
  signedEvent?: NDKEvent;
}

export class PostCommentError extends Error {
  readonly code: PostCommentErrorCode;
  readonly cause?: unknown;
  readonly signedEvent?: NDKEvent;

  constructor(code: PostCommentErrorCode, message: string, options?: PostCommentErrorOptions) {
    super(message);
    this.name = 'PostCommentError';
    this.code = code;
    this.cause = options?.cause;
    this.signedEvent = options?.signedEvent;
  }
}

export interface PostCommentOptions {
  /**
   * The root event being commented on. If `replyTo` is omitted, this is
   * also the parent (top-level comment).
   */
  parentEvent: NDKEvent;

  /**
   * Plaintext comment content — already post-processed by the caller
   * (mention substitution, media-URL append).
   */
  content: string;

  /**
   * Optional parent comment when replying to an existing comment. When
   * present, tag-building uses `parentEvent` as the root-scope source
   * and `replyTo` as the parent-scope source.
   */
  replyTo?: NDKEvent;

  /**
   * Extra tags merged after tag-building (e.g., @-mention `p`-tags
   * parsed from content, poll tags from `buildPollTags`). `p`-tags are
   * deduped against tags already present.
   */
  extraTags?: string[][];

  /**
   * For content variants (e.g., polls as kind 1068) where the thread
   * structure follows NIP-22/NIP-10 but the published kind number
   * reflects content type. If omitted, kind is derived per NIP-22/NIP-10
   * rules (1111 for addressable roots or kind-1111-parent replies, 1 otherwise).
   */
  contentKind?: number;

  /** Default: 'explicit-with-timeout'. */
  signingStrategy?: SigningStrategy;

  /**
   * Publish timeout in ms. Applies only to 'explicit-with-timeout'.
   * Default: 30_000.
   */
  publishTimeoutMs?: number;
}

export interface PostCommentResult {
  /** The signed, published event. Has `.id`, `.sig`, `.pubkey`. */
  event: NDKEvent;

  /**
   * URLs of relays that accepted the publish. May be empty when NDK
   * reports publish without per-relay details.
   */
  publishedRelays: string[];
}

const DEFAULT_PUBLISH_TIMEOUT_MS = 30_000;

function deriveKind(parent: NDKEvent, replyTo: NDKEvent | undefined): number {
  // Addressable root (with `d` tag per NIP-01) → NIP-22 comment.
  // The `isAddressableRoot` predicate is shared with `createCommentFilter`
  // so the published kind always matches what the subscription will fetch.
  if (isAddressableRoot(parent)) return 1111;
  // Parent is itself a NIP-22 comment → reply stays kind 1111.
  if (replyTo && replyTo.kind === 1111) return 1111;
  if (!replyTo && parent.kind === 1111) return 1111;
  // Otherwise plain NIP-10 kind-1 reply.
  return 1;
}

/**
 * Normalize the `ev.publish()` return into a plain `string[]` of relay URLs.
 * NDK's current typing is `Promise<Set<NDKRelay>>`, but we defend against
 * future return-shape changes (string elements, undefined, etc.) to keep
 * the public `PostCommentResult.publishedRelays` contract stable.
 */
function extractRelayUrls(relaySet: Set<NDKRelay> | undefined): string[] {
  if (!relaySet) return [];
  const urls: string[] = [];
  for (const entry of relaySet) {
    if (typeof entry === 'string') {
      urls.push(entry);
    } else if (entry && typeof (entry as NDKRelay).url === 'string') {
      urls.push((entry as NDKRelay).url);
    }
  }
  return urls;
}

function mergeExtraTags(base: string[][], extras: string[][] | undefined): string[][] {
  if (!extras || extras.length === 0) return base;
  const out = [...base];
  for (const tag of extras) {
    if (tag[0] === 'p') {
      const exists = out.some((t) => t[0] === 'p' && t[1] === tag[1]);
      if (exists) continue;
    }
    out.push(tag);
  }
  return out;
}

export async function postComment(
  ndk: NDK,
  options: PostCommentOptions
): Promise<PostCommentResult> {
  const { parentEvent, content, replyTo, extraTags, contentKind } = options;
  const signingStrategy = options.signingStrategy ?? 'explicit-with-timeout';
  const publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;

  if (!parentEvent?.id || !parentEvent?.pubkey) {
    throw new PostCommentError(
      'invalid-parent',
      'parentEvent is missing id or pubkey'
    );
  }

  const ev = new NDKEvent(ndk);
  ev.kind = contentKind ?? deriveKind(parentEvent, replyTo);
  ev.content = content;

  // Tag-building delegates to the existing spec-compliant utility.
  const rootInput = {
    kind: parentEvent.kind ?? 1,
    pubkey: parentEvent.author?.pubkey || parentEvent.pubkey,
    id: parentEvent.id,
    tags: parentEvent.tags as string[][]
  };
  const parentInput = replyTo
    ? {
        id: replyTo.id,
        pubkey: replyTo.pubkey,
        kind: replyTo.kind,
        tags: replyTo.tags as string[][]
      }
    : undefined;
  const baseTags = buildNip22CommentTags(rootInput, parentInput);
  ev.tags = mergeExtraTags(baseTags, extraTags);
  addClientTagToEvent(ev);

  if (signingStrategy === 'explicit-with-timeout') {
    // Ensure created_at is set before signing.
    if (!ev.created_at) ev.created_at = Math.floor(Date.now() / 1000);

    try {
      await ev.sign();
    } catch (e) {
      throw new PostCommentError('sign-failed', 'Failed to sign comment event', {
        cause: e
      });
    }
    if (!ev.id) {
      throw new PostCommentError('sign-failed', 'Event was not signed — no id');
    }

    // NIP-65 inbox routing — fan out to the parent author's (and any
    // additional p-tagged users') read relays so the comment lands in
    // their inbox. Falls back to the NDK pool when no recipient has
    // published a kind:10002.
    const inboxRelaySet =
      (await buildInboxAwareRelaySet({ event: ev, ndk })) ?? undefined;

    let relaySet: Set<NDKRelay> | undefined;
    try {
      relaySet = await Promise.race([
        ev.publish(inboxRelaySet),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Publish timeout after ${publishTimeoutMs}ms`)),
            publishTimeoutMs
          )
        )
      ]);
    } catch (e) {
      const timedOut = e instanceof Error && e.message.startsWith('Publish timeout');
      throw new PostCommentError(
        timedOut ? 'publish-timeout' : 'publish-failed',
        timedOut ? `Publish timed out after ${publishTimeoutMs}ms` : 'Publish failed',
        { cause: e, signedEvent: ev }
      );
    }

    return { event: ev, publishedRelays: extractRelayUrls(relaySet) };
  }

  // 'implicit' — no explicit sign, no timeout. NDK signs internally,
  // but we can still pre-build an inbox-aware relay set since the event
  // tags (which we built above) already determine recipients.
  try {
    const inboxRelaySet =
      (await buildInboxAwareRelaySet({ event: ev, ndk })) ?? undefined;
    const relaySet = await ev.publish(inboxRelaySet);
    return { event: ev, publishedRelays: extractRelayUrls(relaySet) };
  } catch (e) {
    throw new PostCommentError('publish-failed', 'Publish failed', {
      cause: e,
      signedEvent: ev.id ? ev : undefined
    });
  }
}
