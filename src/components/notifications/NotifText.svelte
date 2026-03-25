<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import CustomName from '../CustomName.svelte';

  export let text: string = '';

  type Segment =
    | { type: 'text'; value: string }
    | { type: 'mention'; pubkey: string }
    | { type: 'ref'; label: string };

  const NOSTR_REF_PATTERN = /nostr:((?:npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]+)/gi;

  const IMAGE_URL_PATTERN =
    /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?/gi;
  const IMAGE_HOST_PATTERN =
    /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/gi;
  // Negative lookbehind ensures we don't strip bech32 inside nostr: URIs
  const BARE_BECH32_PATTERN =
    /(?<!nostr:)\b(?:note1|nevent1|naddr1|npub1|nprofile1)[023456789ac-hj-np-z]{20,}\b/gi;

  function decodePubkey(bech32: string): string | null {
    try {
      const decoded = nip19.decode(bech32);
      if (decoded.type === 'npub') return decoded.data as string;
      if (decoded.type === 'nprofile') return (decoded.data as { pubkey: string }).pubkey;
    } catch {}
    return null;
  }

  function parse(input: string): Segment[] {
    if (!input) return [];

    // Clean image URLs and bare bech32 before parsing
    let cleaned = input
      .replace(IMAGE_URL_PATTERN, '')
      .replace(IMAGE_HOST_PATTERN, '')
      .replace(BARE_BECH32_PATTERN, '')
      .replace(/\s+/g, ' ')
      .trim();

    const segments: Segment[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state
    NOSTR_REF_PATTERN.lastIndex = 0;

    while ((match = NOSTR_REF_PATTERN.exec(cleaned)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', value: cleaned.substring(lastIndex, match.index) });
      }

      const ref = match[1];
      if (ref.startsWith('npub1') || ref.startsWith('nprofile1')) {
        const pubkey = decodePubkey(ref);
        if (pubkey) {
          segments.push({ type: 'mention', pubkey });
        } else {
          segments.push({ type: 'text', value: '@someone' });
        }
      } else if (ref.startsWith('naddr1')) {
        segments.push({ type: 'ref', label: 'a recipe' });
      } else {
        segments.push({ type: 'ref', label: 'a post' });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < cleaned.length) {
      segments.push({ type: 'text', value: cleaned.substring(lastIndex) });
    }

    return segments;
  }

  $: segments = parse(text);
</script>

{#each segments as seg, i (i)}{#if seg.type === 'text'}{seg.value}{:else if seg.type === 'mention'}<span class="notif-mention">@<CustomName pubkey={seg.pubkey} /></span>{:else if seg.type === 'ref'}<span class="notif-ref">{seg.label}</span>{/if}{/each}

<style>
  .notif-mention {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .notif-ref {
    font-style: italic;
  }
</style>
