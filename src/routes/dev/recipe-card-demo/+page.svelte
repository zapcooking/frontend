<script lang="ts">
  /**
   * Dev-only demo for RecipeCard's two variants: the recipe-grid poster
   * ('grid') and the Fresh feed hero ('feed'). Mock events, no relays —
   * RecipeCard only reads tags. Eyeball both at 390 / 768 / 1280 widths.
   */
  import RecipeCard from '../../../components/RecipeCard.svelte';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';

  function mockEvent(seed: number, title: string, img: string): NDKEvent {
    return {
      id: 'a'.repeat(64),
      kind: 30023,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
      tags: [
        ['d', `demo-recipe-${seed}`],
        ['title', title],
        ['image', img]
      ],
      content: ''
    } as unknown as NDKEvent;
  }

  // Picsum seeds give stable, dimensionally-addressable fixtures: a
  // portrait source like the chilaquiles photo, a landscape, a square.
  const fixtures = [
    {
      label: 'feed — portrait source (2:3 photo)',
      event: mockEvent(1, 'Quick Chilaquiles with Huevos Rancheros', 'https://picsum.photos/seed/zc-recipe-1/900/1400')
    },
    {
      label: 'feed — landscape source',
      event: mockEvent(2, 'Slow-Braised Short Rib Ramen', 'https://picsum.photos/seed/zc-recipe-2/1600/900')
    },
    {
      label: 'feed — no image (placeholder fallback)',
      event: mockEvent(3, 'Three-Ingredient Peanut Butter Cookies', '')
    },
    {
      label: 'grid — same event for comparison',
      event: mockEvent(1, 'Quick Chilaquiles with Huevos Rancheros', 'https://picsum.photos/seed/zc-recipe-1/900/1400')
    }
  ];
</script>

<svelte:head>
  <title>Dev — RecipeCard variants</title>
</svelte:head>

<div class="page">
  <header>
    <h1>RecipeCard — grid vs feed variants</h1>
    <p class="note">
      The first three cards use <code>variant="feed"</code> (Fresh feed:
      full-column 4:3 hero). The last uses the default
      <code>variant="grid"</code> (recipe grids: 160px 2:3 poster).
    </p>
  </header>

  {#each fixtures as fixture}
    <section>
      <h2>{fixture.label}</h2>
      <!-- Mirrors FreshPostCard's card chrome (padding + sunken bg). -->
      <div class="fresh-post">
        <RecipeCard event={fixture.event} variant="feed" />
      </div>
    </section>
  {/each}

  <section>
    <h2>grid — inside its native poster grid</h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-6 justify-items-center items-start">
      {#each [4, 5, 6] as seed}
        <RecipeCard event={mockEvent(seed, `Grid recipe ${seed}`, `https://picsum.photos/seed/zc-recipe-${seed}/900/1400`)} />
      {/each}
    </div>
  </section>
</div>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem 6rem;
    color: var(--color-text-primary);
  }
  header {
    margin-bottom: 2rem;
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    font-weight: 600;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .note {
    margin: 0 0 0.5rem;
    color: var(--color-caption);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  code {
    background-color: var(--color-input-bg);
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.8125rem;
  }
  section {
    margin-bottom: 2.5rem;
  }
  .fresh-post {
    padding: 1.125rem 1.25rem;
    background-color: var(--color-card-sunken);
    border-radius: 1rem;
  }
</style>
