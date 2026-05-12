<!--
  SPIKE ONLY — Phase C.0 end-to-end passkey login (web).
  Throwaway code under spike/passkey-prf-validation. NEVER MERGE TO MAIN.

  What this does:
    - Real WebAuthn ceremony with PRF extension (eval.first = MAGIC, eval.second = utf8('zap.cooking'))
    - Real PRF-to-nsec derivation per Breez passkey-login spec v0.9.1
    - Real npub displayed
    - Credential ID persisted in localStorage so re-login works after page reload
    - In-memory nsec only — never persisted, never sent over the wire

  What this does NOT do:
    - No server-issued challenges (random client-side bytes; fine for spike)
    - No salt registry publishing to real Nostr relays
    - No authManager wiring — login state is local to this page
    - No assertion verification server-side
    - No backup phrase reveal UX (mnemonic is in console for inspection)
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import {
    deriveSaltRegistryAccount,
    deriveSaltIdentity,
    nsecFromPrivkey,
    bytesToHex,
    PRF_MAGIC,
    ZAP_COOKING_SALT,
    type IdentityAccount,
    type SaltRegistry
  } from '$lib/passkey/derive';

  // Dynamic rpID so the same code works on localhost, preview URLs, and zap.cooking.
  const RP_ID = browser ? window.location.hostname : 'zap.cooking';
  const RP_NAME = 'Zap Cooking (spike)';
  const STORAGE_CRED_ID = 'spike_login_cred_id';
  const STORAGE_USER_ID = 'spike_login_user_id';

  type FlowState =
    | { kind: 'idle' }
    | { kind: 'busy'; message: string }
    | { kind: 'error'; message: string }
    | {
        kind: 'logged-in';
        identity: IdentityAccount;
        registry: SaltRegistry;
        prfFirst8: string; // for visual confirmation; full nsec held in closure
      };

  let state: FlowState = { kind: 'idle' };
  let pluginLoaded = false;
  let pluginError: string | null = null;
  let knownCredentialId: string | null = null;
  let env = '';

  // In-memory nsec — held in this module's closure, never written to storage.
  // Cleared on logout / page reload / tab close.
  let nsecInMemory: string | null = null;

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------
  function bytesToB64Url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  function b64UrlToBytes(s: string): Uint8Array {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function randomBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }
  function getOrCreateUserId(): Uint8Array {
    if (!browser) return new Uint8Array(32);
    const cached = localStorage.getItem(STORAGE_USER_ID);
    if (cached) return b64UrlToBytes(cached);
    const fresh = randomBytes(32);
    localStorage.setItem(STORAGE_USER_ID, bytesToB64Url(fresh));
    return fresh;
  }

  // -------------------------------------------------------------------------
  // ceremonies
  // -------------------------------------------------------------------------
  async function runRegister(): Promise<{ credentialId: Uint8Array }> {
    const challenge = randomBytes(32);
    const userId = getOrCreateUserId();

    const reg = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: RP_ID, name: RP_NAME },
        user: {
          id: userId,
          name: `spike-user@${RP_ID}`,
          displayName: 'Zap Cooking Spike User'
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
          // We request both eval inputs at registration. Some platforms only
          // return prf.results at assertion time, which is why we always do an
          // immediate get() after create() to actually obtain the PRF outputs.
          prf: {
            eval: { first: PRF_MAGIC, second: ZAP_COOKING_SALT }
          }
        } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential;

    return { credentialId: new Uint8Array(reg.rawId) };
  }

  async function runAssert(credentialIdOpt: Uint8Array | null): Promise<{
    prfFirst: Uint8Array;
    prfSecond: Uint8Array;
    credentialId: Uint8Array;
  }> {
    const challenge = randomBytes(32);

    const allowCredentials = credentialIdOpt
      ? [
          {
            id: credentialIdOpt,
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
          prf: {
            eval: { first: PRF_MAGIC, second: ZAP_COOKING_SALT }
          }
        } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential;

    const ext = assertion.getClientExtensionResults();
    const prf = (
      ext as { prf?: { results?: { first?: ArrayBuffer; second?: ArrayBuffer } } }
    ).prf;

    const first = prf?.results?.first ? new Uint8Array(prf.results.first) : null;
    const second = prf?.results?.second ? new Uint8Array(prf.results.second) : null;

    if (!first || first.length !== 32) {
      throw new Error(
        `PRF results.first missing or wrong length (got ${first?.length ?? 'undefined'} bytes, need 32). ` +
          `Your platform/passkey-provider may not support the PRF extension.`
      );
    }
    if (!second || second.length !== 32) {
      throw new Error(
        `PRF results.second missing or wrong length (got ${second?.length ?? 'undefined'} bytes, need 32). ` +
          `eval.second batching may be unsupported on this platform.`
      );
    }

    return {
      prfFirst: first,
      prfSecond: second,
      credentialId: new Uint8Array(assertion.rawId)
    };
  }

  async function deriveAndDisplay(prfFirst: Uint8Array, prfSecond: Uint8Array, credId: Uint8Array) {
    state = { kind: 'busy', message: 'Deriving Nostr identity from PRF outputs…' };
    const registry = await deriveSaltRegistryAccount(prfFirst);
    const identity = await deriveSaltIdentity(prfSecond);
    nsecInMemory = nsecFromPrivkey(identity.privkey);

    // Diagnostic logging — full mnemonic to console only, not the page.
    console.log('[spike/login] identity npub:', identity.npub);
    console.log('[spike/login] backup mnemonic (24 words):', identity.mnemonic);
    console.log('[spike/login] salt registry npub:', registry.pubkeyHex);

    localStorage.setItem(STORAGE_CRED_ID, bytesToB64Url(credId));
    knownCredentialId = bytesToB64Url(credId);

    state = {
      kind: 'logged-in',
      identity,
      registry,
      prfFirst8: bytesToHex(prfSecond.slice(0, 8))
    };
  }

  // -------------------------------------------------------------------------
  // button handlers
  // -------------------------------------------------------------------------
  async function onSignUp() {
    state = { kind: 'busy', message: 'Creating passkey… touch the biometric.' };
    try {
      const { credentialId } = await runRegister();
      // Most platforms don't return PRF outputs on create; do an immediate
      // assertion to actually obtain them.
      state = { kind: 'busy', message: 'Reading PRF outputs… touch the biometric again.' };
      const { prfFirst, prfSecond, credentialId: credIdFromAssertion } = await runAssert(credentialId);
      await deriveAndDisplay(prfFirst, prfSecond, credIdFromAssertion);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      state = { kind: 'error', message: msg };
    }
  }

  async function onSignIn() {
    state = { kind: 'busy', message: 'Signing in… touch the biometric.' };
    try {
      const stored = browser ? localStorage.getItem(STORAGE_CRED_ID) : null;
      const credIdOpt = stored ? b64UrlToBytes(stored) : null;
      const { prfFirst, prfSecond, credentialId } = await runAssert(credIdOpt);
      await deriveAndDisplay(prfFirst, prfSecond, credentialId);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      state = { kind: 'error', message: msg };
    }
  }

  function onLogout() {
    nsecInMemory = null;
    state = { kind: 'idle' };
  }

  function onForgetEverything() {
    nsecInMemory = null;
    if (browser) {
      localStorage.removeItem(STORAGE_CRED_ID);
      localStorage.removeItem(STORAGE_USER_ID);
    }
    knownCredentialId = null;
    state = { kind: 'idle' };
  }

  function onCopyNpub() {
    if (state.kind !== 'logged-in') return;
    navigator.clipboard.writeText(state.identity.npub);
  }

  // -------------------------------------------------------------------------
  // bootstrap
  // -------------------------------------------------------------------------
  onMount(async () => {
    env = `${browser ? window.location.hostname : 'ssr'} (rpID=${RP_ID})`;
    knownCredentialId = browser ? localStorage.getItem(STORAGE_CRED_ID) : null;
    try {
      const mod = await import('@capgo/capacitor-passkey');
      await mod.CapacitorPasskey.autoShimWebAuthn();
      pluginLoaded = true;
    } catch (e) {
      pluginError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      // Plugin failure is fine on web — navigator.credentials works natively.
    }
  });
</script>

<svelte:head>
  <title>Spike Login — DO NOT SHIP</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main>
  <header class="warning">
    <strong>⚠️ SPIKE ONLY</strong> — Phase C.0 throwaway. Real Phase C will reimplement this from scratch.
  </header>

  <div class="card">
    <h1>Sign in to Zap Cooking</h1>
    <p class="sub">with a passkey (spike)</p>

    {#if state.kind === 'idle'}
      {#if knownCredentialId}
        <p class="hint">A passkey is already registered for this browser.</p>
        <button class="primary" on:click={onSignIn}>🔑 Sign in with passkey</button>
        <button class="secondary" on:click={onSignUp}>Create another passkey</button>
      {:else}
        <p class="hint">No passkey registered yet for this browser.</p>
        <button class="primary" on:click={onSignUp}>🔑 Create passkey & sign in</button>
        <button class="secondary" on:click={onSignIn}>I already have one (use OS picker)</button>
      {/if}
    {:else if state.kind === 'busy'}
      <div class="busy">
        <div class="spinner"></div>
        <p>{state.message}</p>
      </div>
    {:else if state.kind === 'error'}
      <div class="error">
        <strong>Something went wrong</strong>
        <code>{state.message}</code>
        <button class="primary" on:click={() => (state = { kind: 'idle' })}>Try again</button>
      </div>
    {:else if state.kind === 'logged-in'}
      <div class="success">
        <p class="signed-in">✅ Signed in</p>
        <div class="npub-row">
          <code class="npub">{state.identity.npub}</code>
          <button class="copy" on:click={onCopyNpub}>copy</button>
        </div>
        <details>
          <summary>Spike diagnostics</summary>
          <dl>
            <dt>identity npub (hex)</dt>
            <dd><code>{state.identity.pubkeyHex}</code></dd>
            <dt>salt registry pubkey (hex)</dt>
            <dd><code>{state.registry.pubkeyHex}</code></dd>
            <dt>PRF(zap.cooking) first 8 bytes</dt>
            <dd><code>{state.prfFirst8}</code></dd>
            <dt>nsec held in memory?</dt>
            <dd>{nsecInMemory ? '✅ yes (closure-only, never written)' : '❌ no'}</dd>
            <dt>backup mnemonic</dt>
            <dd>(logged to browser console only — never displayed on page)</dd>
          </dl>
        </details>
        <button class="secondary" on:click={onLogout}>Log out (drops nsec from memory)</button>
        <button class="danger" on:click={onForgetEverything}
          >Forget this device (clear localStorage; passkey itself stays in your OS keychain)</button
        >
      </div>
    {/if}
  </div>

  <details class="env">
    <summary>Environment</summary>
    <ul>
      <li><strong>Origin:</strong> {env}</li>
      <li><strong>Capacitor plugin loaded:</strong> {pluginLoaded ? '✅' : '❌ (fine on web)'}</li>
      {#if pluginError}<li class="muted">Plugin bootstrap: <code>{pluginError}</code></li>{/if}
      <li>
        <a href="/spike/passkey">→ open dev harness (six raw PRF buttons)</a>
      </li>
    </ul>
  </details>
</main>

<style>
  :global(body) {
    background: #0b0b0e;
    color: #e8e8ea;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
  }
  main {
    max-width: 460px;
    margin: 4rem auto;
    padding: 1rem;
  }
  .warning {
    background: #2a1a00;
    border: 1px solid #f0a500;
    color: #f0a500;
    padding: 0.6rem 0.8rem;
    border-radius: 6px;
    font-size: 0.85em;
    margin-bottom: 1.5rem;
  }
  .card {
    background: #16161a;
    border: 1px solid #2a2a30;
    border-radius: 12px;
    padding: 2rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  h1 {
    margin: 0 0 0.25rem 0;
    font-size: 1.5rem;
  }
  .sub {
    margin: 0 0 1.5rem 0;
    color: #888;
    font-size: 0.9em;
  }
  .hint {
    color: #aaa;
    margin: 0 0 1rem 0;
    font-size: 0.92em;
  }
  button {
    display: block;
    width: 100%;
    padding: 0.75rem 1rem;
    margin: 0.5rem 0;
    border-radius: 8px;
    font-size: 1rem;
    font-family: inherit;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s;
  }
  button.primary {
    background: #f0a500;
    color: #1a1a00;
    font-weight: 600;
  }
  button.primary:hover {
    background: #ffb820;
  }
  button.secondary {
    background: transparent;
    border-color: #3a3a40;
    color: #ccc;
  }
  button.secondary:hover {
    background: #1f1f25;
  }
  button.danger {
    background: transparent;
    border-color: #5c1a1a;
    color: #ff8a8a;
    font-size: 0.85em;
  }
  button.danger:hover {
    background: #2a0a0a;
  }
  button.copy {
    width: auto;
    padding: 0.25rem 0.6rem;
    margin: 0;
    font-size: 0.85em;
    background: #2a3a4a;
    border-color: #3a5a7a;
    color: #fff;
  }
  .busy {
    text-align: center;
    padding: 1rem 0;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #2a2a30;
    border-top-color: #f0a500;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error {
    background: #2a0000;
    border: 1px solid #5c1a1a;
    border-radius: 6px;
    padding: 1rem;
    color: #ff8a8a;
  }
  .error code {
    display: block;
    margin: 0.5rem 0 1rem;
    word-break: break-all;
  }
  .signed-in {
    color: #4cd964;
    font-weight: 600;
    margin: 0 0 1rem 0;
  }
  .npub-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  .npub {
    flex: 1;
    background: #1a1a20;
    padding: 0.5rem;
    border-radius: 4px;
    word-break: break-all;
    font-size: 0.85em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  details {
    margin: 1rem 0;
  }
  summary {
    cursor: pointer;
    color: #888;
    font-size: 0.9em;
  }
  dl {
    margin: 0.5rem 0 0 0;
    font-size: 0.85em;
  }
  dt {
    color: #888;
    margin-top: 0.5rem;
  }
  dd {
    margin: 0.2rem 0 0 1rem;
    word-break: break-all;
  }
  dd code {
    background: #1a1a20;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .env {
    margin-top: 2rem;
    color: #888;
    font-size: 0.85em;
  }
  .env ul {
    list-style: none;
    padding: 0;
  }
  .env li {
    margin: 0.3rem 0;
  }
  .env a {
    color: #6ab0ff;
  }
  .muted {
    color: #666;
  }
</style>
