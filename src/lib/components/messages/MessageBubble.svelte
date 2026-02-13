<script lang="ts">
  import { userPublickey, ndk } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { resolveProfileByPubkey, getDisplayName, type ProfileData } from '$lib/profileResolver';
  import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
  import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpen';

  export let sender: string;
  export let content: string;
  export let created_at: number;
  export let protocol: 'nip17' | 'nip04' = 'nip04';

  $: isMine = sender === $userPublickey;

  // Matches URLs, nostr: identifiers, and bare npub/note/nevent/naddr/nprofile
  const tokenRegex =
    /(https?:\/\/[^\s<]+|nostr:(?:npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+|(?:npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]{6,})/g;

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNpubShort(id: string): string {
    return id.length > 16 ? `${id.slice(0, 10)}...${id.slice(-6)}` : id;
  }

  // Profile resolution for npub/nprofile mentions
  let resolvedNames: Record<string, string> = {};

  function extractPubkeys(text: string): Array<{ pubkey: string; identifier: string }> {
    const results: Array<{ pubkey: string; identifier: string }> = [];
    const regex = new RegExp(tokenRegex.source, tokenRegex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const raw = match[0];
      if (raw.startsWith('http')) continue;
      const identifier = raw.startsWith('nostr:') ? raw.slice(6) : raw;
      try {
        const decoded = nip19.decode(identifier);
        if (decoded.type === 'npub') results.push({ pubkey: decoded.data, identifier });
        else if (decoded.type === 'nprofile')
          results.push({ pubkey: decoded.data.pubkey, identifier });
      } catch {}
    }
    return results;
  }

  async function resolveProfileNames(text: string) {
    const entries = extractPubkeys(text);
    if (entries.length === 0) return;
    const names: Record<string, string> = {};
    await Promise.all(
      entries.map(async ({ pubkey, identifier }) => {
        try {
          const profile = await resolveProfileByPubkey(pubkey, $ndk);
          const name = getDisplayName(profile);
          if (name && name !== 'Anonymous') names[identifier] = name;
        } catch {}
      })
    );
    if (Object.keys(names).length > 0) {
      resolvedNames = { ...resolvedNames, ...names };
    }
  }

  $: resolveProfileNames(content);

  // Pill style adapts to bubble context
  $: pillClass = isMine ? 'msg-pill-sent' : 'msg-pill-received';

  // Reactive HTML — re-renders when resolvedNames updates
  $: renderedHtml = linkify(content, pillClass, resolvedNames);

  function renderNostrToken(raw: string, pillCls: string): string {
    const identifier = raw.startsWith('nostr:') ? raw.slice(6) : raw;
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === 'npub' || decoded.type === 'nprofile') {
        const name = resolvedNames[identifier];
        const label =
          '@' +
          (name ||
            formatNpubShort(
              identifier.startsWith('npub')
                ? identifier
                : nip19.npubEncode(decoded.type === 'nprofile' ? decoded.data.pubkey : decoded.data)
            ));
        const href = `/user/${identifier}`;
        return `<a href="${href}" class="mention-pill ${pillCls}" style="cursor: pointer; text-decoration: none;">${escapeHtml(label)}</a>`;
      }
      if (decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr') {
        const label = formatNpubShort(identifier);
        const href = `/${identifier}`;
        return `<a href="${href}" class="mention-pill ${pillCls}" style="cursor: pointer; text-decoration: none;">${escapeHtml(label)}</a>`;
      }
    } catch {}
    return escapeHtml(raw);
  }

  function linkify(text: string, pillCls: string, _names: Record<string, string>): string {
    const parts = text.split(tokenRegex);
    return parts
      .map((part, i) => {
        if (i % 2 === 1) {
          if (part.startsWith('http')) {
            const escaped = escapeHtml(part);
            return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="underline break-all" style="color: inherit;">${escaped}</a>`;
          }
          return renderNostrToken(part, pillCls);
        }
        return escapeHtml(part);
      })
      .join('');
  }
  $: protocolTip =
    protocol === 'nip17' ? 'Private — metadata hidden' : 'Compatible — metadata visible';

  $: timeString = formatTime(created_at);

  function formatTime(ts: number): string {
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const oneDay = 86400000;

    if (diff < oneDay && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 7 * oneDay) {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="flex {isMine ? 'justify-end' : 'justify-start'} mb-2">
  <div
    class="max-w-[75%] rounded-2xl px-4 py-2.5 {isMine ? 'rounded-br-md' : 'rounded-bl-md'}"
    style={isMine
      ? protocol === 'nip17'
        ? 'background-color: rgba(124, 58, 237, 0.85); color: #ffffff;'
        : 'background-color: var(--color-primary); color: #ffffff;'
      : protocol === 'nip17'
        ? 'background-color: rgba(124, 58, 237, 0.12); color: var(--color-text-primary);'
        : 'background-color: var(--color-input-bg); color: var(--color-text-primary);'}
  >
    <p class="text-sm whitespace-pre-wrap break-words">{@html renderedHtml}</p>
    <p
      class="text-[10px] mt-1 {isMine ? 'text-right' : 'text-left'}"
      style={isMine ? 'color: rgba(255,255,255,0.7);' : 'color: var(--color-caption);'}
    >
      {timeString}
      <span class="inline-flex items-center gap-px ml-1" title={protocolTip}>
        {#if protocol === 'nip17'}
          <LockSimpleIcon
            class="w-2.5 h-2.5"
            weight="bold"
            style="color: rgba(167, 139, 250, 0.8);"
          />
        {:else}
          <LockSimpleOpenIcon
            class="w-2.5 h-2.5"
            weight="bold"
            style="color: rgba(249, 115, 22, 0.6);"
          />
        {/if}
      </span>
    </p>
  </div>
</div>

<style>
  /* Sent bubble pills — white on translucent white */
  :global(.msg-pill-sent) {
    background: rgba(255, 255, 255, 0.2) !important;
    color: #ffffff !important;
  }
  /* Received bubble pills — default orange mention-pill style (inherited from global) */
</style>
