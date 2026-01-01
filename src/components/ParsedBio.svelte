<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';

  export let text: string = '';
  export let class_: string = '';

  interface BioSegment {
    type: 'text' | 'url' | 'nostr';
    content: string;
    href?: string;
    pubkey?: string;
    displayName?: string;
  }

  let segments: BioSegment[] = [];
  let loading = true;

  // Regex patterns
  const URL_REGEX = /(https?:\/\/[^\s<>"\)]+)/g;
  const NOSTR_REGEX = /(nostr:n(?:pub|profile)1[023456789acdefghjklmnpqrstuvwxyz]+)/g;

  function parseText(input: string): BioSegment[] {
    const result: BioSegment[] = [];

    // Combined regex to match both URLs and nostr links
    const combinedRegex = new RegExp(`(${URL_REGEX.source})|(${NOSTR_REGEX.source})`, 'g');

    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(input)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          content: input.slice(lastIndex, match.index)
        });
      }

      if (match[1]) {
        // URL match
        result.push({
          type: 'url',
          content: match[1],
          href: match[1]
        });
      } else if (match[2]) {
        // Nostr match
        result.push({
          type: 'nostr',
          content: match[2]
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < input.length) {
      result.push({
        type: 'text',
        content: input.slice(lastIndex)
      });
    }

    return result;
  }

  function decodeNostrLink(nostrString: string): { pubkey: string; npub: string } | null {
    try {
      const decoded = nip19.decode(nostrString.replace('nostr:', ''));
      if (decoded.type === 'nprofile') {
        return {
          pubkey: decoded.data.pubkey,
          npub: nip19.npubEncode(decoded.data.pubkey)
        };
      } else if (decoded.type === 'npub') {
        return {
          pubkey: decoded.data as string,
          npub: nostrString.replace('nostr:', '')
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function truncateNpub(npub: string): string {
    if (npub.length <= 16) return npub;
    return `${npub.slice(0, 10)}...${npub.slice(-6)}`;
  }

  async function resolveNostrSegments(segs: BioSegment[]): Promise<BioSegment[]> {
    const resolved = [...segs];

    for (let i = 0; i < resolved.length; i++) {
      const seg = resolved[i];
      if (seg.type === 'nostr') {
        const decoded = decodeNostrLink(seg.content);
        if (decoded) {
          seg.pubkey = decoded.pubkey;
          seg.href = `/user/${decoded.npub}`;

          // Try to fetch profile for display name
          try {
            const user = $ndk.getUser({ pubkey: decoded.pubkey });
            await user.fetchProfile();

            if (user.profile?.nip05) {
              // Use NIP-05 identifier (without domain if it's _@)
              const nip05 = user.profile.nip05;
              seg.displayName = nip05.startsWith('_@') ? nip05.slice(2) : nip05;
            } else if (user.profile?.displayName || user.profile?.name) {
              seg.displayName = user.profile.displayName || user.profile.name;
            } else {
              seg.displayName = truncateNpub(decoded.npub);
            }
          } catch (e) {
            seg.displayName = truncateNpub(decoded.npub);
          }
        }
      }
    }

    return resolved;
  }

  onMount(async () => {
    if (!text) {
      loading = false;
      return;
    }

    // Parse text into segments
    const parsed = parseText(text);

    // Resolve nostr links
    segments = await resolveNostrSegments(parsed);
    loading = false;
  });

  // Re-parse when text changes
  $: if (text) {
    loading = true;
    const parsed = parseText(text);
    resolveNostrSegments(parsed).then(resolved => {
      segments = resolved;
      loading = false;
    });
  }
</script>

<span class={class_}>
  {#if loading}
    <span class="opacity-50">{text}</span>
  {:else}
    {#each segments as segment}
      {#if segment.type === 'text'}
        {segment.content}
      {:else if segment.type === 'url'}
        <a
          href={segment.href}
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary hover:underline"
        >{segment.content.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a>
      {:else if segment.type === 'nostr'}
        <a
          href={segment.href}
          class="text-primary hover:underline"
        >@{segment.displayName || segment.content}</a>
      {/if}
    {/each}
  {/if}
</span>
