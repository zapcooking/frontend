<script lang="ts">
  /**
   * /admin/live — Go live moderation.
   *
   * Lists the sessions that are open, ended ones whose input is not
   * confirmed deleted, and every session under a report hold. From here
   * the admin ends a stream, blocks its host from going live (which also
   * ends the host's open session), unblocks an account, and releases a
   * report hold once the report is resolved. A report alert DM links here.
   *
   * Every call is NIP-98 signed by the admin account (/api/admin/live).
   */
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';

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
    report_hold_at: number | null;
  }
  interface Blocked {
    pubkey: string;
    created_at: number;
  }

  $: authed = isAdmin($userPublickey);

  let sessions: Session[] | null = null;
  let blocked: Blocked[] = [];
  let off = false;
  let loading = false;
  let loadError = '';
  let actionError = '';
  let busy = '';
  let blockInput = '';

  $: if (authed && sessions === null && !loading && !loadError) load();

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
      sessions = data.sessions;
      blocked = data.blocked ?? [];
      off = !!data.off;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  /** Run one admin action. True when it was sent and accepted. */
  async function act(
    key: string,
    body: Record<string, unknown>,
    confirmText?: string
  ): Promise<boolean> {
    if (confirmText && !confirm(confirmText)) return false;
    busy = key;
    actionError = '';
    try {
      const res = await signedFetch('POST', JSON.stringify(body));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sessions = null;
      await load();
      return true;
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      busy = '';
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

  function blockTyped() {
    const pk = toHex(blockInput);
    if (!pk) {
      actionError = 'Enter an npub or a 64-character hex key.';
      return;
    }
    void act(`block:${pk}`, { action: 'block', pubkey: pk }, blockConfirm).then((ok) => {
      if (ok) blockInput = '';
    });
  }

  const blockConfirm =
    'Block this account from going live? Its open stream (if any) ends now.';
  const npub = (hex: string) => nip19.npubEncode(hex);
  const when = (s: number | null) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');
</script>

<svelte:head>
  <title>Go live — Admin</title>
</svelte:head>

<div class="page">
  <a href="/admin" class="back">← Admin</a>
  <h1>Go live</h1>
  <p class="lede">
    Open streams, streams whose input is still being deleted, and every stream under a report
    hold. A held stream's record is kept past the 30-day deletion until you release it. Release it
    once the report is resolved.
  </p>

  {#if !authed}
    <div class="status">Sign in with the admin account to use this page.</div>
  {:else}
    {#if off}<p class="status-error">Go live is switched off.</p>{/if}
    {#if actionError}<p class="status-error">{actionError}</p>{/if}

    <h2>Streams</h2>
    {#if loading && !sessions}
      <div class="status">Loading…</div>
    {:else if loadError}
      <div class="status status-error">{loadError}</div>
    {:else if sessions && sessions.length === 0}
      <div class="status">Nothing open or held.</div>
    {:else if sessions}
      <ul class="list">
        {#each sessions as s (s.id)}
          <li class="card">
            <div class="row">
              <a href={`/live/s/${s.id}`} target="_blank" rel="noopener">{s.title}</a>
              <span class="pill" class:live={s.status === 'live'}>{s.status}</span>
              {#if s.report_hold_at}<span class="flag">Held · reported {when(s.report_hold_at)}</span>{/if}
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
                  disabled={busy !== ''}
                  on:click={() => act(`end:${s.id}`, { action: 'end', id: s.id }, 'End this stream now?')}
                  >End</button
                >
              {/if}
              {#if !blocked.some((b) => b.pubkey === s.host_pubkey)}
                <button
                  class="danger"
                  disabled={busy !== ''}
                  on:click={() =>
                    act(`block:${s.host_pubkey}`, { action: 'block', pubkey: s.host_pubkey }, blockConfirm)}
                  >Block host</button
                >
              {:else}
                <span class="meta">Host blocked</span>
              {/if}
              {#if s.report_hold_at}
                <button
                  disabled={busy !== ''}
                  on:click={() =>
                    act(
                      `release:${s.id}`,
                      { action: 'release', id: s.id },
                      'Release the hold? The record then follows the normal 30-day deletion (a stream that ended over 30 days ago is deleted at the next sweep).'
                    )}>Release hold</button
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Blocked from going live</h2>
    <form class="row block-form" on:submit|preventDefault={blockTyped}>
      <input class="input" placeholder="npub or hex key" bind:value={blockInput} />
      <button class="danger" type="submit" disabled={busy !== ''}>Block</button>
    </form>
    {#if blocked.length === 0}
      <div class="status">Nobody is blocked.</div>
    {:else}
      <ul class="list">
        {#each blocked as b (b.pubkey)}
          <li class="card">
            <div class="row">
              <code class="npub">{npub(b.pubkey)}</code>
              <button
                disabled={busy !== ''}
                on:click={() =>
                  act(`unblock:${b.pubkey}`, { action: 'unblock', pubkey: b.pubkey }, 'Unblock this account?')}
                >Unblock</button
              >
            </div>
            <div class="meta">Blocked {when(b.created_at)}</div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .page {
    max-width: 760px;
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
    margin: 1.5rem 0 0.75rem;
  }
  .lede {
    color: var(--color-text-secondary);
    margin: 0 0 1rem;
    font-size: 0.875rem;
  }
  .status {
    padding: 1.5rem;
    text-align: center;
    color: var(--color-text-secondary);
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
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
  .block-form .input {
    flex: 1;
    min-width: 12rem;
  }
</style>
