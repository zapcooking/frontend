<script lang="ts">
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import type { ToastMessage } from '$lib/toast';
  import { dismissToast } from '$lib/toast';

  export let toast: ToastMessage;
</script>

<div
  class="toast toast--{toast.variant}"
  role={toast.variant === 'error' ? 'alert' : 'status'}
  aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
>
  <span class="toast-icon">
    {#if toast.variant === 'success'}
      <CheckCircleIcon size={20} weight="fill" />
    {:else if toast.variant === 'error'}
      <WarningCircleIcon size={20} weight="fill" />
    {:else}
      <InfoIcon size={20} weight="fill" />
    {/if}
  </span>
  <span class="toast-message">{toast.message}</span>
  {#if toast.link}
    <a href={toast.link.href} class="toast-link" on:click={() => dismissToast(toast.id)}>
      {toast.link.label}
    </a>
  {/if}
  <button
    type="button"
    class="toast-dismiss"
    aria-label="Dismiss"
    on:click={() => dismissToast(toast.id)}
  >
    Dismiss
  </button>
</div>

<style>
  .toast {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    background-color: var(--color-bg-primary);
    border: 1px solid currentColor;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
    font-size: 0.875rem;
    line-height: 1.4;
    pointer-events: auto;
    width: 100%;
  }

  .toast--success {
    color: #22c55e;
  }

  .toast--error {
    color: #ef4444;
  }

  .toast--info {
    color: #3b82f6;
  }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .toast-message {
    flex: 1 1 0%;
    color: var(--color-text-primary, #fff);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .toast-link {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 700;
    color: currentColor;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
    opacity: 0.9;
    transition: opacity 0.15s;
  }

  .toast-link:hover {
    opacity: 1;
  }

  .toast-dismiss {
    flex-shrink: 0;
    font-size: 0.8125rem;
    color: currentColor;
    text-decoration: underline;
    text-underline-offset: 2px;
    opacity: 0.8;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .toast-dismiss:hover {
    opacity: 1;
  }
</style>
