<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import CustomAvatar from '../../components/CustomAvatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import type { PageData } from './$types';

  export let data: PageData;

  function getNpub(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return pubkey;
    }
  }

  interface Founder {
    number: number;
    pubkey: string;
    tier: string;
    joined: string | null;
  }

  // CustomAvatar and CustomName handle their own profile loading
  let founders: Founder[] = (data.founders || []).map((f: any) => ({
    number: f.number,
    pubkey: f.pubkey,
    tier: f.tier,
    joined: f.joined
  }));
</script>

<svelte:head>
  <title>Genesis Founders - zap.cooking</title>
  <meta
    name="description"
    content="Meet the Genesis Founders - the first believers who made Zap Cooking possible."
  />
</svelte:head>

<div class="founders-page">
  <section class="genesis-founders">
    <h2>🔥 Genesis Founders</h2>
    <p class="subtitle">The first believers who made this possible</p>

    {#if founders.length === 0}
      <div class="empty-state">
        <p>No founders found.</p>
      </div>
    {:else}
      <div class="founders-grid">
        {#each founders as founder}
          <div class="founder-card">
            <div class="founder-number">#{founder.number}</div>

            <a href="/user/{getNpub(founder.pubkey)}" class="founder-avatar-wrapper">
              <CustomAvatar pubkey={founder.pubkey} size={80} className="founder-avatar-img" />
            </a>

            <div class="founder-info">
              <a href="/user/{getNpub(founder.pubkey)}" class="founder-name">
                <CustomName pubkey={founder.pubkey} className="founder-name-text" />
              </a>
            </div>

            <div class="founder-badge">Genesis Founder</div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .founders-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  /* Genesis Founders List */
  .genesis-founders {
    margin: 3rem 0;
  }

  .genesis-founders h2 {
    text-align: center;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    font-size: 2rem;
    font-weight: bold;
  }

  .subtitle {
    text-align: center;
    color: var(--color-text-secondary);
    margin-bottom: 2rem;
  }

  .loading-state,
  .empty-state {
    text-align: center;
    padding: 3rem;
    color: var(--color-text-secondary);
  }

  .founders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.5rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .founder-card {
    background: var(--color-bg-secondary);
    border: 2px solid var(--color-primary);
    border-radius: 12px;
    padding: 1.5rem;
    text-align: center;
    position: relative;
    color: var(--color-text-primary);
    transition:
      transform 0.2s,
      box-shadow 0.2s;
  }

  .founder-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(236, 71, 0, 0.2);
  }

  .founder-number {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-primary);
    color: white;
    font-weight: bold;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.85rem;
  }

  .founder-avatar-wrapper {
    margin: 1rem auto;
    position: relative;
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .founder-avatar-img {
    border: 3px solid var(--color-primary) !important;
  }

  .founder-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .founder-name {
    font-weight: 600;
    font-size: 1rem;
    text-decoration: none;
    color: var(--color-text-primary);
    transition: color 0.2s;
  }

  .founder-name:hover {
    color: var(--color-primary);
  }

  .founder-name-text {
    color: inherit;
  }

  .founder-badge {
    margin-top: 1rem;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--color-primary);
    font-weight: 600;
  }

  /* Dark mode adjustments */
  html.dark .founder-card {
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  }

  /* Mobile adjustments */
  @media (max-width: 640px) {
    .founders-page {
      padding: 1rem;
    }

    .genesis-founders {
      margin: 2rem 0;
    }

    .founders-grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 1rem;
    }

    .founder-card {
      padding: 1rem;
    }
  }
</style>
