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
  let newAccountBio = '';
  let newAccountPicture = '';
  let uploadingPicture = false;
  let pictureUploadError = '';
  
  // Modal states
  let nsecModal = false;
  let seedModal = false;
  let generateModal = false;
  let showPrivateKey = false;
  
  // File input reference
  let fileInput: HTMLInputElement;

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

  async function useGeneratedKeys(skipProfile = false) {
    if (!generatedKeys || !authManager) return;
    
    // Capture profile data before any state changes
    const profileName = newAccountUsername.trim();
    const profileBio = newAccountBio.trim();
    const profilePicture = newAccountPicture;
    
    try {
      // Convert Uint8Array to hex string for authentication
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      await authManager.authenticateWithPrivateKey(privateKeyHex);
      
      // Create profile if any profile data is provided (and not skipping)
      const hasProfileData = !skipProfile && (profileName || profileBio || profilePicture);
      
      if (hasProfileData) {
        console.log('[Profile] Publishing kind-0 metadata...');
        
        const { NDKEvent } = await import('@nostr-dev-kit/ndk');
        const metaEvent = new NDKEvent($ndk);
        metaEvent.kind = 0;
        metaEvent.tags = [];
        
        const profileContent: any = {};
        
        // Add name if provided
        if (profileName) {
          profileContent.name = profileName;
        }
        
        // Add bio if provided
        if (profileBio) {
          profileContent.about = profileBio;
        }
        
        // Add profile picture if uploaded
        if (profilePicture) {
          profileContent.picture = profilePicture;
        }
        
        metaEvent.content = JSON.stringify(profileContent);
        console.log('[Profile] Event content:', metaEvent.content);
        
        const relays = await metaEvent.publish();
        console.log('[Profile] Published to relays:', relays);
        
        // Wait for relay propagation
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      generateModal = false;
      generatedKeys = null;
      newAccountUsername = '';
      newAccountBio = '';
      newAccountPicture = '';
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
    showPrivateKey = false;
    nsecInput = '';
    seedInput = '';
    nsecError = '';
    seedError = '';
    generatedKeys = null;
    newAccountUsername = '';
    newAccountBio = '';
    newAccountPicture = '';
    uploadingPicture = false;
    pictureUploadError = '';
    showPictureUrlInput = false;
    pictureUrlInput = '';
  }

  // For manual URL entry
  let showPictureUrlInput = false;
  let pictureUrlInput = '';

  function applyPictureUrl() {
    const url = pictureUrlInput.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      newAccountPicture = url;
      showPictureUrlInput = false;
      pictureUrlInput = '';
      pictureUploadError = '';
    } else {
      pictureUploadError = 'Please enter a valid URL';
    }
  }

  async function uploadProfilePicture(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      pictureUploadError = 'Please select an image file (such as JPG, PNG, GIF)';
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      pictureUploadError = 'Image must be less than 5MB';
      return;
    }

    if (!generatedKeys) {
      pictureUploadError = 'Please generate keys first';
      return;
    }

    uploadingPicture = true;
    pictureUploadError = '';
    let uploadedUrl = '';

    // Use nostr.build with NIP-98 auth (same as ImageUploader component)
    try {
      console.log('[Upload] Uploading to nostr.build with NIP-98 auth...');
      
      const { NDKEvent, NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');
      
      // Create a signer from the previously converted private key hex
      const signer = new NDKPrivateKeySigner(privateKeyHex);
      
      
      
      
      // Create NIP-98 auth event
      const uploadUrl = 'https://nostr.build/api/v2/upload/files';
      const authEvent = new NDKEvent($ndk);
      authEvent.kind = 27235;
      const now = Math.floor(Date.now() / 1000);
      authEvent.created_at = now;
      authEvent.content = '';
      authEvent.tags = [
        ['u', uploadUrl],
        ['method', 'POST'],
        ['expiration', String(now + 60)]
      ];
      
      // Sign with the generated keys
      await authEvent.sign(signer);
      
      // Build the auth header
      const authPayload = {
        id: authEvent.id,
        pubkey: authEvent.pubkey,
        created_at: authEvent.created_at,
        kind: authEvent.kind,
        tags: authEvent.tags,
        content: authEvent.content,
        sig: authEvent.sig
      };
      const authHeader = `Nostr ${btoa(JSON.stringify(authPayload))}`;
      
      // Upload with NIP-98 auth
      const formData = new FormData();
      formData.append('file[]', file);
      
      const res = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': authHeader
        }
      });
      
      console.log('[Upload] Response status:', res.status);
      
      if (res.ok) {
        const data = await res.json();
        console.log('[Upload] Response:', data);
        if (data.data?.[0]?.url) {
          uploadedUrl = data.data[0].url;
          console.log('[Upload] Success:', uploadedUrl);
        }
      } else {
        const errorText = await res.text();
        console.error('[Upload] Error:', res.status, errorText);
      }
    } catch (error: any) {
      console.error('[Upload] Failed:', error?.message || error);
    }

    if (uploadedUrl) {
      newAccountPicture = uploadedUrl;
    } else {
      pictureUploadError = 'Upload failed. Try pasting a URL instead.';
      showPictureUrlInput = true;
    }

    uploadingPicture = false;
    if (input) input.value = '';
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
  <svelte:fragment slot="title">{generatedKeys ? '🔐 Save your backup key' : '🎉 Your Zap Cooking account is almost ready'}</svelte:fragment>
  <div class="flex flex-col gap-4">
    {#if !generatedKeys}
      <div class="space-y-4">
        <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div class="text-sm font-medium text-gray-700 mb-2">🔐 Your account, your keys</div>
          <p class="text-sm text-gray-600 mb-3">
            Zap Cooking uses Nostr, which means you own your account and data.
          </p>
          <ul class="text-sm text-gray-600 space-y-1.5">
            <li class="flex items-start gap-2">
              <span class="text-gray-400">•</span>
              <span>Your account will be created on this device</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-gray-400">•</span>
              <span>You'll see a backup key after creation</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-gray-400">•</span>
              <span>Saving it lets you recover your account later</span>
            </li>
          </ul>
        </div>
        
        <p class="text-sm text-gray-500">
          When you continue, we'll create your account and show you a backup key to save for safekeeping.
        </p>
        
        <div>
          <Button on:click={generateNewKeys} primary={true} class="w-full">
            ⚡ Create Account
          </Button>
          <p class="text-xs text-gray-400 text-center mt-2">Takes less than 10 seconds</p>
        </div>
      </div>
    {:else}
      <div class="space-y-4">
        <!-- Calm intro message -->
        <div class="bg-green-50 border border-green-200 rounded-lg p-3">
          <p class="text-sm text-green-700">
            ✓ Your account has been created. Save your backup key below to recover it later.
          </p>
        </div>

        <!-- Backup Key (Private) - Hidden by default -->
        <div>
          <p class="block text-sm font-medium text-gray-700 mb-1">Backup key (private)</p>
          {#if showPrivateKey}
            <div class="flex gap-2">
              <textarea
                id="private-key-textarea"
                readonly
                value={nip19.nsecEncode(generatedKeys.privateKey)}
                rows="2"
                class="flex-1 shadow-sm border-gray-300 rounded-lg text-sm font-mono bg-gray-50 p-3"
              ></textarea>
              <button
                on:click={() => generatedKeys && copyToClipboard(nip19.nsecEncode(generatedKeys.privateKey))}
                class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                Copy
              </button>
            </div>
            <div class="flex items-center justify-between mt-1.5">
              <p class="text-xs text-amber-600">⚠️ Anyone with this key can control your account. Never share it.</p>
              <button
                on:click={() => showPrivateKey = false}
                class="text-xs text-gray-400 hover:text-gray-500 underline"
              >
                Hide
              </button>
            </div>
          {:else}
            <div class="flex gap-2">
              <div class="flex-1 bg-gray-100 border border-gray-200 rounded-lg p-3 text-sm text-gray-400 font-mono">
                ••••••••••••••••••••••••••••••••
              </div>
              <button
                on:click={() => showPrivateKey = true}
                class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                Reveal
              </button>
            </div>
            <p class="text-xs text-gray-400 mt-1.5">Reveal to copy and save securely</p>
          {/if}
        </div>

        <!-- Public Identity (npub) -->
        <div>
          <label for="public-key-input" class="block text-sm font-medium text-gray-700 mb-1">Public identity (npub)</label>
          <div class="flex gap-2">
            <input
              id="public-key-input"
              readonly
              value={nip19.npubEncode(generatedKeys.publicKey)}
              class="flex-1 shadow-sm border-gray-300 rounded-lg text-sm font-mono p-3 bg-gray-50"
            />
            <button
              on:click={() => generatedKeys && copyToClipboard(nip19.npubEncode(generatedKeys.publicKey))}
              class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition-colors"
            >
              Copy
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1.5">This is safe to share - it's your public identity</p>
        </div>

        <!-- Divider -->
        <div class="border-t border-gray-100 pt-4">
          <!-- Profile Setup Section -->
          <p class="text-sm font-medium text-gray-700 mb-3">👋 Set up your profile (optional)</p>
          
          <div class="space-y-3 mb-4">
            <!-- Profile Photo -->
            <div>
              <div class="flex items-center gap-3 mb-2">
                <div class="relative">
                  {#if newAccountPicture}
                    <img 
                      src={newAccountPicture} 
                      alt="Profile preview" 
                      class="w-14 h-14 rounded-full object-cover border-2 border-gray-200"
                    />
                  {:else}
                    <div class="w-14 h-14 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center">
                      <span class="text-gray-400 text-xl">👤</span>
                    </div>
                  {/if}
                </div>
                <div class="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    bind:this={fileInput}
                    on:change={uploadProfilePicture}
                    disabled={uploadingPicture || authState.isLoading}
                  />
                  <div class="flex items-center gap-2">
                    <button
                      on:click={() => fileInput?.click()}
                      disabled={uploadingPicture || authState.isLoading}
                      class="text-sm text-orange-500 hover:text-orange-600 font-medium transition-colors disabled:opacity-50"
                    >
                      {#if uploadingPicture}
                        Uploading...
                      {:else if newAccountPicture}
                        Change photo
                      {:else}
                        Upload photo
                      {/if}
                    </button>
                    {#if !newAccountPicture && !uploadingPicture}
                      <span class="text-gray-300">|</span>
                      <button
                        on:click={() => showPictureUrlInput = !showPictureUrlInput}
                        class="text-sm text-gray-400 hover:text-gray-500 transition-colors"
                      >
                        Paste URL
                      </button>
                    {/if}
                  </div>
                  {#if pictureUploadError && !showPictureUrlInput}
                    <p class="text-xs text-red-500 mt-0.5">{pictureUploadError}</p>
                  {:else if newAccountPicture}
                    <p class="text-xs text-gray-400 mt-0.5">Looking good!</p>
                  {/if}
                </div>
              </div>
              
              <!-- URL Input (shown on demand or after upload failure) -->
              {#if showPictureUrlInput && !newAccountPicture}
                <div class="flex gap-2 mt-2">
                  <input
                    type="url"
                    bind:value={pictureUrlInput}
                    placeholder="https://example.com/photo.jpg"
                    class="flex-1 shadow-sm focus:ring-orange-500 focus:border-orange-500 text-sm border-gray-300 rounded-lg p-2"
                    disabled={authState.isLoading}
                  />
                  <button
                    on:click={applyPictureUrl}
                    disabled={!pictureUrlInput.trim() || authState.isLoading}
                    class="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
                {#if pictureUploadError}
                  <p class="text-xs text-red-500 mt-1">{pictureUploadError}</p>
                {/if}
              {/if}
            </div>

            <!-- Display Name -->
            <div>
              <input
                id="username-input"
                bind:value={newAccountUsername}
                placeholder="Display name"
                class="w-full shadow-sm focus:ring-orange-500 focus:border-orange-500 block text-sm border-gray-300 rounded-lg p-2.5"
                disabled={authState.isLoading}
              />
              <p class="text-xs text-gray-400 mt-1">Shown on your profile across Nostr clients</p>
            </div>

            <!-- Bio -->
            <div>
              <textarea
                bind:value={newAccountBio}
                placeholder="A short bio about you..."
                rows="2"
                class="w-full shadow-sm focus:ring-orange-500 focus:border-orange-500 block text-sm border-gray-300 rounded-lg p-2.5 resize-none"
                disabled={authState.isLoading}
              ></textarea>
              <p class="text-xs text-gray-400 mt-1">A short description about you</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="space-y-2">
            <Button on:click={() => useGeneratedKeys(false)} primary={true} disabled={authState.isLoading || uploadingPicture} class="w-full">
              {authState.isLoading ? '⚡ Setting up...' : '⚡ Continue to Zap Cooking'}
            </Button>
            <button
              on:click={() => useGeneratedKeys(true)}
              disabled={authState.isLoading || uploadingPicture}
              class="w-full text-sm text-gray-400 hover:text-gray-500 transition-colors disabled:opacity-50"
            >
              Skip profile setup for now
            </button>
          </div>
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

  <div class="relative flex flex-col items-center min-h-screen px-4 pt-12 md:pt-20 pb-8">
    <!-- Main Content Card -->
    <section class="glass-card rounded-2xl p-6 md:p-8 w-full mx-auto text-center" style="max-width: 420px;" aria-label="Authentication options">
      <!-- Logo and Title -->
      <div class="mb-5">
        <img src="/favicon.svg" class="w-14 md:w-16 mb-2 mx-auto" alt="Frying Pan with Lightning Bolt" />
        <h1 class="text-xl md:text-2xl font-bold text-gray-800 mb-1">
          Welcome to <span class="text-orange-500">Zap Cooking</span>
        </h1>
        <p class="text-sm text-gray-500">
          Share recipes and support creators with Bitcoin zaps
        </p>
      </div>

      <!-- Authentication Options -->
      <div class="space-y-2.5 mb-3">
        <!-- NIP-07 Extension Login - Primary CTA -->
        <div>
          <button
            on:click={loginWithNIP07}
            on:mouseenter={() => isHovered = true}
            on:mouseleave={() => isHovered = false}
            disabled={authState.isLoading}
            aria-label="Sign in to Zap Cooking using your Nostr browser extension"
            class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold h-[52px] md:h-12 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            <div class="flex items-center justify-center gap-2">
              <span class="text-lg">⚡</span>
              <span class="text-[15px]">
                {authState.isLoading ? 'Connecting...' : 'Sign in with Nostr Extension'}
              </span>
            </div>
          </button>
          <!-- Extension helper - only show if no extension -->
          {#if !authManager?.isNIP07Available()}
            <p class="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
              No extension detected. Install <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-gray-500">Alby</a> or <a href="https://github.com/fiatjaf/nos2x" target="_blank" rel="noopener noreferrer" class="underline hover:text-gray-500">nos2x</a>.
            </p>
          {/if}
        </div>

        <!-- Generate New Account - Secondary CTA -->
        <button
          on:click={() => (generateModal = true)}
          disabled={authState.isLoading}
          aria-label="Create a new Zap Cooking account"
          class="w-full bg-white hover:bg-gray-50 text-gray-600 font-medium h-11 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200"
        >
          <span class="text-sm">Create Account</span>
        </button>
      </div>

      <!-- Error Display -->
      {#if authState.error}
        <div class="bg-red-50 border border-red-200 rounded-lg p-2.5 mb-3">
          <p class="text-red-600 text-xs">{authState.error}</p>
        </div>
      {/if}

      <!-- Advanced option - Import Private Key -->
      <div class="py-3">
        <button
          on:click={() => (nsecModal = true)}
          disabled={authState.isLoading}
          class="text-[11px] text-gray-400 hover:text-gray-500 hover:underline transition-colors disabled:opacity-50"
        >
          Advanced: Import existing key
        </button>
      </div>

      <!-- Value Propositions - Quieter styling -->
      <section class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-gray-400 pt-3 border-t border-gray-100" aria-label="Zap Cooking features">
        <div class="flex items-center gap-1">
          <span class="text-orange-400 text-xs">⚡</span>
          <span>Instant Bitcoin Tips</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-blue-400 text-xs">🔒</span>
          <span>Decentralized & Private</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-purple-400 text-xs">🌍</span>
          <span>Global Recipe Community</span>
        </div>
        <div class="flex items-center gap-1">
          <span class="text-green-400 text-xs">📱</span>
          <span>Cross-Platform Access</span>
        </div>
      </section>
    </section>
  </div>
</main>