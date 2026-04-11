<script lang="ts">
  /**
   * NourishPill — strengths-focused nutrition profile for recipe cards and headers.
   *
   * Hover/focus reveals the inline profile preview.
   * Click opens the full Nourish modal.
   */

  import LeafIcon from 'phosphor-svelte/lib/Leaf';

  export let overall: number | null = null;
  export let gut: number | null = null;
  export let protein: number | null = null;
  export let realFood: number | null = null;
  export let compact: boolean = false;
  export let onClick: (() => void) | undefined = undefined;

  let hovered = false;
  let focused = false;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Describe what this recipe is rich in — strengths only.
   */
  function getStrengths(gut: number, protein: number, realFood: number): string[] {
    const strengths: string[] = [];
    if (realFood >= 7) strengths.push('Whole foods');
    if (gut >= 7) strengths.push('Gut-friendly');
    if (protein >= 7) strengths.push('Protein-rich');
    if (strengths.length === 0) {
      const best = Math.max(gut, protein, realFood);
      if (best >= 5) {
        if (realFood === best) strengths.push('Real ingredients');
        else if (gut === best) strengths.push('Plant diversity');
        else strengths.push('Protein source');
      }
    }
    return strengths.slice(0, 2);
  }

  const DIMENSIONS = [
    { key: 'realFood', label: 'Real Food', icon: '🥬' },
    { key: 'gut',      label: 'Gut Health', icon: '🌱' },
    { key: 'protein',  label: 'Protein',    icon: '💪' }
  ] as const;

  function getDimensionValue(key: string): number {
    if (key === 'realFood') return realFood ?? 0;
    if (key === 'gut') return gut ?? 0;
    if (key === 'protein') return protein ?? 0;
    return 0;
  }

  function handleClick() {
    if (onClick) onClick();
  }

  function showPreview() {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    hovered = true;
  }

  function scheduleHide() {
    hideTimeout = setTimeout(() => { hovered = false; }, 200);
  }

  let showProfile = false;
  let hasSubscores = false;
  let strengths: string[] = [];

  $: showProfile = !compact && (hovered || focused);
  $: hasSubscores = gut !== null && protein !== null && realFood !== null;
  $: strengths = hasSubscores ? getStrengths(gut!, protein!, realFood!) : [];
</script>

{#if overall !== null}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="nourish-wrapper"
    on:mouseenter={showPreview}
    on:mouseleave={scheduleHide}
  >
    <button
      class="nourish-pill"
      on:click={handleClick}
      on:focus={() => { focused = true; }}
      on:blur={() => { focused = false; }}
      aria-label="Nourish Profile — click for details{strengths.length > 0 ? `. ${strengths.join(', ')}` : ''}"
    >
      <span class="pill-leaf"><LeafIcon size={14} weight="fill" /></span>
      <span class="pill-name">Nourish</span>
    </button>

    <!-- Hover/focus preview — positioned as a floating card -->
    {#if showProfile && hasSubscores}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="nourish-profile"
        role="tooltip"
        on:mouseenter={showPreview}
        on:mouseleave={scheduleHide}
      >
        {#if strengths.length > 0}
          <div class="profile-strengths">
            {#each strengths as s}
              <span class="strength-tag">{s}</span>
            {/each}
          </div>
        {/if}

        <div class="profile-dims">
          {#each DIMENSIONS as dim}
            {@const val = getDimensionValue(dim.key)}
            <div class="dim-row">
              <span class="dim-icon">{dim.icon}</span>
              <span class="dim-label">{dim.label}</span>
              <div class="dim-track">
                <div class="dim-fill" style="width: {val * 10}%;" />
              </div>
            </div>
          {/each}
        </div>

        <button class="profile-details" on:click={handleClick}>
          See full profile
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .nourish-wrapper {
    position: relative;
    display: inline-flex;
  }

  /* ── Pill ── */
  .nourish-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    border: 1px solid rgba(34, 197, 94, 0.25);
    background: rgba(34, 197, 94, 0.06);
    cursor: pointer;
    transition: background 150ms, border-color 150ms;
    font-family: inherit;
    line-height: 1;
    white-space: nowrap;
  }
  .nourish-pill:hover {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.4);
  }
  .nourish-pill:focus-visible {
    outline: 2px solid #22c55e;
    outline-offset: 2px;
  }

  .pill-leaf {
    display: flex;
    color: #22c55e;
    flex-shrink: 0;
  }
  .pill-name {
    font-size: 0.6875rem;
    font-weight: 600;
    color: #22c55e;
    letter-spacing: 0.01em;
  }

  /* ── Floating profile card ── */
  .nourish-profile {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.625rem 0.75rem;
    border-radius: 0.625rem;
    background: var(--color-input-bg, #1a1a2e);
    border: 1px solid var(--color-input-border, rgba(255, 255, 255, 0.08));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    min-width: 180px;
    max-width: 220px;
    animation: nourish-fade-in 150ms ease-out;
  }

  @keyframes nourish-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Strength tags */
  .profile-strengths {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .strength-tag {
    font-size: 0.625rem;
    font-weight: 500;
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    background: rgba(34, 197, 94, 0.08);
    color: #22c55e;
    white-space: nowrap;
  }

  /* Dimension rows */
  .profile-dims {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .dim-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .dim-icon {
    font-size: 0.625rem;
    width: 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .dim-label {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    width: 56px;
    flex-shrink: 0;
  }
  .dim-track {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    overflow: hidden;
  }
  .dim-fill {
    height: 100%;
    border-radius: 2px;
    background: #22c55e;
    opacity: 0.7;
    transition: width 400ms ease-out;
  }

  /* Details link */
  .profile-details {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    opacity: 0.6;
    cursor: pointer;
    text-align: left;
    padding: 0;
    border: none;
    background: none;
    font-family: inherit;
    transition: opacity 150ms, color 150ms;
  }
  .profile-details:hover {
    opacity: 1;
    color: #22c55e;
  }
</style>
