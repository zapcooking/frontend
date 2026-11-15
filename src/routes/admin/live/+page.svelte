<script lang="ts">
  /**
   * /admin/live — Go live rollout and moderation.
   *
   *  - Hosting mode: "approved" (only accounts on the approved list may go
   *    live; the default) or "members" (any active member).
   *  - Access requests: pending "Request access" asks with the
   *    requester's profile, note and membership. Approve (adds to the
   *    approved list) or Decline; both logged.
   *  - Approved hosts: add, remove, list.
   *  - Blocked hosts: block by key, unblock (right after Approved hosts).
   *  - Streams: open ones, ones whose input is still being deleted, and
   *    ones under an open report hold. End, block the host.
   *  - Reports: each report hold with its reports. Release the hold once
   *    the report is resolved.
   *  - Action log: every admin action, with time and actor.
   *
   * Every call is NIP-98 signed by the admin account (/api/admin/live),
   * and every action is written to the action log by the server.
   */
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { showToast } from '$lib/toast';
  import { adminActionError, displayedMode, displayedOff } from '$lib/live/adminClient';

  interface Session {
    id: string;
    host_pubkey: string;
    title: string;
    status: 'created' | 'live' | 'ended';
    end_reason: string | null;
    created_at: number;
    started_at: number | null;
    ended_at: number | null;
    guest_joins: number;
    input_recorded: boolean;
    hold_status: 'open' | 'released' | null;
  }
  interface Listed {
    pubkey: string;
    created_at: number;
    added_by?: string;
  }
  interface Incident {
    report_count: number;
    session_id: string;
    status: 'open' | 'released';
    opened_at: number;
    released_at: number | null;
    title: string;
    host_pubkey: string;
    reports: {
      reason: string;
      details: string;
      comment_id: string | null;
      comment_pubkey: string | null;
      created_at: number;
    }[];
  }
  interface AccessRequest {
    id: string;
    pubkey: string;
    note: string;
    created_at: number;
    membership: 'active' | 'inactive' | 'unknown';
  }
  interface Action {
    id: string;
    occurred_at: number;
    actor: string;
    action: string;
    session_id: string | null;
    target_pubkey: string | null;
    detail: string;
  }

  const REASON_LABELS: Record<string, string> = {
    child_safety: 'Child safety',
    violence: 'Violence / danger',
    nudity: 'Nudity',
    spam: 'Spam',
    other: 'Other'
  };

  $: authed = isAdmin($userPublickey);

  let loaded = false;
  let sessions: Session[] = [];
  let approved: Listed[] = [];
  let requests: AccessRequest[] = [];
  /** Display names for requesters, from their Nostr profiles (best effort). */
  let names: Record<string, string> = {};
  let blocked: Listed[] = [];
  let incidents: Incident[] = [];
  let actions: Action[] = [];
  /** The off flag as KV reads it (can lag ~1 min) and as last switched (action log). */
  let offRead = false;
  let offSet: boolean | null = null;
  $: offShown = displayedOff(offRead, offSet);
  $: off = offShown.off;
  /** The mode as KV reads it (can lag ~1 min) and as last switched (action log). */
  let modeRead: 'approved' | 'members' = 'approved';
  let modeSet: 'approved' | 'members' | null = null;
  $: shown = displayedMode(modeRead, modeSet);
  $: mode = shown.mode;
  let loading = false;
  let loadError = '';
  let actionError = '';
  let busy = false;
  let approveInput = '';
  let blockInput = '';

  $: if (authed && !loaded && !loading && !loadError) load();

  async function signedFetch(method: 'GET' | 'POST', bodyString?: string) {
    const url = new URL('/api/admin/live', window.location.origin).toString();
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
      sessions = data.sessions ?? [];
      approved = data.approved ?? [];
      requests = data.requests ?? [];
      void loadNames(requests.map((r) => r.pubkey));
      blocked = data.blocked ?? [];
      incidents = data.incidents ?? [];
      actions = data.actions ?? [];
      offRead = !!data.off;
      offSet = typeof data.off_set === 'boolean' ? data.off_set : null;
      modeRead = data.mode === 'members' ? 'members' : 'approved';
      modeSet = data.mode_set === 'members' || data.mode_set === 'approved' ? data.mode_set : null;
      loaded = true;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  /** Show a failure where it can't be missed: the banner at the top and a toast. */
  function fail(message: string) {
    actionError = message;
    showToast('error', message);
  }

  /**
   * Run one admin action. True when it was sent and accepted. Every
   * failure is shown (banner + toast). After every action the page is
   * reloaded from the server; a mode switch also takes the mode from the
   * server's reply, so the page never shows a stale mode.
   */
  async function act(body: Record<string, unknown>, confirmText?: string): Promise<boolean> {
    if (confirmText && !confirm(confirmText)) return false;
    busy = true;
    actionError = '';
    try {
      let res: Response;
      try {
        res = await signedFetch('POST', JSON.stringify(body));
      } catch {
        fail(adminActionError('network'));
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail(adminActionError({ status: res.status, error: data?.error }));
        await load();
        return false;
      }
      if (body.action === 'mode' && (data.mode === 'members' || data.mode === 'approved')) {
        modeSet = data.mode;
      }
      if (body.action === 'off' && data.flag_written === true && typeof data.off === 'boolean') {
        offSet = data.off;
      }
      await load();
      // The log is how the page knows the last switch. If the switch worked
      // but its log entry failed, the reload above read the PREVIOUS switch
      // from the log: keep the state the server just confirmed instead.
      if (data.logged === false) {
        if (body.action === 'mode' && (data.mode === 'members' || data.mode === 'approved')) {
          modeSet = data.mode;
        }
        if (body.action === 'off' && data.flag_written === true && typeof data.off === 'boolean') {
          offSet = data.off;
        }
      }
      if (body.action === 'off' && data.flag_written === false) {
        fail(
          'The off switch could not be saved (KV). ' +
            (body.on ? `Open streams were still ended (${data.ended ?? 0}).` : 'Nothing changed.') +
            ' Try again.'
        );
        return false;
      }
      if (data.logged === false) fail('Done, but the action log entry could not be written.');
      return true;
    } finally {
      busy = false;
    }
  }

  /** Every report of one incident, when it has more than the list shows. */
  let allReports: Record<string, Incident['reports']> = {};
  async function showAllReports(sessionId: string) {
    try {
      const url = new URL('/api/admin/live', window.location.origin);
      url.searchParams.set('incident', sessionId);
      const auth = await signNip98AuthHeader($ndk, { method: 'GET', url: url.toString() });
      const res = await fetch(url, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail(adminActionError({ status: res.status, error: data?.error }));
        return;
      }
      allReports = { ...allReports, [sessionId]: data.reports ?? [] };
    } catch {
      fail(adminActionError('network'));
    }
  }

  async function loadNames(pubkeys: string[]) {
    for (const pk of pubkeys) {
      if (names[pk] !== undefined) continue;
      try {
        const profile = await $ndk.getUser({ pubkey: pk }).fetchProfile();
        const name = (profile?.displayName || profile?.name || '').toString().trim();
        names = { ...names, [pk]: name };
      } catch {
        names = { ...names, [pk]: '' };
      }
    }
  }

  /** Hex from an npub or a hex string, or null. */
  function toHex(value: string): string | null {
    const v = value.trim();
    if (/^[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
    try {
      const decoded = nip19.decode(v);
      if (decoded.type === 'npub') return decoded.data as string;
    } catch {
      /* not an npub */
    }
    return null;
  }

  async function addTyped(kind: 'approve' | 'block') {
    const pk = toHex(kind === 'approve' ? approveInput : blockInput);
    if (!pk) {
      actionError = 'Enter an npub or a 64-character hex key.';
      return;
    }
    const ok = await act(
      { action: kind, pubkey: pk },
      kind === 'block' ? blockConfirm : undefined
    );
    if (ok) {
      if (kind === 'approve') approveInput = '';
      else blockInput = '';
    }
  }

  function switchMode(next: 'approved' | 'members') {
    const text =
      next === 'members'
        ? 'Open hosting to ALL active members? The approved list stops being checked (takes about a minute to apply everywhere).'
        : 'Limit hosting to the approved list again? Members not on the list can no longer start a stream (running streams continue).';
    void act({ action: 'mode', mode: next }, text);
  }

  const blockConfirm = 'Block this account from going live? Its open stream (if any) ends now.';
  const npub = (hex: string) => nip19.npubEncode(hex);
  const short = (hex: string) => `${npub(hex).slice(0, 14)}…`;
  const MEMBERSHIP_LABELS = { active: 'Active member', inactive: 'Not a member', unknown: 'Membership unknown' };
  const when = (s: number | null) =>
    s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
  $: isBlocked = (pk: string) => blocked.some((b) => b.pubkey === pk);
</script>

<svelte:head>
  <title>Go live — Admin</title>
</svelte:head>

<div class="page">
  <a href="/admin" class="back">← Admin</a>
  <h1>Go live</h1>
  <a href="/admin/live/metrics" class="back">Live metrics →</a>

  {#if !authed}
    <div class="status">Sign in with the admin account to use this page.</div>
  {:else if loading && !loaded}
    <div class="status">Loading…</div>
  {:else if loadError}
    <div class="status status-error">{loadError}</div>
  {:else}
    {#if actionError}
      <div class="action-error" role="alert">
        <span>{actionError}</span>
        <button on:click={() => (actionError = '')} aria-label="Dismiss">✕</button>
      </div>
    {/if}

    <h2>Go live switch</h2>
    <div class="card">
      <div class="row">
        <strong class:off-label={off}>{off ? 'Go live is OFF for everyone' : 'Go live is on'}</strong>
        {#if offShown.applying}<span class="flag">Applying everywhere (up to a minute)</span>{/if}
        {#if off}
          <button disabled={busy} on:click={() => act({ action: 'off', on: false }, 'Switch Go live back on? Nothing is restarted.')}
            >Switch back on</button
          >
        {:else}
          <button
            class="danger"
            disabled={busy}
            on:click={() =>
              act(
                { action: 'off', on: true },
                'Switch Go live OFF for everyone? Every open stream ends now, and nobody can start, publish or join until it is switched back on.'
              )}>Switch off for everyone</button
          >
        {/if}
      </div>
      <p class="meta">The emergency stop. It ends every open stream at once; the switch itself takes up to a minute to reach every location.</p>
    </div>

    <h2>Who can host</h2>
    <div class="card">
      <div class="row">
        <strong>{mode === 'approved' ? 'Approved hosts only' : 'Any active member'}</strong>
        {#if shown.applying}<span class="flag">Applying everywhere (up to a minute)</span>{/if}
        {#if mode === 'approved'}
          <button disabled={busy} on:click={() => switchMode('members')}>Open to all members</button>
        {:else}
          <button disabled={busy} on:click={() => switchMode('approved')}>Back to approved only</button>
        {/if}
      </div>
      <p class="meta">
        Members not on the list see "Live hosting is rolling out" and can request access, which
        DMs this account. Blocked accounts can't host in either mode.
      </p>
    </div>

    <h2>Access requests ({requests.length})</h2>
    {#if requests.length === 0}
      <div class="status">No pending requests.</div>
    {:else}
      <ul class="list">
        {#each requests as r (r.id)}
          <li class="card">
            <div class="row">
              <a href={`/user/${npub(r.pubkey)}`} target="_blank" rel="noopener"
                >{names[r.pubkey] || short(r.pubkey)}</a
              >
              <span class="pill" class:member-ok={r.membership === 'active'}
                >{MEMBERSHIP_LABELS[r.membership]}</span
              >
              <span class="meta">asked {when(r.created_at)}</span>
            </div>
            <code class="npub">{npub(r.pubkey)}</code>
            {#if r.note}<p class="note">"{r.note}"</p>{:else}<p class="meta">No note.</p>{/if}
            <div class="actions">
              <button
                disabled={busy}
                on:click={() =>
                  act(
                    { action: 'approve_request', id: r.id },
                    r.membership === 'active'
                      ? undefined
                      : 'This account is not confirmed as an active member. Approve anyway? (It still cannot go live without a membership.)'
                  )}>Approve</button
              >
              <button
                class="danger"
                disabled={busy}
                on:click={() =>
                  act(
                    { action: 'decline_request', id: r.id },
                    'Decline this request? They can ask again in 30 days.'
                  )}>Decline</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Approved hosts ({approved.length})</h2>
    <form class="row add-form" on:submit|preventDefault={() => addTyped('approve')}>
      <input class="input" placeholder="npub or hex key" bind:value={approveInput} />
      <button type="submit" disabled={busy}>Approve</button>
    </form>
    <ul class="list">
      {#each approved as a (a.pubkey)}
        <li class="card row">
          <code class="npub">{npub(a.pubkey)}</code>
          <span class="meta">since {when(a.created_at)}</span>
          <button
            disabled={busy}
            on:click={() =>
              act(
                { action: 'unapprove', pubkey: a.pubkey },
                'Remove from the approved list? A stream already running is not ended.'
              )}>Remove</button
          >
        </li>
      {/each}
    </ul>

    <h2>Blocked from going live</h2>
    <form class="row add-form" on:submit|preventDefault={() => addTyped('block')}>
      <input class="input" placeholder="npub or hex key" bind:value={blockInput} />
      <button class="danger" type="submit" disabled={busy}>Block</button>
    </form>
    {#if blocked.length === 0}
      <div class="status">Nobody is blocked.</div>
    {:else}
      <ul class="list">
        {#each blocked as b (b.pubkey)}
          <li class="card row">
            <code class="npub">{npub(b.pubkey)}</code>
            <span class="meta">since {when(b.created_at)}</span>
            <button
              disabled={busy}
              on:click={() => act({ action: 'unblock', pubkey: b.pubkey }, 'Unblock this account?')}
              >Unblock</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Streams</h2>
    {#if sessions.length === 0}
      <div class="status">Nothing open or held.</div>
    {:else}
      <ul class="list">
        {#each sessions as s (s.id)}
          <li class="card">
            <div class="row">
              <a href={`/live/s/${s.id}`} target="_blank" rel="noopener">{s.title}</a>
              <span class="pill" class:live={s.status === 'live'}>{s.status}</span>
              {#if s.hold_status === 'open'}<span class="flag">Reported · held</span>{/if}
            </div>
            <code class="npub">{npub(s.host_pubkey)}</code>
            <div class="meta">
              Created {when(s.created_at)} · started {when(s.started_at)}
              {#if s.status === 'ended'}· ended {when(s.ended_at)} ({s.end_reason ?? '—'}){/if}
              · {s.guest_joins} guest joins
              {#if s.input_recorded}· input not yet deleted{/if}
            </div>
            <div class="actions">
              {#if s.status !== 'ended'}
                <button
                  disabled={busy}
                  on:click={() => act({ action: 'end', id: s.id }, 'End this stream now?')}>End</button
                >
              {/if}
              {#if !isBlocked(s.host_pubkey)}
                <button
                  class="danger"
                  disabled={busy}
                  on:click={() => act({ action: 'block', pubkey: s.host_pubkey }, blockConfirm)}
                  >Block host</button
                >
              {:else}
                <span class="meta">Host blocked</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Reports</h2>
    {#if incidents.length === 0}
      <div class="status">No reports.</div>
    {:else}
      <ul class="list">
        {#each incidents as i (i.session_id)}
          <li class="card">
            <div class="row">
              <a href={`/live/s/${i.session_id}`} target="_blank" rel="noopener"
                >{i.title || i.session_id}</a
              >
              {#if i.status === 'open'}
                <span class="flag">Hold open since {when(i.opened_at)}</span>
              {:else}
                <span class="pill">Released {when(i.released_at)}</span>
              {/if}
            </div>
            {#if i.host_pubkey}<code class="npub">Host {npub(i.host_pubkey)}</code>{/if}
            <ul class="reports">
              {#each allReports[i.session_id] ?? i.reports as r}
                <li class:urgent={r.reason === 'child_safety' || r.reason === 'violence'}>
                  <strong>{REASON_LABELS[r.reason] ?? r.reason}</strong>
                  · {when(r.created_at)}
                  · {r.comment_id ? `comment by ${short(r.comment_pubkey ?? '')}` : 'the stream'}
                  {#if r.details}<div class="meta">"{r.details}"</div>{/if}
                </li>
              {/each}
            </ul>
            {#if !allReports[i.session_id] && i.report_count > i.reports.length}
              <p class="meta">
                Showing {i.reports.length} of {i.report_count} reports (urgent first, then newest).
                <button on:click={() => showAllReports(i.session_id)}>Show all {i.report_count}</button>
              </p>
            {/if}
            {#if i.status === 'open'}
              <div class="actions">
                <button
                  disabled={busy}
                  on:click={() =>
                    act(
                      { action: 'release', id: i.session_id },
                      'Release the hold? Confirm the report is resolved and nothing must be kept for legal reasons. The record is then deleted on the normal schedule.'
                    )}>Release hold</button
                >
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Action log</h2>
    {#if actions.length === 0}
      <div class="status">No actions yet.</div>
    {:else}
      <div class="log-wrap"><table class="log">
        <thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {#each actions as a (a.id)}
            <tr>
              <td>{when(a.occurred_at)}</td>
              <td>{short(a.actor)}</td>
              <td>{a.action}</td>
              <td>
                {#if a.session_id}<a href={`/live/s/${a.session_id}`}>stream</a>{/if}
                {#if a.target_pubkey}{short(a.target_pubkey)}{/if}
              </td>
              <td>{a.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    {/if}
  {/if}
</div>

<style>
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
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
    margin: 1.75rem 0 0.75rem;
  }
  .status {
    padding: 1.25rem;
    text-align: center;
    color: var(--color-text-secondary);
  }
  .off-label {
    color: var(--color-danger);
  }
  .action-error {
    position: sticky;
    top: 0.5rem;
    z-index: 5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-danger);
    background: var(--color-bg-secondary);
    color: var(--color-danger);
    font-weight: 600;
  }
  .action-error button {
    border: 0;
    padding: 0 0.25rem;
  }
  .status-error {
    color: var(--color-danger);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card {
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
    padding: 0.875rem 1.125rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .card.row {
    flex-direction: row;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .npub {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
  .pill {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    font-size: 0.75rem;
  }
  .pill.member-ok {
    border-color: #16a34a;
    color: #16a34a;
  }
  .note {
    margin: 0;
    font-size: 0.875rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .pill.live {
    background: #dc2626;
    border-color: #dc2626;
    color: #fff;
  }
  .flag {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: #f59e0b;
    color: #1f1300;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .reports {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    font-size: 0.875rem;
  }
  .reports .urgent strong {
    color: var(--color-danger);
  }
  button {
    padding: 0.375rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    font-size: 0.875rem;
  }
  button.danger {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .add-form {
    margin-bottom: 0.5rem;
  }
  .add-form .input {
    flex: 1;
    min-width: 12rem;
  }
  .log-wrap {
    overflow-x: auto;
  }
  .log {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .log th,
  .log td {
    text-align: left;
    padding: 0.375rem 0.5rem;
    border-bottom: 1px solid var(--color-input-border);
    vertical-align: top;
  }
  .log th {
    color: var(--color-text-secondary);
    font-weight: 600;
  }
</style>
