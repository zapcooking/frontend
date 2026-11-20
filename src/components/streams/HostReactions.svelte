<script lang="ts">
  /**
   * Viewers' reactions, floating up over the host's own preview — the
   * same hearts viewers see, on the host's screen only (drawn over the
   * preview, never into the broadcast). Receive-only: the host has no
   * like button.
   *
   * Listens on both the "Live now" note and the stream's address, so a
   * stream with the note switched off still shows reactions.
   */
  import { onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { ndk } from '$lib/nostr';
  import { openReactionFeed } from '$lib/streams/liveReactionFeed';
  import { goLiveAddress, hasTargets, targetsKey } from '$lib/streams/liveReactions';
  import ReactionHearts from './ReactionHearts.svelte';

  export let sessionId: string;
  export let hostPubkey: string;
  /** The "Live now" note id, once it exists. */
  export let noteId: string | null = null;
  /** Off: nothing is drawn (the host's zap animations switch). */
  export let show = true;
  /** Start height, clear of the stage's control bar. */
  export let bottom = '5rem';

  let layer: ReactionHearts | null = null;
  let stop: (() => void) | null = null;
  let openKey = '';

  $: targets = { e: noteId, a: goLiveAddress(hostPubkey, sessionId) };
  $: reopen(targetsKey(targets), sessionId);

  // The subscription stays open while the switch is off, so turning it
  // back on shows reactions at once.
  function reopen(key: string, session: string) {
    const next = `${session}|${key}`;
    if (!browser || next === openKey) return;
    openKey = next;
    stop?.();
    stop = null;
    if (!hasTargets(targets)) return;
    stop = openReactionFeed({
      ndk: $ndk,
      targets,
      sessionId: session,
      onReaction: (reaction) => {
        if (show && !document.hidden) layer?.spawn(reaction);
      }
    });
  }

  onDestroy(() => {
    stop?.();
    stop = null;
  });
</script>

{#if show}
  <ReactionHearts bind:this={layer} {bottom} />
{/if}
