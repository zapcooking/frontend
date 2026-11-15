<script lang="ts">
  /**
   * /admin/live/metrics — Go live usage and estimated Cloudflare cost.
   *
   *  - Cards: this month vs last month (UTC), from live_host_monthly.
   *  - Charts: viewer-minutes per day (the estimated cost is the same
   *    numbers at US$1 per 1,000 minutes, in the tooltip and on the
   *    axis label); streams per day by host. Both from the last 30 days
   *    of streams.
   *  - Per-host table (this or last month) and per-stream table (last
   *    30 days, CSV export). Both sortable.
   *
   * Every call is NIP-98 signed by an admin (/api/admin/live/metrics).
   * Streams are counted in their month once recorded, about 5 minutes
   * after they end; "Record ended streams now" runs that step at once.
   */
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { showToast } from '$lib/toast';
  import { adminActionError } from '$lib/live/adminClient';
  import {
    change,
    chartHosts,
    dailySeries,
    hostRows,
    monthTotals,
    sortBy,
    streamSeconds,
    streamsCsv,
    type Day,
    type HostRow,
    type MonthlyRow,
    type SortDir,
    type StreamRow
  } from '$lib/live/metricsView';

  $: authed = isAdmin($userPublickey);

  let loaded = false;
  let loading = false;
  let loadError = '';
  let busy = false;
  let now = 0;
  let thisMonth = '';
  let lastMonth = '';
  let monthly: MonthlyRow[] = [];
  let streams: StreamRow[] = [];
  let unrecorded = 0;
  let usdPer1000 = 1;
  let names: Record<string, string> = {};

  $: if (authed && !loaded && !loading && !loadError) load();

  async function signedFetch(method: 'GET' | 'POST', bodyString?: string) {
    const url = new URL('/api/admin/live/metrics', window.location.origin).toString();
    const auth = await signNip98AuthHeader($ndk, { method, url, bodyString });
    const headers: Record<string, string> = { Authorization: auth };
    if (bodyString !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: bodyString });
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await signedFetch('GET');
      if (!res.ok) throw new Error(res.status === 403 ? 'Forbidden' : `HTTP ${res.status}`);
      const data = await res.json();
      now = data.now;
      thisMonth = data.this_month;
      lastMonth = data.last_month;
      monthly = data.monthly ?? [];
      streams = data.streams ?? [];
      unrecorded = data.unrecorded ?? 0;
      usdPer1000 = data.usd_per_1000_minutes ?? 1;
      loaded = true;
      void loadNames([...new Set([...monthly, ...streams].map((r) => r.host_pubkey))]);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function recordNow() {
    busy = true;
    try {
      let res: Response;
      try {
        res = await signedFetch('POST', JSON.stringify({ action: 'record' }));
      } catch {
        showToast('error', adminActionError('network'));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast('error', adminActionError({ status: res.status, error: data?.error }));
        return;
      }
      const parts = [`${data.recorded ?? 0} recorded`];
      if (data.waiting) parts.push(`${data.waiting} waiting (presence or relays unreachable)`);
      if (data.gaveUp) parts.push(`${data.gaveUp} recorded without viewer time`);
      showToast('success', parts.join(' · '));
      await load();
    } finally {
      busy = false;
    }
  }

  async function loadNames(pubkeys: string[]) {
    for (const pk of pubkeys) {
      if (names[pk] !== undefined) continue;
      names = { ...names, [pk]: '' };
      try {
        const profile = await $ndk.getUser({ pubkey: pk }).fetchProfile();
        const name = (profile?.displayName || profile?.name || '').toString().trim();
        if (name) names = { ...names, [pk]: name };
      } catch {
        /* keeps the npub */
      }
    }
  }

  // ── Formatting ─────────────────────────────────────────────────────
  const npub = (hex: string) => nip19.npubEncode(hex);
  const hostLabel = (pk: string) => names[pk] || `${npub(pk).slice(0, 12)}…`;
  const int = (n: number) => Math.round(n).toLocaleString();
  const one = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const usd = (n: number) =>
    n < 10
      ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `$${Math.round(n).toLocaleString()}`;
  const duration = (secs: number) => {
    const m = Math.round(secs / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  };
  const when = (s: number | null) =>
    s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  const monthName = (m: string) =>
    m
      ? new Date(`${m}-01T00:00:00Z`).toLocaleString(undefined, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        })
      : '';
  function delta(nowV: number, lastV: number): { text: string; dir: 'up' | 'down' | 'flat' } {
    const c = change(nowV, lastV);
    if (c === null) return { text: nowV > 0 ? 'new' : '—', dir: 'flat' };
    if (Math.abs(c) < 0.005) return { text: 'same', dir: 'flat' };
    return {
      text: `${c > 0 ? '+' : '−'}${Math.round(Math.abs(c) * 100)}%`,
      dir: c > 0 ? 'up' : 'down'
    };
  }

  // ── Cards ──────────────────────────────────────────────────────────
  $: cur = monthTotals(monthly, thisMonth, usdPer1000);
  $: prev = monthTotals(monthly, lastMonth, usdPer1000);
  $: cards = [
    { label: 'Streams', now: cur.streams, last: prev.streams, fmt: int },
    { label: 'Hours streamed', now: cur.hours, last: prev.hours, fmt: one },
    { label: 'Viewer-minutes', now: cur.viewerMinutes, last: prev.viewerMinutes, fmt: int },
    { label: 'Est. Cloudflare cost', now: cur.costUsd, last: prev.costUsd, fmt: usd },
    { label: 'Sats zapped', now: cur.sats, last: prev.sats, fmt: int },
    { label: 'Active hosts', now: cur.activeHosts, last: prev.activeHosts, fmt: int }
  ];

  // ── Charts ─────────────────────────────────────────────────────────
  $: days = loaded ? dailySeries(streams, now, usdPer1000) : [];
  $: colored = chartHosts(streams, 5);
  $: hasOther = streams.some((s) => !colored.includes(s.host_pubkey));
  /** Fixed slot per host for this load: color follows the host, not a day's rank. */
  $: seriesKeys = [...colored, ...(hasOther ? ['other'] : [])];
  const seriesVar = (key: string, i: number) =>
    key === 'other' ? 'var(--viz-other)' : `var(--viz-${i + 1})`;
  const seriesName = (key: string) => (key === 'other' ? 'Other hosts' : hostLabel(key));
  function stackFor(d: Day): { key: string; value: number }[] {
    const parts = colored.map((k) => ({ key: k, value: d.streamsByHost.get(k) ?? 0 }));
    if (hasOther) {
      let other = 0;
      for (const [k, v] of d.streamsByHost) if (!colored.includes(k)) other += v;
      parts.push({ key: 'other', value: other });
    }
    return parts;
  }

  let chartWidth = 640;
  const H = 200;
  const PAD = { top: 12, right: 8, bottom: 26, left: 44 };
  $: plotW = Math.max(120, chartWidth - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  $: slot = days.length ? plotW / days.length : 0;
  $: barW = Math.max(2, Math.min(18, slot - 2));

  /** A round axis maximum and its ticks (0, half, max). */
  function niceMax(v: number): number {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  $: vmMax = niceMax(Math.max(0, ...days.map((d) => d.viewerMinutes)));
  $: stMax = Math.max(2, niceMax(Math.max(0, ...days.map((d) => d.streams))));
  const y = (v: number, max: number) => PAD.top + plotH - (v / max) * plotH;

  /** A bar with 4 px rounded top corners, anchored to the baseline. */
  function barPath(x: number, top: number, w: number, bottom: number, round: boolean): string {
    const h = bottom - top;
    if (h <= 0) return '';
    const r = round ? Math.min(4, w / 2, h) : 0;
    return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
  }
  const dayLabel = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    });

  /** Beside the hovered column, on the side with room, never over it. */
  function tipStyle(i: number, width: number): string {
    const left = PAD.left + i * slot;
    const gap = 8;
    const x =
      left + slot + gap + width <= chartWidth ? left + slot + gap : Math.max(0, left - gap - width);
    return `left:${x}px;width:${width}px`;
  }

  let hoverA: number | null = null;
  let hoverB: number | null = null;

  // ── Tables ─────────────────────────────────────────────────────────
  let hostMonth: 'this' | 'last' = 'this';
  let hostSort: { key: keyof HostRow | 'name'; dir: SortDir } = {
    key: 'viewerMinutes',
    dir: 'desc'
  };
  $: hostList = hostRows(monthly, hostMonth === 'this' ? thisMonth : lastMonth, usdPer1000).map(
    (r) => ({ ...r, name: hostLabel(r.pubkey) })
  );
  $: hostSorted = sortBy(hostList, hostSort.key as keyof (typeof hostList)[number], hostSort.dir);
  function sortHosts(key: keyof HostRow | 'name') {
    hostSort =
      hostSort.key === key
        ? { key, dir: hostSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' };
  }

  $: streamList = streams.map((s) => {
    const secs = streamSeconds(s, now);
    return {
      ...s,
      name: hostLabel(s.host_pubkey),
      seconds: secs,
      avg: s.viewer_seconds === null || secs === 0 ? null : s.viewer_seconds / secs,
      viewerMinutes: s.viewer_seconds === null ? null : s.viewer_seconds / 60,
      cost: s.viewer_seconds === null ? null : (s.viewer_seconds / 60 / 1000) * usdPer1000
    };
  });
  type StreamView = (typeof streamList)[number];
  let streamSort: { key: keyof StreamView; dir: SortDir } = { key: 'started_at', dir: 'desc' };
  $: streamSorted = sortBy(streamList, streamSort.key, streamSort.dir);
  const HOST_COLS: [keyof HostRow | 'name', string][] = [
    ['name', 'Host'],
    ['streams', 'Streams'],
    ['hours', 'Total hours'],
    ['longestSeconds', 'Longest'],
    ['avgViewers', 'Avg viewers'],
    ['peak', 'Peak'],
    ['viewerMinutes', 'Viewer-min'],
    ['costUsd', 'Est. cost'],
    ['sats', 'Sats']
  ];
  const STREAM_COLS: [keyof StreamView, string][] = [
    ['started_at', 'Started (UTC)'],
    ['name', 'Host'],
    ['title', 'Title'],
    ['seconds', 'Length'],
    ['peak_watching', 'Peak'],
    ['joins', 'Joins'],
    ['avg', 'Avg viewers'],
    ['viewerMinutes', 'Viewer-min'],
    ['cost', 'Est. cost'],
    ['zap_sats', 'Sats']
  ];
  const TEXT_COLS: string[] = ['started_at', 'name', 'title'];
  function sortStreams(key: keyof StreamView) {
    streamSort =
      streamSort.key === key
        ? { key, dir: streamSort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'title' ? 'asc' : 'desc' };
  }
  const ariaSort = (active: boolean, dir: SortDir) =>
    active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';

  function downloadCsv() {
    const csv = streamsCsv(sortBy(streams, 'started_at', 'desc'), now, usdPer1000, names);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zapcooking-live-streams-${new Date(now * 1000).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
</script>

<svelte:head>
  <title>Live metrics — Admin</title>
</svelte:head>

<div class="page viz">
  <a href="/admin/live" class="back">← Go live</a>
  <h1>Live metrics</h1>

  {#if !authed}
    <div class="status">Sign in with an admin account to see this page.</div>
  {:else if loadError}
    <div class="status status-error">
      Could not load: {loadError} <button on:click={load}>Retry</button>
    </div>
  {:else if !loaded}
    <div class="status">Loading…</div>
  {:else}
    <p class="lede">
      {monthName(thisMonth)} so far against {monthName(lastMonth)} (UTC). A stream counts once it is recorded,
      about 5 minutes after it ends.
      {#if unrecorded > 0}
        <strong
          >{unrecorded} ended {unrecorded === 1 ? 'stream is' : 'streams are'} not recorded yet.</strong
        >
      {/if}
      <button class="small" disabled={busy} on:click={recordNow}>Record ended streams now</button>
    </p>

    <ul class="cards">
      {#each cards as c (c.label)}
        {@const d = delta(c.now, c.last)}
        <li class="card">
          <span class="card-label">{c.label}</span>
          <span class="card-value">{c.fmt(c.now)}</span>
          <span class="card-sub">
            <span class="delta {d.dir}">{d.text}</span> vs {c.fmt(c.last)} last month
          </span>
        </li>
      {/each}
    </ul>
    <p class="note">
      Estimated cost = viewer-minutes × ${usdPer1000} per 1,000 (Cloudflare Stream delivery). Viewer time
      comes from the watch page's heartbeat, which stops while a tab is hidden, so it runs low against
      what Cloudflare bills.
    </p>

    <h2>Viewer-minutes per day</h2>
    <p class="chart-sub">
      Last 30 days, by the day each stream started. Est. cost is the same bars at ${usdPer1000} per 1,000
      minutes.
    </p>
    <div class="chart" bind:clientWidth={chartWidth}>
      <svg
        width={chartWidth}
        height={H}
        role="img"
        aria-label="Viewer-minutes per day, last 30 days"
      >
        {#each [0, vmMax / 2, vmMax] as t}
          <line
            class="grid"
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(t, vmMax)}
            y2={y(t, vmMax)}
          />
          <text class="tick" x={PAD.left - 6} y={y(t, vmMax) + 4} text-anchor="end">{int(t)}</text>
        {/each}
        {#each days as d, i (d.day)}
          {@const x = PAD.left + i * slot + (slot - barW) / 2}
          <path
            class="bar"
            class:dim={hoverA !== null && hoverA !== i}
            d={barPath(x, y(d.viewerMinutes, vmMax), barW, y(0, vmMax), true)}
          />
          {#if i % 7 === 2 || i === days.length - 1}
            <text class="tick" x={x + barW / 2} y={H - 8} text-anchor="middle"
              >{dayLabel(d.day)}</text
            >
          {/if}
          <rect
            class="hit"
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={plotH}
            role="presentation"
            on:mouseenter={() => (hoverA = i)}
            on:mouseleave={() => (hoverA = null)}
          />
        {/each}
      </svg>
      {#if hoverA !== null && days[hoverA]}
        {@const d = days[hoverA]}
        <div class="tooltip" style={tipStyle(hoverA, 170)}>
          <strong>{dayLabel(d.day)}</strong>
          <span>{int(d.viewerMinutes)} viewer-minutes</span>
          <span>{usd(d.costUsd)} est. cost</span>
          <span class="muted">{d.streams} {d.streams === 1 ? 'stream' : 'streams'}</span>
        </div>
      {/if}
    </div>

    <h2>Streams per day by host</h2>
    {#if seriesKeys.length > 0}
      <ul class="legend">
        {#each seriesKeys as k, i (k)}
          <li>
            <span class="swatch" style={`background:${seriesVar(k, i)}`}></span>{seriesName(k)}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="chart">
      <svg
        width={chartWidth}
        height={H}
        role="img"
        aria-label="Streams per day by host, last 30 days"
      >
        {#each [0, stMax / 2, stMax] as t}
          <line
            class="grid"
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(t, stMax)}
            y2={y(t, stMax)}
          />
          <text class="tick" x={PAD.left - 6} y={y(t, stMax) + 4} text-anchor="end">{one(t)}</text>
        {/each}
        {#each days as d, i (d.day)}
          {@const x = PAD.left + i * slot + (slot - barW) / 2}
          {@const parts = stackFor(d)}
          {@const topIndex = parts.map((p) => p.value > 0).lastIndexOf(true)}
          {#each parts as p, j (p.key)}
            {#if p.value > 0}
              {@const below = parts.slice(0, j).reduce((a, q) => a + q.value, 0)}
              <path
                class="seg"
                class:dim={hoverB !== null && hoverB !== i}
                style={`fill:${seriesVar(p.key, j)}`}
                d={barPath(
                  x,
                  y(below + p.value, stMax) + (j === topIndex ? 0 : 1),
                  barW,
                  y(below, stMax) - (j === 0 ? 0 : 1),
                  j === topIndex
                )}
              />
            {/if}
          {/each}
          {#if i % 7 === 2 || i === days.length - 1}
            <text class="tick" x={x + barW / 2} y={H - 8} text-anchor="middle"
              >{dayLabel(d.day)}</text
            >
          {/if}
          <rect
            class="hit"
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={plotH}
            role="presentation"
            on:mouseenter={() => (hoverB = i)}
            on:mouseleave={() => (hoverB = null)}
          />
        {/each}
      </svg>
      {#if hoverB !== null && days[hoverB]}
        {@const d = days[hoverB]}
        <div class="tooltip" style={tipStyle(hoverB, 190)}>
          <strong>{dayLabel(d.day)} · {d.streams} {d.streams === 1 ? 'stream' : 'streams'}</strong>
          {#each stackFor(d).filter((p) => p.value > 0) as p (p.key)}
            <span>{seriesName(p.key)}: {p.value}</span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="table-head">
      <h2>Hosts</h2>
      <div class="seg-toggle" role="group" aria-label="Month">
        <button class:on={hostMonth === 'this'} on:click={() => (hostMonth = 'this')}
          >{monthName(thisMonth)}</button
        >
        <button class:on={hostMonth === 'last'} on:click={() => (hostMonth = 'last')}
          >{monthName(lastMonth)}</button
        >
      </div>
    </div>
    {#if hostSorted.length === 0}
      <div class="status">
        No recorded streams in {monthName(hostMonth === 'this' ? thisMonth : lastMonth)}.
      </div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each HOST_COLS as [key, label] (key)}
                <th
                  aria-sort={ariaSort(hostSort.key === key, hostSort.dir)}
                  class:num={key !== 'name'}
                >
                  <button on:click={() => sortHosts(key)}>
                    {label}{hostSort.key === key ? (hostSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each hostSorted as r (r.pubkey)}
              <tr>
                <td
                  ><a href={`/user/${npub(r.pubkey)}`} target="_blank" rel="noopener">{r.name}</a
                  ></td
                >
                <td class="num">{int(r.streams)}</td>
                <td class="num">{one(r.hours)}</td>
                <td class="num">{duration(r.longestSeconds)}</td>
                <td class="num">{one(r.avgViewers)}</td>
                <td class="num">{int(r.peak)}</td>
                <td class="num">{int(r.viewerMinutes)}</td>
                <td class="num">{usd(r.costUsd)}</td>
                <td class="num">{int(r.sats)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="table-head">
      <h2>Streams, last 30 days ({streams.length})</h2>
      <button class="small" disabled={streams.length === 0} on:click={downloadCsv}
        >Export CSV</button
      >
    </div>
    {#if streamSorted.length === 0}
      <div class="status">No streams in the last 30 days.</div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each STREAM_COLS as [key, label] (key)}
                <th
                  aria-sort={ariaSort(streamSort.key === key, streamSort.dir)}
                  class:num={!TEXT_COLS.includes(key)}
                >
                  <button on:click={() => sortStreams(key)}>
                    {label}{streamSort.key === key ? (streamSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each streamSorted as s (s.id)}
              <tr>
                <td class="nowrap">{when(s.started_at)}</td>
                <td
                  ><a href={`/user/${npub(s.host_pubkey)}`} target="_blank" rel="noopener"
                    >{s.name}</a
                  ></td
                >
                <td>
                  <a href={`/live/s/${s.id}`} target="_blank" rel="noopener">{s.title}</a>
                  {#if s.status !== 'ended'}<span class="pill live">{s.status}</span>{/if}
                  {#if s.status === 'ended' && s.metrics_at === null}<span class="pill"
                      >not recorded</span
                    >{/if}
                </td>
                <td class="num nowrap">{duration(s.seconds)}</td>
                <td class="num">{int(s.peak_watching)}</td>
                <td class="num">{int(s.joins)}</td>
                <td class="num">{s.avg === null ? '—' : one(s.avg)}</td>
                <td class="num">{s.viewerMinutes === null ? '—' : int(s.viewerMinutes)}</td>
                <td class="num">{s.cost === null ? '—' : usd(s.cost)}</td>
                <td class="num">{s.zap_sats === null ? '—' : int(s.zap_sats)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .viz {
    /* Categorical slots 1–5 (validated light on #fff, dark on #111827) and a neutral "Other". */
    --viz-1: #2a78d6;
    --viz-2: #eb6834;
    --viz-3: #1baf7a;
    --viz-4: #eda100;
    --viz-5: #e87ba4;
    --viz-other: #9ca3af;
    --viz-bar: #2a78d6;
    --viz-grid: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  }
  :global(html.dark) .viz {
    --viz-1: #3987e5;
    --viz-2: #d95926;
    --viz-3: #199e70;
    --viz-4: #c98500;
    --viz-5: #d55181;
    --viz-other: #6b7280;
    --viz-bar: #3987e5;
  }
  .page {
    max-width: 1040px;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
    color: var(--color-text-primary);
  }
  .back {
    display: inline-block;
    margin-bottom: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 700;
    margin: 2rem 0 0.5rem;
  }
  .lede,
  .note,
  .chart-sub {
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .note {
    font-size: 0.8125rem;
    margin-top: 0.5rem;
  }
  .chart-sub {
    margin: 0 0 0.5rem;
  }
  .status {
    padding: 1.25rem;
    text-align: center;
    color: var(--color-text-secondary);
  }
  .status-error {
    color: var(--color-danger);
  }
  button {
    font: inherit;
    color: var(--color-text-primary);
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.small {
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    margin-left: 0.25rem;
  }
  .cards {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }
  @media (max-width: 560px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
  }
  .card-label {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
  .card-value {
    font-size: 1.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .card-sub {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }
  .delta {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .delta.up::before {
    content: '▲ ';
    font-size: 0.625rem;
  }
  .delta.down::before {
    content: '▼ ';
    font-size: 0.625rem;
  }
  .chart {
    position: relative;
    width: 100%;
  }
  .chart svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--viz-grid);
    stroke-width: 1;
  }
  .tick {
    font-size: 11px;
    fill: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .bar {
    fill: var(--viz-bar);
  }
  .bar.dim,
  .seg.dim {
    opacity: 0.45;
  }
  .hit {
    fill: transparent;
  }
  .tooltip {
    position: absolute;
    top: 0;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    box-sizing: border-box;
    padding: 0.5rem 0.625rem;
    font-size: 0.8125rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.375rem;
    background: var(--color-bg-primary);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .legend {
    list-style: none;
    margin: 0 0 0.5rem;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    font-size: 0.8125rem;
    color: var(--color-text-primary);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .table-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .seg-toggle {
    display: inline-flex;
  }
  .seg-toggle button {
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    border-radius: 0;
  }
  .seg-toggle button:first-child {
    border-radius: 0.375rem 0 0 0.375rem;
  }
  .seg-toggle button:last-child {
    border-radius: 0 0.375rem 0.375rem 0;
    border-left: 0;
  }
  .seg-toggle button.on {
    background: var(--color-text-primary);
    color: var(--color-bg-primary);
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 0.5rem 0.625rem;
    text-align: left;
    border-bottom: 1px solid var(--color-input-border);
  }
  tbody tr:last-child td {
    border-bottom: 0;
  }
  th {
    white-space: nowrap;
    background: var(--color-bg-secondary);
  }
  th button {
    border: 0;
    background: none;
    padding: 0;
    font-weight: 600;
    color: var(--color-text-secondary);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  td:nth-child(2) {
    white-space: nowrap;
  }
  td:has(a[href^='/live/s/']) {
    min-width: 11rem;
  }
  .nowrap {
    white-space: nowrap;
  }
  td a {
    color: inherit;
  }
  .pill {
    display: inline-block;
    margin-left: 0.375rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    font-size: 0.6875rem;
    border: 1px solid var(--color-input-border);
    color: var(--color-text-secondary);
  }
  .pill.live {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
</style>
