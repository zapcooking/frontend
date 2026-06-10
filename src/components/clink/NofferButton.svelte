<!--
  Small "⚡ Pay" pill rendered inline anywhere we surface a CLINK noffer
  (note content, profile page, bio). Click opens NofferPayModal which
  does the actual RPC / wallet hand-off.
-->
<script lang="ts">
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import NofferPayModal from './NofferPayModal.svelte';

  export let noffer: string;

  let open = false;
</script>

<button
  type="button"
  class="noffer-pay-btn"
  on:click|stopPropagation|preventDefault={() => (open = true)}
  title="Pay this CLINK offer"
>
  <LightningIcon weight="fill" size={14} />
  <span>Pay</span>
</button>

{#if open}
  <NofferPayModal bind:open {noffer} />
{/if}

<style>
  .noffer-pay-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    color: #f59e0b;
    background-color: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.4);
    cursor: pointer;
    transition:
      background-color 0.15s ease-out,
      transform 0.05s ease-out;
    vertical-align: middle;
  }
  .noffer-pay-btn:hover {
    background-color: rgba(245, 158, 11, 0.22);
  }
  .noffer-pay-btn:active {
    transform: scale(0.97);
  }
  .noffer-pay-btn:focus-visible {
    outline: 2px solid #f59e0b;
    outline-offset: 2px;
  }
</style>
