<script lang="ts">
  /**
   * /admin/reads-moderation — edit Reads blocklists / denylist and review
   * the keyword-hit + user-report queue.
   *
   * NIP-98 signed, same as /admin/promos. KV writes may take ~1m to
   * propagate across Cloudflare edges.
   */
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';
  import type { ReadsModerationLists } from '$lib/reads/moderationConfig';

  interface ReviewLog {
    kind: 'keyword' | 'report';
    eventId: string;
    pubkey: string;
    naddr: string;
    matchedTerm?: string;
    field?: string;
    reason?: string;
    details?: string;
    createdAt: string;
    ipHash: string;
  }

  let loading = false;
  let loadError = '';
  let lists: ReadsModerationLists | null = null;
  let logs: ReviewLog[] = [];
  let busy = false;
  let actionError = '';
  let savedHint = '';

  let pubkeysText = '';
  let eventIdsText = '';
  let naddrsText = '';
  let denylistText = '';

  $: authed = isAdmin($userPublickey);

  $: if (authed && lists === null && !loading && !loadError) {
    loadAll();
  }

  function linesToList(text: string): string[] {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function signedFetch(method: 'GET' | 'POST', path: string, bodyString?: string) {
    const url = new URL(path, window.location.origin).toString();
    const auth = await signNip98AuthHeader($ndk, { method, url, bodyString });
    const headers: Record<string, string> = { Authorization: auth };
    if (bodyString !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: bodyString });
  }

  function applyLists(next: ReadsModerationLists) {
    lists = next;
    pubkeysText = next.blockedPubkeys.join('\n');
    eventIdsText = next.blockedEventIds.join('\n');
    naddrsText = next.blockedNaddrs.join('\n');
    denylistText = next.denylist.join('\n');
  }

  async function loadAll() {
    loading = true;
    loadError = '';
    try {
      const res = await signedFetch('GET', '/api/admin/reads-moderation');
      if (res.status === 403) throw new Error('Forbidden');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lists: ReadsModerationLists; logs: ReviewLog[] };
      applyLists(data.lists);
      logs = data.logs || [];
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (busy) return;
    busy = true;
    actionError = '';
    savedHint = '';
    const bodyString = JSON.stringify({
      action: 'save',
      lists: {
        blockedPubkeys: linesToList(pubkeysText),
        blockedEventIds: linesToList(eventIdsText),
        blockedNaddrs: linesToList(naddrsText),
        denylist: linesToList(denylistText)
      }
    });
    try {
      const res = await signedFetch('POST', '/api/admin/reads-moderation', bodyString);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lists: ReadsModerationLists };
      applyLists(data.lists);
      savedHint = 'Saved. Propagation across edges can take about a minute.';
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function blockFromLog(pubkey: string) {
    if (busy) return;
    busy = true;
    actionError = '';
    const bodyString = JSON.stringify({ action: 'block-pubkey', pubkey });
    try {
      const res = await signedFetch('POST', '/api/admin/reads-moderation', bodyString);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lists: ReadsModerationLists };
      applyLists(data.lists);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>Reads moderation — Admin</title>
</svelte:head>

<div class="page">
  <p class="crumb"><a href="/admin">Admin</a> / Reads moderation</p>
  <h1>Reads moderation</h1>
  <p class="lede">
    Blocklist and NSFW/spam denylist for long-form articles. Seed values live in
    <code>src/lib/reads/moderationConfig.ts</code>; saving here writes Cloudflare KV so you
    don't need a redeploy. Keyword hits auto-add the author pubkey.
  </p>

  {#if !authed}
    <p class="muted">Sign in with the admin account to use this tool.</p>
  {:else if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else if lists}
    <section>
      <h2>Blocked pubkeys</h2>
      <textarea bind:value={pubkeysText} rows="6" spellcheck="false"></textarea>
    </section>
    <section>
      <h2>Blocked event ids</h2>
      <textarea bind:value={eventIdsText} rows="4" spellcheck="false"></textarea>
    </section>
    <section>
      <h2>Blocked naddrs</h2>
      <textarea bind:value={naddrsText} rows="4" spellcheck="false"></textarea>
    </section>
    <section>
      <h2>Keyword denylist</h2>
      <p class="hint">One term or phrase per line. Scanned against title, summary, hashtags, and the first 500 characters of the body.</p>
      <textarea bind:value={denylistText} rows="10" spellcheck="false"></textarea>
    </section>

    {#if actionError}
      <p class="error">{actionError}</p>
    {/if}
    {#if savedHint}
      <p class="ok">{savedHint}</p>
    {/if}

    <button class="save" on:click={save} disabled={busy}>{busy ? 'Saving…' : 'Save lists'}</button>

    <section>
      <h2>Review queue</h2>
      {#if logs.length === 0}
        <p class="muted">No keyword hits or user reports yet.</p>
      {:else}
        <ul class="logs">
          {#each logs as log}
            <li>
              <div class="log-head">
                <span class="kind">{log.kind}</span>
                <span class="time">{log.createdAt}</span>
              </div>
              <div class="mono">{log.pubkey}</div>
              {#if log.eventId}<div class="mono dim">{log.eventId}</div>{/if}
              {#if log.matchedTerm}<div>term: <strong>{log.matchedTerm}</strong> ({log.field || '—'})</div>{/if}
              {#if log.reason}<div>reason: {log.reason}{log.details ? ` — ${log.details}` : ''}</div>{/if}
              {#if log.kind === 'report'}
                <button class="mini" on:click={() => blockFromLog(log.pubkey)} disabled={busy}>
                  Block pubkey
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    color: var(--color-text-primary);
  }
  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
  }
  h2 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .crumb {
    font-size: 0.85rem;
    margin-bottom: 1rem;
    color: var(--color-text-secondary);
  }
  .lede,
  .hint,
  .muted {
    color: var(--color-text-secondary);
    font-size: 0.9rem;
    margin: 0 0 1.25rem;
    line-height: 1.45;
  }
  code {
    font-size: 0.8rem;
  }
  section {
    margin: 1.25rem 0;
  }
  textarea {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    color: var(--color-text-primary);
  }
  .save {
    background: var(--color-primary, #ff6b35);
    color: white;
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.25rem;
    font-weight: 600;
    cursor: pointer;
  }
  .save:disabled,
  .mini:disabled {
    opacity: 0.6;
  }
  .error {
    color: #b91c1c;
  }
  .ok {
    color: #15803d;
    font-size: 0.9rem;
  }
  .logs {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .logs li {
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--color-bg-secondary);
    font-size: 0.85rem;
  }
  .log-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }
  .kind {
    text-transform: uppercase;
    font-weight: 700;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }
  .time,
  .dim {
    color: var(--color-text-secondary);
    font-size: 0.75rem;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
  .mini {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    cursor: pointer;
    color: inherit;
  }
</style>
