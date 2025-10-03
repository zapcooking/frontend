<script lang="ts">
  import Button from '../../components/Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import Modal from '../../components/Modal.svelte';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;
  import { nip19 } from 'nostr-tools';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { onMount, onDestroy } from 'svelte';
  import { DEFAULT_PROFILE_IMAGE } from '$lib/consts';

  let authManager: any = null;
  let authState: AuthState = {
    isAuthenticated: false,
    user: null,
    publicKey: '',
    authMethod: null,
    isLoading: false,
    error: null
  };
  let unsubscribe: (() => void) | null = null;

  // Form states
  let nsecInput = '';
  let nsecError = '';
  let seedInput = '';
  let seedError = '';
  let generatedKeys: { privateKey: Uint8Array; publicKey: string; seedPhrase: string } | null = null;
  let newAccountUsername = '';
  
  // Modal states
  let nsecModal = false;
  let seedModal = false;
  let generateModal = false;

  // Animation states
  let isHovered = false;

  onMount(() => {
    try {
      // Initialize auth manager
      authManager = createAuthManager($ndk);
      if (authManager) {
        authState = authManager.getState();
        
        // Subscribe to auth state changes
        unsubscribe = authManager.subscribe((state: AuthState) => {
          authState = state;
          
          // Sync with legacy userPublickey store for compatibility
          if (state.isAuthenticated && state.publicKey) {
            userPublickey.set(state.publicKey);
          } else {
            userPublickey.set('');
          }
          
          // Redirect to home if authenticated
          if (state.isAuthenticated) {
            goto('/');
          }
        });
      }
    } catch (error) {
      console.error('Failed to initialize auth manager in login page:', error);
      // Set authManager to a safe default to prevent template errors
      authManager = {
        isNIP07Available: () => false
      };
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  async function loginWithNIP07() {
    if (!authManager) return;
    try {
      await authManager.authenticateWithNIP07();
    } catch (error) {
      console.error('NIP-07 login failed:', error);
    }
  }

  async function loginWithPrivateKey() {
    if (!authManager) return;
    try {
      nsecError = '';
      if (!nsecInput.trim()) {
        nsecError = 'Please enter a private key';
        return;
      }
      
      await authManager.authenticateWithPrivateKey(nsecInput.trim());
      nsecModal = false;
      nsecInput = '';
    } catch (error) {
      nsecError = authState.error || 'Invalid private key';
      console.error('Private key login failed:', error);
    }
  }

  async function loginWithSeed() {
    if (!authManager) return;
    try {
      seedError = '';
      if (!seedInput.trim()) {
        seedError = 'Please enter a seed phrase';
        return;
      }
      
      await authManager.authenticateWithSeed(seedInput.trim());
      seedModal = false;
      seedInput = '';
    } catch (error) {
      seedError = authState.error || 'Invalid seed phrase';
      console.error('Seed login failed:', error);
    }
  }

  function generateNewKeys() {
    if (!authManager) return;
    generatedKeys = authManager.generateKeyPair();
  }

  async function useGeneratedKeys() {
    if (!generatedKeys || !authManager) return;
    
    try {
      // Convert Uint8Array to hex string for authentication
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await authManager.authenticateWithPrivateKey(privateKeyHex);
      
      // Create profile with username if provided
      if (newAccountUsername.trim()) {
        const { NDKEvent } = await import('@nostr-dev-kit/ndk');
        const metaEvent = new NDKEvent($ndk);
        metaEvent.kind = 0;
        metaEvent.tags = [];
        
        const profileContent: any = { 
          displayName: newAccountUsername.trim(),
          picture: DEFAULT_PROFILE_IMAGE
        };
        
        // Add username to profile with NIP-05 verification
        profileContent.name = newAccountUsername.trim();
        profileContent.nip05 = `${newAccountUsername.trim()}@zap.cooking`;
        
        metaEvent.content = JSON.stringify(profileContent);
        await metaEvent.publish();
        
        // Small delay to allow relays to propagate
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      generateModal = false;
      generatedKeys = null;
      newAccountUsername = '';
    } catch (error) {
      console.error('Generated key login failed:', error);
    }
  }

  function copyToClipboard(text: string) {
    if (browser) {
      navigator.clipboard.writeText(text);
    }
  }

  function modalCleanup() {
    nsecModal = false;
    seedModal = false;
    generateModal = false;
    nsecInput = '';
    seedInput = '';
    nsecError = '';
    seedError = '';
    generatedKeys = null;
    newAccountUsername = '';
  }
</script>

<svelte:head>
  <title>Welcome to ZapCooking - Join the Recipe Revolution - zap.cooking</title>
</svelte:head>

<style>
  :global(.lightning-bg) {
    background: #ffffff;
  }

  :global(.lightning-pulse) {
    animation: lightningPulse 2s ease-in-out infinite;
  }

  :global(.electric-glow) {
    box-shadow: 0 0 20px rgba(247, 147, 26, 0.2), 0 0 40px rgba(247, 147, 26, 0.1);
  }

  :global(.glass-card) {
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid rgba(0, 0, 0, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  :global(.lightning-border) {
    position: relative;
    border: 2px solid #f7931a;
    border-radius: 16px;
  }

  @keyframes lightningPulse {
    0%, 100% { 
      opacity: 1;
      transform: scale(1);
    }
    50% { 
      opacity: 0.8;
      transform: scale(1.05);
    }
  }

</style>

<!-- Private Key Modal -->
<Modal bind:open={nsecModal} on:close={modalCleanup}>
  <svelte:fragment slot="title">🔑 Log in with Private Key</svelte:fragment>
  <div class="flex flex-col gap-4">
    <div class="text-sm text-gray-600">
      Enter your private key (nsec1...) or hex format
    </div>
    <input
      bind:value={nsecInput}
      placeholder="nsec1..."
      class="shadow-sm focus:ring-orange-500 focus:border-orange-500 block w-full sm:text-sm border-gray-300 rounded-md p-3"
      disabled={authState.isLoading}
    />
    {#if nsecError}
      <div class="text-red-500 text-sm">{nsecError}</div>
    {/if}
    <div class="flex gap-2">
      <Button on:click={loginWithPrivateKey} primary={true} disabled={authState.isLoading}>
        {authState.isLoading ? '⚡ Connecting...' : '⚡ Login'}
      </Button>
      <Button on:click={modalCleanup} primary={false} disabled={authState.isLoading}>Cancel</Button>
    </div>
  </div>
</Modal>

<!-- Seed Phrase Modal -->
<Modal bind:open={seedModal} on:close={modalCleanup}>
  <svelte:fragment slot="title">🌱 Restore from Seed Phrase</svelte:fragment>
  <div class="flex flex-col gap-4">
    <div class="text-sm text-gray-600">
      Enter your 12 or 24 word seed phrase
    </div>
    <textarea
      bind:value={seedInput}
      placeholder="word1 word2 word3..."
      rows="3"
      class="shadow-sm focus:ring-orange-500 focus:border-orange-500 block w-full sm:text-sm border-gray-300 rounded-md p-3"
      disabled={authState.isLoading}
    ></textarea>
    {#if seedError}
      <div class="text-red-500 text-sm">{seedError}</div>
    {/if}
    <div class="flex gap-2">
      <Button on:click={loginWithSeed} primary={true} disabled={authState.isLoading}>
        {authState.isLoading ? '⚡ Restoring...' : '⚡ Restore'}
      </Button>
      <Button on:click={modalCleanup} primary={false} disabled={authState.isLoading}>Cancel</Button>
    </div>
  </div>
</Modal>

<!-- Generate Keys Modal -->
<Modal bind:open={generateModal} on:close={modalCleanup}>
  <svelte:fragment slot="title">👨‍🍳 Create New Zap Cooking Account</svelte:fragment>
  <div class="flex flex-col gap-4">
    {#if !generatedKeys}
      <div class="space-y-4">
        <div class="bg-orange-50 border border-orange-200 rounded-md p-4">
          <div class="text-sm font-medium text-orange-800 mb-2">🔒 Security Warning</div>
          <div class="text-sm text-orange-700 space-y-2">
            <p>• This will generate a new Nostr private key</p>
            <p>• <strong>Never share your private key with anyone</strong></p>
            <p>• Store it securely - if lost, your account cannot be recovered</p>
            <p>• Consider using a hardware wallet for maximum security</p>
          </div>
        </div>
        
        <div class="text-sm text-gray-600">
          Click "Generate Account" to create a new Nostr identity. You'll be shown your private key (nsec) and public key (npub) that you must save securely.
        </div>
        
        <Button on:click={generateNewKeys} primary={true} class="w-full">
          ⚡ Generate Account
        </Button>
      </div>
    {:else}
      <div class="space-y-4">
        <div class="bg-orange-50 border border-orange-200 rounded-md p-4">
          <div class="text-sm font-medium text-orange-800 mb-2">🚨 CRITICAL: Save Your Private Key</div>
          <div class="text-sm text-orange-700 space-y-2">
            <p>• <strong>Write down your private key (nsec) immediately</strong></p>
            <p>• Store it in a secure location (password manager, encrypted file)</p>
            <p>• <strong>Never share it with anyone</strong></p>
            <p>• If you lose this key, you cannot recover your account</p>
            <p>• This is your only way to prove ownership of this account</p>
          </div>
        </div>
        
        <div>
          <label for="username-input" class="block text-sm font-medium text-gray-700 mb-1">👨‍🍳 Username (Optional)</label>
          <input
            id="username-input"
            bind:value={newAccountUsername}
            placeholder="chef123"
            class="w-full shadow-sm focus:ring-orange-500 focus:border-orange-500 block sm:text-sm border-gray-300 rounded-md p-3"
            disabled={authState.isLoading}
          />
          <div class="text-xs text-gray-500 mt-1">
            This will be your @username on Nostr. Leave empty if you prefer to use your public key.
          </div>
        </div>

        <div>
          <label for="private-key-textarea" class="block text-sm font-medium text-gray-700 mb-1">Private Key (nsec) - SAVE THIS!</label>
          <div class="flex gap-2">
            <textarea
              id="private-key-textarea"
              readonly
              value={nip19.nsecEncode(generatedKeys.privateKey)}
              rows="3"
              class="flex-1 shadow-sm border-orange-300 rounded-md text-sm font-mono bg-orange-50 p-3"
            ></textarea>
            <button
              on:click={() => generatedKeys && copyToClipboard(nip19.nsecEncode(generatedKeys.privateKey))}
              class="px-3 py-2 bg-orange-100 hover:bg-orange-200 rounded-md text-sm text-orange-800 font-medium transition-colors"
            >
              Copy
            </button>
          </div>
          <div class="text-xs text-orange-600 mt-1">⚠️ This is your private key - keep it secret!</div>
        </div>

        <div>
          <label for="public-key-input" class="block text-sm font-medium text-gray-700 mb-1">Public Key (npub)</label>
          <div class="flex gap-2">
            <input
              id="public-key-input"
              readonly
              value={nip19.npubEncode(generatedKeys.publicKey)}
              class="flex-1 shadow-sm border-gray-300 rounded-md text-sm font-mono p-3"
            />
            <button
              on:click={() => generatedKeys && copyToClipboard(nip19.npubEncode(generatedKeys.publicKey))}
              class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors"
            >
              Copy
            </button>
          </div>
          <div class="text-xs text-gray-500 mt-1">This is safe to share - it's your public identity</div>
        </div>

        <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
          <div class="text-sm font-medium text-blue-800 mb-1">💡 What's Next?</div>
          <div class="text-sm text-blue-700">
            After creating your account, you can set up your profile, add a display name, and start sharing recipes with the Nostr community!
          </div>
        </div>

        <div class="flex gap-2">
          <Button on:click={useGeneratedKeys} primary={true} disabled={authState.isLoading} class="w-full">
            {authState.isLoading ? '⚡ Creating Account...' : '⚡ Create Account'}
          </Button>
        </div>
      </div>
    {/if}
  </div>
</Modal>

<!-- Main Login Page -->
<main class="min-h-screen lightning-bg relative overflow-hidden" aria-label="Zap Cooking login page">
  <!-- Background Lightning Effects -->
  <div class="absolute inset-0 opacity-5">
    <div class="absolute top-10 left-10 text-6xl lightning-pulse">⚡</div>
    <div class="absolute top-32 right-20 text-4xl lightning-pulse" style="animation-delay: 0.5s;">⚡</div>
    <div class="absolute bottom-20 left-32 text-5xl lightning-pulse" style="animation-delay: 1s;">⚡</div>
    <div class="absolute bottom-40 right-10 text-3xl lightning-pulse" style="animation-delay: 1.5s;">⚡</div>
    <div class="absolute top-1/2 left-10 text-4xl lightning-pulse" style="animation-delay: 2s;">⚡</div>
  </div>

  <!-- Floating Cooking Elements -->
  <div class="absolute inset-0 opacity-10 pointer-events-none">
    <div class="absolute top-20 left-1/4 text-3xl animate-bounce" style="animation-delay: 0.2s;">🍳</div>
    <div class="absolute top-40 right-1/3 text-2xl animate-bounce" style="animation-delay: 0.8s;">🥘</div>
    <div class="absolute bottom-32 left-1/3 text-2xl animate-bounce" style="animation-delay: 1.2s;">👨‍🍳</div>
    <div class="absolute bottom-20 right-1/4 text-3xl animate-bounce" style="animation-delay: 0.6s;">🍽️</div>
  </div>

  <div class="relative flex flex-col justify-center items-center min-h-screen px-4 py-8">
    <!-- Main Content Card -->
    <section class="glass-card rounded-3xl p-8 md:p-12 max-w-md w-full mx-auto text-center" aria-label="Authentication options">
      <!-- Logo and Title -->
      <div class="mb-8">
        <img src="/favicon.svg" class="w-20 mb-4 mx-auto" alt="Frying Pan with Lightning Bolt" />
        <h1 class="text-3xl md:text-4xl font-bold text-gray-800 mb-2">
          Welcome to <span class="text-orange-500">Zap Cooking</span>
        </h1>
        <p class="text-lg text-gray-600 mb-6">
          Share recipes, support creators with Bitcoin zaps, and join the decentralized cooking revolution
        </p>
      </div>

      <!-- Authentication Options -->
      <nav class="space-y-4 mb-8">
        <!-- NIP-07 Extension Login -->
        <button
          on:click={loginWithNIP07}
          on:mouseenter={() => isHovered = true}
          on:mouseleave={() => isHovered = false}
          disabled={authState.isLoading}
          aria-label="Connect to Zap Cooking using your Nostr browser extension"
          class="w-full lightning-border electric-glow bg-gradient-to-r from-orange-500 to-purple-600 hover:from-orange-600 hover:to-purple-700 text-white font-semibold py-4 px-6 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          <div class="flex items-center justify-center gap-3">
            <span class="text-2xl lightning-pulse">⚡</span>
            <span class="text-lg">
              {authState.isLoading ? 'Connecting...' : 'Connect Nostr Extension'}
            </span>
          </div>
        </button>

        <!-- Private Key Login -->
        <button
          on:click={() => (nsecModal = true)}
          disabled={authState.isLoading}
          aria-label="Log in to Zap Cooking using your private key"
          class="w-full glass-card hover:bg-gray-50 text-gray-800 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none border border-gray-200"
        >
          <div class="flex items-center justify-center gap-3">
            🔑
            <span class="text-lg">Import Private Key</span>
          </div>
        </button>

        <!-- Seed Phrase Login -->
        <button
          on:click={() => (seedModal = true)}
          disabled={authState.isLoading}
          aria-label="Restore your Zap Cooking account using a seed phrase"
          class="w-full glass-card hover:bg-gray-50 text-gray-800 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none border border-gray-200"
        >
          <div class="flex items-center justify-center gap-3">
            🌱
            <span class="text-lg">Restore from Seed Phrase</span>
          </div>
        </button>

        <!-- Generate New Account -->
        <button
          on:click={() => (generateModal = true)}
          disabled={authState.isLoading}
          aria-label="Create a new Zap Cooking account with a fresh Nostr identity"
          class="w-full glass-card hover:bg-gray-50 text-gray-800 font-semibold py-4 px-6 rounded-2xl transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none border border-gray-200"
        >
          <div class="flex items-center justify-center gap-3">
            👨‍🍳
            <span class="text-lg">Create New Identity</span>
          </div>
        </button>
      </nav>

      <!-- Error Display -->
      {#if authState.error}
        <div class="bg-red-500/20 border border-red-500/30 rounded-xl p-4 mb-6">
          <div class="text-red-200 text-sm">{authState.error}</div>
        </div>
      {/if}

      <!-- Extension Help -->
      {#if !authManager?.isNIP07Available()}
        <div class="bg-blue-500/20 border border-blue-500/30 rounded-xl p-4 mb-6">
          <div class="text-blue-200 text-sm">
            <strong>⚡ No Nostr Extension Detected</strong><br/>
            Install <a href="https://getalby.com" target="_blank" class="underline text-blue-300 hover:text-blue-200">Alby</a> or 
            <a href="https://github.com/fiatjaf/nos2x" target="_blank" class="underline text-blue-300 hover:text-blue-200">nos2x</a> 
            for the easiest login experience.
          </div>
        </div>
      {/if}

      <!-- Value Propositions -->
      <section class="grid grid-cols-2 gap-4 text-sm text-gray-600" aria-label="Zap Cooking features">
        <div class="flex items-center gap-2">
          <span class="text-orange-500">⚡</span>
          <span>Instant Bitcoin Tips</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-blue-500">🔒</span>
          <span>Decentralized & Private</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-purple-500">🌍</span>
          <span>Global Recipe Community</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-green-500">📱</span>
          <span>Cross-Platform Access</span>
        </div>
      </section>
    </section>
</main>