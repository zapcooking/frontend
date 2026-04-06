<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import CustomName from '../CustomName.svelte';

  export let text: string = '';

  type Segment =
    | { type: 'text'; value: string }
    | { type: 'mention'; pubkey: string }
    | { type: 'ref'; label: string }
    | { type: 'url'; href: string };

  const NOSTR_REF_PATTERN = /nostr:((?:npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]+)/gi;

  const MEDIA_URL_PATTERN =
    /https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif|mp4|webm|mov|ogg)(?:\?[^\s]*)?/gi;
  const MEDIA_HOST_PATTERN =
    /https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth|v\.nostr\.build)[^\s]*/gi;
  const URL_PATTERN = /https?:\/\/[^\s]+/g;
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

    // Clean media URLs and bare bech32 before parsing
    let cleaned = input
      .replace(MEDIA_URL_PATTERN, '')
      .replace(MEDIA_HOST_PATTERN, '')
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

    // Second pass: linkify URLs in text segments
    return segments.flatMap((seg) => {
      if (seg.type !== 'text') return [seg];
      const result: Segment[] = [];
      let pos = 0;
      URL_PATTERN.lastIndex = 0;
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = URL_PATTERN.exec(seg.value)) !== null) {
        if (urlMatch.index > pos) {
          result.push({ type: 'text', value: seg.value.substring(pos, urlMatch.index) });
        }
        result.push({ type: 'url', href: urlMatch[0] });
        pos = urlMatch.index + urlMatch[0].length;
      }
      if (pos < seg.value.length) {
        result.push({ type: 'text', value: seg.value.substring(pos) });
      }
      return result.length > 0 ? result : [seg];
    });
  }

  $: segments = parse(text);
</script>

{#each segments as seg, i (i)}{#if seg.type === 'text'}{seg.value}{:else if seg.type === 'mention'}<span class="notif-mention">@<CustomName pubkey={seg.pubkey} /></span>{:else if seg.type === 'ref'}<span class="notif-ref">{seg.label}</span>{:else if seg.type === 'url'}<a href={seg.href} class="notif-link" target="_blank" rel="noopener noreferrer">{seg.href.replace(/^https?:\/\//, '').split('/')[0]}</a>{/if}{/each}

<style>
  .notif-mention {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .notif-ref {
    font-style: italic;
  }
  .notif-link {
    color: var(--color-link, #f7931a);
    text-decoration: underline;
    text-decoration-color: transparent;
    transition: text-decoration-color 0.15s;
  }
  .notif-link:hover {
    text-decoration-color: currentColor;
  }
</style>
