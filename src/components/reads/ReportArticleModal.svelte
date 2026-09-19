<script lang="ts">
  import Modal from '../Modal.svelte';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import { showToast } from '$lib/toast';
  import { submitReadsReport } from '$lib/reads/moderationClient';

  export let open = false;
  export let pubkey = '';
  export let eventId = '';
  export let naddr = '';

  type ReportReason = 'nsfw' | 'spam' | 'other';

  let reason: ReportReason = 'nsfw';
  let details = '';
  let submitting = false;

  $: if (open) {
    reason = 'nsfw';
    details = '';
    submitting = false;
  }

  async function submit() {
    if (submitting) return;
    submitting = true;
    const result = await submitReadsReport({
      pubkey,
      eventId,
      naddr,
      reason,
      details: details.trim() || undefined
    });
    submitting = false;
    if (!result.ok) {
      showToast(
        'error',
        result.error === 'rate_limited'
          ? 'Too many reports right now — try again later.'
          : "Couldn't send the report. Please try again."
      );
      return;
    }
    open = false;
    showToast('success', 'Thanks — we received your report.');
  }
</script>

<Modal bind:open compact autoHeight>
  <div class="flex flex-col gap-4 p-1">
    <div class="flex items-center gap-2">
      <FlagIcon size={20} />
      <h2 class="text-lg font-semibold" style="color: var(--color-text-primary);">Report article</h2>
    </div>
    <p class="text-sm" style="color: var(--color-text-secondary);">
      Flag this for review. Reports go to the same queue as automated NSFW/spam filters.
    </p>
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium mb-1" style="color: var(--color-text-primary);">Reason</legend>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" bind:group={reason} value="nsfw" />
        NSFW / sexual content
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" bind:group={reason} value="spam" />
        Spam or scam
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="radio" bind:group={reason} value="other" />
        Other
      </label>
    </fieldset>
    <label class="flex flex-col gap-1 text-sm">
      <span style="color: var(--color-text-secondary);">Details (optional)</span>
      <textarea
        bind:value={details}
        maxlength="500"
        rows="3"
        class="w-full rounded-lg px-3 py-2 text-sm"
        style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
        placeholder="Anything that helps us review this"
      ></textarea>
    </label>
    <div class="flex justify-end gap-2">
      <button
        class="px-4 py-2 rounded-full text-sm"
        style="color: var(--color-text-secondary);"
        on:click={() => (open = false)}
        disabled={submitting}
      >
        Cancel
      </button>
      <button
        class="px-4 py-2 rounded-full text-sm text-white bg-primary hover:opacity-90 disabled:opacity-50"
        on:click={submit}
        disabled={submitting}
      >
        {submitting ? 'Sending…' : 'Submit report'}
      </button>
    </div>
  </div>
</Modal>
