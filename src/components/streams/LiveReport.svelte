<script lang="ts">
  /**
   * Report a Go live stream, or one comment in its chat
   * (POST /api/live/<id>/report). The report is stored with the session,
   * opens a report hold (the record is kept until the admin releases it)
   * and DMs the admin. The admin reviews it, ends the stream or blocks the
   * host from /admin/live. No picture is captured. A comment report
   * carries the comment's event id and author.
   */
  import Modal from '../Modal.svelte';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import { showToast } from '$lib/toast';
  import { LIVE_REPORT_DETAILS_MAX, type LiveReportReason } from '$lib/live/config';

  export let sessionId: string;
  /** Report this comment instead of the stream. */
  export let comment: { id: string; pubkey: string } | null = null;
  /** Show the "Report this stream" button (off when opened by the chat). */
  export let trigger = true;
  export let open = false;

  const REASONS: { id: LiveReportReason; label: string }[] = [
    { id: 'child_safety', label: 'A child is at risk or being exploited' },
    { id: 'violence', label: 'Violence or someone in immediate danger' },
    { id: 'nudity', label: 'Nudity or sexual content' },
    { id: 'spam', label: 'Spam or a scam' },
    { id: 'other', label: 'Something else' }
  ];

  let reason: LiveReportReason = 'other';
  let note = '';
  let sending = false;

  async function send(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`/api/live/${sessionId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          details: note.trim().slice(0, LIVE_REPORT_DETAILS_MAX),
          ...(comment ? { comment: { id: comment.id, pubkey: comment.pubkey } } : {})
        })
      });
      if (res.status === 429) return { ok: false, error: 'rate_limited' };
      return res.ok ? { ok: true } : { ok: false, error: 'network' };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  async function submit() {
    if (sending) return;
    sending = true;
    const result = await send();
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
