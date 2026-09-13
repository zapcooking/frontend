<script lang="ts">
  import FoodArt from '../FoodArt.svelte';
  export let id: string;
  export let garnish = false;
</script>

{#if id === 'egg'}<svg viewBox="0 0 100 100" aria-hidden="true"
    ><path
      d="M52 8C78 12 91 55 79 78C67 100 28 97 17 73C8 50 28 4 52 8Z"
      fill="#fff9db"
      stroke="#dfc99d"
      stroke-width="2"
    /><ellipse cx="49" cy="62" rx="22" ry="24" fill="#e6a533" /><ellipse
      cx="44"
      cy="55"
      rx="11"
      ry="13"
      fill="#f8c64e"
    /></svg
  >
{:else if id === 'parmesan' && garnish}<svg viewBox="0 0 100 100" aria-hidden="true"
    ><g stroke="#d9b45e" stroke-width="4" stroke-linecap="round"
      ><path
        d="m22 22 12 5m21-3 8 8m-19 8-7 11m33-11 9 7m-60 14 13 4m20-3 8 10m20-7-5 12m-39 0 11 6m-22-49 7 4m40 54 8 2"
      /></g
    ></svg
  >
{:else}<FoodArt {id} />{/if}

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
</style>
