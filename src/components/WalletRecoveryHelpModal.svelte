<script lang="ts">
  import Modal from './Modal.svelte';
  import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOut';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import KeyIcon from 'phosphor-svelte/lib/Key';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';

  export let open = false;

  function close() {
    open = false;
  }
</script>

<Modal bind:open cleanup={close}>
  <span slot="title">Wallet Recovery</span>

  <div class="flex flex-col gap-6 text-sm" style="color: var(--color-text-primary);">
    <!-- Introduction -->
    <section>
      <p class="leading-relaxed">
        Your wallet uses <strong>Breez Spark</strong>, an open standard for Lightning wallets.
        This means you can recover your funds using your <strong>12-word seed phrase</strong>
        in any compatible wallet.
      </p>
    </section>

    <!-- How it Works -->
    <section>
      <h3 class="font-semibold mb-2 flex items-center gap-2">
        <KeyIcon size={18} />
        How it Works
      </h3>
      <p class="leading-relaxed text-caption">
        Your seed phrase is the master key to your wallet. It's generated when you create
        your wallet and gives you full control over your funds. Because this is a
        <strong>non-custodial wallet</strong>, only you have access to this seed phrase
        — we never store it on our servers.
      </p>
    </section>

    <!-- Compatible Wallets -->
    <section>
      <h3 class="font-semibold mb-2">Compatible Wallets</h3>
      <p class="leading-relaxed text-caption mb-3">
        Your seed phrase works with any wallet in the Spark ecosystem. You're not locked
        into using this app — you can access your funds elsewhere if needed.
      </p>
      <div class="p-3 rounded-lg" style="background-color: var(--color-input-bg);">
        <div class="font-medium mb-1">Blitz Wallet</div>
        <p class="text-xs text-caption mb-2">A mobile Spark-compatible wallet</p>
        <a
          href="https://blitzwalletapp.com"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary hover:underline inline-flex items-center gap-1 text-xs"
        >
          blitzwalletapp.com
          <ArrowSquareOutIcon size={12} />
        </a>
      </div>
    </section>

    <!-- Recovery Process -->
    <section>
      <h3 class="font-semibold mb-2">Recovery Process</h3>
      <ol class="list-decimal list-inside space-y-1 text-caption leading-relaxed">
        <li>Install a compatible wallet (like Blitz Wallet)</li>
        <li>Choose the "Recover" or "Import" option</li>
        <li>Enter your 12-word seed phrase</li>
      </ol>

      <div class="mt-3 p-3 rounded-lg border" style="background-color: var(--color-bg-primary); border-color: var(--color-input-border);">
        <div class="flex items-start gap-2">
          <WarningIcon size={16} class="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <div class="font-medium text-xs mb-1">Advanced: Recovery Tool</div>
            <p class="text-xs text-caption mb-2">
              For advanced users or if you encounter issues, Blitz Wallet provides a web-based recovery tool.
              <strong>Use with caution</strong> — this is a third-party tool.
            </p>
            <a
              href="https://recover.blitz-wallet.com/"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline inline-flex items-center gap-1 text-xs"
            >
              recover.blitz-wallet.com
              <ArrowSquareOutIcon size={12} />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Security Reminder -->
    <section>
      <h3 class="font-semibold mb-2 flex items-center gap-2">
        <ShieldCheckIcon size={18} />
        Security Reminder
      </h3>
      <ul class="list-disc list-inside space-y-1 text-caption leading-relaxed">
        <li>Never share your seed phrase with anyone</li>
        <li>Store it in a safe, offline location</li>
        <li>Anyone with your seed phrase has full access to your funds</li>
      </ul>
    </section>

    <!-- Documentation Link -->
    <section class="pt-2 border-t" style="border-color: var(--color-input-border);">
      <a
        href="https://sdk-doc-spark.breez.technology/"
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary hover:underline inline-flex items-center gap-1"
      >
        Breez Spark Documentation
        <ArrowSquareOutIcon size={14} />
      </a>
    </section>
  </div>
</Modal>
