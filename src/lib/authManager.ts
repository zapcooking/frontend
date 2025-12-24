import { browser } from '$app/environment';
import { NDKNip07Signer, NDKPrivateKeySigner, type NDKUser } from '@nostr-dev-kit/ndk';
import { nip19, getPublicKey, generateSecretKey } from 'nostr-tools';
import * as nip06 from 'nostr-tools/nip06';

export interface AuthState {
  isAuthenticated: boolean;
  user: NDKUser | null;
  publicKey: string;
  authMethod: 'nip07' | 'privateKey' | 'seed' | 'anonymous' | null;
  isLoading: boolean;
  error: string | null;
}

export interface AuthOptions {
  method: 'nip07' | 'privateKey' | 'seed' | 'anonymous';
  privateKey?: string;
  seedPhrase?: string;
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
      
      await event.publish();
    } finally {
      // Restore original signer
      this.ndk.signer = originalSigner;
    }
  }

  // Logout and clear all authentication data
  async logout(): Promise<void> {
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
