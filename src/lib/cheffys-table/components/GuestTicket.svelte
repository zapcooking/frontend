<script lang="ts">
  import GuestPortrait from './GuestPortrait.svelte';
  import Clock from 'phosphor-svelte/lib/Clock';
  import Leaf from 'phosphor-svelte/lib/Leaf';
  import type { Customer } from '../service';
  export let customer: Customer;
  export let arrival = false;
</script>

<article class="guest-ticket" class:arrival>
  <div class="guest-face"><GuestPortrait id={customer.id} size={arrival ? 108 : 78} /></div>
  <div class="guest-order">
    <span class="eyebrow">{arrival ? 'A seat at your table' : 'On the ticket'}</span>
    <h2>{customer.name}</h2>
    <blockquote>{customer.brief.replace(/[“”]/g, '')}</blockquote>
    <div class="requests">
      <span><Clock size={15} />{customer.patience} min</span>{#if customer.plantOnly}<span
          ><Leaf size={15} />Plant-based</span
        >{/if}{#if customer.noChili}<span>Keep it mild</span>{/if}
      <span class="compact-vessel"
        >{customer.preferred === 'toast'
          ? 'On toast'
          : customer.preferred === 'bowl'
            ? 'Bowl'
            : 'Composed'}</span
      >
    </div>
    <p class="vessel-request">
      Picturing {customer.preferred === 'toast'
        ? 'something on toast'
        : customer.preferred === 'bowl'
          ? 'a bowl'
          : 'a composed plate'}.
    </p>
  </div>
</article>

<style>
  .guest-ticket {
    position: relative;
    padding: 24px 22px 26px;
    background: var(--table-ticket);
    box-shadow: 0 9px 25px var(--table-shadow);
    border-radius: 3px 3px 12px 12px;
    transform: rotate(-2deg);
  }
  .guest-ticket::before {
    content: '';
    width: 46px;
    height: 16px;
    position: absolute;
    top: -8px;
    left: calc(50% - 23px);
    background: var(--table-wood);
    opacity: 0.65;
    transform: rotate(4deg);
  }
  .guest-face {
    margin: 0 0 12px;
  }
  .eyebrow {
    font-size: 11px;
  }
  h2 {
    font-size: 29px;
    line-height: 1.2;
    font-weight: 750;
    margin: 4px 0 15px;
    letter-spacing: -0.7px;
  }
  blockquote {
    font-size: 17px;
    line-height: 1.45;
    margin: 0;
  }
  .requests {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin: 18px 0 0;
  }
  .requests span {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-size: 12px;
    font-weight: 650;
  }
  .requests .compact-vessel {
    display: none;
  }
  .vessel-request {
    border-top: 1px dashed var(--table-line);
    padding-top: 14px;
    margin-top: 16px;
    font-size: 13px;
    color: var(--table-muted);
  }
  .arrival {
    max-width: 410px;
    text-align: center;
    margin: auto;
    padding: 26px 30px;
  }
  .arrival .guest-face {
    display: flex;
    justify-content: center;
  }
  .arrival .requests {
    justify-content: center;
  }
  .arrival h2 {
    font-size: 38px;
  }
  .arrival blockquote {
    font-size: 22px;
  }
  @media (min-width: 700px) and (max-width: 1100px) {
    .guest-ticket:not(.arrival) {
      transform: none;
      display: flex;
      gap: 20px;
      padding: 16px 24px;
      align-items: center;
    }
    .guest-ticket:not(.arrival) .guest-face {
      margin: 0;
    }
    .guest-ticket:not(.arrival) .eyebrow {
      display: none;
    }
    .guest-ticket:not(.arrival) h2 {
      font-size: 22px;
      margin: 0 0 4px;
    }
    .guest-ticket:not(.arrival) .requests {
      margin: 8px 0 0;
    }
    .guest-ticket:not(.arrival) .vessel-request {
      display: none;
    }
  }
  @media (max-width: 699px) {
    .guest-ticket:not(.arrival) .compact-vessel {
      display: inline-flex;
    }
    .guest-ticket:not(.arrival) .vessel-request {
      display: none;
    }
    .guest-ticket:not(.arrival) {
      transform: none;
      display: flex;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      box-shadow: none;
    }
    .guest-ticket:not(.arrival)::before {
      display: none;
    }
    .guest-ticket:not(.arrival) .guest-face {
      width: 52px;
      height: 52px;
      flex-shrink: 0;
      margin: 0;
    }
    .guest-ticket:not(.arrival) .guest-face :global(svg) {
      width: 52px;
      height: 52px;
    }
    .guest-ticket:not(.arrival) .eyebrow {
      display: none;
    }
    .guest-ticket:not(.arrival) h2 {
      font-size: 17px;
      margin: 0 0 2px;
    }
    .guest-ticket:not(.arrival) blockquote {
      font-size: 13px;
      line-height: 1.35;
    }
    .guest-ticket:not(.arrival) .requests {
      margin: 6px 0 0;
      gap: 9px;
    }
    .guest-ticket:not(.arrival) .requests span {
      font-size: 12px;
    }
    .guest-ticket:not(.arrival) .vessel-request {
      border: 0;
      padding: 0;
      margin-top: 5px;
      font-size: 12px;
    }
    .arrival {
      padding: 20px 22px;
      max-width: 350px;
    }
    .arrival h2 {
      font-size: 32px;
    }
    .arrival blockquote {
      font-size: 20px;
    }
  }
  @media (max-width: 699px) and (max-height: 740px) {
    .arrival {
      padding: 16px 22px;
    }
    .arrival .guest-face :global(svg) {
      width: 96px;
      height: 96px;
    }
    .arrival blockquote {
      font-size: 18px;
    }
  }
</style>
