<!--
  CLINK noffer "Pay" affordance.

  Three variants, sharing one click target → NofferPayModal:

    `pill` (default) — small inline pill for note content / bios / list
      rows. Filled zap-orange → amber gradient, white icon + label,
      subtle brand-orange glow. Flows with surrounding text but reads
      as a real CTA, not a label.

    `row` — peer of the compact buttons in the profile sheet's action
      row. Same shape, height and type as the Zap / Message / Follow
      buttons beside it; the gradient is the only thing setting it
      apart, which is the point — it's one of the row's controls, not a
      badge dropped into it.

    `cta` — full-width prominent button for the profile page or any
      other place we want noffer payments front and center. Matches the
      visual weight of the Send Zap button (large tap target, bold
      label) but uses the gradient to distinguish.
-->
<script lang="ts">
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import NofferPayModal from './NofferPayModal.svelte';

  export let noffer: string;
  /**
   * Visual size — 'pill' is the inline default, 'row' sits in a profile
   * sheet's action row, 'cta' is full-width prominent.
   */
  export let variant: 'pill' | 'row' | 'cta' = 'pill';
  /** Label override; defaults differ per variant. */
  export let label: string = '';

  let open = false;

  $: resolvedLabel = label || (variant === 'cta' ? 'Pay CLINK offer' : 'Pay');
  // Icon tracks the label: 16px next to the row's 14px text matches the
  // phosphor icons in the buttons it sits with.
  $: iconSize = variant === 'cta' ? 20 : variant === 'row' ? 16 : 14;
</script>

<button
  type="button"
  class="noffer-pay-btn noffer-pay-btn--{variant}"
  on:click|stopPropagation|preventDefault={() => (open = true)}
  title="Pay this CLINK offer"
>
  <LightningIcon weight="fill" size={iconSize} />
  <span>{resolvedLabel}</span>
</button>

{#if open}
  <NofferPayModal bind:open {noffer} />
{/if}

<style>
  .noffer-pay-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    color: #fff;
    /* Zap-orange → amber gradient. The diagonal gradient picks up the
       brand orange (#ec4700, also `--zap-orange` in app.css) on the
       leading edge and warms into amber-500 on the trailing edge —
       mirrors the orange/amber sweep used elsewhere for zap pills. */
    background: linear-gradient(135deg, #ec4700 0%, #f59e0b 100%);
    border: none;
    cursor: pointer;
    transition:
      transform 0.08s ease-out,
      box-shadow 0.15s ease-out,
      filter 0.15s ease-out;
    vertical-align: middle;
    text-decoration: none;
    line-height: 1;
  }
  .noffer-pay-btn:hover {
    filter: brightness(1.05);
    box-shadow: 0 0 18px rgba(236, 71, 0, 0.45);
  }
  .noffer-pay-btn:active {
    transform: scale(0.97);
  }
  .noffer-pay-btn:focus-visible {
    outline: 2px solid #ec4700;
    outline-offset: 2px;
  }

  /* Inline pill — used in note content and bios. Small enough to flow
     between words; soft glow so it pulls the eye without screaming.
     Heavier weight here because the pill is small and competes with
     surrounding body text — needs the extra punch to read as a CTA. */
  .noffer-pay-btn--pill {
    padding: 0.3rem 0.7rem;
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 700;
    box-shadow: 0 0 0 1px rgba(236, 71, 0, 0.5), 0 2px 8px rgba(236, 71, 0, 0.25);
  }

  /* Action-row peer — profile sheet. Mirrors the Tailwind its siblings
     carry (rounded-lg / px-3 py-1.5 / gap-1.5 / text-sm / font-medium),
     line-height included, so every button on the row is the same height
     and shape. No resting shadow either: the siblings are flat, and a
     glow here would read as a different kind of control. */
  .noffer-pay-btn--row {
    /* Sized like a sibling, not wrapped in one: as the flex item
       itself, its padding sits on top of the same equal share theirs
       does, so the widths match. */
    flex: 1 1 0%;
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
    gap: 0.375rem;
    font-size: 0.875rem;
    line-height: 1.25rem;
    font-weight: 500;
    white-space: nowrap;
  }

  /* Full-width CTA — used on the profile page. Weight matches the
     Send Zap and Copy npub buttons it sits next to (Tailwind
     font-medium / 500) so the row reads as peers rather than this
     one shouting over the others. */
  .noffer-pay-btn--cta {
    width: 100%;
    padding: 0.85rem 1rem;
    border-radius: 0.5rem;
    font-size: 1rem;
    font-weight: 500;
    box-shadow: 0 4px 14px rgba(236, 71, 0, 0.32);
  }
  .noffer-pay-btn--cta:hover {
    box-shadow: 0 6px 22px rgba(236, 71, 0, 0.5);
  }
</style>
