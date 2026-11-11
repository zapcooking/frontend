<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/stores';
  import type { NDKUser } from '@nostr-dev-kit/ndk';
  import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import XIcon from 'phosphor-svelte/lib/X';
  import ThemePreviewCard from '../../components/ThemePreviewCard.svelte';
  import ZapModal from '../../components/ZapModal.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { theme, exploreStyle } from '$lib/themeStore';
  import { EXPLORE_STYLES, THEME_UNLOCK_TAG, type ExploreStyle } from '$lib/themeStyles';
  import { ORG_PUBKEY } from '$lib/landing/curation';
  import {
    themeUnlocks,
    canUseStyle,
    confirmThemeUnlock,
    loadThemeUnlocks
  } from '$lib/stores/themeUnlocks';
  import { scopeThemeCss } from '$lib/themePreviewCss';
  import { showToast } from '$lib/toast';
  import palettesCss from '$lib/themes/palettes.css?raw';
  import surfacesCss from '$lib/themes/surfaces.css?raw';

  // Every theme's tokens, rescoped from <html> to its preview card.
  const previewCss = scopeThemeCss(`${palettesCss}\n${surfacesCss}`);
  // Built from parts so Svelte's style preprocessor doesn't read it as a block.
  const styleTag = 'sty' + 'le';
  const previewStyle = `<${styleTag}>${previewCss}</${styleTag}>`;

  let previewMode: 'light' | 'dark' = 'light';
  onMount(() => {
    previewMode = theme.getResolvedTheme();
  });

  let zapOpen = false;
  let unlocking: ExploreStyle | null = null;
  let confirming: string | null = null;
  let orgUser: NDKUser | null = null;
  $: orgUser = $ndk ? $ndk.getUser({ pubkey: ORG_PUBKEY }) : null;

  const formatSats = (sats: number) => sats.toLocaleString('en-US');

  /** Cheapest first: free themes, then by price. Equal prices keep registry order. */
  const galleryStyles = [...EXPLORE_STYLES].sort((a, b) => (a.price ?? -1) - (b.price ?? -1));

  function useTheme(style: ExploreStyle) {
    stopPreview();
    theme.setStyle(style.value);
    if (style.modes.length === 1) theme.setTheme(style.modes[0]);
  }

  // A full-page preview writes the theme attribute straight onto the document,
  // bypassing the appearance controller, so nothing reaches localStorage. The
  // reactive stores only re-read the document on the controller's
  // appearancechange event, so every direct write emits one too — otherwise the
  // page renders the restored theme while a card still claims "In use".
  let previewing: ExploreStyle | null = null;
  let savedAppearance: { style: string; mode: string; dark: boolean } | null = null;

  function syncStores() {
    document.dispatchEvent(new Event('zapcooking:appearancechange'));
  }

  function startPreview(style: ExploreStyle) {
    const root = document.documentElement;
    if (!savedAppearance) {
      savedAppearance = {
        style: root.getAttribute('data-explore-theme') ?? 'original',
        mode: root.getAttribute('data-color-mode') ?? 'system',
        dark: root.classList.contains('dark')
      };
    }
    previewing = style;
    root.setAttribute('data-explore-theme', style.value);
    // A single-mode theme previews in the only way it can render.
    if (style.modes.length === 1) {
      root.setAttribute('data-color-mode', style.modes[0]);
      root.classList.toggle('dark', style.modes[0] === 'dark');
    }
    syncStores();
  }

  function stopPreview() {
    if (!savedAppearance) return;
    const root = document.documentElement;
    root.setAttribute('data-explore-theme', savedAppearance.style);
    root.setAttribute('data-color-mode', savedAppearance.mode);
    root.classList.toggle('dark', savedAppearance.dark);
    previewing = null;
    savedAppearance = null;
    syncStores();
  }

  onDestroy(stopPreview);

  function startUnlock(style: ExploreStyle) {
    unlocking = style;
    zapOpen = true;
  }

  async function onZapComplete() {
    const style = unlocking;
    const pubkey = $userPublickey;
    if (!style || !pubkey || !$ndk) return;
    confirming = style.value;
    const unlocked = await confirmThemeUnlock($ndk, pubkey, style.value);
    confirming = null;
    if (unlocked) {
      useTheme(style);
      showToast('success', `${style.label} is yours. Enjoy!`);
    } else {
      showToast(
        'info',
        `Payment sent. ${style.label} unlocks as soon as the zap receipt reaches the relays; check back in a minute.`,
        10000
      );
    }
  }

  // Deep link from the mood picker: /themes?unlock=<value> scrolls to the card.
  onMount(() => {
    const value = $page.url.searchParams.get('unlock');
    if (value) document.getElementById(`theme-${value}`)?.scrollIntoView({ block: 'center' });
  });

  $: status = $themeUnlocks;
</script>

<svelte:head>
  <title>Theme Gallery - zap.cooking</title>
  {@html previewStyle}
</svelte:head>

<div class="gallery">
  <header class="gallery-head">
    <div>
      <h1>Theme Gallery</h1>
      <p class="lede">
        Give your kitchen a new look. The first five themes are free; the rest unlock
        permanently with a zap to Zap Cooking, on every device you sign in to.
      </p>
      {#if status.all}
        <p class="perk">
          <CheckIcon size={16} weight="bold" />
          {status.reason === 'founder'
            ? 'As a founder, every theme is yours.'
            : 'Your membership includes every theme.'}
        </p>
      {/if}
    </div>
    <div class="mode-toggle" role="group" aria-label="Preview mode">
      {#each ['light', 'dark'] as mode}
        <button
          type="button"
          class:on={previewMode === mode}
          aria-pressed={previewMode === mode}
          on:click={() => (previewMode = mode === 'dark' ? 'dark' : 'light')}
        >
          {mode === 'dark' ? 'Dark' : 'Light'}
        </button>
      {/each}
    </div>
  </header>

  {#if previewing}
    <p class="preview-banner" role="status">
      <span>
        Previewing <strong>{previewing.label}</strong> across this page. Nothing is saved until
        you pick <strong>Use theme</strong>.
      </span>
      <button type="button" class="banner-stop" aria-label="Stop preview" title="Stop preview" on:click={stopPreview}>
        <XIcon size={14} weight="bold" />
      </button>
    </p>
  {/if}

  <ul class="grid">
    {#each galleryStyles as style (style.value)}
      {@const usable = canUseStyle(status, style.value)}
      {@const active = (previewing ? (savedAppearance?.style ?? $exploreStyle) : $exploreStyle) === style.value}
      <li class="card" class:active class:previewing={previewing === style} id="theme-{style.value}">
        <div class="preview">
          <ThemePreviewCard
            theme={style.value}
            mode={style.modes.includes(previewMode) ? previewMode : style.modes[0]}
          />
        </div>
        <div class="meta">
          <div class="name">
            <h2>{style.label}</h2>
            {#if style.modes.length === 1}
              <span class="mode-note">{style.modes[0] === 'dark' ? 'Dark only' : 'Light only'}</span>
            {/if}
            <span class="badge" class:locked={!usable}>
              {#if style.price === undefined}
                Free
              {:else if usable}
                Unlocked
              {:else}
                <LockSimpleIcon size={12} weight="bold" />
                {formatSats(style.price)} sats
              {/if}
            </span>
          </div>
          {#if active}
            <button type="button" class="btn current" disabled>
              <CheckIcon size={14} weight="bold" /> In use
            </button>
          {:else}
            <div class="actions">
              <!-- While previewing, the left button cancels; the label stays short so the
                   row keeps two balanced buttons on every card. -->
              <button
                type="button"
                class="btn ghost"
                aria-label={previewing === style ? 'Cancel preview' : `Preview ${style.label}`}
                on:click={() => (previewing === style ? stopPreview() : startPreview(style))}
              >
                {previewing === style ? 'Cancel' : 'Preview'}
              </button>
              {#if usable}
                <button type="button" class="btn" on:click={() => useTheme(style)}>Use theme</button>
              {:else if confirming === style.value}
                <button type="button" class="btn" disabled>Confirming…</button>
              {:else}
                <!-- The price is in the badge above and again in the zap modal, which shows the
                     fixed amount before anything is paid, so the label stays short enough for one line. -->
                <button
                  type="button"
                  class="btn unlock"
                  aria-label="Unlock {style.label} for {formatSats(style.price ?? 0)} sats"
                  on:click={() => startUnlock(style)}
                >
                  <LightningIcon size={14} weight="fill" />
                  Unlock
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  {#if $userPublickey && !status.all}
    <p class="fine">
      Already zapped for a theme and don't see it?
      <button type="button" class="link" on:click={() => loadThemeUnlocks($userPublickey)}>
        Check again
      </button>
    </p>
  {/if}
</div>

{#if zapOpen && unlocking && orgUser}
  <ZapModal
    bind:open={zapOpen}
    event={orgUser}
    title="Unlock {unlocking.label}"
    purposeLabel="A one-time zap to Zap Cooking unlocks {unlocking.label} for good."
    fixedAmount={unlocking.price}
    allowAnonymous={false}
    extraTags={[[THEME_UNLOCK_TAG, unlocking.value]]}
    on:zap-complete={onZapComplete}
  />
{/if}

<style>
  .gallery {
    max-width: 1100px;
  }
  .gallery-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }
  .lede {
    max-width: 38rem;
    margin-top: 8px;
    color: var(--color-text-secondary);
  }
  .perk {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    color: var(--color-success);
    font-weight: 500;
  }
  .mode-toggle {
    display: flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--color-input-border);
    border-radius: 999px;
  }
  .mode-toggle button {
    padding: 6px 14px;
    border-radius: 999px;
    color: var(--color-text-primary);
    font-size: 14px;
  }
  .mode-toggle button.on {
    background: var(--color-primary);
    color: var(--color-on-action, #fff);
  }
  .banner-stop {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    color: var(--color-text-secondary);
  }
  .banner-stop:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  }
  .preview-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    margin-bottom: 20px;
    padding: 10px 14px;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-secondary));
    color: var(--color-text-primary);
    font-size: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
  }
  .card {
    overflow: hidden;
    border: 1px solid var(--color-input-border);
    border-radius: 14px;
    background: var(--color-bg-secondary);
  }
  .card.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .preview {
    height: 140px;
    border-bottom: 1px solid var(--color-input-border);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 14px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .mode-note {
    flex: none;
    color: var(--color-caption);
    font-size: 12px;
    white-space: nowrap;
  }
  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
    font-size: 12px;
    font-weight: 600;
  }
  .badge.locked {
    background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
    color: var(--color-text-secondary);
  }
  .card.previewing {
    outline: 2px dashed var(--color-primary);
    outline-offset: 2px;
  }
  /* Two buttons on one line on every card, free or locked. flex: 1 1 0 makes them equal
     when they fit; with nowrap, a flex item never shrinks below its text, so a longer label
     takes a little more room instead of wrapping. While previewing, the left button reads
     Cancel and cancels the preview; the X for that lives in the page banner. */
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .btn {
    flex: 1 1 0;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: 1px solid var(--color-input-border);
    border-radius: 10px;
    color: var(--color-text-primary);
    font-size: 14px;
    font-weight: 600;
    line-height: 20px; /* fixed, so the bolt icon can't make locked cards' buttons taller */
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) {
    background: var(--color-accent-gray);
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.unlock {
    border-color: transparent;
    background: var(--color-action, var(--color-primary));
    color: var(--color-on-action, #fff);
  }
  .btn.unlock:hover {
    filter: brightness(1.08);
  }
  .btn:disabled {
    cursor: default;
    opacity: 0.8;
  }
  .fine {
    margin-top: 24px;
    color: var(--color-caption);
    font-size: 14px;
  }
  .link {
    color: var(--color-primary);
    text-decoration: underline;
  }
</style>
