<script context="module" lang="ts">
  // Dev-only tooling — redirect away in production builds. (Checked via
  // PROD so the branch survives DEV being inlined+eliminated at build.)
  import { redirect } from '@sveltejs/kit';
  if (import.meta.env.PROD) {
    throw redirect(307, '/');
  }
</script>

<script lang="ts">
  /**
   * Preview for the mining indicator, which otherwise only appears mid-post
   * and only for a signed-in user — so the one piece of this feature whose
   * whole job is to be looked at was also the one piece that could not be.
   *
   * It drives the real store, so what appears is the real indicator the
   * layout mounts, in its real position. "Mine" runs a real mine through
   * the real worker; the state buttons just park the store somewhere so a
   * given moment can be inspected without waiting for it.
   */
  import { minePow, powCancel, isPowCanceled } from '$lib/powMiner';
  import { POW_LEVELS } from '$lib/pow';
  import {
    miningOp,
    startMiningOp,
    reportMiningBest,
    markMiningFound,
    endMiningOp
  } from '$lib/stores/miningOp';

  let bits = 20;
  let result = '';

  async function run() {
    result = '';
    startMiningOp(bits, powCancel);
    const startedAt = Date.now();
    try {
      const mined = await minePow(
        {
          pubkey: 'a'.repeat(64),
          created_at: Math.floor(Date.now() / 1000),
          kind: 1,
          tags: [['client', 'Zap Cooking']],
          content: 'dev preview mine'
        },
        bits,
        (p) => reportMiningBest(p.best)
      );
      markMiningFound();
      result = `Reached ${mined.difficulty} bits in ${mined.attempts.toLocaleString()} attempts (${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s)`;
      setTimeout(endMiningOp, 800);
    } catch (err) {
      endMiningOp();
      result = isPowCanceled(err) ? 'Stopped.' : `Failed: ${String(err)}`;
    }
  }

  function park(best: number, found: boolean, age = 0) {
    miningOp.set({ bits: 22, startedAt: Date.now() - age * 1000, best, found, stop: endMiningOp });
  }
</script>

<div class="max-w-2xl w-full px-4 py-8 flex flex-col gap-8">
  <div>
    <h1 class="text-xl font-bold" style="color: var(--color-text-primary)">Mining indicator</h1>
    <p class="text-sm text-caption mt-1">
      The floating pill a composer leaves behind while it mines. Dev-only route; it appears at the
      bottom of the window.
    </p>
  </div>

  <section class="flex flex-col gap-3">
    <h2 class="text-sm font-semibold" style="color: var(--color-text-primary)">Live mine</h2>
    <div class="flex gap-2 flex-wrap items-center">
      {#each POW_LEVELS as level (level.bits)}
        <button
          class="px-3 py-1.5 rounded-full text-sm font-medium {bits === level.bits
            ? 'bg-orange-500 text-white'
            : 'bg-secondary'}"
          style={bits === level.bits ? '' : 'color: var(--color-text-primary)'}
          on:click={() => (bits = level.bits)}
          disabled={!!$miningOp}
        >{level.bits}</button>
      {/each}
      <button
        class="px-3 py-1.5 rounded-lg text-sm font-medium bg-input"
        style="color: var(--color-text-primary)"
        on:click={run}
        disabled={!!$miningOp}
      >Mine</button>
    </div>
    <p class="text-sm text-caption">{result || 'Idle.'}</p>
  </section>

  <section class="flex flex-col gap-3">
    <h2 class="text-sm font-semibold" style="color: var(--color-text-primary)">Parked states</h2>
    <div class="flex gap-2 flex-wrap">
      <button class="state-btn" on:click={() => park(0, false, 0)}>Just started</button>
      <button class="state-btn" on:click={() => park(19, false, 14)}>Mid-mine</button>
      <button class="state-btn" on:click={() => park(22, true, 31)}>Found</button>
      <button class="state-btn" on:click={endMiningOp}>Clear</button>
    </div>
  </section>
</div>

<style>
  .state-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 500;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }
</style>
