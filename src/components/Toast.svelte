<script lang="ts">
  import XIcon from 'phosphor-svelte/lib/X';
  import type { ToastMessage } from '$lib/toast';
  import { dismissToast } from '$lib/toast';

  export let toast: ToastMessage;
</script>

<div
  class="toast toast--{toast.variant}"
  role={toast.variant === 'error' ? 'alert' : 'status'}
  aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
>
  <span class="toast-message">{toast.message}</span>
  <button
    type="button"
    class="toast-dismiss"
    aria-label="Dismiss"
    on:click={() => dismissToast(toast.id)}
  >
    <XIcon size={14} weight="bold" />
  </button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    font-size: 0.875rem;
    line-height: 1.4;
    min-width: 240px;
    max-width: 420px;
    pointer-events: auto; /* override container's pointer-events: none */
  }

  .toast--error {
    border-color: rgba(239, 68, 68, 0.45);
    background: rgba(239, 68, 68, 0.1);
  }

  .toast--success {
    border-color: rgba(34, 197, 94, 0.45);
    background: rgba(34, 197, 94, 0.1);
  }

  .toast-message {
    flex: 1 1 0%;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .toast-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.25rem;
    color: var(--color-text-secondary);
    transition: opacity 0.15s;
  }

  .toast-dismiss:hover {
    opacity: 0.7;
  }
</style>
