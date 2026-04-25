<script lang="ts">
  /**
   * iOS-specific login form.
   *
   * This component is used on iOS native app where NIP-07 browser extensions
   * are not available.
   *
   * Available auth methods:
   * - Private key (nsec) import
   * - NIP-46 bunker URI paste
   * - Generate new keys
   */
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { onMount, onDestroy } from 'svelte';
  import { theme } from '$lib/themeStore';

  // Dark mode detection for logo
  $: resolvedTheme =
    $theme === 'system'
      ? browser && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : $theme;
  $: isDarkMode = resolvedTheme === 'dark';

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
  let generatedKeys: { privateKey: Uint8Array; publicKey: string } | null = null;
  let newAccountUsername = '';
  let newAccountBio = '';
  let newAccountPicture = '';
  let uploadingPicture = false;
  let pictureUploadError = '';

  // Modal states
  let nsecModal = false;
  let bunkerModal = false;
  let generateModal = false;
  let showPrivateKey = false;
  let backupStep = 1;
  let backupDownloaded = false;
  let bunkerConnectionString = '';
  let bunkerError = '';
  let bunkerConnecting = false;

  // File input reference
  let fileInput: HTMLInputElement;

  // For manual URL entry
  let showPictureUrlInput = false;
  let pictureUrlInput = '';

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

          // Redirect to explore page if authenticated
          if (state.isAuthenticated) {
            goto('/explore');
          }
        });
      }
    } catch (error) {
      console.error('Failed to initialize auth manager in iOS login:', error);
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

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

  async function loginWithBunker() {
    if (!authManager) return;

    try {
      bunkerError = '';
      bunkerConnecting = true;

      if (!bunkerConnectionString.trim()) {
        bunkerError = 'Please enter a bunker connection string';
        bunkerConnecting = false;
        return;
      }

      await authManager.authenticateWithNIP46(bunkerConnectionString.trim());
      bunkerModal = false;
      bunkerConnectionString = '';
    } catch (error: any) {
      bunkerError = error?.message || authState.error || 'Failed to connect to bunker';
      console.error('Bunker login failed:', error);
    } finally {
      bunkerConnecting = false;
    }
  }

  function openBunkerModal() {
    bunkerModal = true;
    bunkerError = '';
    bunkerConnecting = false;
    bunkerConnectionString = '';
  }

  function generateNewKeys() {
    if (!authManager) return;
    generatedKeys = authManager.generateKeyPair();
    backupStep = 1;
    backupDownloaded = false;
  }

  function downloadKeysBackup() {
    if (!browser || !generatedKeys) return;
    const nsec = nip19.nsecEncode(generatedKeys.privateKey);
    const npub = nip19.npubEncode(generatedKeys.publicKey);
    const content = [
      'Zap Cooking Nostr Backup',
      '',
      `Public key (npub): ${npub}`,
      '',
      `Private key (nsec): ${nsec}`,
      '',
      'Keep this file safe:',
      '- Do not share your private key.',
      '- Store in a secure password manager or offline storage.',
      '- You can restore your profile in any Nostr client.',
      '- Zap Cooking: https://zap.cooking',
      '- Anyone with this file can access your profile.'
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zapcooking-keys-${date}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    backupDownloaded = true;
  }

  async function useGeneratedKeys(skipProfile = false) {
    if (!generatedKeys || !authManager) return;

    // Capture profile data before any state changes
    const profileName = newAccountUsername.trim();
    const profileBio = newAccountBio.trim();
    const profilePicture = newAccountPicture;

    try {
      if (browser) {
        localStorage.setItem('zapcooking_wallet_welcome_force', '1');
      }

      // Convert Uint8Array to hex string for authentication
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map((b) => b.toString(16).padStart(2, '0'))
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

        if (profileName) {
          profileContent.name = profileName;
        }

        if (profileBio) {
          profileContent.about = profileBio;
        }

        if (profilePicture) {
          profileContent.picture = profilePicture;
        }

        metaEvent.content = JSON.stringify(profileContent);
        console.log('[Profile] Event content:', metaEvent.content);

        const relays = await metaEvent.publish();
        console.log('[Profile] Published to relays:', relays);

        // Wait for relay propagation
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
    bunkerModal = false;
    generateModal = false;
    showPrivateKey = false;
    backupStep = 1;
    backupDownloaded = false;
    nsecInput = '';
    nsecError = '';
    generatedKeys = null;
    newAccountUsername = '';
    newAccountBio = '';
    newAccountPicture = '';
    uploadingPicture = false;
    pictureUploadError = '';
    showPictureUrlInput = false;
    pictureUrlInput = '';
    bunkerConnectionString = '';
    bunkerError = '';
    bunkerConnecting = false;
  }

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

    // Use nostr.build with NIP-98 auth
    try {
      console.log('[Upload] Uploading to nostr.build with NIP-98 auth...');

      const { NDKEvent, NDKPrivateKeySigner } = await import('@nostr-dev-kit/ndk');

      // Convert private key Uint8Array to hex string
      const privateKeyHex = Array.from(generatedKeys.privateKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Create a signer from the private key hex
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
          Authorization: authHeader
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

<!-- Private Key Modal -->
<Modal bind:open={nsecModal} on:close={modalCleanup}>
  <svelte:fragment slot="title">🔑 Log in with Private Key</svelte:fragment>
  <div class="flex flex-col gap-4">
    <div class="text-sm text-caption">Enter your private key (nsec1...) or hex format</div>
    <input
      bind:value={nsecInput}
      placeholder="nsec1..."
      class="input block w-full sm:text-sm p-3"
      disabled={authState.isLoading}
    />
    {#if nsecError}
      <div class="text-sm" style="color: var(--color-danger, #ef4444)">{nsecError}</div>
    {/if}
    <div class="flex gap-2">
      <Button on:click={loginWithPrivateKey} primary={true} disabled={authState.isLoading}>
        {authState.isLoading ? '⚡ Connecting...' : '⚡ Login'}
      </Button>
      <Button on:click={modalCleanup} primary={false} disabled={authState.isLoading}>Cancel</Button>
    </div>
  </div>
</Modal>

<!-- Bunker (NIP-46) Modal -->
<Modal bind:open={bunkerModal} on:close={modalCleanup}>
  <svelte:fragment slot="title">🔐 Paste bunker URI</svelte:fragment>
  <div class="flex flex-col gap-4">
    <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
      <p class="text-sm text-caption">
        Connect a remote signer so your private key stays in your signer app.
      </p>
    </div>

    <div>
      <label
        for="ios-bunker-input"
        class="block text-sm font-medium mb-1.5"
        style="color: var(--color-text-primary)"
      >
        NIP-46 Connection String
      </label>
      <textarea
        id="ios-bunker-input"
        bind:value={bunkerConnectionString}
        placeholder="bunker://pubkey?relay=wss://relay.example.com&#10;or&#10;npub1... wss://relay.example.com"
        rows="3"
        class="input block w-full sm:text-sm p-3 font-mono text-xs"
        disabled={bunkerConnecting || authState.isLoading}
      ></textarea>
      <p class="text-xs text-caption mt-1.5">
        Paste a bunker URI (or npub with relay hints). Do not paste nostrconnect:// here.
      </p>
    </div>

    {#if bunkerError}
      <div
        class="bg-input border rounded-lg p-2.5"
        style="border-color: var(--color-danger, #ef4444)"
      >
        <p class="text-sm" style="color: var(--color-danger, #ef4444)">{bunkerError}</p>
      </div>
    {/if}

    {#if bunkerConnecting}
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-primary, #f97316)">
        <div class="flex items-center gap-2">
          <div
            class="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full"
          ></div>
          <p class="text-sm" style="color: var(--color-text-primary)">
            Connecting to bunker... This may take a moment.
          </p>
        </div>
      </div>
    {/if}

    <div class="flex gap-2">
      <Button
        on:click={loginWithBunker}
        primary={true}
        disabled={bunkerConnecting || authState.isLoading || !bunkerConnectionString.trim()}
      >
        {bunkerConnecting ? '⏳ Connecting...' : '🔐 Connect'}
      </Button>
      <Button on:click={modalCleanup} primary={false} disabled={bunkerConnecting || authState.isLoading}
        >Cancel</Button
      >
    </div>
  </div>
</Modal>

<!-- Generate Keys Modal -->
<Modal bind:open={generateModal} on:close={modalCleanup}>
  <svelte:fragment slot="title"
    >{generatedKeys
      ? backupStep === 2
        ? 'Add a display name and bio (optional)'
        : '🔐 Save your backup key'
      : '🎉 Your Zap Cooking profile is almost ready!'}</svelte:fragment
  >
  <div class="flex flex-col gap-4">
    {#if !generatedKeys}
      <div class="space-y-4">
        <div class="bg-input border rounded-lg p-4" style="border-color: var(--color-input-border)">
          <div class="text-sm font-medium mb-2" style="color: var(--color-text-primary)">
            🔐 Your profile, your keys
          </div>
          <p class="text-sm text-caption mb-3">
            Zap Cooking uses Nostr, which means you own your profile and data.
          </p>
          <ul class="text-sm text-caption space-y-1.5">
            <li class="flex items-start gap-2">
              <span class="text-caption">•</span>
              <span>Your profile will be created on this device</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-caption">•</span>
              <span>You'll see a backup key after creation</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-caption">•</span>
              <span>Saving it lets you recover your profile later</span>
            </li>
          </ul>
        </div>

        <p class="text-sm text-caption">
          When you continue, we'll create your profile and show you a backup key to save for
          safekeeping.
        </p>

        <div>
          <Button on:click={generateNewKeys} primary={true} class="w-full">
            ⚡ Create Profile
          </Button>
          <p class="text-xs text-caption text-center mt-2">Takes less than 10 seconds</p>
        </div>
      </div>
    {:else}
      <div class="space-y-4">
        <!-- Calm intro message -->
        {#if backupStep === 1}
          <div class="bg-green-50 border border-green-200 rounded-lg p-3">
            <p class="text-sm text-green-700">
              ✓ Your profile has been created. Save your backup key below to recover it later.
            </p>
          </div>
        {/if}

        {#if backupStep === 1}
          <!-- Backup Key (Private) - Hidden by default -->
          <div>
            <p class="block text-sm font-medium mb-1" style="color: var(--color-text-primary)">
              Backup key (private)
            </p>
            {#if showPrivateKey}
              <div class="flex gap-2">
                <textarea
                  id="private-key-textarea"
                  readonly
                  value={nip19.nsecEncode(generatedKeys.privateKey)}
                  rows="2"
                  class="flex-1 input text-sm font-mono p-3"
                ></textarea>
                <button
                  on:click={() =>
                    generatedKeys && copyToClipboard(nip19.nsecEncode(generatedKeys.privateKey))}
                  class="px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm font-medium transition-colors"
                  style="color: var(--color-text-primary)"
                >
                  Copy
                </button>
              </div>
              <div class="flex items-center justify-between mt-1.5">
                <p class="text-xs text-amber-600">
                  ⚠️ Anyone with this key can control your profile. Never share it.
                </p>
                <button
                  on:click={() => (showPrivateKey = false)}
                  class="text-xs text-caption hover:opacity-80 underline"
                >
                  Hide
                </button>
              </div>
            {:else}
              <div class="flex gap-2">
                <div
                  class="flex-1 bg-input border rounded-lg p-3 text-sm text-caption font-mono"
                  style="border-color: var(--color-input-border)"
                >
                  ••••••••••••••••••••••••••••••••
                </div>
                <button
                  on:click={() => (showPrivateKey = true)}
                  class="px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm font-medium transition-colors"
                  style="color: var(--color-text-primary)"
                >
                  Reveal
                </button>
              </div>
              <p class="text-xs text-caption mt-1.5">Reveal to copy and save securely</p>
            {/if}
          </div>

          <!-- Public Identity (npub) -->
          <div>
            <label
              for="public-key-input"
              class="block text-sm font-medium mb-1"
              style="color: var(--color-text-primary)">Public identity (npub)</label
            >
            <div class="flex gap-2">
              <input
                id="public-key-input"
                readonly
                value={nip19.npubEncode(generatedKeys.publicKey)}
                class="flex-1 input text-sm font-mono p-3"
              />
              <button
                on:click={() =>
                  generatedKeys && copyToClipboard(nip19.npubEncode(generatedKeys.publicKey))}
                class="px-3 py-2 bg-accent-gray hover:opacity-80 rounded-lg text-sm transition-colors"
                style="color: var(--color-text-primary)"
              >
                Copy
              </button>
            </div>
            <p class="text-xs text-caption mt-1.5">
              This is safe to share - it's your public identity
            </p>
          </div>

          <p class="text-xs text-caption uppercase tracking-wide mb-2">Step 1</p>
          <div
            class="bg-input border rounded-lg p-3"
            style="border-color: var(--color-input-border)"
          >
            <p class="text-sm text-caption">
              Download a backup file with your keys and safety notes.
            </p>
            <Button on:click={downloadKeysBackup} primary={true} class="w-full mt-3">
              Download backup file
            </Button>
          </div>
          <Button
            on:click={() => (backupStep = 2)}
            primary={false}
            class="w-full {!backupDownloaded ? 'opacity-50 cursor-not-allowed' : ''}"
            disabled={!backupDownloaded}
          >
            ⚡ Next
          </Button>
          {#if !backupDownloaded}
            <p class="text-xs text-caption text-center">Download the backup file to continue.</p>
          {/if}
        {:else}
          <p class="text-xs text-caption uppercase tracking-wide mb-2">Step 2</p>

          <div class="space-y-3 mb-4">
            <!-- Profile Photo -->
            <div>
              <div class="flex items-center gap-3 mb-2">
                <div class="relative">
                  {#if newAccountPicture}
                    <img
                      src={newAccountPicture}
                      alt="Profile preview"
                      class="w-14 h-14 rounded-full object-cover border-2"
                      style="border-color: var(--color-input-border)"
                    />
                  {:else}
                    <div
                      class="w-14 h-14 rounded-full bg-input border-2 border-dashed flex items-center justify-center"
                      style="border-color: var(--color-input-border)"
                    >
                      <span class="text-caption text-xl">👤</span>
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
                      <span class="text-caption">|</span>
                      <button
                        on:click={() => (showPictureUrlInput = !showPictureUrlInput)}
                        class="text-sm text-caption hover:opacity-80 transition-colors"
                      >
                        Paste URL
                      </button>
                    {/if}
                  </div>
                  {#if pictureUploadError && !showPictureUrlInput}
                    <p class="text-xs text-red-500 mt-0.5">{pictureUploadError}</p>
                  {:else if newAccountPicture}
                    <p class="text-xs text-caption mt-0.5">Looking good!</p>
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
                    class="flex-1 input text-sm p-2"
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
                class="w-full input block text-sm p-2.5"
                disabled={authState.isLoading}
              />
              <p class="text-xs text-caption mt-1">Shown on your profile across Nostr clients</p>
            </div>

            <!-- Bio -->
            <div>
              <textarea
                bind:value={newAccountBio}
                placeholder="A short bio about you..."
                rows="2"
                class="w-full input block text-sm p-2.5 resize-none"
                disabled={authState.isLoading}
              ></textarea>
              <p class="text-xs text-caption mt-1">A short description about you</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="space-y-2">
            <Button
              on:click={() => useGeneratedKeys(false)}
              primary={true}
              disabled={authState.isLoading || uploadingPicture}
              class="w-full"
            >
              {authState.isLoading ? '⚡ Setting up...' : '⚡ Continue to Zap Cooking'}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<!-- Main Login Page -->
<main
  class="min-h-screen lightning-bg relative overflow-hidden"
  aria-label="Zap Cooking login page"
>
  <!-- Background Lightning Effects -->
  <div class="absolute inset-0 opacity-5">
    <div class="absolute top-10 left-10 text-6xl lightning-pulse">⚡</div>
    <div class="absolute top-32 right-20 text-4xl lightning-pulse" style="animation-delay: 0.5s;">
      ⚡
    </div>
    <div class="absolute bottom-20 left-32 text-5xl lightning-pulse" style="animation-delay: 1s;">
      ⚡
    </div>
    <div
      class="absolute bottom-40 right-10 text-3xl lightning-pulse"
      style="animation-delay: 1.5s;"
    >
      ⚡
    </div>
    <div class="absolute top-1/2 left-10 text-4xl lightning-pulse" style="animation-delay: 2s;">
      ⚡
    </div>
  </div>

  <!-- Floating Cooking Elements -->
  <div class="absolute inset-0 opacity-10 pointer-events-none">
    <div class="absolute top-20 left-1/4 text-3xl animate-bounce" style="animation-delay: 0.2s;">
      🍳
    </div>
    <div class="absolute top-40 right-1/3 text-2xl animate-bounce" style="animation-delay: 0.8s;">
      🥘
    </div>
    <div class="absolute bottom-32 left-1/3 text-2xl animate-bounce" style="animation-delay: 1.2s;">
      👨‍🍳
    </div>
    <div
      class="absolute bottom-20 right-1/4 text-3xl animate-bounce"
      style="animation-delay: 0.6s;"
    >
      🍽️
    </div>
  </div>

  <div class="ios-signin-wrap">
    <div class="signin-scrim" aria-hidden="true"></div>
    <section
      class="signin-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-signin-title"
    >
      <p class="signin-eyebrow">Welcome to</p>
      <h1 id="ios-signin-title" class="signin-wordmark">
        <img src="/zap_cooking_logo_white.svg" alt="Zap Cooking" />
      </h1>
      <p class="signin-tagline">Share recipes and get paid by your community.</p>

      <!-- Primary CTA on iOS: Create Profile.
           NIP-07 + QR pairing intentionally omitted on iOS — App Store
           policy on cross-app handoff for unlisted signers. The existing
           supportsNIP46QRPairing() helper at $lib/platform.ts returns
           false here. -->
      <button
        type="button"
        on:click={() => (generateModal = true)}
        disabled={authState.isLoading}
        aria-label="Create a new Zap Cooking profile"
        class="signin-cta-primary"
      >
        <svg class="signin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor" />
        </svg>
        <span>{authState.isLoading ? 'Connecting…' : 'Create Profile'}</span>
      </button>

      {#if authState.error}
        <div class="signin-error" role="alert">
          {authState.error}
        </div>
      {/if}

      <div class="signin-divider" aria-hidden="true">
        <span>or</span>
      </div>

      <!-- Tile row on iOS: 2 tiles only (Bunker URI, Import key).
           QR / pair phone is dropped per platform policy, not shown
           disabled — disabled-but-untappable is worse UX than a
           smaller grid. -->
      <div class="signin-tiles signin-tiles-two" role="group" aria-label="Other sign-in methods">
        <button
          type="button"
          on:click={openBunkerModal}
          disabled={authState.isLoading}
          aria-label="Sign in with a bunker URI from a remote signer"
          class="signin-tile"
        >
          <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.6" />
            <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            <circle cx="12" cy="15" r="1.5" fill="currentColor" />
          </svg>
          <span class="signin-tile-title">Bunker URI</span>
          <span class="signin-tile-sub">Remote signer</span>
        </button>

        <button
          type="button"
          on:click={() => (nsecModal = true)}
          disabled={authState.isLoading}
          aria-label="Sign in by importing a private key"
          class="signin-tile"
        >
          <svg class="signin-tile-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="14.5" r="3.5" stroke="currentColor" stroke-width="1.6" />
            <path d="M11 12l9-9m-3 0h3v3m-5 2l2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="signin-tile-title">Import key</span>
          <span class="signin-tile-sub">Paste nsec</span>
        </button>
      </div>

      <footer class="signin-footer">
        <span class="signin-footer-tag">Your identity · Your data · Your money</span>
        <span class="signin-footer-links">
          <a href="/terms">Terms</a>
          <span aria-hidden="true">·</span>
          <a href="/privacy">Privacy</a>
        </span>
      </footer>
    </section>
  </div>
</main>

<style>
  :global(.lightning-bg) {
    background-color: var(--color-bg-primary);
  }

  :global(.lightning-pulse) {
    animation: lightningPulse 2s ease-in-out infinite;
  }

  :global(.glass-card) {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  @keyframes lightningPulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.8;
      transform: scale(1.05);
    }
  }

  /* ───── iOS sign-in card (parity with desktop) ─────
     Mirrors the dark-surface styles in src/routes/login/+page.svelte.
     Kept duplicated rather than promoted to app.css because the
     visual is scoped to the login surface and the iOS layout has
     small differences (full-page wrap, two-tile grid). */

  .ios-signin-wrap {
    position: relative;
    z-index: 1;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 1.5rem 1rem;
    padding-top: max(2.5rem, env(safe-area-inset-top));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
  }

  .signin-scrim {
    position: absolute;
    inset: 0;
    background: rgba(11, 14, 20, 0.85);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    z-index: -1;
  }

  .signin-card {
    position: relative;
    width: 100%;
    max-width: 440px;
    background: #13171f;
    border: 1px solid #262c3a;
    border-radius: 24px;
    padding: 2.25rem 1.75rem 1.5rem;
    box-shadow:
      0 1px 0 rgba(245, 235, 221, 0.04) inset,
      0 24px 64px rgba(0, 0, 0, 0.55),
      0 4px 12px rgba(247, 147, 26, 0.06);
    text-align: center;
    color: #f5ebdd;
    font-family: 'Albert Sans', 'Inter', system-ui, -apple-system, sans-serif;
    animation: signinRise 320ms cubic-bezier(0.2, 0.8, 0.25, 1) both;
  }

  @keyframes signinRise {
    from { opacity: 0; transform: translateY(8px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .signin-eyebrow {
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #7e8597;
    margin: 0 0 0.5rem;
  }

  .signin-wordmark { margin: 0 auto 0.875rem; line-height: 0; }
  .signin-wordmark img {
    width: 240px;
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
  }

  .signin-tagline {
    font-size: 0.9375rem;
    font-weight: 400;
    color: #c5b8a3;
    margin: 0 0 1.75rem;
    line-height: 1.5;
  }

  .signin-cta-primary {
    width: 100%;
    height: 52px;
    border-radius: 14px;
    border: none;
    background: linear-gradient(135deg, #f7931a 0%, #ff5f1f 100%);
    color: #fff8ec;
    font-family: inherit;
    font-weight: 600;
    font-size: 0.9375rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0 1.25rem;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.18) inset,
      0 8px 24px rgba(247, 147, 26, 0.36),
      0 2px 6px rgba(255, 95, 31, 0.22);
    transition: transform 120ms ease, box-shadow 200ms ease, opacity 200ms ease;
  }
  .signin-cta-primary:hover:not(:disabled) { transform: translateY(-1px); }
  .signin-cta-primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .signin-cta-primary:focus-visible { outline: 2px solid #f5ebdd; outline-offset: 3px; }

  .signin-icon { color: currentColor; flex-shrink: 0; }

  .signin-error {
    margin-top: 1rem;
    padding: 0.625rem 0.75rem;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.6);
    font-size: 0.8125rem;
    color: #fca5a5;
    line-height: 1.5;
  }

  .signin-divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.5rem 0 1rem;
    color: #7e8597;
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
  }
  .signin-divider::before, .signin-divider::after {
    content: ''; flex: 1; height: 1px; background: #262c3a;
  }

  .signin-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.625rem;
  }
  .signin-tiles-two {
    grid-template-columns: repeat(2, 1fr);
  }

  .signin-tile {
    background: #1b202b;
    border: 1px solid #262c3a;
    border-radius: 14px;
    padding: 0.875rem 0.5rem 0.75rem;
    color: #f5ebdd;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    text-align: center;
    transition: transform 120ms ease, border-color 200ms ease, background 200ms ease;
  }
  .signin-tile:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: rgba(247, 147, 26, 0.5);
    background: #20262f;
  }
  .signin-tile:focus-visible { outline: 2px solid #f7931a; outline-offset: 2px; }
  .signin-tile:disabled { opacity: 0.55; cursor: not-allowed; }
  .signin-tile-icon { color: #f7931a; margin-bottom: 0.125rem; }
  .signin-tile-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: #f5ebdd;
    line-height: 1.2;
  }
  .signin-tile-sub {
    font-size: 0.6875rem;
    font-weight: 400;
    color: #7e8597;
    line-height: 1.2;
  }

  .signin-footer {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid #262c3a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.75rem;
    color: #7e8597;
  }
  .signin-footer-tag { font-weight: 500; letter-spacing: 0.02em; }
  .signin-footer-links { display: inline-flex; align-items: center; gap: 0.4rem; }
  .signin-footer a { color: #f7931a; text-decoration: none; }
  .signin-footer a:hover { text-decoration: underline; }

  @media (max-width: 480px) {
    .signin-card { padding: 1.75rem 1.25rem 1.25rem; border-radius: 20px; }
    .signin-wordmark img { width: 200px; }
    .signin-tagline { font-size: 0.875rem; margin-bottom: 1.5rem; }
    .signin-tile { padding: 0.75rem 0.375rem 0.625rem; }
    .signin-tile-title { font-size: 0.75rem; }
    .signin-tile-sub { font-size: 0.625rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .signin-card,
    .signin-cta-primary,
    .signin-tile {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
