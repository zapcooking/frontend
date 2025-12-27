import { browser } from '$app/environment';
import { NDKNip07Signer, NDKPrivateKeySigner, NDKNip46Signer, type NDKUser } from '@nostr-dev-kit/ndk';
import { nip19, getPublicKey, generateSecretKey } from 'nostr-tools';
import * as nip06 from 'nostr-tools/nip06';

export interface AuthState {
  isAuthenticated: boolean;
  user: NDKUser | null;
  publicKey: string;
  authMethod: 'nip07' | 'privateKey' | 'seed' | 'anonymous' | 'nip46' | null;
  isLoading: boolean;
  error: string | null;
}

export interface NIP46ConnectionInfo {
  signerPubkey: string;
  relays: string[];
  connectionString: string; // Stored for reconnection (secret redacted if present)
  localPrivateKey?: string; // The local ephemeral key used for NIP-46 communication
}

export interface AuthOptions {
  method: 'nip07' | 'privateKey' | 'seed' | 'anonymous' | 'nip46';
  privateKey?: string;
  seedPhrase?: string;
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
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Get current auth state
  getState(): AuthState {
    return { ...this.authState };
  }

  // Update auth state and notify listeners
  private updateState(updates: Partial<AuthState>) {
    this.authState = { ...this.authState, ...updates };
    this.listeners.forEach(listener => listener(this.authState));
    
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
        throw new Error('Nostr extension not detected. Please install a compatible extension like Alby or nos2x.');
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
            .map(b => b.toString(16).padStart(2, '0'))
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

  // Authenticate with seed phrase
  async authenticateWithSeed(seedPhrase: string): Promise<void> {
    this.updateState({ isLoading: true, error: null });

    try {
      if (!browser) {
        throw new Error('Browser environment required');
      }

      const privateKeyBytes = nip06.privateKeyFromSeedWords(seedPhrase);
      const privateKey = Array.from(privateKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await this.authenticateWithPrivateKey(privateKey);
      
      this.updateState({
        authMethod: 'seed',
        isLoading: false
      });
      
    } catch (error) {
      console.error('Seed phrase authentication failed:', error);
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Invalid seed phrase'
      });
      throw error;
    }
  }

  // Parse NIP-46 connection string (bunker:// or nostrconnect://)
  parseNIP46ConnectionString(connectionString: string): { signerPubkey: string; relays: string[]; secret?: string } {
    const trimmed = connectionString.trim();
    
    // Handle bunker:// format: bunker://<remote-signer-pubkey>?relay=<relay>&secret=<secret>
    // Handle nostrconnect:// format: nostrconnect://<remote-signer-pubkey>?relay=<relay>&secret=<secret>
    if (trimmed.startsWith('bunker://') || trimmed.startsWith('nostrconnect://')) {
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
      const relays = parts.slice(1).filter(r => r.startsWith('wss://') || r.startsWith('ws://'));
      
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
    
    throw new Error('Invalid connection string. Use bunker://, nostrconnect://, or npub with relay hints.');
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
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      // Create a local signer for the NIP-46 client
      const localSigner = new NDKPrivateKeySigner(localPrivateKey);
      
      console.log('[NIP-46] Creating NIP-46 signer...');
      
      // Create the NIP-46 signer
      // NDKNip46Signer(ndk, remotePubkey, localSigner)
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerPubkey, localSigner);
      
      // Add relays to NDK if not already present
      for (const relay of relays) {
        try {
          this.ndk.addExplicitRelay(relay);
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e);
        }
      }
      
      // Set the token/secret if provided
      if (secret) {
        this.nip46Signer.token = secret;
      }
      
      console.log('[NIP-46] Connecting to bunker (this may take a moment)...');
      
      // Block until connected with timeout
      const connectionTimeout = 30000; // 30 seconds
      const connectionPromise = this.nip46Signer.blockUntilReady();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout - bunker not responding')), connectionTimeout);
      });
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      console.log('[NIP-46] Connected! Getting user...');
      
      // Set the signer on NDK
      this.ndk.signer = this.nip46Signer;
      
      // Get the user
      const user = await this.nip46Signer.user();
      const publicKey = user.hexpubkey;
      
      console.log('[NIP-46] Authenticated as:', publicKey);

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
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
        relays,
        connectionString: redactedConnectionString,
        localPrivateKey // Store to reconnect without re-pairing
      };
      
      localStorage.setItem('nostrcooking_loggedInPublicKey', publicKey);
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
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        localSigner = new NDKPrivateKeySigner(localPrivateKey);
      }
      
      // Create the NIP-46 signer
      this.nip46Signer = new NDKNip46Signer(this.ndk, nip46Info.signerPubkey, localSigner);
      
      // Add relays
      for (const relay of nip46Info.relays) {
        try {
          this.ndk.addExplicitRelay(relay);
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e);
        }
      }
      
      // Try to connect with a shorter timeout for reconnection
      const connectionTimeout = 15000; // 15 seconds for reconnection
      const connectionPromise = this.nip46Signer.blockUntilReady();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Bunker reconnection timeout')), connectionTimeout);
      });
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      // Set the signer on NDK
      this.ndk.signer = this.nip46Signer;
      
      // Get the user
      const user = await this.nip46Signer.user();
      const publicKey = user.hexpubkey;
      
      console.log('[NIP-46] Reconnected as:', publicKey);

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
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

  // Generate new key pair for anonymous posting
  generateAnonymousKey(): { privateKey: string; publicKey: string } {
    const privateKeyBytes = generateSecretKey();
    const privateKey = Array.from(privateKeyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const publicKey = getPublicKey(privateKeyBytes);
    
    return { privateKey, publicKey };
  }

  // Generate new key pair (nsec format)
  generateKeyPair(): { privateKey: Uint8Array; publicKey: string; seedPhrase: string } {
    const privateKey = generateSecretKey();
    const publicKey = getPublicKey(privateKey);
    
    // Return empty seedPhrase since we're using nsec format
    return { privateKey, publicKey, seedPhrase: '' };
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
