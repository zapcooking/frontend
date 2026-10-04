<script lang="ts">
  /**
   * Report a Fresh post (NIP-56, kind 1984): the post and its author, one
   * reason, an optional note. Published through $ndk to the reader's own
   * relays; the feed relay isn't told. "Also mute" (on by default) mutes
   * the author with the app's usual mute. The post is hidden from this
   * session's feed either way.
   */
  import { createEventDispatcher } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { setPubkeyMuted } from '$lib/muteToggle';
  import { publishReport, REPORT_TYPES, type ReportType } from '$lib/freshFeed/social';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import Modal from './Modal.svelte';

  export let open = false;
  export let post: RelayEvent | null = null;

  const dispatch = createEventDispatcher<{ reported: RelayEvent }>();

  let type: ReportType = 'spam';
  let note = '';
  let alsoMute = true;
  let busy = false;
  let error = '';

  $: if (open) error = '';

  async function submit() {
    if (!post || busy || !$userPublickey) return;
    busy = true;
    error = '';
    try {
      await publishReport($ndk, post, type, note);
      if (alsoMute) {
        try {
          await setPubkeyMuted($userPublickey, post.pubkey, true);
        } catch (err) {
          console.error('[Fresh] mute after report failed:', err);
        }
      }
      dispatch('reported', post);
      note = '';
      open = false;
    } catch (err) {
      console.error('[Fresh] report failed:', err);
      error = "Couldn't send the report. Please try again.";
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open compact>
  <h1 slot="title">Report post</h1>
  <form class="flex flex-col gap-4" on:submit|preventDefault={submit}>
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm mb-2" style="color: var(--color-caption)">What's wrong with it?</legend
      >
      {#each REPORT_TYPES as t}
        <label class="flex items-center gap-2 text-sm" style="color: var(--color-text-primary)">
          <input type="radio" bind:group={type} value={t.value} />
          {t.label}
        </label>
      {/each}
    </fieldset>
    <textarea
      bind:value={note}
      rows="2"
      maxlength="500"
      placeholder="Add details (optional)"
      class="w-full px-3 py-2 rounded-lg text-sm"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
    ></textarea>
    <label class="flex items-center gap-2 text-sm" style="color: var(--color-text-primary)">
      <input type="checkbox" bind:checked={alsoMute} />
      Also mute this person
    </label>
    <p class="text-xs" style="color: var(--color-caption)">
      Reports are public Nostr events (NIP-56) sent to your relays.
    </p>
    {#if error}
      <p class="text-sm text-red-500" role="alert">{error}</p>
    {/if}
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="px-4 py-2 rounded-lg text-sm bg-input hover:bg-accent-gray"
        style="color: var(--color-text-primary)"
        on:click={() => (open = false)}>Cancel</button
      >
      <button
        type="submit"
        disabled={busy}
        class="px-4 py-2 rounded-lg text-sm bg-primary text-white disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Report'}
      </button>
    </div>
  </form>
</Modal>
