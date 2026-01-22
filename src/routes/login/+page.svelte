<script lang="ts">
  import Button from '../../components/Button.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import Modal from '../../components/Modal.svelte';
  import type { PageData } from './$types';
  import QRCode from 'svelte-qrcode';

  export const data: PageData = {} as PageData;
  import { nip19 } from 'nostr-tools';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { onMount, onDestroy } from 'svelte';
  import { DEFAULT_PROFILE_IMAGE } from '$lib/consts';
  import { theme } from '$lib/themeStore';
  import { platformIsIOS } from '$lib/platform';
  import LoginFormIOS from '../../components/LoginFormIOS.svelte';

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
  let generateModal = false;
  let showPrivateKey = false;
  let backupStep = 1;
  let backupDownloaded = false;
  let bunkerModal = false;
  let nip46UniversalModal = false;

  // Bunker form states
  let bunkerConnectionString = '';
  let bunkerError = '';
  let bunkerConnecting = false;

  // Universal NIP-46 pairing states
  let nip46PairingUri = '';
  let nip46PairingStatus = 'Waiting for approval…';
  let nip46PairingError = '';

  // Check if running on Android via Capacitor
  $: isAndroid =
    browser &&
    typeof window !== 'undefined' &&
    (window as any).Capacitor?.getPlatform?.() === 'android';

  // File input reference
  let fileInput: HTMLInputElement;

  // Animation states
  let isHovered = false;

  // UX state for extension detection warning
  let showMissingSignerNotice = false;

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

        // Check for pending NIP-46 pairing on mount
        // This handles the case where user returns from signer app
        // and the Capacitor appStateChange listener didn't fire
        if (authManager.hasPendingNip46Pairing()) {
          console.log('[Login] Found pending NIP-46 pairing, restarting listener...');
          nip46UniversalModal = true;
          nip46PairingStatus = 'Waiting for approval…';
          authManager.restartNip46ListenerIfPending().catch((e: Error) => {
            console.error('[Login] Failed to restart NIP-46 listener:', e);
          });
        }
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

    // Check if extension is available before trying
    if (!authManager.isNIP07Available()) {
      showMissingSignerNotice = true;
      return;
    }

    // Hide notice on successful attempt
    showMissingSignerNotice = false;

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

  async function startUniversalPairing() {
    if (!authManager) return;

    try {
      nip46PairingError = '';
      nip46PairingStatus = 'Generating connection...';
      nip46UniversalModal = true;

      const result = await authManager.startNip46PairingUniversal();
      nip46PairingUri = result.uri;
      nip46PairingStatus = 'Waiting for approval…';

      // On Android, open the URI with _system target
      if (isAndroid) {
        window.open(result.uri, '_system');
      }
    } catch (error) {
      console.error('[NIP-46] Failed to start universal pairing:', error);
      nip46PairingError = error instanceof Error ? error.message : 'Failed to start pairing';
      nip46PairingStatus = '';
    }
  }

  function modalCleanup() {
    nsecModal = false;
    generateModal = false;
    bunkerModal = false;
    nip46UniversalModal = false;
    showPrivateKey = false;
    backupStep = 1;
    backupDownloaded = false;
    nsecInput = '';
    nsecError = '';
    bunkerConnectionString = '';
    bunkerError = '';
    bunkerConnecting = false;
    generatedKeys = null;
    newAccountUsername = '';
    newAccountBio = '';
    newAccountPicture = '';
    uploadingPicture = false;
    pictureUploadError = '';
    showPictureUrlInput = false;
    pictureUrlInput = '';
    nip46PairingUri = '';
    nip46PairingStatus = 'Waiting for approval…';
    nip46PairingError = '';
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

<svelte:head>
  <title>Welcome to ZapCooking - Join the Recipe Revolution - zap.cooking</title>
</svelte:head>

<!-- iOS uses a simplified login form without NIP-07 and NIP-46 -->
{#if $platformIsIOS}
  <LoginFormIOS />
{:else}
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
        <Button on:click={modalCleanup} primary={false} disabled={authState.isLoading}
          >Cancel</Button
        >
      </div>
    </div>
  </Modal>

  <!-- Bunker (NIP-46) Modal -->
  <Modal bind:open={bunkerModal} on:close={modalCleanup}>
    <svelte:fragment slot="title">🔐 Connect External Signer</svelte:fragment>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Use a remote signer so your private key never touches this device. This is the most secure
          way to sign in.
        </p>
      </div>

      <div>
        <label
          for="bunker-input"
          class="block text-sm font-medium mb-1.5"
          style="color: var(--color-text-primary)"
        >
          NIP-46 Connection String
        </label>
        <textarea
          id="bunker-input"
          bind:value={bunkerConnectionString}
          placeholder="bunker://pubkey?relay=wss://relay.example.com&#10;or&#10;npub1... wss://relay.example.com"
          rows="3"
          class="input block w-full sm:text-sm p-3 font-mono text-xs"
          disabled={bunkerConnecting}
        ></textarea>
        <p class="text-xs text-caption mt-1.5">
          Paste your NIP-46 connection string from Amber or another remote signer.
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
        <div
          class="bg-input border rounded-lg p-3"
          style="border-color: var(--color-primary, #f97316)"
        >
          <div class="flex items-center gap-2">
            <div
              class="animate-spin h-4 w-4 border-2 border-orange-500 border-t-transparent rounded-full"
            ></div>
            <p class="text-sm" style="color: var(--color-text-primary)">
              Connecting to bunker... This may take a moment.
            </p>
          </div>
          <p class="text-xs text-caption mt-1">
            Check your signer app to approve the connection request.
          </p>
        </div>
      {/if}

      <div class="flex gap-2">
        <Button
          on:click={loginWithBunker}
          primary={true}
          disabled={bunkerConnecting || !bunkerConnectionString.trim()}
        >
          {bunkerConnecting ? '⏳ Connecting...' : '🔐 Connect'}
        </Button>
        <Button on:click={modalCleanup} primary={false} disabled={bunkerConnecting}>Cancel</Button>
      </div>
    </div>
  </Modal>

  <!-- Universal NIP-46 Pairing Modal -->
  <Modal bind:open={nip46UniversalModal} on:close={modalCleanup}>
    <svelte:fragment slot="title">🔐 Connect External Signer</svelte:fragment>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">
          Use a remote signer so your private key never touches this device. This is the most secure
          way to sign in.
        </p>
      </div>

      {#if nip46PairingError}
        <div
          class="bg-input border rounded-lg p-2.5"
          style="border-color: var(--color-danger, #ef4444)"
        >
          <p class="text-sm" style="color: var(--color-danger, #ef4444)">{nip46PairingError}</p>
        </div>
      {/if}

      {#if nip46PairingUri}
        <div class="flex flex-col items-center gap-4">
          <!-- QR Code - Centered with proper padding -->
          <div
            class="bg-white rounded-lg qr-container"
            style="--qr-size: 280px; --qr-padding: 16px;"
          >
            <QRCode value={nip46PairingUri} size={248} padding={null} />
          </div>

          <!-- Status -->
          <div class="text-center">
            <p class="text-sm font-medium mb-1" style="color: var(--color-text-primary)">
              {nip46PairingStatus}
            </p>
            <p class="text-xs text-caption">Approve the connection in your signer app (Amber)</p>
          </div>

          <!-- Action Buttons -->
          <div class="flex flex-col gap-2 w-full">
            {#if isAndroid}
              <Button
                on:click={() => window.open(nip46PairingUri, '_system')}
                primary={true}
                class="w-full"
              >
                📱 Open Signer
              </Button>
            {/if}
            <Button
              on:click={() => copyToClipboard(nip46PairingUri)}
              primary={false}
              class="w-full"
            >
              📋 Copy Link
            </Button>
          </div>
        </div>
      {:else if nip46PairingStatus}
        <div class="flex items-center justify-center gap-2 py-8">
          <div
            class="animate-spin h-5 w-5 border-2 border-orange-500 border-t-transparent rounded-full"
          ></div>
          <p class="text-sm" style="color: var(--color-text-primary)">{nip46PairingStatus}</p>
        </div>
      {/if}

      <div class="flex gap-2">
        <Button on:click={modalCleanup} primary={false} disabled={false}>Cancel</Button>
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
          <div
            class="bg-input border rounded-lg p-4"
            style="border-color: var(--color-input-border)"
          >
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
            <p class="text-xs text-caption uppercase tracking-wide mb-2">Step 1</p>
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
              Continue to Step 2
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
      <div
        class="absolute bottom-32 left-1/3 text-2xl animate-bounce"
        style="animation-delay: 1.2s;"
      >
        👨‍🍳
      </div>
      <div
        class="absolute bottom-20 right-1/4 text-3xl animate-bounce"
        style="animation-delay: 0.6s;"
      >
        🍽️
      </div>
    </div>

    <div class="relative flex flex-col items-center min-h-screen px-4 pt-12 md:pt-20 pb-8">
      <!-- Main Content Card -->
      <section
        class="glass-card rounded-2xl p-6 md:p-8 w-full mx-auto text-center"
        style="max-width: 420px;"
        aria-label="Authentication options"
      >
        <!-- Logo and Title -->
        <div class="mb-5">
          <img
            src={isDarkMode ? '/zap_cooking_logo_white.svg' : '/zap_cooking_logo_black.svg'}
            class="h-10 md:h-12 mb-2 mx-auto"
            alt="Zap Cooking"
          />
          <h1 class="text-xl md:text-2xl font-bold mb-1" style="color: var(--color-text-primary)">
            Welcome to <span class="text-orange-500">Zap Cooking</span>
          </h1>
          <p class="text-sm text-caption">Share recipes and support creators with Bitcoin zaps</p>
        </div>

        <!-- Authentication Options -->
        <div class="space-y-2.5 mb-3">
          <!-- NIP-07 Extension Login - Primary CTA -->
          <div>
            <button
              on:click={loginWithNIP07}
              on:mouseenter={() => (isHovered = true)}
              on:mouseleave={() => (isHovered = false)}
              disabled={authState.isLoading}
              aria-label="Sign in to Zap Cooking using your Nostr browser extension"
              class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold h-[52px] md:h-12 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              <div class="flex items-center justify-center gap-2">
                <span class="text-lg">⚡</span>
                <span class="text-[15px]">
                  {authState.isLoading ? 'Connecting...' : 'Sign in with Browser Signer'}
                </span>
              </div>
            </button>
            <!-- Extension helper - show neutral info initially, warning only after click -->
            {#if !showMissingSignerNotice && authManager?.isNIP07Available() === false}
              <p class="text-[11px] text-caption mt-1.5 leading-relaxed">
                Works with <a
                  href="https://getalby.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline hover:opacity-80">Alby</a
                >
                or
                <a
                  href="https://github.com/fiatjaf/nos2x"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline hover:opacity-80">nos2x</a
                >.
              </p>
            {/if}
            <!-- Missing signer notice - shown only after user clicks and no extension detected -->
            {#if showMissingSignerNotice}
              <div
                class="bg-input border rounded-lg p-2.5 mt-1.5"
                style="border-color: var(--color-input-border)"
              >
                <p class="text-[11px] text-caption leading-relaxed">
                  No browser signer detected. Install <a
                    href="https://getalby.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline hover:opacity-80">Alby</a
                  >
                  or
                  <a
                    href="https://github.com/fiatjaf/nos2x"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="underline hover:opacity-80">nos2x</a
                  >, or use an external signer like Amber.
                </p>
              </div>
            {/if}
          </div>

          <!-- Generate New Account - Secondary CTA -->
          <button
            on:click={() => (generateModal = true)}
            disabled={authState.isLoading}
            aria-label="Create a new Zap Cooking profile"
            class="w-full bg-input hover:opacity-90 font-medium h-11 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border"
            style="color: var(--color-text-primary); border-color: var(--color-input-border)"
          >
            <span class="text-sm">🔑 Create Profile</span>
          </button>
        </div>

        <!-- Error Display -->
        {#if authState.error}
          <div
            class="bg-input border rounded-lg p-2.5 mb-3"
            style="border-color: var(--color-danger, #ef4444)"
          >
            <p class="text-xs" style="color: var(--color-danger, #ef4444)">{authState.error}</p>
          </div>
        {/if}

        <!-- Advanced options -->
        <div class="py-3 space-y-2">
          <div class="flex items-center justify-center gap-3 text-[11px]">
            <button
              on:click={startUniversalPairing}
              disabled={authState.isLoading}
              class="text-caption hover:opacity-80 hover:underline transition-colors disabled:opacity-50"
            >
              🔐 Connect External Signer
            </button>
            <span class="text-caption">|</span>
            <button
              on:click={() => (nsecModal = true)}
              disabled={authState.isLoading}
              class="text-caption hover:opacity-80 hover:underline transition-colors disabled:opacity-50"
            >
              Import key
            </button>
          </div>
        </div>

        <!-- Value Propositions - Quieter styling -->
        <section
          class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-caption pt-3 border-t"
          style="border-color: var(--color-input-border)"
          aria-label="Zap Cooking features"
        >
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
{/if}

<style>
  :global(.lightning-bg) {
    background-color: var(--color-bg-primary);
  }

  :global(.lightning-pulse) {
    animation: lightningPulse 2s ease-in-out infinite;
  }

  :global(.electric-glow) {
    box-shadow:
      0 0 20px rgba(247, 147, 26, 0.2),
      0 0 40px rgba(247, 147, 26, 0.1);
  }

  :global(.glass-card) {
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  :global(.lightning-border) {
    position: relative;
    border: 2px solid #f7931a;
    border-radius: 16px;
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

  :global(.qr-container) {
    text-align: center !important;
    width: var(--qr-size, 280px);
    height: var(--qr-size, 280px);
    padding: var(--qr-padding, 16px);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.qr-container canvas),
  :global(.qr-container svg),
  :global(.qr-container img) {
    display: block !important;
    width: 100%;
    height: 100%;
  }
</style>
