<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { formatDistanceToNow } from 'date-fns';
  import { formatSats } from '$lib/utils';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import NoteContent from './NoteContent.svelte';

  export let event: NDKEvent;
  export let engagementData: {
    zaps: { totalAmount: number; count: number };
    reactions: { count: number };
    comments: { count: number };
  };
  export let format: 'square' | 'landscape' = 'square';
  export let showQR: boolean = true;

  $: noteId = nip19.noteEncode(event.id);
  $: noteUrl = `https://zap.cooking/${noteId}`;
  $: timestamp = event.created_at 
    ? formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })
    : 'Unknown time';
  $: zapAmount = engagementData.zaps.totalAmount / 1000; // Convert millisats to sats
  $: hasZaps = zapAmount > 0;
  $: hasReactions = engagementData.reactions.count > 0;
  $: hasComments = engagementData.comments.count > 0;

  // Truncate content if too long (for square format, limit to ~500 chars)
  $: maxContentLength = format === 'square' ? 500 : 800;
  $: displayContent = event.content.length > maxContentLength
    ? event.content.substring(0, maxContentLength) + '...'
    : event.content;
</script>

<div
  class="share-note-card {format}"
  style="
    width: {format === 'square' ? '1080px' : '1200px'};
    height: {format === 'square' ? '1080px' : '675px'};
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
    color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    padding: 60px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  "
>
  <!-- Background decoration -->
  <div
    style="
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(251, 191, 36, 0.1) 0%, transparent 70%);
      pointer-events: none;
    "
  ></div>

  <!-- Header with avatar and name -->
  <div
    style="
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 30px;
      z-index: 1;
    "
  >
    <div style="flex-shrink: 0;">
      <CustomAvatar pubkey={event.author?.hexpubkey || event.pubkey} size={64} />
    </div>
    <div style="flex: 1; min-width: 0;">
      <div style="font-size: 28px; font-weight: 600; margin-bottom: 4px; line-height: 1.2;">
        <CustomName pubkey={event.author?.hexpubkey || event.pubkey} />
      </div>
      <div style="font-size: 18px; color: #9ca3af; font-weight: 400;">
        {timestamp}
      </div>
    </div>
  </div>

  <!-- Note content -->
  <div
    style="
      flex: 1;
      font-size: 32px;
      line-height: 1.6;
      color: #f3f4f6;
      margin-bottom: 30px;
      overflow: hidden;
      z-index: 1;
      word-wrap: break-word;
      white-space: pre-wrap;
    "
  >
    <NoteContent content={displayContent} />
  </div>

  <!-- Engagement metrics bar -->
  <div
    style="
      display: flex;
      align-items: center;
      gap: 40px;
      padding: 20px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 1;
    "
  >
    {#if hasZaps}
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 32px;">⚡</span>
        <div>
          <div style="font-size: 24px; font-weight: 600; line-height: 1.2;">
            {formatSats(Math.floor(zapAmount))} sats
          </div>
          <div style="font-size: 16px; color: #9ca3af;">
            {engagementData.zaps.count} {engagementData.zaps.count === 1 ? 'zap' : 'zaps'}
          </div>
        </div>
      </div>
    {/if}
    
    {#if hasReactions}
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 32px;">💜</span>
        <div>
          <div style="font-size: 24px; font-weight: 600; line-height: 1.2;">
            {engagementData.reactions.count}
          </div>
          <div style="font-size: 16px; color: #9ca3af;">reactions</div>
        </div>
      </div>
    {/if}
    
    {#if hasComments}
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 32px;">💬</span>
        <div>
          <div style="font-size: 24px; font-weight: 600; line-height: 1.2;">
            {engagementData.comments.count}
          </div>
          <div style="font-size: 16px; color: #9ca3af;">comments</div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Footer with branding and QR code -->
  <div
    style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      z-index: 1;
    "
  >
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="font-size: 20px; font-weight: 600; color: #fbbf24;">
        zap.cooking
      </div>
      <div style="font-size: 16px; color: #9ca3af;">
        Shared via zap.cooking
      </div>
    </div>
    
    {#if showQR}
      <div
        id="qr-code-container"
        style="
          width: 120px;
          height: 120px;
          background: white;
          padding: 8px;
          border-radius: 8px;
        "
      >
        <!-- QR code will be generated here -->
      </div>
    {/if}
  </div>
</div>

<style>
  :global(.share-note-card) {
    /* Ensure fonts are loaded */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }
</style>
