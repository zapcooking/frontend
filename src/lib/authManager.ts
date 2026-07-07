import { browser } from '$app/environment';
import {
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKNip46Signer,
  NDKRelaySet,
  NDKSubscriptionCacheUsage,
  type NDKSubscription,
  type NDKUser
} from '@nostr-dev-kit/ndk';
import { nip19, getPublicKey, generateSecretKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { fetchNip46UserPubkey, sendNip46Rpc } from './nip46Rpc';
import { Nip44LocalSigner } from './nip44LocalSigner';

// Permissions requested in the NIP-46 connect handshake. NDK 2.10's
// blockUntilReady omits the perms param entirely, so permission-enforcing
// signers pre-grant nothing; sending them explicitly lets the signer
// authorize the whole session in one approval.
const NIP46_CONNECT_PERMS =
  'get_public_key,sign_event,nip04_encrypt,nip04_decrypt,nip44_encrypt,nip44_decrypt';

// localStorage key holding the in-flight ephemeral client key for a
// bunker paste-login. NIP-46 authorizations bind to the client key, so a
// retry with a fresh bunker URI (new single-use secret) can re-authorize
// the SAME client key. Distinct from `nostrcooking_nip46_pending`, which
// belongs to the nostrconnect:// QR flow — do not conflate them.
const NIP46_BUNKER_PENDING_KEY = 'nostrcooking_nip46_bunker_pending';

// How long a pending ephemeral client key may be reused across retries.
const NIP46_BUNKER_PENDING_TTL_MS = 15 * 60 * 1000;

export interface AuthState {
  isAuthenticated: boolean;
  user: NDKUser | null;
  publicKey: string;
  authMethod: 'nip07' | 'privateKey' | 'anonymous' | 'nip46' | null;
  isLoading: boolean;
  error: string | null;
  // NIP-46 auth-challenge URL surfaced when a popup blocker prevents us
  // from opening the signer's browser-approval window automatically. The
  // bunker modal renders it as a tappable link. Undefined when not pending.
  authChallengeUrl?: string;
}

export interface NIP46ConnectionInfo {
  signerPubkey: string;
  userPubkey: string; // The actual user pubkey (may differ from signerPubkey)
  relays: string[];
  connectionString: string; // Stored for reconnection (secret redacted if present)
  localPrivateKey?: string; // The local ephemeral key used for NIP-46 communication
  // Bunker URI secret, when present. Kept out of `connectionString` (which
  // is redacted for display) but required here so reconnectNIP46 can
  // reconstruct `pubkey#secret` for NDKNip46Signer. Without this the
  // initial pair works but the session fails to restore after reload.
  // No less sensitive than `localPrivateKey`, which is already stored.
  secret?: string;
}

export interface AuthOptions {
  method: 'nip07' | 'privateKey' | 'anonymous' | 'nip46';
  privateKey?: string;
  bunkerConnectionString?: string;
}

export class AuthManager {
  private ndk: any;
  private authState: AuthState = {
    isAuthenticated: false,
    user: null,
    publicKey: '',
    authMethod: null,
    isLoading: false,
    error: null
  };

  private listeners: ((state: AuthState) => void)[] = [];
  private nip46Signer: NDKNip46Signer | null = null;
  private nip46ResponseSub: NDKSubscription | null = null;

  constructor(ndk: any) {
    this.ndk = ndk;
    this.initializeFromStorage();
  }

  // Subscribe to auth state changes
  subscribe(listener: (state: AuthState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // Get current auth state
  getState(): AuthState {
    return { ...this.authState };
  }

  // Update auth state and notify listeners
  private updateState(updates: Partial<AuthState>) {
    this.authState = { ...this.authState, ...updates };
    this.listeners.forEach((listener) => listener(this.authState));

    // Update NDK instance with new signer if authenticated
    if (this.authState.isAuthenticated && this.authState.publicKey && this.ndk) {
      // The signer should already be set, but ensure NDK is updated
      this.ndk.signer = this.ndk.signer;
    }
  }

  // Resolve the real user pubkey via a NIP-46 get_public_key RPC.
  // See src/lib/nip46Rpc.ts for why NDK's user() is not usable here.
  private async fetchNip46UserPubkey(): Promise<string> {
    if (!this.nip46Signer) throw new Error('NIP-46 signer not initialized');
    return fetchNip46UserPubkey(this.nip46Signer);
  }

  // Initialize authentication from localStorage
  private async initializeFromStorage() {
    if (!browser) return;

    try {
      const storedPublicKey = localStorage.getItem('nostrcooking_loggedInPublicKey');
      const storedPrivateKey = localStorage.getItem('nostrcooking_privateKey');
      const storedAuthMethod = localStorage.getItem('nostrcooking_authMethod');
      const storedNip46 = localStorage.getItem('nostrcooking_nip46');

      // Try to restore NIP-46 connection
      if (storedAuthMethod === 'nip46' && storedNip46 && storedPublicKey) {
        try {
          const nip46Info: NIP46ConnectionInfo = JSON.parse(storedNip46);
          await this.reconnectNIP46(nip46Info);
          return;
        } catch (error) {
          console.error('Failed to restore NIP-46 authentication:', error);
          this.clearStorage();
        }
      }

      if (storedPrivateKey && storedPublicKey) {
        try {
          await this.authenticateWithPrivateKey(storedPrivateKey);
        } catch (error) {
          console.error('Failed to restore authentication:', error);
          this.clearStorage();
        }
      } else if (storedPublicKey) {
        try {
          await this.authenticateWithNIP07();
        } catch (error) {
          console.error('Failed to restore NIP-07 authentication:', error);
          this.clearStorage();
        }
      }
    } catch (error) {
      console.error('Error during authentication initialization:', error);
      this.clearStorage();
    }
  }

  // Authenticate with NIP-07 browser extension
  async authenticateWithNIP07(): Promise<void> {
    this.updateState({ isLoading: true, error: null });

    try {
      if (!browser) {
        throw new Error('Browser environment required');
      }

      if (!window.nostr) {
        throw new Error(
          'Nostr extension not detected. Please install a compatible extension like Alby or nos2x.'
        );
      }

      const signer = new NDKNip07Signer();
      this.ndk.signer = signer;

      const user = await signer.user();
      const publicKey = user.hexpubkey;

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
        authMethod: 'nip07',
        isLoading: false,
        error: null
      });

      localStorage.setItem('nostrcooking_loggedInPublicKey', publicKey);
    } catch (error) {
      console.error('NIP-07 authentication failed:', error);
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      });
      throw error;
    }
  }

  // Authenticate with private key
  async authenticateWithPrivateKey(privateKey: string): Promise<void> {
    this.updateState({ isLoading: true, error: null });

    try {
      if (!browser) {
        throw new Error('Browser environment required');
      }

      let pk = privateKey.trim();

      // Handle nsec1 format - decode to Uint8Array then convert to hex
      if (pk.startsWith('nsec1')) {
        try {
          const decoded = nip19.decode(pk);
          if (decoded.type !== 'nsec') {
            throw new Error('Invalid nsec key format');
          }
          const bytes = decoded.data as Uint8Array;
          pk = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        } catch (decodeError) {
          throw new Error('Invalid nsec key - could not decode');
        }
      }

      // Validate hex key format (should be 64 hex characters)
      if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
        throw new Error('Invalid private key format - expected 64 hex characters or nsec1 key');
      }

      const signer = new NDKPrivateKeySigner(pk);
      this.ndk.signer = signer;

      const user = await signer.user();
      const publicKey = user.hexpubkey;

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
        authMethod: 'privateKey',
        isLoading: false,
        error: null
      });

      localStorage.setItem('nostrcooking_loggedInPublicKey', publicKey);
      localStorage.setItem('nostrcooking_privateKey', pk);
    } catch (error) {
      console.error('Private key authentication failed:', error);
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Invalid private key'
      });
      throw error;
    }
  }

  // Parse NIP-46 connection string (bunker:// only - nostrconnect:// is client-generated, not user input)
  parseNIP46ConnectionString(connectionString: string): {
    signerPubkey: string;
    relays: string[];
    secret?: string;
  } {
    const trimmed = connectionString.trim();

    // Reject nostrconnect:// - it contains client pubkey, not signer pubkey
    // nostrconnect:// is what clients generate for signers to scan, not what users paste
    if (trimmed.startsWith('nostrconnect://')) {
      throw new Error(
        'nostrconnect:// URIs are for signers to scan. Please use a bunker:// connection string from your signer app.'
      );
    }

    // Handle bunker:// format: bunker://<remote-signer-pubkey>?relay=<relay>&secret=<secret>
    if (trimmed.startsWith('bunker://')) {
      try {
        const url = new URL(trimmed);
        let signerPubkey = url.hostname || url.pathname.replace('//', '');

        // Handle npub format
        if (signerPubkey.startsWith('npub1')) {
          const decoded = nip19.decode(signerPubkey);
          if (decoded.type !== 'npub') {
            throw new Error('Invalid npub in connection string');
          }
          signerPubkey = decoded.data as string;
        }

        // Validate hex pubkey (64 chars)
        if (!/^[0-9a-fA-F]{64}$/.test(signerPubkey)) {
          throw new Error('Invalid signer pubkey format');
        }

        // Extract relays from query params
        const relays = url.searchParams.getAll('relay');
        if (relays.length === 0) {
          throw new Error('No relay specified in connection string');
        }

        // Extract optional secret
        const secret = url.searchParams.get('secret') || undefined;

        return { signerPubkey, relays, secret };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Invalid')) {
          throw error;
        }
        throw new Error('Invalid bunker connection string format');
      }
    }

    // Handle plain npub with relay hints (npub1... wss://relay1 wss://relay2)
    if (trimmed.startsWith('npub1')) {
      const parts = trimmed.split(/\s+/);
      const npub = parts[0];
      const relays = parts.slice(1).filter((r) => r.startsWith('wss://'));

      try {
        const decoded = nip19.decode(npub);
        if (decoded.type !== 'npub') {
          throw new Error('Invalid npub format');
        }
        const signerPubkey = decoded.data as string;

        if (relays.length === 0) {
          throw new Error('No relay specified. Please add relay URLs after the npub.');
        }

        return { signerPubkey, relays };
      } catch (error) {
        if (error instanceof Error && error.message.includes('Invalid')) {
          throw error;
        }
        throw new Error('Invalid npub format');
      }
    }

    throw new Error('Invalid connection string. Use bunker:// or npub with relay hints.');
  }

  // Authenticate with NIP-46 bunker
  async authenticateWithNIP46(connectionString: string): Promise<void> {
    // Clear any stale auth-challenge link from a prior attempt.
    this.updateState({ isLoading: true, error: null, authChallengeUrl: undefined });

    try {
      if (!browser) {
        throw new Error('Browser environment required');
      }

      console.log('[NIP-46] Parsing connection string...');
      const { signerPubkey, relays, secret } = this.parseNIP46ConnectionString(connectionString);
      console.log('[NIP-46] Signer pubkey:', signerPubkey);
      console.log('[NIP-46] Relays:', relays);

      // Resolve the local ephemeral client key. NIP-46 authorizations are
      // bound to this key, so on retry we reuse a recently-stored key for
      // the same signer: the user can generate a fresh bunker URI (with a
      // new single-use secret) and re-authorize the SAME client without a
      // second identity approval. Only reuse when the signer matches and
      // the stored key is < 15 minutes old; otherwise generate + overwrite.
      let localPrivateKey: string | null = null;
      try {
        const rawPending = localStorage.getItem(NIP46_BUNKER_PENDING_KEY);
        if (rawPending) {
          const pending = JSON.parse(rawPending) as {
            signerPubkey?: string;
            localPrivateKey?: string;
            createdAt?: number;
          };
          const fresh =
            typeof pending.createdAt === 'number' &&
            Date.now() - pending.createdAt < NIP46_BUNKER_PENDING_TTL_MS;
          if (
            pending.signerPubkey === signerPubkey &&
            typeof pending.localPrivateKey === 'string' &&
            /^[0-9a-f]{64}$/i.test(pending.localPrivateKey) &&
            fresh
          ) {
            localPrivateKey = pending.localPrivateKey;
            console.log('[NIP-46] Reusing pending ephemeral client key for retry');
          }
        }
      } catch (e) {
        console.warn('[NIP-46] Could not read pending bunker key:', e);
      }

      if (!localPrivateKey) {
        const localPrivateKeyBytes = generateSecretKey();
        localPrivateKey = Array.from(localPrivateKeyBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        localStorage.setItem(
          NIP46_BUNKER_PENDING_KEY,
          JSON.stringify({ signerPubkey, localPrivateKey, createdAt: Date.now() })
        );
      }

      // Create a local signer for the NIP-46 client. NIP-44-aware
      // wrapper: NDK 2.10's NDKPrivateKeySigner is NIP-04-only and the
      // RPC channel inherits its encrypt/decrypt — see Nip44LocalSigner.
      const localSigner = new Nip44LocalSigner(localPrivateKey);

      // Add relays to NDK and connect BEFORE constructing the signer so the
      // scoped RPC relay set (below) references relays already in the pool.
      for (const relay of relays) {
        try {
          this.ndk.addExplicitRelay(relay);
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e);
        }
      }

      console.log('[NIP-46] Connecting NDK...');
      await this.ndk.connect();

      console.log('[NIP-46] Creating NIP-46 signer...');

      // Create the NIP-46 signer.
      // If bunker URI includes `secret`, NDK expects `pubkey#secret` token for connect.
      const signerToken = secret ? `${signerPubkey}#${secret}` : signerPubkey;
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner);

      // Scope the RPC relay set to the bunker's relays. In the bunker-token
      // construction path NDK leaves rpc.relaySet undefined, so NIP-46 RPC
      // traffic would otherwise publish/subscribe against the entire pool.
      (this.nip46Signer as any).rpc.relaySet = NDKRelaySet.fromRelayUrls(relays, this.ndk);

      // Handle auth-challenge (nsec.app-style browser approval). NDK emits
      // 'authUrl' on the rpc instance (with the URL as the event arg) when a
      // signer responds result:"auth_url". We bypass blockUntilReady, which
      // is what normally bridges this event, so listen on rpc directly. This
      // MUST be attached before connect is sent.
      //
      // authUrlSeen tags the human-in-the-loop case: once an auth challenge
      // is issued, a subsequent connect timeout means the signer is alive
      // and waiting on the user (not unreachable), so the timeout message
      // and retry guidance differ (see below).
      let authUrlSeen = false;
      (this.nip46Signer as any).rpc.on('authUrl', (url: string) => {
        console.log('[NIP-46] auth challenge:', url);
        // The URL comes from the remote signer's response — untrusted input.
        // Only accept http(s) so a malicious/compromised signer cannot smuggle
        // a javascript:/data: (or other-scheme) URL into window.open() or the
        // modal's <a href>, which would be an XSS/phishing vector.
        let safeUrl: string | null = null;
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            safeUrl = parsed.href;
          }
        } catch {
          /* not a parseable URL */
        }
        if (!safeUrl) {
          console.warn('[NIP-46] Ignoring auth challenge with unsupported URL:', url);
          return;
        }
        authUrlSeen = true;
        let popup: Window | null = null;
        try {
          // Not using the `noopener` window feature: it forces window.open to
          // return null even on success, which would defeat the popup-blocked
          // detection below. Instead sever `opener` on the returned handle to
          // block reverse-tabnabbing. The manual <a> fallback in the modal
          // carries rel="noopener noreferrer".
          popup = window.open(safeUrl, '_blank', 'width=420,height=640');
          if (popup) {
            try {
              popup.opener = null;
            } catch {
              /* cross-origin after navigation — best effort */
            }
          }
        } catch (e) {
          console.warn('[NIP-46] window.open threw:', e);
        }
        if (!popup) {
          // Popup blocked — surface the URL so the user can tap it manually.
          this.updateState({ authChallengeUrl: safeUrl });
        }
      });

      // Set the signer on NDK before driving the handshake.
      this.ndk.signer = this.nip46Signer;

      // Arm the kind-24133 response subscription. startListening() arms it
      // the moment ndk.subscribe is called; its promise only resolves on
      // EOSE. With the RPC relay set scoped to the bunker's relays, a single
      // slow/unreachable relay could hang that EOSE forever — so race a
      // timeout and proceed, since the listener is live regardless of EOSE.
      // (Trading the old silent failure for a silent hang would be no fix.)
      try {
        const listenTimeout = new Promise<void>((resolve) => setTimeout(resolve, 10000));
        await Promise.race([(this.nip46Signer as any).startListening(), listenTimeout]);
      } catch (e) {
        console.warn('[NIP-46] startListening error (continuing, listener is live):', e);
      }

      console.log('[NIP-46] Sending connect handshake...');

      // Explicit connect RPC with perms. Accept 'ack', or the echoed secret
      // (spec-compliant for some signers) but ONLY when a secret was sent —
      // otherwise an unexpected echo could pass as a false positive. Any
      // other outcome fails the auth with actionable guidance; we no longer
      // proceed to get_public_key on a failed/absent connect (which is what
      // produced the "get_public_key: no permission" error).
      let ack: string;
      try {
        // 60s: human-in-the-loop approval (popup or browser tab) is tight in
        // 30s even without a popup blocker. Still a bounded wait.
        ack = await sendNip46Rpc(
          this.nip46Signer,
          'connect',
          [signerPubkey, secret ?? '', NIP46_CONNECT_PERMS],
          60000
        );
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (/timed out/i.test(raw)) {
          // If an auth challenge was issued, the signer is alive and waiting
          // on the user — NDK's re-armed handler would deliver a late ack,
          // but our timer has already rejected. The persisted client key
          // means the now-granted authorization carries over, so a plain
          // retry (tap Connect again) succeeds.
          if (authUrlSeen) {
            throw new Error(
              `Approval pending — finish approving in your signer, then tap Connect again. (${raw})`
            );
          }
          throw new Error(
            `Bunker didn't respond. Check that your signer app is open and online. (${raw})`
          );
        }
        throw new Error(
          `Connect was rejected. Bunker secrets are single-use — generate a fresh bunker URI in your signer app and try again. (${raw})`
        );
      }

      const connectOk = ack === 'ack' || (secret !== undefined && ack === secret);
      if (!connectOk) {
        throw new Error(
          `Connect was rejected. Bunker secrets are single-use — generate a fresh bunker URI in your signer app and try again. (unexpected connect response: ${JSON.stringify(ack)})`
        );
      }
      console.log('[NIP-46] Connect acknowledged');

      console.log('[NIP-46] Getting user pubkey via get_public_key...');

      // Per NIP-46: client MUST call get_public_key to learn user-pubkey.
      // See fetchNip46UserPubkey — NDK's user() returns the signer
      // service pubkey synchronously, not the user identity. No silent
      // fallback to signer pubkey: if the RPC fails we fail the auth
      // rather than log the session in as the signer service.
      const userPubkey = await this.fetchNip46UserPubkey();
      const user = this.ndk.getUser({ pubkey: userPubkey });
      this.bindUserToSigner(user);

      console.log('[NIP-46] Signer pubkey:', signerPubkey);
      console.log('[NIP-46] User pubkey (from get_public_key):', userPubkey);
      if (signerPubkey !== userPubkey) {
        console.log(
          '[NIP-46] Note: signer pubkey differs from user pubkey (this is valid per spec)'
        );
      }

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null,
        authChallengeUrl: undefined
      });

      // Store connection info for reconnection (redact secret for security)
      const redactedConnectionString = secret
        ? connectionString.replace(secret, '***REDACTED***')
        : connectionString;

      const nip46Info: NIP46ConnectionInfo = {
        signerPubkey,
        userPubkey, // Store the actual user pubkey separately
        relays,
        connectionString: redactedConnectionString,
        localPrivateKey, // Store to reconnect without re-pairing
        secret // Retained separately from the redacted connectionString for reconnect
      };

      localStorage.setItem('nostrcooking_loggedInPublicKey', userPubkey);
      localStorage.setItem('nostrcooking_authMethod', 'nip46');
      localStorage.setItem('nostrcooking_nip46', JSON.stringify(nip46Info));
      // Success supersedes the pending ephemeral key (now persisted in
      // nostrcooking_nip46 for reconnect). On FAILURE we deliberately keep
      // it, so a retry with a fresh bunker URI reuses this authorized key.
      localStorage.removeItem(NIP46_BUNKER_PENDING_KEY);
    } catch (error) {
      console.error('[NIP-46] Authentication failed:', error);
      this.nip46Signer = null;
      // Also drop the abandoned signer from NDK. We set this.ndk.signer to the
      // bunker signer before the handshake, so on failure it would otherwise
      // dangle and let later app code sign through a stale/unauthorized signer
      // while AuthState reports unauthenticated.
      this.ndk.signer = null;
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to connect to bunker'
      });
      throw error;
    }
  }

  // Reconnect to NIP-46 bunker using stored info
  private async reconnectNIP46(nip46Info: NIP46ConnectionInfo): Promise<void> {
    this.updateState({ isLoading: true, error: null });

    try {
      console.log('[NIP-46] Reconnecting to bunker...');

      // Use stored local private key if available. NIP-44-aware wrapper —
      // see Nip44LocalSigner for why NDKPrivateKeySigner alone hangs on
      // spec-compliant signers.
      let localSigner: Nip44LocalSigner;
      if (nip46Info.localPrivateKey) {
        localSigner = new Nip44LocalSigner(nip46Info.localPrivateKey);
      } else {
        // Generate new ephemeral key (will need re-pairing)
        const localPrivateKeyBytes = generateSecretKey();
        const localPrivateKey = Array.from(localPrivateKeyBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        localSigner = new Nip44LocalSigner(localPrivateKey);
      }

      // Add relays first
      for (const relay of nip46Info.relays) {
        try {
          this.ndk.addExplicitRelay(relay);
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e);
        }
      }

      console.log('[NIP-46] Connecting NDK...');
      await this.ndk.connect();

      // Create the NIP-46 signer. Reconstruct `pubkey#secret` if the
      // original bunker URI carried a secret — NDK uses the token as-is
      // for the connect RPC, so dropping the secret here silently breaks
      // the session restore for secret-based bunkers.
      const signerToken = nip46Info.secret
        ? `${nip46Info.signerPubkey}#${nip46Info.secret}`
        : nip46Info.signerPubkey;
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner);

      // Set the signer on NDK BEFORE blockUntilReady
      this.ndk.signer = this.nip46Signer;

      // Try to establish session with timeout
      console.log('[NIP-46] Attempting to establish session on reconnect (15s timeout)...');
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Bunker reconnection timeout')), 15000);
        });
        await Promise.race([this.nip46Signer.blockUntilReady(), timeoutPromise]);
        console.log('[NIP-46] Reconnection session established successfully!');
      } catch (e) {
        console.warn('[NIP-46] Reconnection session establishment failed or timed out:', e);
        // Still proceed - might work anyway, or will fail on actual sign attempt
      }

      // Re-verify the user pubkey via a real get_public_key RPC so a stored
      // value that was ever wrong (e.g. pre-fix sessions that recorded the
      // signer pubkey) gets corrected on next login. If the RPC fails, fall
      // back to the stored value — a previously-fetched correct pubkey is
      // better than failing the reconnect.
      let userPubkey = nip46Info.userPubkey;
      try {
        console.log('[NIP-46] Fetching actual user pubkey via get_public_key...');
        const actualUserPubkey = await this.fetchNip46UserPubkey();
        console.log('[NIP-46] Signer pubkey:', nip46Info.signerPubkey);
        console.log('[NIP-46] Stored user pubkey:', userPubkey);
        console.log('[NIP-46] Actual user pubkey (from get_public_key):', actualUserPubkey);

        userPubkey = actualUserPubkey;

        if (nip46Info.userPubkey && nip46Info.userPubkey !== actualUserPubkey) {
          console.warn(
            '[NIP-46] Stored user pubkey differs from actual user pubkey — updating stored value'
          );
          nip46Info.userPubkey = actualUserPubkey;
          localStorage.setItem('nostrcooking_nip46', JSON.stringify(nip46Info));
          localStorage.setItem('nostrcooking_loggedInPublicKey', actualUserPubkey);
        }
      } catch (e) {
        console.warn('[NIP-46] Could not get user pubkey from signer, using stored value:', e);
      }

      const user = this.ndk.getUser({ pubkey: userPubkey });
      this.bindUserToSigner(user);

      console.log('[NIP-46] Reconnected as user:', userPubkey);

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null
      });
    } catch (error) {
      console.error('[NIP-46] Reconnection failed:', error);
      this.nip46Signer = null;
      // Same stale-signer hazard as authenticateWithNIP46: the signer was
      // assigned to NDK before the handshake, so drop it here to keep NDK
      // consistent with the unauthenticated state.
      this.ndk.signer = null;

      // Don't clear storage immediately - user might want to retry
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: 'Bunker not reachable. Please check your connection or reconnect.'
      });

      throw error;
    }
  }

  // Get NIP-46 connection info (for display in settings)
  getNIP46Info(): NIP46ConnectionInfo | null {
    if (!browser) return null;
    const stored = localStorage.getItem('nostrcooking_nip46');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  // Disconnect NIP-46 bunker
  async disconnectNIP46(): Promise<void> {
    this.nip46Signer = null;
    this.ndk.signer = null;

    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null,
      authChallengeUrl: undefined
    });

    this.clearStorage();
  }

  // ============================================================
  // Universal NIP-46 Pairing (for "Open Amber" flow on mobile)
  // ============================================================

  // Generate a random secret for NIP-46 nostrconnect:// flow
  private generateSecret(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Start universal NIP-46 pairing - generates nostrconnect:// URI
  async startNip46PairingUniversal(): Promise<{ uri: string; relays: string[] }> {
    if (!browser) {
      throw new Error('Browser environment required');
    }

    console.log('[NIP-46] Starting universal pairing...');

    // Generate ephemeral local keypair
    const localPrivateKeyBytes = generateSecretKey();
    const localPrivateKey = Array.from(localPrivateKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const localPubkey = getPublicKey(localPrivateKeyBytes);

    // Generate secret for connection validation (required by NIP-46)
    const secret = this.generateSecret();

    // Choose relays - use NDK's existing relays or defaults
    let relays: string[] = [];
    if (this.ndk.pool && this.ndk.pool.relays && this.ndk.pool.relays.size > 0) {
      relays = Array.from(this.ndk.pool.relays.keys()) as string[];
    }
    if (relays.length === 0) {
      relays = ['wss://relay.damus.io', 'wss://nos.lol'];
    }

    // Store pending pairing info including secret for validation
    const pendingInfo = {
      localPrivateKey,
      localPubkey,
      relays,
      secret, // Store secret to validate in connect response
      startedAt: Date.now()
    };
    localStorage.setItem('nostrcooking_nip46_pending', JSON.stringify(pendingInfo));

    // Build nostrconnect:// URI per NIP-46 spec
    // Format: nostrconnect://<client-pubkey>?relay=<relay>&secret=<secret>&name=<name>&url=<url>
    const params = new URLSearchParams();
    relays.forEach((r) => params.append('relay', r));
    params.set('secret', secret);
    params.set('name', 'Zap Cooking');
    params.set('url', 'https://zap.cooking');
    // Optional: request specific permissions
    // params.set('perms', 'sign_event:30023,sign_event:1,sign_event:7');

    const uri = `nostrconnect://${localPubkey}?${params.toString()}`;

    console.log('[NIP-46] Generated nostrconnect URI');
    console.log('[NIP-46] Local pubkey:', localPubkey);
    console.log('[NIP-46] Secret generated for validation');

    // Ensure NDK has relays and is connected
    for (const relay of relays) {
      try {
        this.ndk.addExplicitRelay(relay);
      } catch (e) {
        console.warn('[NIP-46] Failed to add relay:', relay, e);
      }
    }

    await this.ndk.connect();

    // Start listening for NIP-46 responses immediately
    // This handles the case where user approves and returns before app is backgrounded
    console.log('[NIP-46] Starting to listen for signer responses...');
    this.startNip46ResponseListener(localPubkey);

    // Watchdog: re-arm listener once shortly after startup to avoid missed initial relay subscription races.
    setTimeout(() => {
      if (this.hasPendingNip46Pairing() && !this.authState.isAuthenticated) {
        console.log('[NIP-46] Re-arming response listener after startup...');
        this.restartNip46ListenerIfPending().catch((e) => {
          console.warn('[NIP-46] Listener re-arm failed:', e);
        });
      }
    }, 2000);

    return { uri, relays };
  }

  // Decrypt a NIP-46 connect-response payload. Tries NIP-44 first
  // (current spec) then falls back to NIP-04 — older signers (and
  // some bunker servers that mirror the request format) still publish
  // their connect-response in NIP-04. Async because `nostr-tools/nip04`
  // exposes `decrypt` as a Promise.
  private async decryptNip44(
    ciphertext: string,
    senderPubkey: string,
    recipientPrivateKey: string
  ): Promise<string> {
    const privateKeyBytes = new Uint8Array(
      recipientPrivateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    try {
      const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, senderPubkey);
      return nip44.v2.decrypt(ciphertext, conversationKey);
    } catch (nip44Error) {
      try {
        return await nip04.decrypt(recipientPrivateKey, senderPubkey, ciphertext);
      } catch {
        console.error(
          '[NIP-46] Failed to decrypt response with NIP-44 or NIP-04:',
          nip44Error
        );
        throw new Error('Failed to decrypt response');
      }
    }
  }

  // Start listening for NIP-46 responses (used by both initial pairing and resume)
  private startNip46ResponseListener(localPubkey: string): void {
    // Ensure only one active listener exists at a time.
    if (this.nip46ResponseSub) {
      this.nip46ResponseSub.stop();
      this.nip46ResponseSub = null;
    }

    // Listen for NIP-46 events (kind 24133) addressed to our local pubkey
    const filter = {
      kinds: [24133],
      '#p': [localPubkey],
      since: Math.floor((Date.now() - 5 * 60 * 1000) / 1000)
    };

    console.log('[NIP-46] Subscribing to events for:', localPubkey);
    const sub = this.ndk.subscribe(filter, {
      closeOnEose: false,
      groupable: false,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
    });
    this.nip46ResponseSub = sub;

    // Track if we're already processing a pairing to prevent duplicates
    let isProcessingPairing = false;

    sub.on('event', async (event: any) => {
      console.log('[NIP-46] Received NIP-46 event from:', event.pubkey);

      // Prevent duplicate processing
      if (isProcessingPairing) {
        console.log('[NIP-46] Already processing a pairing, ignoring duplicate event');
        return;
      }

      // The event.pubkey is the signer's pubkey
      const signerPubkey = event.pubkey;

      // Get pending info to validate secret
      const pendingInfo = this.getPendingNip46Info();
      if (!pendingInfo) {
        console.log('[NIP-46] No pending pairing info, ignoring event');
        return;
      }

      // Decrypt and validate the response per NIP-46 spec. An
      // undecryptable or unparseable event MUST be ignored — otherwise
      // any unrelated kind:24133 event tagged #p=localPubkey becomes a
      // trigger to call completeNip46PairingWithSignerPubkey() with an
      // arbitrary pubkey, which generates noise at best and enables
      // spoofed pairing attempts at worst.
      let response: { id?: string; method?: string; result?: unknown; error?: string };
      try {
        const decrypted = await this.decryptNip44(
          event.content,
          signerPubkey,
          pendingInfo.localPrivateKey
        );
        response = JSON.parse(decrypted);
      } catch (e) {
        console.warn('[NIP-46] Ignoring event that failed to decrypt/parse:', e);
        return;
      }

      console.log('[NIP-46] Decrypted response:', {
        id: response.id,
        method: response.method,
        hasResult: !!response.result,
        hasError: !!response.error
      });

      if (response.error) {
        console.error('[NIP-46] Signer returned error:', response.error);
        return;
      }

      // Skip non-connect responses outright (get_public_key, sign_event,
      // etc.). NDK's own signer handles those.
      if (response.method && response.method !== 'connect') {
        console.log(
          '[NIP-46] Response is for method:',
          response.method,
          '- not a connect response, skipping pairing'
        );
        return;
      }

      // Validate the connect response. Per NIP-46 the signer returns the
      // secret the client passed in, or 'ack' for looser-spec signers.
      // Anything else is either an unrelated response or a spoof — don't
      // initiate pairing based on it.
      const result = response.result;
      const isAckOnly = result === 'ack';
      const isSecretMatch = typeof result === 'string' && result === pendingInfo.secret;
      if (!isAckOnly && !isSecretMatch) {
        console.warn(
          '[NIP-46] Connect response result did not match expected secret — ignoring',
          { got: result }
        );
        return;
      }
      console.log('[NIP-46] Secret validated successfully');

      try {
        isProcessingPairing = true;
        await this.completeNip46PairingWithSignerPubkey(signerPubkey);
        console.log('[NIP-46] Pairing completed successfully, stopping listener');
        sub.stop();
        if (this.nip46ResponseSub === sub) {
          this.nip46ResponseSub = null;
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        if (errorMsg.includes('No pending NIP-46 pairing found')) {
          // Already completed, stop listening
          console.log('[NIP-46] Pairing already completed, stopping listener');
          sub.stop();
          if (this.nip46ResponseSub === sub) {
            this.nip46ResponseSub = null;
          }
        } else {
          console.error('[NIP-46] Failed to complete pairing from event:', e);
        }
      } finally {
        isProcessingPairing = false;
      }
    });

    sub.on('close', () => {
      if (this.nip46ResponseSub === sub) {
        this.nip46ResponseSub = null;
      }
    });

    console.log('[NIP-46] Response listener started');
  }

  // Check if there's a pending NIP-46 pairing
  hasPendingNip46Pairing(): boolean {
    if (!browser) return false;
    const pending = localStorage.getItem('nostrcooking_nip46_pending');
    if (!pending) return false;

    try {
      const info = JSON.parse(pending);
      // Expire after 5 minutes
      if (Date.now() - info.startedAt > 5 * 60 * 1000) {
        localStorage.removeItem('nostrcooking_nip46_pending');
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Get pending pairing info
  getPendingNip46Info(): {
    localPrivateKey: string;
    localPubkey: string;
    relays: string[];
    secret: string;
  } | null {
    if (!browser) return null;
    const pending = localStorage.getItem('nostrcooking_nip46_pending');
    if (!pending) return null;

    try {
      return JSON.parse(pending);
    } catch {
      return null;
    }
  }

  // Complete NIP-46 pairing with the signer's pubkey
  async completeNip46PairingWithSignerPubkey(signerPubkey: string): Promise<void> {
    console.log('[NIP-46] Completing pairing with signer:', signerPubkey);

    // Check if already authenticated with this signer first (before checking pending)
    const currentAuth = this.getState();
    if (currentAuth.isAuthenticated && currentAuth.authMethod === 'nip46') {
      const storedNip46 = localStorage.getItem('nostrcooking_nip46');
      if (storedNip46) {
        try {
          const nip46Info = JSON.parse(storedNip46);
          if (nip46Info.signerPubkey === signerPubkey) {
            console.log(
              '[NIP-46] Already authenticated with this signer, ignoring duplicate event'
            );
            return; // Already paired, just return silently
          }
        } catch (e) {
          // Invalid stored data, continue with pairing
        }
      }
    }

    const pendingInfo = this.getPendingNip46Info();
    if (!pendingInfo) {
      throw new Error('No pending NIP-46 pairing found');
    }

    this.updateState({ isLoading: true, error: null });

    try {
      // NIP-44-aware local signer — see Nip44LocalSigner.
      const localSigner = new Nip44LocalSigner(pendingInfo.localPrivateKey);

      for (const relay of pendingInfo.relays) {
        try {
          this.ndk.addExplicitRelay(relay);
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e);
        }
      }

      console.log('[NIP-46] Connecting NDK...');
      await this.ndk.connect();

      console.log('[NIP-46] Creating NIP-46 signer...');
      const signerToken = pendingInfo.secret ? `${signerPubkey}#${pendingInfo.secret}` : signerPubkey;
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner);

      // Set signer on NDK BEFORE blockUntilReady
      this.ndk.signer = this.nip46Signer;

      // Try to establish session first so we can get user pubkey
      console.log('[NIP-46] Attempting to establish NIP-46 session (15s timeout)...');
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Session establishment timeout')), 15000);
        });
        await Promise.race([this.nip46Signer.blockUntilReady(), timeoutPromise]);
        console.log('[NIP-46] Session established successfully!');
      } catch (e) {
        console.warn(
          '[NIP-46] Session establishment timed out, will still try to get user pubkey:',
          e
        );
      }

      // Per NIP-46: client MUST call get_public_key to learn user-pubkey.
      // Even if blockUntilReady timed out the RPC listener is still live,
      // so get_public_key can still succeed. No silent fallback to signer
      // pubkey — if we can't learn the user's identity we fail the auth
      // rather than log the session in as the signer service.
      console.log('[NIP-46] Calling get_public_key to get actual user pubkey...');
      const userPubkey = await this.fetchNip46UserPubkey();
      console.log('[NIP-46] Got user pubkey via get_public_key:', userPubkey);
      console.log('[NIP-46] Signer pubkey:', signerPubkey);
      if (signerPubkey !== userPubkey) {
        console.log(
          '[NIP-46] Note: signer pubkey differs from user pubkey (this is valid per spec)'
        );
      }

      const user = this.ndk.getUser({ pubkey: userPubkey });
      this.bindUserToSigner(user);

      const nip46Info: NIP46ConnectionInfo = {
        signerPubkey,
        userPubkey, // Store the actual user pubkey separately
        relays: pendingInfo.relays,
        connectionString: `bunker://${signerPubkey}?${pendingInfo.relays.map((r) => `relay=${encodeURIComponent(r)}`).join('&')}`,
        localPrivateKey: pendingInfo.localPrivateKey
      };

      localStorage.setItem('nostrcooking_loggedInPublicKey', userPubkey);
      localStorage.setItem('nostrcooking_authMethod', 'nip46');
      localStorage.setItem('nostrcooking_nip46', JSON.stringify(nip46Info));
      localStorage.removeItem('nostrcooking_nip46_pending');

      console.log('[NIP-46] Auth info saved, authenticated as user:', userPubkey);

      // Update state to show user as logged in
      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null
      });
    } catch (error) {
      console.error('[NIP-46] Pairing failed:', error);
      this.nip46Signer = null;
      this.ndk.signer = undefined;
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to complete pairing'
      });
      throw error;
    }
  }

  // Restart NIP-46 listener if there's a pending pairing
  async restartNip46ListenerIfPending(): Promise<void> {
    if (!this.hasPendingNip46Pairing()) {
      console.log('[NIP-46] No pending pairing to restart');
      return;
    }

    const pendingInfo = this.getPendingNip46Info();
    if (!pendingInfo) return;

    console.log('[NIP-46] Restarting listener for pending pairing...');

    // Ensure relays are connected
    for (const relay of pendingInfo.relays) {
      try {
        this.ndk.addExplicitRelay(relay);
      } catch (e) {
        console.warn('[NIP-46] Failed to add relay:', relay, e);
      }
    }

    await this.ndk.connect();

    // Start listening for NIP-46 responses using shared listener method
    this.startNip46ResponseListener(pendingInfo.localPubkey);

    console.log('[NIP-46] Listener restarted, waiting for signer response...');
  }

  /**
   * Bind the authenticated user onto the NIP-46 signer and NDK.
   *
   * NDKNip46Signer.user() returns its `remoteUser`, which it initializes to the
   * SIGNER pubkey in the constructor and never updates — not even after a
   * successful connect. For bunkers whose signer pubkey differs from the user
   * pubkey (e.g. Primal remote signing), every event we sign would otherwise be
   * stamped (via NDKEvent.toNostrEvent → signer.user()) with the signer's
   * pubkey while the bunker signs with the user's key — producing an event
   * whose signature fails verification. That silently breaks relay NIP-42 auth,
   * NIP-98 uploads (nostr.build 401), notes, reactions — everything.
   *
   * Point the signer's reported user at the real user. `remotePubkey` (used to
   * route the signing RPC to the bunker) is intentionally left untouched.
   */
  private bindUserToSigner(user: NDKUser): void {
    if (this.nip46Signer) {
      (this.nip46Signer as unknown as { remoteUser: NDKUser }).remoteUser = user;
    }
    this.ndk.activeUser = user;
  }

  // Ensure NIP-46 signer is ready (call before signing operations)
  async ensureNip46SignerReady(): Promise<boolean> {
    if (!this.nip46Signer) {
      // Try to reconnect if we have stored info
      const nip46Info = this.getNIP46Info();
      if (nip46Info) {
        try {
          await this.reconnectNIP46(nip46Info);
          // After reconnecting, verify it's actually ready
          if (!this.nip46Signer) {
            return false;
          }
          const signer: NDKNip46Signer = this.nip46Signer;
          try {
            // Quick check - try to get user (this will fail if not ready)
            await signer.user();
            return true;
          } catch (e) {
            console.warn('[NIP-46] Signer reconnected but not ready:', e);
            // Try blockUntilReady with short timeout
            try {
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Ready check timeout')), 5000);
              });
              await Promise.race([signer.blockUntilReady(), timeoutPromise]);
              console.log('[NIP-46] Signer is now ready');
              return true;
            } catch (e2) {
              console.error('[NIP-46] Signer still not ready after reconnect:', e2);
              return false;
            }
          }
        } catch (e) {
          console.error('[NIP-46] Failed to reconnect:', e);
          return false;
        }
      }
      return false;
    }

    // Signer exists - verify it's actually ready
    const signer = this.nip46Signer;
    if (signer === null) {
      return false;
    }
    try {
      // Quick check - try to get user (this will fail if not ready)
      await signer.user();
      return true;
    } catch (e) {
      console.warn('[NIP-46] Signer exists but not ready, attempting to establish session...');
      // Try blockUntilReady with short timeout
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Ready check timeout')), 5000);
        });
        await Promise.race([signer.blockUntilReady(), timeoutPromise]);
        console.log('[NIP-46] Signer is now ready');
        return true;
      } catch (e2) {
        console.error('[NIP-46] Signer not ready:', e2);
        return false;
      }
    }
  }

  // Generate new key pair for anonymous posting
  generateAnonymousKey(): { privateKey: string; publicKey: string } {
    const privateKeyBytes = generateSecretKey();
    const privateKey = Array.from(privateKeyBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKey = getPublicKey(privateKeyBytes);

    return { privateKey, publicKey };
  }

  // Generate new key pair (nsec format)
  generateKeyPair(): { privateKey: Uint8Array; publicKey: string } {
    const privateKey = generateSecretKey();
    const publicKey = getPublicKey(privateKey);

    return { privateKey, publicKey };
  }

  // Post anonymously with ephemeral key
  async postAnonymously(content: string, tags: string[][] = []): Promise<void> {
    const { privateKey } = this.generateAnonymousKey();
    const signer = new NDKPrivateKeySigner(privateKey);

    // Temporarily set signer for this post
    const originalSigner = this.ndk.signer;
    this.ndk.signer = signer;

    try {
      const event = new (await import('@nostr-dev-kit/ndk')).NDKEvent(this.ndk);
      event.kind = 1;
      event.content = content;
      event.tags = tags;

      // Add NIP-89 client tag
      const { addClientTagToEvent } = await import('./nip89');
      addClientTagToEvent(event);

      await event.publish();
    } finally {
      // Restore original signer
      this.ndk.signer = originalSigner;
    }
  }

  // Logout and clear all authentication data
  async logout(): Promise<void> {
    // Clear NIP-46 signer if present
    if (this.nip46Signer) {
      this.nip46Signer = null;
    }
    if (this.nip46ResponseSub) {
      this.nip46ResponseSub.stop();
      this.nip46ResponseSub = null;
    }

    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null
    });

    this.clearStorage();
    this.ndk.signer = null;
  }

  // Clear localStorage
  private clearStorage(): void {
    if (browser) {
      if (this.nip46ResponseSub) {
        this.nip46ResponseSub.stop();
        this.nip46ResponseSub = null;
      }
      localStorage.removeItem('nostrcooking_loggedInPublicKey');
      localStorage.removeItem('nostrcooking_privateKey');
      localStorage.removeItem('nostrcooking_authMethod');
      localStorage.removeItem('nostrcooking_nip46');
      localStorage.removeItem('nostrcooking_nip46_pending');
      localStorage.removeItem(NIP46_BUNKER_PENDING_KEY);
    }
  }

  // Check if NIP-07 extension is available
  isNIP07Available(): boolean {
    return browser && !!window.nostr;
  }

  // Get user profile
  async getUserProfile(): Promise<any> {
    if (!this.authState.user) {
      throw new Error('No authenticated user');
    }

    return await this.authState.user.fetchProfile();
  }
}

// Global auth manager instance
let authManager: AuthManager | null = null;

export function createAuthManager(ndk: any): AuthManager {
  if (!authManager) {
    authManager = new AuthManager(ndk);
  } else {
    // Update NDK instance if it has changed
    authManager['ndk'] = ndk;
  }
  return authManager;
}

export function getAuthManager(): AuthManager | null {
  return authManager;
}
