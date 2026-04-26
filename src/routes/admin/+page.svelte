<script lang="ts">
  /**
   * /admin — index hub linking the admin sub-pages.
   *
   * Lightweight directory page; each sub-route owns its own auth gate
   * (NIP-98 on write endpoints, header check on read endpoints) so
   * this page is intentionally just a list of links — visiting
   * unauthenticated still renders, but the linked endpoints reject.
   */
  import { isAdmin } from '$lib/adminAuth';
  import { userPublickey } from '$lib/nostr';

  $: authed = isAdmin($userPublickey);
</script>

<svelte:head>
  <title>Admin — Zap Cooking</title>
</svelte:head>

<div class="page">
  <h1>Admin</h1>

  {#if !authed}
    <div class="unauthorized">
      <p>Sign in with the admin account to use these tools.</p>
    </div>
  {:else}
    <ul class="links">
      <li>
        <a href="/admin/promos">
          <span class="title">Cookbook promos</span>
          <span class="desc">Toggle promos on/off, create and disable codes.</span>
        </a>
      </li>
      <li>
        <a href="/admin/nourish-flags">
          <span class="title">Nourish flags</span>
          <span class="desc">Review user flags + rescore stale recipes.</span>
        </a>
      </li>
    </ul>
  {/if}
</div>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.25rem;
    color: var(--color-text-primary);
  }
  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 1.25rem;
  }
  .unauthorized {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-secondary);
  }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .links a {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1rem 1.25rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
    text-decoration: none;
    color: inherit;
    transition: border-color 120ms ease;
  }
  .links a:hover {
    border-color: var(--color-primary);
  }
  .title {
    font-weight: 600;
  }
  .desc {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
</style>
