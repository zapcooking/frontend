<script lang="ts">
  /**
   * "Save your backup key" gate, shared by every path that leads to passkey
   * enrollment: signup (LoginOverlay), the login-time prompt, and Settings.
   * Renders the nsec (masked until revealed) with copy, the npub with copy,
   * and the backup-file download; dispatches `satisfied` once the user has
   * downloaded the file, completed a verified clipboard copy, or — only when
   * `allowAcknowledge` — ticked that they already hold a backup. Un-ticking
   * that box dispatches `unsatisfied` when it was the only save.
   *
   * Decision logic lives in backupGateSatisfied() (unit-tested); this file
   * is presentation only. The gate must run BEFORE enrollVault so the
   * plaintext key is still present if the user bails.
   */
  import { createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import Button from './Button.svelte';
  import { showToast } from '$lib/toast';
  import { hexToBytes } from '$lib/passkeyVaultCrypto';
  import { backupGateSatisfied, downloadKeysBackupFile } from '$lib/keyBackupGate';

  /** Session private key, 64-char hex. */
  export let nsecHex: string;
  /** Bech32 npub of the same key. */
  export let npub: string;
  /** Let an existing user self-attest an existing backup. NEVER true at signup. */
  export let allowAcknowledge = false;

  const dispatch = createEventDispatcher<{ satisfied: void; unsatisfied: void }>();

  let showPrivateKey = false;
  let downloaded = false;
  let copiedVerified = false;
  let acknowledged = false;
  let wasSatisfied = false;

  $: nsec = nsecHex ? nip19.nsecEncode(hexToBytes(nsecHex)) : '';
  $: satisfied = backupGateSatisfied({
    downloaded,
    copiedVerified,
    acknowledged,
    allowAcknowledge
  });
  $: if (satisfied !== wasSatisfied) {
    wasSatisfied = satisfied;
    dispatch(satisfied ? 'satisfied' : 'unsatisfied');
  }

  // Returns whether the write actually landed — a rejected clipboard write
  // must not count as a saved key.
  async function copyToClipboard(text: string): Promise<boolean> {
    if (!browser) return false;
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied');
      return true;
    } catch {
      showToast('error', 'Could not copy — select the text and copy it manually');
      return false;
    }
  }

  async function copyNsec() {
    if (await copyToClipboard(nsec)) copiedVerified = true;
  }

  function download() {
    if (downloadKeysBackupFile(nsec, npub)) downloaded = true;
  }
</script>

<div class="space-y-4">
  <div>
    <p class="block text-sm font-medium mb-1" style="color: var(--color-text-primary)">
      Backup key (private)
    </p>
    {#if showPrivateKey}
      <div class="flex flex-col sm:flex-row gap-2">
        <textarea
          readonly
          value={nsec}
          rows="2"
          class="flex-1 min-w-0 input text-sm font-mono p-3"
          aria-label="Private key (nsec)"
        ></textarea>
        <button
          type="button"
          on:click={copyNsec}
          class="flex-shrink-0 px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm font-medium transition-colors"
          style="color: var(--color-text-primary)"
        >
          Copy
        </button>
      </div>
      <div class="flex items-center justify-between mt-1.5">
        <p class="text-xs text-amber-600">
          ⚠️ Anyone with this key can control your profile. Never share it.
        </p>
        <button
          type="button"
          on:click={() => (showPrivateKey = false)}
          class="text-xs text-caption hover:opacity-80 underline"
        >
          Hide
        </button>
      </div>
    {:else}
      <div class="flex flex-col sm:flex-row gap-2">
        <div
          class="flex-1 min-w-0 bg-input border rounded-lg p-3 text-sm text-caption font-mono overflow-hidden whitespace-nowrap"
          style="border-color: var(--color-input-border)"
        >
          ••••••••••••••••••••••••••••••••
        </div>
        <button
          type="button"
          on:click={() => (showPrivateKey = true)}
          class="flex-shrink-0 px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm font-medium transition-colors"
          style="color: var(--color-text-primary)"
        >
          Reveal
        </button>
      </div>
      <p class="text-xs text-caption mt-1.5">Reveal to copy and save securely</p>
    {/if}
  </div>

  <div>
    <p class="block text-sm font-medium mb-1" style="color: var(--color-text-primary)">
      Public identity (npub)
    </p>
    <div class="flex flex-col sm:flex-row gap-2">
      <input
        readonly
        value={npub}
        class="flex-1 min-w-0 input text-sm font-mono p-3"
        aria-label="Public key (npub)"
      />
      <button
        type="button"
        on:click={() => copyToClipboard(npub)}
        class="flex-shrink-0 px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm transition-colors"
        style="color: var(--color-text-primary)"
      >
        Copy
      </button>
    </div>
    <p class="text-xs text-caption mt-1.5">This is safe to share - it's your public identity</p>
  </div>

  <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
    <p class="text-sm text-caption">Download a backup file with your keys and safety notes.</p>
    <Button on:click={download} primary={true} class="w-full mt-3">Download backup file</Button>
  </div>

  {#if allowAcknowledge}
    <label class="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" bind:checked={acknowledged} class="mt-0.5" />
      <span class="text-xs text-caption">
        <span class="font-medium" style="color: var(--color-text-primary)">
          I already have my nsec backed up somewhere safe.
        </span>
      </span>
    </label>
  {/if}
</div>
