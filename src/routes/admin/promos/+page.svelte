<script lang="ts">
  /**
   * /admin/promos — manage cookbook export promo codes.
   *
   * Loads the resolved config from /api/admin/promos (KV override or
   * hardcoded defaults), then offers:
   *   - Global enable/disable toggle
   *   - Per-code create / edit / delete
   *
   * All requests are NIP-98 signed (kind 27235) and verified server-
   * side. The signing pubkey must equal ADMIN_PUBKEY — the public
   * admin pubkey alone isn't enough auth, since it's, well, public.
   *
   * KV reads/writes are eventually consistent across CF edges (~60s
   * worst case); we surface this in the UI so the admin doesn't
   * panic when a fresh code takes a moment to validate.
   */
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { isAdmin } from '$lib/adminAuth';
  import { signNip98AuthHeader } from '$lib/nip98';

  interface PromoEntry {
    percentOff: number;
    flatOff: number;
    expiresAt?: number;
    note?: string;
  }
  interface PromoConfigState {
    enabled: boolean;
    codes: Record<string, PromoEntry>;
  }

  let loading = true;
  let loadError = '';
  let config: PromoConfigState | null = null;
  let defaults: PromoConfigState | null = null;

  // Per-code submission state — keyed by code (or 'new' for the create row).
  let busyCode: string | null = null;
  let actionError = '';

  // Add-code form
  let newCode = '';
  let newPercentOff = '50';
  let newFlatOff = '0';
  let newNote = '';
  let newExpiresAt = ''; // ISO date string from <input type=date>

  // Inline edit state — only one row in edit mode at a time
  let editingCode: string | null = null;
  let editPercentOff = '';
  let editFlatOff = '';
  let editNote = '';
  let editExpiresAt = '';

  $: authed = isAdmin($userPublickey);

  onMount(() => {
    if (authed) loadConfig();
  });

  // Reload after sign-in (page might mount before pubkey settles).
  $: if (authed && config === null && !loading && !loadError) {
    loadConfig();
  }

  async function signedFetch(
    method: 'GET' | 'POST',
    path: string,
    bodyString?: string
  ): Promise<Response> {
    const url = new URL(path, window.location.origin).toString();
    const auth = await signNip98AuthHeader($ndk, { method, url, bodyString });
    const headers: Record<string, string> = { Authorization: auth };
    if (bodyString !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, { method, headers, body: bodyString });
  }

  async function loadConfig() {
    loading = true;
    loadError = '';
    try {
      const res = await signedFetch('GET', '/api/admin/promos');
      if (res.status === 403) throw new Error('Forbidden');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        config: PromoConfigState;
        defaults: PromoConfigState;
      };
      config = data.config;
      defaults = data.defaults;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function postAction(payload: Record<string, unknown>): Promise<boolean> {
    actionError = '';
    const bodyString = JSON.stringify(payload);
    try {
      const res = await signedFetch('POST', '/api/admin/promos', bodyString);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        actionError =
          typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        return false;
      }
      if (data?.config) config = data.config;
      return true;
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async function handleToggle() {
    if (!config) return;
    busyCode = '__toggle';
    await postAction({ action: 'toggle', enabled: !config.enabled });
    busyCode = null;
  }

  function parseExpiresInput(value: string): number | undefined {
    const v = value.trim();
    if (!v) return undefined;
    // <input type=date> gives YYYY-MM-DD; store as end-of-day local ms.
    const ms = Date.parse(`${v}T23:59:59`);
    return Number.isFinite(ms) ? ms : undefined;
  }

  function formatExpiresForInput(ms?: number): string {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatExpiresLabel(ms?: number): string {
    if (!ms) return 'never';
    return new Date(ms).toLocaleDateString();
  }

  async function handleAddCode() {
    const code = newCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
      actionError = 'Code must be 2–32 chars, A–Z 0–9 _ -';
      return;
    }
    busyCode = '__add';
    const ok = await postAction({
      action: 'upsert',
      code,
      percentOff: Number(newPercentOff),
      flatOff: Number(newFlatOff || 0),
      note: newNote.trim() || undefined,
      expiresAt: parseExpiresInput(newExpiresAt) ?? null
    });
    busyCode = null;
    if (ok) {
      newCode = '';
      newPercentOff = '50';
      newFlatOff = '0';
      newNote = '';
      newExpiresAt = '';
    }
  }

  function startEdit(code: string, entry: PromoEntry) {
    editingCode = code;
    editPercentOff = String(entry.percentOff);
    editFlatOff = String(entry.flatOff);
    editNote = entry.note ?? '';
    editExpiresAt = formatExpiresForInput(entry.expiresAt);
    actionError = '';
  }

  function cancelEdit() {
    editingCode = null;
  }

  async function saveEdit(code: string) {
    busyCode = code;
    const ok = await postAction({
      action: 'upsert',
      code,
      percentOff: Number(editPercentOff),
      flatOff: Number(editFlatOff || 0),
      note: editNote.trim() || undefined,
      expiresAt: parseExpiresInput(editExpiresAt) ?? null
    });
    busyCode = null;
    if (ok) editingCode = null;
  }

  async function deleteCode(code: string) {
    if (!confirm(`Delete promo code "${code}"? Active uses will fail next time.`)) {
      return;
    }
    busyCode = code;
    await postAction({ action: 'delete', code });
    busyCode = null;
  }

  $: codeEntries = config
    ? Object.entries(config.codes).sort(([a], [b]) => a.localeCompare(b))
    : [];
</script>

<svelte:head>
  <title>Cookbook Promos — Admin</title>
</svelte:head>

<div class="page">
  <a class="back" href="/admin">← Admin</a>
  <h1>Cookbook Promos</h1>
  <p class="lede">
    Toggle promos on/off, create new codes, edit or remove existing ones. Changes
    propagate to all edges within ~1 minute (Cloudflare KV).
  </p>

  {#if !authed}
    <div class="unauthorized">
      <p>Sign in with the admin account to manage promos.</p>
    </div>
  {:else if loading}
    <p class="status">Loading promo config…</p>
  {:else if loadError}
    <p class="status status-error">Couldn't load: {loadError}</p>
    <button class="btn" type="button" on:click={loadConfig}>Retry</button>
  {:else if config}
    <section class="card">
      <div class="card-row">
        <div>
          <div class="card-title">Promos globally</div>
          <div class="card-desc">
            {#if config.enabled}
              Enabled — codes work as configured below.
            {:else}
              Disabled — every code is rejected with <code>unknown_code</code>.
            {/if}
          </div>
        </div>
        <button
          class="btn btn-primary"
          type="button"
          disabled={busyCode === '__toggle'}
          on:click={handleToggle}
        >
          {#if busyCode === '__toggle'}…{:else}
            {config.enabled ? 'Disable all' : 'Enable all'}
          {/if}
        </button>
      </div>
      <p class="hint">
        Tip: the env var <code>COOKBOOK_PROMOS_DISABLED=true</code> is a
        break-glass override. When set, this page can still toggle KV state,
        but every public lookup returns <code>disabled</code>.
      </p>
    </section>

    <section class="card">
      <div class="card-title">Add code</div>
      <div class="form-grid">
        <label>
          <span>Code</span>
          <input
            type="text"
            placeholder="LAUNCH"
            bind:value={newCode}
            maxlength="32"
            class="mono"
          />
        </label>
        <label>
          <span>Percent off</span>
          <input
            type="number"
            min="0"
            max="100"
            bind:value={newPercentOff}
          />
        </label>
        <label>
          <span>Flat off (sats)</span>
          <input type="number" min="0" bind:value={newFlatOff} />
        </label>
        <label>
          <span>Expires (optional)</span>
          <input type="date" bind:value={newExpiresAt} />
        </label>
        <label class="full">
          <span>Note (admin only)</span>
          <input
            type="text"
            placeholder="e.g. partner promo, winter campaign"
            bind:value={newNote}
            maxlength="200"
          />
        </label>
      </div>
      <div class="actions">
        <button
          class="btn btn-primary"
          type="button"
          disabled={busyCode === '__add' || !newCode.trim()}
          on:click={handleAddCode}
        >
          {busyCode === '__add' ? 'Saving…' : 'Add code'}
        </button>
      </div>
    </section>

    {#if actionError}
      <p class="status status-error">{actionError}</p>
    {/if}

    <section class="card">
      <div class="card-title">Codes</div>
      {#if codeEntries.length === 0}
        <p class="hint">No codes yet. Add one above.</p>
      {:else}
        <ul class="codes">
          {#each codeEntries as [code, entry] (code)}
            <li class="code-row">
              {#if editingCode === code}
                <div class="form-grid">
                  <label>
                    <span>Code</span>
                    <input type="text" value={code} disabled class="mono" />
                  </label>
                  <label>
                    <span>Percent off</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      bind:value={editPercentOff}
                    />
                  </label>
                  <label>
                    <span>Flat off (sats)</span>
                    <input type="number" min="0" bind:value={editFlatOff} />
                  </label>
                  <label>
                    <span>Expires</span>
                    <input type="date" bind:value={editExpiresAt} />
                  </label>
                  <label class="full">
                    <span>Note</span>
                    <input
                      type="text"
                      bind:value={editNote}
                      maxlength="200"
                    />
                  </label>
                </div>
                <div class="actions">
                  <button class="btn" type="button" on:click={cancelEdit}>
                    Cancel
                  </button>
                  <button
                    class="btn btn-primary"
                    type="button"
                    disabled={busyCode === code}
                    on:click={() => saveEdit(code)}
                  >
                    {busyCode === code ? 'Saving…' : 'Save'}
                  </button>
                </div>
              {:else}
                <div class="code-summary">
                  <div class="code-id">
                    <span class="code-name mono">{code}</span>
                    {#if entry.percentOff === 100}
                      <span class="badge badge-free">FREE</span>
                    {:else}
                      <span class="badge">{entry.percentOff}% off</span>
                    {/if}
                    {#if entry.flatOff > 0}
                      <span class="badge">−{entry.flatOff} sats</span>
                    {/if}
                  </div>
                  <div class="code-meta">
                    <span>Expires: {formatExpiresLabel(entry.expiresAt)}</span>
                    {#if entry.note}<span>· {entry.note}</span>{/if}
                  </div>
                </div>
                <div class="actions">
                  <button
                    class="btn"
                    type="button"
                    on:click={() => startEdit(code, entry)}
                  >
                    Edit
                  </button>
                  <button
                    class="btn btn-danger"
                    type="button"
                    disabled={busyCode === code}
                    on:click={() => deleteCode(code)}
                  >
                    {busyCode === code ? '…' : 'Delete'}
                  </button>
                </div>
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
  .back {
    display: inline-block;
    margin-bottom: 0.75rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    text-decoration: none;
  }
  .back:hover {
    color: var(--color-text-primary);
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
  .unauthorized,
  .status {
    padding: 2rem;
    text-align: center;
    color: var(--color-text-secondary);
  }
  .status-error {
    color: #ef4444;
  }
  .card {
    border: 1px solid var(--color-input-border);
    border-radius: 0.5rem;
    background: var(--color-bg-secondary);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .card-title {
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
  .card-desc {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }
  .hint {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    margin: 0.75rem 0 0;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .form-grid label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }
  .form-grid label.full {
    grid-column: 1 / -1;
  }
  .form-grid input {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.375rem;
    background: var(--color-bg-primary, transparent);
    color: var(--color-text-primary);
    font-size: 0.875rem;
  }
  .mono {
    font-family: ui-monospace, monospace;
    text-transform: uppercase;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary, transparent);
    color: var(--color-text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }
  .btn-danger {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.4);
  }
  .codes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .code-row {
    border: 1px solid var(--color-input-border);
    border-radius: 0.375rem;
    padding: 0.75rem 0.875rem;
  }
  .code-summary {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }
  .code-id {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .code-name {
    font-weight: 600;
    font-size: 0.9375rem;
  }
  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 500;
  }
  .badge-free {
    background: rgba(180, 95, 30, 0.15);
    color: #b45f1e;
  }
  .code-meta {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .code-row .code-summary + .actions {
    margin-top: 0.5rem;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    padding: 0.0625rem 0.25rem;
    background: var(--color-bg-tertiary, rgba(255, 255, 255, 0.06));
    border-radius: 0.1875rem;
  }

  @media (max-width: 540px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
    .code-summary {
      flex-direction: column;
    }
  }
</style>
