<script lang="ts">
  /**
   * Free AI recipe-import hero for the public landing page.
   *
   * Renders in one of three modes based on auth + membership tier:
   *
   *   1. Logged-out          → full hero (headline + subtext + input)
   *   2. Logged-in non-Pro   → compact pill (just input, discoverable
   *                            for free and Cook+ users)
   *   3. Logged-in Pro/Founder → hidden (they have the nav sparkle)
   *
   * The submit path POSTs to `/api/extract-recipe/public`, stashes the
   * parsed recipe in sessionStorage under `ANON_IMPORT_HANDOFF_KEY`, and
   * navigates to `/souschef` where the anon-preview branch reads the
   * handoff and shows the editor in view-only mode until sign-in.
   *
   * Rate limit: 3 imports/hour/browser via `$lib/rateLimit.ts`
   * (localStorage, first-line UX guard). The real cost-cap is the
   * per-IP limiter on the server endpoint.
   */

  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { checkRateLimit, recordHit } from '$lib/rateLimit';
  import { ANON_IMPORT_HANDOFF_KEY } from '$lib/anonImport';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';

  const RATE_LIMIT_OPTS = {
    bucket: 'anon-url-import',
    limit: 3,
    windowMs: 60 * 60 * 1000
  } as const;

  let urlInput = '';
  let error = '';
  let isSubmitting = false;

  // Membership tier lookup — same pattern as explore/+page.svelte.
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => {
    membershipMap = v;
  });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '').trim().toLowerCase();
  $: tierStatus = normalizedPk ? membershipMap[normalizedPk] : undefined;
  $: isPremiumTier =
    !!tierStatus?.active && (tierStatus.tier === 'pro_kitchen' || tierStatus.tier === 'founders');
  $: isLoggedIn = $userPublickey !== '';
  $: mode = isPremiumTier ? 'hidden' : isLoggedIn ? 'compact' : 'full';

  import { onDestroy } from 'svelte';
  onDestroy(() => unsubMembership());

  function validateUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return 'Paste a recipe URL first.';
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return 'That doesn\u2019t look like a valid URL.';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'Only http(s) URLs are supported.';
    }
    if (trimmed.length > 2048) {
      return 'That URL is too long.';
    }
    return '';
  }

  function formatRetryTime(retryAt: number): string {
    const mins = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
    return `Try again in about ${mins} min.`;
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    error = '';

    const validationError = validateUrl(urlInput);
    if (validationError) {
      error = validationError;
      return;
    }

    const limit = checkRateLimit(RATE_LIMIT_OPTS);
    if (!limit.allowed) {
      error = `Free imports are capped at 3/hour. ${formatRetryTime(limit.retryAt)}`;
      return;
    }

    // TODO(analytics): emit `anon_import_attempt` with { urlHost }.

    isSubmitting = true;
    try {
      const res = await fetch('/api/extract-recipe/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() })
      });

      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const retryMins = body?.retryAfter ? Math.max(1, Math.ceil(body.retryAfter / 60)) : 60;
        error = `We\u2019re a bit busy right now — try again in about ${retryMins} min.`;
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        error = (data && typeof data.error === 'string' && data.error) || 'Import failed. Try a different URL.';
        return;
      }

      if (browser) {
        try {
          sessionStorage.setItem(
            ANON_IMPORT_HANDOFF_KEY,
            JSON.stringify({ recipe: data.recipe, sourceUrl: urlInput.trim(), at: Date.now() })
          );
        } catch {
          // If sessionStorage is disabled (private mode with strict settings),
          // fall back to a querystring flag and let /souschef show a generic
          // "please re-paste" state.
        }
      }

      recordHit(RATE_LIMIT_OPTS);
      // TODO(analytics): emit `anon_import_success` with { urlHost }.

      urlInput = '';
      await goto('/souschef?from=anon-import');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Network error. Try again.';
    } finally {
      isSubmitting = false;
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  }
</script>

{#if mode !== 'hidden'}
  <section
    class="hero-card"
    class:hero-full={mode === 'full'}
    class:hero-compact={mode === 'compact'}
    data-section="import-hero"
  >
    <div class="hero-copy">
      <h2 class="hero-title">
        <SparkleIcon size={18} weight="fill" class="hero-sparkle" />
        Import any recipe with AI
      </h2>
      <p class="hero-sub">Paste a link from any site</p>
    </div>

    <form class="hero-form" on:submit|preventDefault={handleSubmit}>
      <div class="input-wrap">
        <span class="input-prefix">zap.cooking/</span>
        <input
          type="url"
          inputmode="url"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Paste a recipe URL…"
          bind:value={urlInput}
          on:keydown={handleKey}
          disabled={isSubmitting}
          aria-label="Recipe URL"
        />
      </div>
      <button
        type="submit"
        class="submit-btn"
        disabled={isSubmitting || !urlInput.trim()}
        aria-label="Import recipe"
      >
        {#if isSubmitting}
          <ArrowsClockwiseIcon size={16} class="spin" />
          <span>Importing…</span>
        {:else}
          <SparkleIcon size={16} weight="fill" />
          <span>Import</span>
        {/if}
      </button>
    </form>

    {#if error}
      <p class="hero-error" role="alert">{error}</p>
    {/if}
  </section>
{/if}

<style>
  /* Sizing baseline — input and button share the same single-line
     height so the row reads like one clean control. */
  .hero-card {
    --hero-control-h: 44px;

    position: relative;
    border: 1px solid var(--color-input-border);
    border-radius: 0.85rem;
    background: var(--color-bg-secondary);
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  /* Full mode — anon visitors. Reads as a distinct feature card via
     an orange-tinted border + background wash. Everything uses
     --color-primary via color-mix so it tracks the light/dark theme. */
  .hero-full {
    padding: 1rem 1rem 0.95rem;
    border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-input-border));
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-primary) 10%, transparent) 0%,
        color-mix(in srgb, var(--color-primary) 4%, transparent) 60%,
        transparent 100%
      ),
      var(--color-bg-secondary);
  }

  /* Compact mode — logged-in non-premium users. Same feature copy,
     just denser. */
  .hero-compact {
    padding: 0.75rem 0.9rem;
  }

  .hero-copy {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .hero-title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.95rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--color-text-primary);
  }

  :global(.hero-sparkle) {
    color: var(--color-primary);
    flex-shrink: 0;
  }

  .hero-sub {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.3;
    color: var(--color-text-secondary);
  }

  .hero-form {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .input-wrap {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--hero-control-h);
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0 0.7rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    transition: border-color 120ms ease;
  }

  .input-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .input-prefix {
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: nowrap;
    user-select: none;
    flex-shrink: 0;
  }

  /* Explicit height + margin overrides defeat any ambient global
     `input` rules that might otherwise inflate the control. */
  .input-wrap input {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    border: none;
    background: transparent;
    outline: none;
    color: var(--color-text-primary);
    font-size: 0.88rem;
    font-family: inherit;
    padding: 0;
    line-height: 1.2;
    box-sizing: border-box;
  }

  .input-wrap input::placeholder {
    color: var(--color-text-secondary);
    opacity: 0.7;
  }

  /* Button uses --color-primary flat rather than a hardcoded 2-stop
     gradient so it's visibly calmer than the floating FAB in the
     bottom nav. Shadow is tiny — it's a utility button, not a hero. */
  .submit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    height: var(--hero-control-h);
    padding: 0 0.9rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--color-primary);
    color: white;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
    transition: filter 120ms ease, opacity 120ms ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .submit-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .submit-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }

  .hero-error {
    margin: 0;
    font-size: 0.78rem;
    color: #ef4444;
  }

  :global(.spin) {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Phones that still have room to keep the row horizontal. Shorten
     the subtext and the button label so they don't push the input
     below the input's own sensible min width. */
  @media (max-width: 520px) {
    .hero-full {
      padding: 0.85rem 0.9rem;
    }
    .input-prefix {
      /* Prefix is nice-to-have context, not load-bearing. Drop it on
         tight phones so the placeholder gets the visible real estate. */
      display: none;
    }
  }

  /* Only stack at truly narrow widths (<360px — small legacy phones).
     At 400–433px the row still fits horizontally. */
  @media (max-width: 359px) {
    .hero-form {
      flex-direction: column;
      align-items: stretch;
    }
    .submit-btn {
      width: 100%;
    }
  }
</style>
