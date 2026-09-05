<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import X from 'phosphor-svelte/lib/X';
  export let title: string;
  export let onClose: () => void;
  let dialog: HTMLDialogElement;
  let previous: HTMLElement | null = null;
  onMount(() => {
    previous = document.activeElement as HTMLElement;
    dialog.showModal();
    // Keep Tab inside the native modal, including browsers that otherwise focus chrome.
    dialog.addEventListener('keydown', trap);
    return () => dialog.removeEventListener('keydown', trap);
  });
  onDestroy(() => {
    dialog?.close();
    if (previous?.isConnected) previous.focus();
  });
  function trap(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea,summary,[tabindex="0"]'
      )
    ).filter((node) => node.getClientRects().length > 0);
    const first = nodes[0],
      last = nodes.at(-1),
      active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<dialog
  bind:this={dialog}
  on:cancel|preventDefault={onClose}
  aria-labelledby="table-sheet-title"
  tabindex="-1"
>
  <header>
    <div>
      <span class="eyebrow">Cheffy’s Table</span>
      <h2 id="table-sheet-title">{title}</h2>
    </div>
    <button class="table-icon" on:click={onClose} aria-label={`Close ${title}`}
      ><X size={24} /></button
    >
  </header>
  <div class="sheet-content"><slot /></div>
</dialog>

<style>
  dialog {
    width: min(580px, calc(100vw - 40px));
    max-height: min(85dvh, 820px);
    border: 1px solid var(--table-line);
    border-radius: 25px;
    padding: 0;
    margin: auto;
    background: var(--table-raised);
    color: var(--table-ink);
    box-shadow: 0 30px 80px #0004;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  dialog::backdrop {
    background: #131b2280;
    backdrop-filter: blur(3px);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 22px 26px;
    border-bottom: 1px solid var(--table-line);
    position: sticky;
    top: 0;
    background: var(--table-raised);
    z-index: 1;
  }
  header h2 {
    font-size: 26px;
    letter-spacing: -0.7px;
    font-weight: 750;
    margin-top: 4px;
  }
  .sheet-content {
    padding: 24px 26px 30px;
  }
  @media (max-width: 699px) {
    dialog {
      width: 100%;
      max-width: 100%;
      margin: auto 0 0;
      max-height: 88dvh;
      border-radius: 24px 24px 0 0;
      border-bottom: 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    header {
      padding: 18px 22px;
    }
    .sheet-content {
      padding: 20px 22px 28px;
    }
  }
</style>
