<!--
  SPIKE ONLY — Phase C.0 passkey PRF validation harness.
  Throwaway code. NEVER MERGE TO MAIN.
  See docs/passkey-investigation/SPIKE-README.md for the runbook.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  // -- constants -----------------------------------------------------------
  const RP_ID = 'zap.cooking';
  const RP_NAME = 'zap.cooking spike';

  const INPUT_A_LABEL = 'spike-test-input-1';
  const INPUT_B_LABEL = 'spike-test-input-1-alt';
  const INPUT_DET_LABEL = 'spike-test-input-determinism';

  // sessionStorage keys (cleared on tab close)
  const KEY_DAY1_CRED_ID = 'spike_day1_cred_id';
  const KEY_DAY3_CRED_ID = 'spike_day3_cred_id';
  const KEY_USER_ID = 'spike_user_id';

  // -- state ---------------------------------------------------------------
  type ResultEntry = {
    label: string;
    timestamp: string;
    prfEnabled: boolean | null;
    prfFirstHex: string | null;
    prfFullHex: string | null;
    rawExtensionResults: unknown;
    rawCredentialJson: unknown;
    error?: string;
  };

  let env = 'detecting…';
  let pluginLoaded = false;
  let bootstrapError: string | null = null;
  let busy = false;
  let lastError: string | null = null;
  let results: Record<string, ResultEntry> = {};
  let showFullPrf = false;
  let copied = false;

  $: comparisonAvsC = compare(
    results['day1-assert-A']?.prfFullHex ?? null,
    results['day1-assert-A-repeat']?.prfFullHex ?? null
  );
  $: comparisonAvsB = compare(
    results['day1-assert-A']?.prfFullHex ?? null,
    results['day1-assert-B']?.prfFullHex ?? null
  );

  // -- helpers -------------------------------------------------------------
  function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function bytesToB64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function base64UrlToBytes(b64url: string): Uint8Array {
    const padded = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256(s: string): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
    return new Uint8Array(buf);
  }

  function randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }

  function getOrCreateUserId(): Uint8Array {
    if (!browser) return new Uint8Array(32);
    const cached = sessionStorage.getItem(KEY_USER_ID);
    if (cached) return base64UrlToBytes(cached);
    const fresh = randomBytes(32);
    sessionStorage.setItem(KEY_USER_ID, bytesToB64Url(fresh));
    return fresh;
  }

  function detectEnv(): string {
    if (!browser) return 'ssr';
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) {
      const platform = cap.getPlatform?.() ?? 'unknown';
      return `Capacitor ${platform}`;
    }
    return `web (${navigator.userAgent.slice(0, 80)}…)`;
  }

  function compare(a: string | null, b: string | null): { ok: boolean; label: string } | null {
    if (!a || !b) return null;
    if (a === b) return { ok: true, label: 'MATCH' };
    return { ok: false, label: 'DIFFER' };
  }

  function recordResult(label: string, entry: Partial<ResultEntry>) {
    results = {
      ...results,
      [label]: {
        label,
        timestamp: new Date().toISOString(),
        prfEnabled: null,
        prfFirstHex: null,
        prfFullHex: null,
        rawExtensionResults: null,
        rawCredentialJson: null,
        ...entry
      }
    };
  }

  // -- core ceremony wrappers ---------------------------------------------
  async function doRegister(label: string, prfInput: Uint8Array, credIdStorageKey: string) {
    busy = true;
    lastError = null;
    try {
      const challenge = randomBytes(32);
      const userId = getOrCreateUserId();

      const reg = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { id: RP_ID, name: RP_NAME },
          user: {
            id: userId,
            name: `spike-${Date.now()}@${RP_ID}`,
            displayName: 'Spike Test'
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 }
          ],
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required'
          },
          attestation: 'none',
          extensions: {
            // PRF at registration: 'eval' tells the platform to also evaluate; some
            // platforms only return prf.enabled at registration time and require an
            // assertion to actually return prf.results — that's expected.
            prf: { eval: { first: prfInput } }
          } as AuthenticationExtensionsClientInputs
        }
      })) as PublicKeyCredential;

      const extResults = reg.getClientExtensionResults();
      const prf = (extResults as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }).prf;
      const prfFirst = prf?.results?.first ? new Uint8Array(prf.results.first) : null;

      const credIdBytes = new Uint8Array(reg.rawId);
      sessionStorage.setItem(credIdStorageKey, bytesToB64Url(credIdBytes));

      recordResult(label, {
        prfEnabled: prf?.enabled ?? null,
        prfFirstHex: prfFirst ? bytesToHex(prfFirst.slice(0, 8)) : null,
        prfFullHex: prfFirst ? bytesToHex(prfFirst) : null,
        rawExtensionResults: extResults,
        rawCredentialJson: { id: reg.id, type: reg.type, rawIdLength: credIdBytes.length }
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      lastError = msg;
      recordResult(label, { error: msg });
    } finally {
      busy = false;
    }
  }

  async function doAssert(label: string, prfInput: Uint8Array, credIdStorageKey: string) {
    busy = true;
    lastError = null;
    try {
      const challenge = randomBytes(32);
      const credIdB64u = sessionStorage.getItem(credIdStorageKey);

      // If this device has the credential ID, target it. If not (e.g., Day 3 second
      // device with synced passkey), omit allowCredentials and let the OS picker show.
      const allowCredentials = credIdB64u
        ? [
            {
              id: base64UrlToBytes(credIdB64u),
              type: 'public-key' as const,
              transports: ['internal', 'hybrid'] as AuthenticatorTransport[]
            }
          ]
        : undefined;

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: RP_ID,
          userVerification: 'required',
          allowCredentials,
          extensions: {
            prf: { eval: { first: prfInput } }
          } as AuthenticationExtensionsClientInputs
        }
      })) as PublicKeyCredential;

      const extResults = assertion.getClientExtensionResults();
      const prf = (extResults as { prf?: { results?: { first?: ArrayBuffer } } }).prf;
      const prfFirst = prf?.results?.first ? new Uint8Array(prf.results.first) : null;

      // If we hit the OS picker (no allowCredentials), record the credential ID
      // we ended up with so future assertions can target it on this device.
      if (!credIdB64u) {
        const idBytes = new Uint8Array(assertion.rawId);
        sessionStorage.setItem(credIdStorageKey, bytesToB64Url(idBytes));
      }

      recordResult(label, {
        prfEnabled: null,
        prfFirstHex: prfFirst ? bytesToHex(prfFirst.slice(0, 8)) : null,
        prfFullHex: prfFirst ? bytesToHex(prfFirst) : null,
        rawExtensionResults: extResults,
        rawCredentialJson: { id: assertion.id, type: assertion.type }
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      lastError = msg;
      recordResult(label, { error: msg });
    } finally {
      busy = false;
    }
  }

  // -- button handlers -----------------------------------------------------
  async function day1Register() {
    await doRegister('day1-register', await sha256(INPUT_A_LABEL), KEY_DAY1_CRED_ID);
  }
  async function day1AssertA() {
    await doAssert('day1-assert-A', await sha256(INPUT_A_LABEL), KEY_DAY1_CRED_ID);
  }
  async function day1AssertB() {
    await doAssert('day1-assert-B', await sha256(INPUT_B_LABEL), KEY_DAY1_CRED_ID);
  }
  async function day1AssertARepeat() {
    await doAssert('day1-assert-A-repeat', await sha256(INPUT_A_LABEL), KEY_DAY1_CRED_ID);
  }
  async function day3Register() {
    await doRegister('day3-register', await sha256(INPUT_DET_LABEL), KEY_DAY3_CRED_ID);
  }
  async function day3Assert() {
    await doAssert('day3-assert', await sha256(INPUT_DET_LABEL), KEY_DAY3_CRED_ID);
  }

  function clearAllResults() {
    results = {};
    sessionStorage.removeItem(KEY_DAY1_CRED_ID);
    sessionStorage.removeItem(KEY_DAY3_CRED_ID);
    sessionStorage.removeItem(KEY_USER_ID);
    lastError = null;
  }

  // -- copy-to-clipboard --------------------------------------------------
  function buildReportSnippet(): string {
    const lines: string[] = [];
    lines.push(`### Spike harness results (${new Date().toISOString()})`);
    lines.push('');
    lines.push(`- Environment: ${env}`);
    lines.push(`- Plugin loaded: ${pluginLoaded}`);
    if (bootstrapError) lines.push(`- Bootstrap error: ${bootstrapError}`);
    lines.push('');
    lines.push('| Step | prf.enabled | First 8 bytes (hex) | Error |');
    lines.push('|---|---|---|---|');
    for (const key of [
      'day1-register',
      'day1-assert-A',
      'day1-assert-B',
      'day1-assert-A-repeat',
      'day3-register',
      'day3-assert'
    ]) {
      const r = results[key];
      if (!r) continue;
      const first8 = r.prfFirstHex ?? '—';
      const enabled = r.prfEnabled === null ? 'n/a' : String(r.prfEnabled);
      const err = r.error ?? '';
      lines.push(`| ${key} | ${enabled} | \`${first8}\` | ${err} |`);
    }
    lines.push('');
    if (comparisonAvsC) lines.push(`- A vs A-repeat (should MATCH): **${comparisonAvsC.label}**`);
    if (comparisonAvsB) lines.push(`- A vs B (should DIFFER): **${comparisonAvsB.label}**`);
    lines.push('');
    return lines.join('\n');
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(buildReportSnippet());
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (e) {
      lastError = `Copy failed: ${String(e)}`;
    }
  }

  // -- bootstrap -----------------------------------------------------------
  onMount(async () => {
    env = detectEnv();
    try {
      const mod = await import('@capgo/capacitor-passkey');
      await mod.CapacitorPasskey.autoShimWebAuthn();
      pluginLoaded = true;
    } catch (e) {
      bootstrapError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  });
</script>

<svelte:head>
  <title>Passkey PRF Spike — DO NOT SHIP</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="container">
  <header class="warning">
    <h1>⚠️ Passkey PRF Validation Spike</h1>
    <p>
      <strong>Throwaway harness.</strong> Phase C.0 only. Not for production. All inputs are dummy strings; no real
      Nostr identities, nsecs, or user data are touched. See <code>docs/passkey-investigation/SPIKE-README.md</code> for
      the Day 1–3 runbook.
    </p>
  </header>

  <section class="env">
    <h2>Environment</h2>
    <ul>
      <li><strong>Runtime:</strong> {env}</li>
      <li><strong>Plugin loaded:</strong> {pluginLoaded ? '✅ yes' : '❌ no'}</li>
      <li><strong>RP ID:</strong> <code>{RP_ID}</code></li>
      {#if bootstrapError}
        <li class="error"><strong>Bootstrap error:</strong> <code>{bootstrapError}</code></li>
      {/if}
    </ul>
  </section>

  <section>
    <h2>Day 1 — single-device PRF</h2>
    <ol>
      <li>
        <button on:click={day1Register} disabled={busy}>1. Register passkey (PRF input A)</button>
      </li>
      <li>
        <button on:click={day1AssertA} disabled={busy}>2. Assert with input A → OUT_A</button>
      </li>
      <li>
        <button on:click={day1AssertB} disabled={busy}>3. Assert with input B → OUT_B (should differ)</button>
      </li>
      <li>
        <button on:click={day1AssertARepeat} disabled={busy}
          >4. Assert with input A again → OUT_A_repeat (should match)</button
        >
      </li>
    </ol>
  </section>

  <section>
    <h2>Day 3 — cross-device determinism</h2>
    <p>
      <strong>Device 1:</strong> click Register, then click Assert. Capture OUT.<br />
      <strong>Device 2 (same iCloud / Google account, passkey synced):</strong> click Assert only. Compare OUT byte-for-byte.
    </p>
    <ol>
      <li>
        <button on:click={day3Register} disabled={busy}>5. Register passkey (DETERMINISM input)</button>
      </li>
      <li>
        <button on:click={day3Assert} disabled={busy}>6. Assert with DETERMINISM input → OUT</button>
      </li>
    </ol>
  </section>

  <section class="comparisons">
    <h2>Day 1 comparisons</h2>
    {#if comparisonAvsC}
      <p>
        OUT_A vs OUT_A_repeat (should MATCH):
        <strong class:ok={comparisonAvsC.ok} class:bad={!comparisonAvsC.ok}>{comparisonAvsC.label}</strong>
      </p>
    {/if}
    {#if comparisonAvsB}
      <p>
        OUT_A vs OUT_B (should DIFFER):
        <strong class:ok={!comparisonAvsB.ok} class:bad={comparisonAvsB.ok}>{comparisonAvsB.label}</strong>
      </p>
    {/if}
  </section>

  <section class="results">
    <h2>Results</h2>
    <label>
      <input type="checkbox" bind:checked={showFullPrf} />
      Show full PRF outputs (otherwise only first 8 bytes shown)
    </label>
    {#if Object.keys(results).length === 0}
      <p><em>No ceremonies run yet.</em></p>
    {/if}
    {#each Object.entries(results) as [key, r] (key)}
      <details open>
        <summary><strong>{r.label}</strong> @ {r.timestamp}</summary>
        {#if r.error}
          <p class="error"><strong>Error:</strong> <code>{r.error}</code></p>
        {/if}
        <p>
          <strong>prf.enabled:</strong>
          {r.prfEnabled === null ? 'n/a (assertion)' : String(r.prfEnabled)}
        </p>
        <p>
          <strong>PRF output (first 8 bytes):</strong>
          <code>{r.prfFirstHex ?? '—'}</code>
        </p>
        {#if showFullPrf && r.prfFullHex}
          <p>
            <strong>PRF output (full, 32 bytes):</strong>
            <code class="full">{r.prfFullHex}</code>
          </p>
        {/if}
        <details>
          <summary>Raw clientExtensionResults JSON</summary>
          <pre>{JSON.stringify(r.rawExtensionResults, null, 2)}</pre>
        </details>
      </details>
    {/each}
  </section>

  <section>
    <button on:click={copyReport} disabled={busy}>📋 Copy report snippet for SPIKE-RESULT.md</button>
    {#if copied}<span class="copied">copied</span>{/if}
    <button on:click={clearAllResults} disabled={busy} class="danger">Clear results & sessionStorage</button>
  </section>

  {#if lastError}
    <section class="error-box">
      <strong>Last error:</strong> <code>{lastError}</code>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    background: #0b0b0e;
    color: #eee;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .container {
    max-width: 800px;
    margin: 2rem auto;
    padding: 1rem;
  }
  .warning {
    border: 2px solid #f0a500;
    background: #2a1a00;
    padding: 1rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }
  h1 {
    margin: 0 0 0.5rem 0;
    color: #f0a500;
  }
  h2 {
    margin-top: 2rem;
    border-bottom: 1px solid #333;
    padding-bottom: 0.25rem;
  }
  section {
    margin-bottom: 1.5rem;
  }
  button {
    background: #1a3a5c;
    color: #fff;
    border: 1px solid #2a5a8c;
    padding: 0.5rem 0.9rem;
    margin: 0.25rem 0;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.danger {
    background: #5c1a1a;
    border-color: #8c2a2a;
    margin-left: 1rem;
  }
  ol {
    padding-left: 1.5rem;
  }
  ol li {
    margin: 0.5rem 0;
  }
  code {
    background: #1a1a1f;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    word-break: break-all;
  }
  code.full {
    display: block;
    padding: 0.5rem;
    margin: 0.5rem 0;
  }
  pre {
    background: #1a1a1f;
    padding: 0.5rem;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
  }
  details {
    margin: 0.5rem 0;
  }
  summary {
    cursor: pointer;
  }
  .ok {
    color: #4cd964;
  }
  .bad {
    color: #ff453a;
  }
  .error,
  .error-box {
    color: #ff453a;
  }
  .error-box {
    border: 1px solid #ff453a;
    padding: 0.5rem;
    border-radius: 4px;
    background: #2a0000;
  }
  .copied {
    margin-left: 0.5rem;
    color: #4cd964;
  }
</style>
