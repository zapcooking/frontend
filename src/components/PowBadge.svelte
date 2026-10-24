<script lang="ts">
  /**
   * NIP-13 proof of work, shown beside the timestamp.
   *
   * Reads the id, never the tag's word for it. A `nonce` tag is a claim; the
   * leading zero bits of the event id are the proof. A note committing to 22
   * that reaches 9 did not do the work it says it did, so the badge shows
   * what was ACHIEVED and stays away entirely when a committed target was
   * missed — a badge that repeated the claim would be worth nothing to the
   * reader, since anyone can type a tag.
   *
   * Nothing renders for notes without a nonce tag: leading zeros happen by
   * chance all the time, and a note that never claimed to be mined is not
   * making a claim to display.
   */
  import HammerIcon from 'phosphor-svelte/lib/Hammer';
  import { leadingZeroBits } from '$lib/pow';

  export let id: string | undefined = undefined;
  export let tags: string[][] = [];

  $: nonce = tags?.find((t) => t[0] === 'nonce');
  $: achieved = id ? leadingZeroBits(id) : 0;
  // The target is a SHOULD in NIP-13, so a nonce without one still counts —
  // there is simply nothing to hold it to.
  $: committed = nonce && nonce[2] ? Number(nonce[2]) : NaN;
  $: backed = !!nonce && achieved > 0 && (Number.isNaN(committed) || achieved >= committed);
</script>

{#if backed}
  <span
    class="pow-badge"
    title="{achieved} bits of proof of work{Number.isNaN(committed)
      ? ''
      : `, mined for ${committed}`} (NIP-13)"
  >
    <HammerIcon size={11} weight="fill" />
    <span>{achieved}</span>
  </span>
{/if}

<style>
  .pow-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
</style>
