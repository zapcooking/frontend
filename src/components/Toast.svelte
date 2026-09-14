<script lang="ts">
  import { browser } from '$app/environment';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircle';
  import InfoIcon from 'phosphor-svelte/lib/Info';
  import type { ToastMessage } from '$lib/toast';
  import { dismissToast } from '$lib/toast';

  export let toast: ToastMessage;

  // Enter/exit per the transitions.dev toast recipe: fade + translate +
  // slight scale + cross-blur, arriving on the slower open clock and
  // leaving on the faster close clock. The container is top-center, so
  // the toast drops in from above instead of rising from below.
  // Svelte 4's easing module has no custom cubic-bezier factory, so the
  // recipe's curve (0.22, 1, 0.36, 1) is evaluated with Newton–Raphson.
  function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
    return (t: number): number => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let i = 0; i < 8; i++) {
        const x = 3 * u * (1 - u) ** 2 * x1 + 3 * u * u * (1 - u) * x2 + u ** 3 - t;
        if (Math.abs(x) < 1e-5) break;
        const d = 3 * (1 - u) ** 2 * x1 + 6 * u * (1 - u) * (x2 - x1) + 3 * u * u * (1 - x2);
        if (Math.abs(d) < 1e-6) break;
        u -= x / d;
      }
      return 3 * u * (1 - u) ** 2 * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
    };
  }
  const toastEase = cubicBezier(0.22, 1, 0.36, 1);
  const reducedMotion =
    browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function toastCss(t: number): string {
    return `opacity: ${t}; transform: translateY(${(1 - t) * -16}px) scale(${0.97 + 0.03 * t}); filter: blur(${(1 - t) * 2}px);`;
  }

  // The recipe's will-change hint — promotes the toast for its own
  // transform/opacity/filter animation. Applied by both directions
  // because an outro can run on a toast whose intro never did (a new
  // toast replaces the visible one).
  const prepWillChange = (node: Element) => {
    (node as HTMLElement).style.willChange = 'transform, opacity, filter';
  };

  const toastIn = (node: Element) => {
    prepWillChange(node);
    return {
      duration: reducedMotion ? 0 : 350,
      easing: toastEase,
      css: toastCss
    };
  };
  const toastOut = (node: Element) => {
    prepWillChange(node);
    return {
      duration: reducedMotion ? 0 : 250,
      easing: toastEase,
      css: toastCss
    };
  };
</script>

<div
  class="toast toast--{toast.variant}"
  role={toast.variant === 'error' ? 'alert' : 'status'}
  aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
  in:toastIn
  out:toastOut
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
