<script lang="ts">
  /**
   * /admin/deletion-requests — the staff queue behind /delete-account.
   *
   * Each pending request is due 30 days after requested_at. A row whose
   * Stripe result is not 'cancelled' is flagged: the member may have an
   * older subscription our metadata search cannot find, so someone
   * checks Stripe by hand before marking it completed. The daily cron
   * digest (workers/cron/deletionDigest.ts) DMs the admin account while
   * anything here is pending, and links to this page.
   */
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';

  interface Request {
    pubkey: string;
    source: string;
    billing: string;
    scheduled_posts_removed: number;
    attempts: number;
    requested_at: number;
    completed_at: number | null;
    needs_billing_check: boolean;
  }

  const DAY = 86400;

  $: authed = isAdmin($userPublickey);

  let tab: 'pending' | 'completed' = 'pending';
  let requests: Request[] | null = null;
  let loading = false;
  let loadError = '';
  let actionError = '';
  let completing = '';

  $: if (authed && requests === null && !loading && !loadError) {
    load();
  }

  async function signedFetch(method: 'GET' | 'POST', path: string, bodyString?: string) {
    const url = new URL(path, window.location.origin).toString();
    const auth = await signNip98AuthHeader($ndk, { method, url, bodyString });
    const headers: Record<string, string> = { Authorization: auth };
    if (bodyString !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: bodyString });
  }

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await signedFetch('GET', `/api/admin/deletion-requests?status=${tab}`);
      if (!res.ok) throw new Error(res.status === 403 ? 'Forbidden' : `HTTP ${res.status}`);
      requests = (await res.json()).requests;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function switchTab(next: 'pending' | 'completed') {
    tab = next;
    requests = null;
    loadError = '';
  }

  async function complete(pubkey: string) {
    const ok = confirm(
      'Mark completed? Confirm that membership and credits are removed on member-relay, ' +
        'Pantry events are deleted, and Stripe shows no renewing subscription for this person.'
    );
    if (!ok) return;
    completing = pubkey;
    actionError = '';
    try {
      const res = await signedFetch(
        'POST',
        '/api/admin/deletion-requests',
        JSON.stringify({ pubkey })
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      requests = (requests ?? []).filter((r) => r.pubkey !== pubkey);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      completing = '';
    }
  }

  const npub = (hex: string) => nip19.npubEncode(hex);
  const date = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
  const daysLeft = (r: Request) => Math.ceil((r.requested_at + 30 * DAY - Date.now() / 1000) / DAY);
</script>

<svelte:head>
  <title>Deletion requests — Admin</title>
</svelte:head>

<div class="page">
  <a href="/admin" class="back">← Admin</a>
  <h1>Deletion requests</h1>
  <p class="lede">
    Each request is due 30 days after it was made. For every pending request: remove membership
    and credits on member-relay, delete Pantry events, then mark it completed. A
    <strong>Check Stripe</strong> flag means we couldn't confirm the renewal was stopped. Find the
    customer in Stripe and cancel any renewing subscription by hand.
  </p>

  {#if !authed}
    <div class="status">Sign in with the admin account to use this page.</div>
  {:else}
    <div class="tabs">
      <button class:active={tab === 'pending'} on:click={() => switchTab('pending')}>Pending</button>
      <button class:active={tab === 'completed'} on:click={() => switchTab('completed')}>Completed</button>
    </div>

    {#if actionError}<p class="status-error">{actionError}</p>{/if}

    {#if loading}
      <div class="status">Loading…</div>
    {:else if loadError}
      <div class="status status-error">{loadError}</div>
    {:else if requests && requests.length === 0}
      <div class="status">No {tab} requests.</div>
    {:else if requests}
      <ul class="list">
        {#each requests as r (r.pubkey + r.requested_at)}
          <li class="card">
            <div class="row">
              <code class="npub">{npub(r.pubkey)}</code>
              {#if r.needs_billing_check}<span class="flag">Check Stripe</span>{/if}
            </div>
            <div class="meta">
              Requested {date(r.requested_at)} from {r.source}
              {#if r.attempts > 1}· {r.attempts} requests{/if}
              · Stripe: {r.billing}
              · {r.scheduled_posts_removed} scheduled posts removed
            </div>
            {#if tab === 'pending'}
              <div class="row">
                <span class:overdue={daysLeft(r) < 0} class:soon={daysLeft(r) >= 0 && daysLeft(r) <= 7}>
                  {daysLeft(r) < 0 ? `Overdue by ${-daysLeft(r)} days` : `Due in ${daysLeft(r)} days`}
                </span>
                <button class="complete" disabled={completing === r.pubkey} on:click={() => complete(r.pubkey)}>
                  {completing === r.pubkey ? 'Saving…' : 'Mark completed'}
                </button>
              </div>
            {:else if r.completed_at}
              <div class="meta">Completed {date(r.completed_at)}</div>
            {/if}
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
  .lede {
    color: var(--color-text-secondary);
    margin: 0 0 1.5rem;
    font-size: 0.875rem;
  }
  .status {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-secondary);
  }
  .status-error {
    color: #ef4444;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .tabs button {
    padding: 0.375rem 0.875rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    font-size: 0.875rem;
  }
  .tabs button.active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
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
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .npub {
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .flag {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: #f59e0b;
    color: #1f1300;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .meta {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
  .overdue {
    color: #ef4444;
    font-weight: 600;
  }
  .soon {
    color: #f59e0b;
    font-weight: 600;
  }
  .complete {
    padding: 0.375rem 0.875rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    font-size: 0.875rem;
  }
</style>
