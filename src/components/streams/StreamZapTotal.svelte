<script lang="ts">
  /**
   * Zap bolt + tally for a stream.
   *
   * The zap target is the HOST (the announcement's `p` tag marked `host`),
   * not the announcement's author — streams are usually published by a
   * service account. The zap request carries the `a` coordinate instead of
   * an event id, so receipts land with the `#a` tag every NIP-53 client
   * (zap.stream included) scans.
   *
   * A Go live session has no announcement. With its "Live now" note
   * (`noteId`) the zap targets the note, an `e` tag, so receipts can be
   * counted for the total; without a note it is a plain zap to the host's
   * profile, with no running total.
   */
  import { createEventDispatcher } from 'svelte';
  import { get } from 'svelte/store';
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import ZapModal from '../ZapModal.svelte';

  export let address: string | null;
  /** Go live: the "Live now" note's id, zapped instead of the profile. */
  export let noteId: string | null = null;
  /**
   * Go live: the note is expected but its id is not known yet. The button
   * waits ("Loading…") rather than silently zapping the profile.
   */
  export let notePending = false;
  /** Go live: a session with no note at all (switch off). Says so on the button. */
  export let goLive = false;
  export let hostPubkey: string;
  /** Host's lud16 resolved by the player — skips the profile resolver. */
  export let hostLud16: string | null = null;
  export let sats = 0;
  export let count = 0;
  export let loading = false;

  const dispatch = createEventDispatcher<{ zapComplete: { amount: number } }>();

  let zapOpen = false;

  $: hostUser = hostPubkey ? new NDKUser({ pubkey: hostPubkey }) : null;
  // The note as an event the zap modal can target (id + author is enough).
  $: noteEvent =
    noteId && hostPubkey
      ? new NDKEvent(get(ndk), {
          kind: 1,
          id: noteId,
          pubkey: hostPubkey,
          content: '',
          tags: [],
          created_at: 0
        })
      : null;

  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  }

  function onComplete(e: CustomEvent<{ amount: number }>) {
    dispatch('zapComplete', { amount: e.detail.amount });
  }
</script>

<div class="flex items-center gap-1.5">
  {#if hostUser}
    <button
      type="button"
      class="flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1.5 text-sm font-semibold text-amber-500 hover:bg-amber-500/25 disabled:cursor-wait disabled:opacity-60"
      on:click={() => (zapOpen = true)}
      disabled={notePending && !noteId}
      aria-label={notePending && !noteId
        ? 'Zap: loading'
        : goLive && !noteId
          ? 'Zap the host (this stream has no Live now note)'
          : 'Zap this stream'}
      title={notePending && !noteId
        ? 'Waiting for the Live now note'
        : goLive && !noteId
          ? 'Zap the host (no Live now note, so no total)'
          : 'Zap this stream'}
    >
      <LightningIcon class="h-4 w-4" weight="fill" />
      {#if notePending && !noteId}
        Loading…
      {:else if goLive && !noteId}
        Zap host
      {:else}
        Zap
      {/if}
    </button>

    {#if count > 0}
      <button
        type="button"
        class="text-sm font-semibold text-amber-500 tabular-nums whitespace-nowrap {loading
          ? 'opacity-60'
          : ''}"
        on:click={() => (zapOpen = true)}
        title={'⚡ ' +
          sats.toLocaleString() +
          ' sats across ' +
          count.toLocaleString() +
          (count === 1 ? ' zap' : ' zaps')}
      >
        ⚡ {compact(sats)} sats · {count.toLocaleString()}
        {count === 1 ? 'zap' : 'zaps'}
      </button>
    {/if}
  {/if}
</div>

{#if hostUser}
  <ZapModal
    bind:open={zapOpen}
    event={noteEvent ?? hostUser}
    addressTag={noteEvent ? undefined : (address ?? undefined)}
    on:zap-complete={onComplete}
  />
{/if}
