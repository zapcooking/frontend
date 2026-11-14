<script lang="ts">
  /**
   * Report a Go live stream, or one comment in its chat. The report goes
   * into the admin review queue (/admin/reads-moderation) with the
   * session's link, so the admin can open the stream and end it from
   * /api/admin/live. No picture is captured. A comment report carries the
   * comment's event id and author.
   */
  import Modal from '../Modal.svelte';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import { showToast } from '$lib/toast';
  import { submitReadsReport } from '$lib/reads/moderationClient';

  export let sessionId: string;
  export let hostPubkey: string;
  export let title: string;
  /** Report this comment instead of the stream. */
  export let comment: { id: string; pubkey: string } | null = null;
  /** Show the "Report this stream" button (off when opened by the chat). */
  export let trigger = true;
  export let open = false;

  type Reason = 'nsfw' | 'spam' | 'other';
  const REASONS: { id: Reason; label: string }[] = [
    { id: 'nsfw', label: 'Nudity or sexual content' },
    { id: 'spam', label: 'Spam or a scam' },
    { id: 'other', label: 'Something else' }
  ];

  let reason: Reason = 'nsfw';
  let note = '';
  let sending = false;

  function details(): string {
    const link = `${location.origin}/live/s/${sessionId}`;
    const what = comment ? `Comment on live stream ${link}` : `Live stream ${link}`;
    const text = [what, `"${title}"`, note.trim()].filter(Boolean).join(' — ');
    return text.slice(0, 500);
  }

  async function submit() {
    if (sending) return;
    sending = true;
    const result = await submitReadsReport(
      comment
        ? { eventId: comment.id, pubkey: comment.pubkey, reason, details: details() }
        : { pubkey: hostPubkey, reason, details: details() }
    );
    sending = false;
    if (result.ok) {
      open = false;
      note = '';
      showToast('success', 'Thanks. The report was sent for review.');
    } else {
      showToast(
        'error',
        result.error === 'rate_limited'
          ? 'Too many reports from here. Please try again in a few minutes.'
          : 'The report could not be sent. Check your connection and try again.'
      );
    }
  }
</script>

{#if trigger}<button
    type="button"
    class="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    on:click={() => (open = true)}
  >
    <FlagIcon class="h-3.5 w-3.5" />
    Report this stream
  </button>{/if}

<Modal bind:open compact autoHeight>
  <h2 slot="title">{comment ? 'Report this comment' : 'Report this stream'}</h2>
  <form class="flex flex-col gap-3" on:submit|preventDefault={submit}>
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1 text-sm" style="color: var(--color-caption);">What is wrong?</legend>
      {#each REASONS as r (r.id)}
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="live-report-reason" value={r.id} bind:group={reason} />
          {r.label}
        </label>
      {/each}
    </fieldset>
    <label class="flex flex-col gap-1 text-sm">
      <span style="color: var(--color-caption);">Anything else? (optional)</span>
      <textarea bind:value={note} rows="3" maxlength="300" class="input"></textarea>
    </label>
    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="rounded-full px-4 py-2 text-sm"
        style="color: var(--color-text-primary);"
        on:click={() => (open = false)}>Cancel</button
      >
      <button
        type="submit"
        class="rounded-full bg-action px-4 py-2 text-sm text-on-action hover:opacity-90 disabled:opacity-50"
        disabled={sending}
      >
        {sending ? 'Sending…' : 'Send report'}
      </button>
    </div>
  </form>
</Modal>
