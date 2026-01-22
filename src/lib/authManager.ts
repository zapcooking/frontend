import { browser } from '$app/environment';
import {
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKNip46Signer,
  type NDKUser
} from '@nostr-dev-kit/ndk';
import { nip19, getPublicKey, generateSecretKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';

export interface AuthState {
  isAuthenticated: boolean;
  user: NDKUser | null;
  publicKey: string;
  authMethod: 'nip07' | 'privateKey' | 'anonymous' | 'nip46' | null;
  isLoading: boolean;
  error: string | null;
}

export interface NIP46ConnectionInfo {
  signerPubkey: string;
  userPubkey: string; // The actual user pubkey (may differ from signerPubkey)
  relays: string[];
  connectionString: string; // Stored for reconnection (secret redacted if present)
  localPrivateKey?: string; // The local ephemeral key used for NIP-46 communication
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
    this.updateState({ isLoading: true, error: null });

    try {
      if (!browser) {
        throw new Error('Browser environment required');
      }

      console.log('[NIP-46] Parsing connection string...');
      const { signerPubkey, relays, secret } = this.parseNIP46ConnectionString(connectionString);
      console.log('[NIP-46] Signer pubkey:', signerPubkey);
      console.log('[NIP-46] Relays:', relays);

      // Generate a local ephemeral key for NIP-46 communication
      const localPrivateKeyBytes = generateSecretKey();
      const localPrivateKey = Array.from(localPrivateKeyBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Create a local signer for the NIP-46 client
      const localSigner = new NDKPrivateKeySigner(localPrivateKey);

      // Add relays to NDK if not already present
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

      // Create the NIP-46 signer
      // NDKNip46Signer(ndk, remotePubkey, localSigner)
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerPubkey, localSigner);

      // Set internal properties that NDKNip46Signer needs
      try {
        (this.nip46Signer as any).bunkerPubkey = signerPubkey;
        (this.nip46Signer as any)._bunkerPubkey = signerPubkey;
        (this.nip46Signer as any).userPubkey = signerPubkey;
        (this.nip46Signer as any)._userPubkey = signerPubkey;
        const remoteUser = this.ndk.getUser({ pubkey: signerPubkey });
        (this.nip46Signer as any)._remoteUser = remoteUser;
        console.log('[NIP-46] Set signer internal properties');
      } catch (e) {
        console.warn('[NIP-46] Could not set signer properties:', e);
      }

      // Set the signer on NDK BEFORE blockUntilReady
      this.ndk.signer = this.nip46Signer;

      console.log('[NIP-46] Connecting to bunker (this may take a moment)...');

      // Block until connected with timeout
      const connectionTimeout = 30000; // 30 seconds
      const connectionPromise = this.nip46Signer.blockUntilReady();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Connection timeout - bunker not responding')),
          connectionTimeout
        );
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      console.log('[NIP-46] Connected! Getting user pubkey via get_public_key...');

      // Per NIP-46: client MUST call get_public_key to learn user-pubkey
      // The signer pubkey may differ from the actual user pubkey
      const user = await this.nip46Signer.user();
      const userPubkey = user.hexpubkey;

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
        error: null
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
        localPrivateKey // Store to reconnect without re-pairing
      };

      localStorage.setItem('nostrcooking_loggedInPublicKey', userPubkey);
      localStorage.setItem('nostrcooking_authMethod', 'nip46');
      localStorage.setItem('nostrcooking_nip46', JSON.stringify(nip46Info));
    } catch (error) {
      console.error('[NIP-46] Authentication failed:', error);
      this.nip46Signer = null;
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

      // Use stored local private key if available
      let localSigner: NDKPrivateKeySigner;
      if (nip46Info.localPrivateKey) {
        localSigner = new NDKPrivateKeySigner(nip46Info.localPrivateKey);
      } else {
        // Generate new ephemeral key (will need re-pairing)
        const localPrivateKeyBytes = generateSecretKey();
        const localPrivateKey = Array.from(localPrivateKeyBytes)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        localSigner = new NDKPrivateKeySigner(localPrivateKey);
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

      // Create the NIP-46 signer
      this.nip46Signer = new NDKNip46Signer(this.ndk, nip46Info.signerPubkey, localSigner);

      // Set internal properties that NDKNip46Signer needs
      try {
        (this.nip46Signer as any).bunkerPubkey = nip46Info.signerPubkey;
        (this.nip46Signer as any)._bunkerPubkey = nip46Info.signerPubkey;
        (this.nip46Signer as any).userPubkey = nip46Info.signerPubkey;
        (this.nip46Signer as any)._userPubkey = nip46Info.signerPubkey;
        const remoteUser = this.ndk.getUser({ pubkey: nip46Info.signerPubkey });
        (this.nip46Signer as any)._remoteUser = remoteUser;
        console.log('[NIP-46] Set signer internal properties on reconnect');
      } catch (e) {
        console.warn('[NIP-46] Could not set signer properties:', e);
      }

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

      // ALWAYS fetch the actual user pubkey from the signer to ensure it's correct
      // The stored userPubkey might be incorrect (e.g., if it was stored as signer pubkey)
      // Per NIP-46: client MUST call get_public_key to learn user-pubkey
      let userPubkey = nip46Info.userPubkey; // Use as fallback
      try {
        console.log('[NIP-46] Fetching actual user pubkey via get_public_key...');
        const userFromSigner = await this.nip46Signer.user();
        const actualUserPubkey = userFromSigner.hexpubkey;
        console.log('[NIP-46] Signer pubkey:', nip46Info.signerPubkey);
        console.log('[NIP-46] Stored user pubkey:', userPubkey);
        console.log('[NIP-46] Actual user pubkey (from get_public_key):', actualUserPubkey);

        // Use the actual user pubkey from the signer
        userPubkey = actualUserPubkey;

        // If stored userPubkey differs from actual, log a warning
        if (nip46Info.userPubkey && nip46Info.userPubkey !== actualUserPubkey) {
          console.warn(
            '[NIP-46] Stored user pubkey differs from actual user pubkey! Updating stored value.'
          );
          // Update the stored value
          nip46Info.userPubkey = actualUserPubkey;
          localStorage.setItem('nostrcooking_nip46', JSON.stringify(nip46Info));
          localStorage.setItem('nostrcooking_loggedInPublicKey', actualUserPubkey);
        }
      } catch (e) {
        console.warn('[NIP-46] Could not get user pubkey from signer, using stored value:', e);
        // Fall back to stored value if we can't fetch it
      }

      const user = this.ndk.getUser({ pubkey: userPubkey });

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
      error: null
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
      relays = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'];
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

    return { uri, relays };
  }

  // Decrypt NIP-44 encrypted content
  private decryptNip44(
    ciphertext: string,
    senderPubkey: string,
    recipientPrivateKey: string
  ): string {
    try {
      // Convert hex private key to Uint8Array
      const privateKeyBytes = new Uint8Array(
        recipientPrivateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );

      // Get conversation key
      const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, senderPubkey);

      // Decrypt
      return nip44.v2.decrypt(ciphertext, conversationKey);
    } catch (e) {
      console.error('[NIP-46] Failed to decrypt NIP-44 content:', e);
      throw new Error('Failed to decrypt response');
    }
  }

  // Start listening for NIP-46 responses (used by both initial pairing and resume)
  private startNip46ResponseListener(localPubkey: string): void {
    // Listen for NIP-46 events (kind 24133) addressed to our local pubkey
    const filter = {
      kinds: [24133],
      '#p': [localPubkey],
      since: Math.floor((Date.now() - 5 * 60 * 1000) / 1000)
    };

    console.log('[NIP-46] Subscribing to events for:', localPubkey);
    const sub = this.ndk.subscribe(filter, { closeOnEose: false });

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

      // Decrypt and validate the response per NIP-46 spec
      let response: any = null;
      try {
        const decrypted = this.decryptNip44(
          event.content,
          signerPubkey,
          pendingInfo.localPrivateKey
        );
        response = JSON.parse(decrypted);

        console.log('[NIP-46] Decrypted response:', {
          id: response.id,
          method: response.method,
          hasResult: !!response.result,
          hasError: !!response.error
        });

        // Only validate secret for "connect" method responses
        // Other methods (get_public_key, sign_event, etc.) won't have the secret in result
        if (response.method === 'connect' || (!response.method && response.result)) {
          // Per NIP-46: client MUST validate the secret returned by connect response
          if (response.result === pendingInfo.secret || response.result === 'ack') {
            // Some signers return 'ack' instead of the secret, which is allowed per spec
            console.log('[NIP-46] Secret validated successfully');
          } else if (response.result !== undefined) {
            // Only warn if result is present but doesn't match (might be a different response type)
            console.warn(
              '[NIP-46] Secret mismatch - expected:',
              pendingInfo.secret,
              'got:',
              response.result
            );
            // Still proceed but log warning - some signers may not implement secret correctly
          }
          // If response.result is undefined and method is not 'connect', it's likely a different method response
        }

        if (response.error) {
          console.error('[NIP-46] Signer returned error:', response.error);
          throw new Error(response.error);
        }
      } catch (e) {
        // If decryption fails, it might be from a different signer or malformed
        // Log but continue to try completing - NDK will handle its own validation
        console.warn('[NIP-46] Could not validate response (will still attempt connection):', e);
      }

      // Only attempt pairing if this looks like a connect response or if we can't determine the method
      // Skip if it's clearly a different method response (like get_public_key, sign_event, etc.)
      if (response && response.method && response.method !== 'connect') {
        console.log(
          '[NIP-46] Response is for method:',
          response.method,
          '- not a connect response, skipping pairing'
        );
        return;
      }

      try {
        isProcessingPairing = true;
        await this.completeNip46PairingWithSignerPubkey(signerPubkey);
        console.log('[NIP-46] Pairing completed successfully, stopping listener');
        sub.stop();
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        if (errorMsg.includes('No pending NIP-46 pairing found')) {
          // Already completed, stop listening
          console.log('[NIP-46] Pairing already completed, stopping listener');
          sub.stop();
        } else {
          console.error('[NIP-46] Failed to complete pairing from event:', e);
        }
      } finally {
        isProcessingPairing = false;
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
      const localSigner = new NDKPrivateKeySigner(pendingInfo.localPrivateKey);

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
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerPubkey, localSigner);

      // Set signer on NDK BEFORE blockUntilReady
      this.ndk.signer = this.nip46Signer;

      // Try to establish session first so we can get user pubkey
      console.log('[NIP-46] Attempting to establish NIP-46 session (15s timeout)...');
      let sessionEstablished = false;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Session establishment timeout')), 15000);
        });
        await Promise.race([this.nip46Signer.blockUntilReady(), timeoutPromise]);
        console.log('[NIP-46] Session established successfully!');
        sessionEstablished = true;
      } catch (e) {
        console.warn(
          '[NIP-46] Session establishment timed out, will still try to get user pubkey:',
          e
        );
      }

      // Per NIP-46: client MUST call get_public_key to learn user-pubkey
      // The signer pubkey may differ from the actual user pubkey
      // ALWAYS try to get the user pubkey, even if session establishment timed out
      // The signer might still be able to respond to get_public_key requests
      let userPubkey = signerPubkey; // Fallback to signer pubkey
      try {
        console.log('[NIP-46] Calling get_public_key to get actual user pubkey...');
        const user = await this.nip46Signer.user();
        userPubkey = user.hexpubkey;
        console.log('[NIP-46] Got user pubkey via get_public_key:', userPubkey);
        console.log('[NIP-46] Signer pubkey:', signerPubkey);
        if (signerPubkey !== userPubkey) {
          console.log(
            '[NIP-46] Note: signer pubkey differs from user pubkey (this is valid per spec)'
          );
        }
      } catch (e) {
        console.warn(
          '[NIP-46] Could not get user pubkey via get_public_key, using signer pubkey as fallback:',
          e
        );
        // Only use signer pubkey as fallback if we truly can't get the user pubkey
        // This should be rare, as get_public_key should work even if blockUntilReady() timed out
      }

      const user = this.ndk.getUser({ pubkey: userPubkey });

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
      localStorage.removeItem('nostrcooking_loggedInPublicKey');
      localStorage.removeItem('nostrcooking_privateKey');
      localStorage.removeItem('nostrcooking_authMethod');
      localStorage.removeItem('nostrcooking_nip46');
      localStorage.removeItem('nostrcooking_nip46_pending');
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
