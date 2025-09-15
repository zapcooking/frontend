<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  export let content: string;
  export let className: string = '';

  // Parse content and create clickable links for URLs and nostr references
  function parseContent(text: string) {
    // Regex to find URLs and nostr references
    const urlRegex = /(https?:\/\/[^\s]+)|nostr:(nevent1|note1|npub1|nprofile1)([023456789acdefghjklmnpqrstuvwxyz]+)/g;
    
    const parts = [];
    let lastIndex = 0;
    let match;
    let keyCounter = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      const [fullMatch, url, nostrPrefix, nostrData] = match;
      const index = match.index;

      // Add text before this match
      if (index > lastIndex) {
        parts.push({
          type: 'text',
          content: text.substring(lastIndex, index),
          key: `text-${keyCounter++}`
        });
      }

      if (url) {
        // Add the URL as a clickable link
        parts.push({
          type: 'url',
          content: fullMatch,
          url: url,
          key: `url-${keyCounter++}`
        });
      } else if (nostrPrefix && nostrData) {
        // Add the nostr reference as a clickable link
        parts.push({
          type: 'nostr',
          content: fullMatch,
          prefix: nostrPrefix,
          data: nostrData,
          key: `nostr-${keyCounter++}`
        });
      }

      lastIndex = index + fullMatch.length;
    }

    // Add any remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex),
        key: `text-${keyCounter++}`
      });
    }

    return parts;
  }

  function handleNostrClick(nostrId: string) {
    // Navigate to the nostr reference
    goto(`/${nostrId}`);
  }

  $: parsedContent = parseContent(content);
</script>

<div class="whitespace-pre-wrap break-words {className}">
  {#each parsedContent as part}
    {#if part.type === 'text'}
      {part.content}
    {:else if part.type === 'url'}
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        class="text-blue-500 hover:text-blue-700 hover:underline break-all"
      >
        {part.content}
      </a>
    {:else if part.type === 'nostr'}
      <button
        class="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
        on:click={() => handleNostrClick(part.content)}
      >
        {part.content}
      </button>
    {/if}
  {/each}
</div>
