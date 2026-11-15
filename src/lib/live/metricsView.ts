/**
 * /admin/live/metrics — the numbers the page shows, from the API's rows.
 * Pure, for tests. Months and days are UTC, like live_host_monthly.
 */

export interface MonthlyRow {
  host_pubkey: string;
  month: string;
  streams: number;
  stream_seconds: number;
  longest_seconds: number;
  viewer_seconds: number;
  peak_watching: number;
  zap_sats: number;
}

export interface StreamRow {
  id: string;
  host_pubkey: string;
  title: string;
  status: 'created' | 'live' | 'ended';
  end_reason: string | null;
  started_at: number;
  ended_at: number | null;
  peak_watching: number;
  joins: number;
  viewer_seconds: number | null;
  zap_sats: number | null;
  metrics_at: number | null;
}

/** Estimated Cloudflare cost of `viewerSeconds`, US$. */
export const costUsd = (viewerSeconds: number, usdPer1000: number) =>
  (viewerSeconds / 60 / 1000) * usdPer1000;

export interface MonthTotals {
  streams: number;
  hours: number;
  viewerMinutes: number;
  costUsd: number;
  sats: number;
  activeHosts: number;
}

export function monthTotals(rows: MonthlyRow[], month: string, usdPer1000: number): MonthTotals {
  const t = { streams: 0, seconds: 0, viewerSeconds: 0, sats: 0, hosts: 0 };
  for (const r of rows) {
    if (r.month !== month || r.streams <= 0) continue;
    t.streams += r.streams;
    t.seconds += r.stream_seconds;
    t.viewerSeconds += r.viewer_seconds;
    t.sats += r.zap_sats;
    t.hosts++;
  }
  return {
    streams: t.streams,
    hours: t.seconds / 3600,
    viewerMinutes: t.viewerSeconds / 60,
    costUsd: costUsd(t.viewerSeconds, usdPer1000),
    sats: t.sats,
    activeHosts: t.hosts
  };
}

/** Relative change from `last` to `now`, or null when there is no base. */
export function change(now: number, last: number): number | null {
  if (!(last > 0)) return null;
  return (now - last) / last;
}

export interface HostRow {
  pubkey: string;
  streams: number;
  hours: number;
  longestSeconds: number;
  /** Viewer time over stream time: how many were watching on average. */
  avgViewers: number;
  peak: number;
  viewerMinutes: number;
  costUsd: number;
  sats: number;
}

export function hostRows(rows: MonthlyRow[], month: string, usdPer1000: number): HostRow[] {
  return rows
    .filter((r) => r.month === month && r.streams > 0)
    .map((r) => ({
      pubkey: r.host_pubkey,
      streams: r.streams,
      hours: r.stream_seconds / 3600,
      longestSeconds: r.longest_seconds,
      avgViewers: r.stream_seconds > 0 ? r.viewer_seconds / r.stream_seconds : 0,
      peak: r.peak_watching,
      viewerMinutes: r.viewer_seconds / 60,
      costUsd: costUsd(r.viewer_seconds, usdPer1000),
      sats: r.zap_sats
    }));
}

export type SortDir = 'asc' | 'desc';

/** A sorted copy. Ties keep their order. Strings compare case-insensitively. */
export function sortBy<T>(rows: T[], key: keyof T, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[key] as unknown;
      const y = b.row[key] as unknown;
      // Missing values always sort last.
      if (x === null || x === undefined) return y === null || y === undefined ? a.i - b.i : 1;
      if (y === null || y === undefined) return -1;
      const c =
        typeof x === 'string' && typeof y === 'string'
          ? x.localeCompare(y, undefined, { sensitivity: 'base' })
          : (x as number) - (y as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.row);
}

/** Seconds a stream ran (to now while still live). */
export function streamSeconds(s: StreamRow, now: number): number {
  return Math.max(0, (s.ended_at ?? now) - s.started_at);
}

/** 'YYYY-MM-DD' (UTC). */
export const dayKey = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);

export interface Day {
  day: string;
  viewerMinutes: number;
  costUsd: number;
  /** Streams started that day, per host. */
  streamsByHost: Map<string, number>;
  streams: number;
}

/** The last `days` UTC days, oldest first, ending today; streams filed by start day. */
export function dailySeries(
  streams: StreamRow[],
  now: number,
  usdPer1000: number,
  days = 30
): Day[] {
  const out: Day[] = [];
  const index = new Map<string, Day>();
  for (let i = days - 1; i >= 0; i--) {
    const d: Day = {
      day: dayKey(now - i * 86_400),
      viewerMinutes: 0,
      costUsd: 0,
      streamsByHost: new Map(),
      streams: 0
    };
    out.push(d);
    index.set(d.day, d);
  }
  for (const s of streams) {
    const d = index.get(dayKey(s.started_at));
    if (!d) continue;
    const vs = s.viewer_seconds ?? 0;
    d.viewerMinutes += vs / 60;
    d.costUsd += costUsd(vs, usdPer1000);
    d.streams++;
    d.streamsByHost.set(s.host_pubkey, (d.streamsByHost.get(s.host_pubkey) ?? 0) + 1);
  }
  return out;
}

/**
 * The hosts that get their own color in "streams per day": the `max` with
 * the most streams (ties by key, so the order is stable), then 'other'.
 */
export function chartHosts(streams: StreamRow[], max = 5): string[] {
  const counts = new Map<string, number>();
  for (const s of streams) counts.set(s.host_pubkey, (counts.get(s.host_pubkey) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([pk]) => pk);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const iso = (s: number | null) => (s === null ? '' : new Date(s * 1000).toISOString());

/** The per-stream table as CSV (RFC 4180, CRLF), one row per stream. */
export function streamsCsv(
  streams: StreamRow[],
  now: number,
  usdPer1000: number,
  names: Record<string, string> = {}
): string {
  const header = [
    'session_id',
    'host_pubkey',
    'host_name',
    'title',
    'status',
    'end_reason',
    'started_at_utc',
    'ended_at_utc',
    'minutes',
    'peak_watching',
    'joins',
    'avg_watching',
    'viewer_minutes',
    'est_cost_usd',
    'zap_sats',
    'recorded'
  ];
  const lines = [header.join(',')];
  for (const s of streams) {
    const secs = streamSeconds(s, now);
    const vs = s.viewer_seconds;
    lines.push(
      [
        s.id,
        s.host_pubkey,
        names[s.host_pubkey] ?? '',
        s.title,
        s.status,
        s.end_reason ?? '',
        iso(s.started_at),
        iso(s.ended_at),
        (secs / 60).toFixed(1),
        s.peak_watching,
        s.joins,
        vs === null || secs === 0 ? '' : (vs / secs).toFixed(2),
        vs === null ? '' : (vs / 60).toFixed(1),
        vs === null ? '' : costUsd(vs, usdPer1000).toFixed(4),
        s.zap_sats ?? '',
        s.metrics_at === null ? 'no' : 'yes'
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}
