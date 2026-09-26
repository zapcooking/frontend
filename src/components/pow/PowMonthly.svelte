<script lang="ts">
  import { REPOS } from '$lib/shipped/config';
  import { REPO_LABELS, formatNumber, monthlyRows } from '$lib/shipped/viewModel';
  import type { PowPayload } from '$lib/shipped/types';

  export let summary: PowPayload;

  $: rows = monthlyRows(summary);
  $: total = rows.length ? rows[rows.length - 1].cumulative : 0;

  // Running total as an inline SVG: one point at the end of each month.
  const W = 600;
  const H = 140;
  const PAD = 6;
  $: points = rows.map((r, i) => {
    const x = rows.length > 1 ? PAD + (i * (W - 2 * PAD)) / (rows.length - 1) : W / 2;
    const y = total > 0 ? H - PAD - (r.cumulative / total) * (H - 2 * PAD) : H - PAD;
    return { x, y, label: r.label, cumulative: r.cumulative };
  });
  $: line = points.map((p) => `${p.x},${p.y}`).join(' ');
  $: area = points.length ? `${PAD},${H - PAD} ${line} ${points[points.length - 1].x},${H - PAD}` : '';
  $: last = rows[rows.length - 1];
</script>

<section class="monthly" aria-labelledby="pow-monthly-title">
  <h2 id="pow-monthly-title">Month by month</h2>

  <figure>
    <svg
      viewBox="0 0 {W} {H}"
      preserveAspectRatio="none"
      role="img"
      aria-label={last
        ? `Running total of merged pull requests: ${formatNumber(total)} by the end of ${last.label}`
        : 'No merged pull requests yet'}
    >
      <polygon class="area" points={area} />
      <polyline class="line" points={line} />
    </svg>
    <figcaption>Running total, {formatNumber(total)} PRs</figcaption>
  </figure>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col" class="num">PRs</th>
          <th scope="col" class="num">Lines</th>
          <th scope="col">By app</th>
        </tr>
      </thead>
      <tbody>
        {#each [...rows].reverse() as r (r.month)}
          <tr>
            <th scope="row">{r.label}</th>
            <td class="num">{formatNumber(r.prs)}</td>
            <td class="num lines">
              <span class="add">+{formatNumber(r.countedAdditions)}</span>
              <span class="del">−{formatNumber(r.countedDeletions)}</span>
            </td>
            <td>
              <div class="split">
                {#if r.prs > 0}
                  <div class="bar" aria-hidden="true">
                    {#each REPOS as repo}
                      {#if r.byRepo[repo] > 0}
                        <span class="seg seg-{repo}" style="flex: {r.byRepo[repo]}" />
                      {/if}
                    {/each}
                  </div>
                {/if}
                <span class="split-text">
                  {REPOS.filter((repo) => r.byRepo[repo] > 0)
                    .map((repo) => `${REPO_LABELS[repo]} ${r.byRepo[repo]}`)
                    .join(' · ') || '—'}
                </span>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>

<style>
  .monthly {
    background: var(--color-bg-secondary);
    border-radius: 12px;
    padding: 1.25rem;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-text-primary);
    margin-bottom: 0.75rem;
  }
  figure {
    margin: 0 0 1rem;
  }
  svg {
    width: 100%;
    height: 140px;
    display: block;
  }
  .area {
    fill: color-mix(in srgb, var(--color-primary) 14%, transparent);
  }
  .line {
    fill: none;
    stroke: var(--color-primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  figcaption {
    font-size: 0.75rem;
    color: var(--color-caption);
    margin-top: 0.25rem;
  }
  .table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem 0.5rem 0.5rem 0;
    border-top: 1px solid var(--color-input-border);
    white-space: nowrap;
  }
  thead th {
    border-top: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  tbody th {
    font-weight: 600;
  }
  .num {
    text-align: right;
    padding-right: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .lines {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .add {
    color: #16a34a;
  }
  .del {
    color: var(--color-text-secondary);
  }
  :global(html.dark) .add {
    color: #4ade80;
  }
  .split {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .bar {
    display: flex;
    width: 72px;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    flex-shrink: 0;
    gap: 1px;
  }
  .seg-frontend {
    background: var(--color-primary);
  }
  .seg-zap_cooking_android {
    background: color-mix(in srgb, var(--color-primary) 55%, var(--color-card-sunken));
  }
  .seg-zapcooking_ios {
    background: var(--color-caption);
  }
  .split-text {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
</style>
