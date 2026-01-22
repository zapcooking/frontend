<script lang="ts">
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { browser } from '$app/environment';
  import { ndk, userPublickey } from '$lib/nostr';
  import { onMount, onDestroy } from 'svelte';
  import Button from '../../components/Button.svelte';
  import { createAuthManager, type AuthState } from '$lib/authManager';
  import { Fetch } from 'hurdak';
  import { DEFAULT_PROFILE_IMAGE } from '$lib/consts';

  let authManager = createAuthManager($ndk);
  let authState: AuthState = authManager.getState();
  let unsubscribe: (() => void) | null = null;

  let step = 0;
  let generatedKeys: { privateKey: Uint8Array; publicKey: string } | null = null;
  let npub = '';

  let disableStepButtons = false;
  let name = '';
  let username = '';
  let picture = DEFAULT_PROFILE_IMAGE;
  let about = '';

  onMount(() => {
    // Subscribe to auth state changes
    unsubscribe = authManager.subscribe((state) => {
      authState = state;

      // Update the legacy userPublickey store for compatibility
      if (state.isAuthenticated && state.publicKey) {
        userPublickey.set(state.publicKey);
      } else {
        userPublickey.set('');
      }
    });

    // Redirect if already authenticated
    if (authState.isAuthenticated) {
      goto('/settings');
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  function generateNewKeys() {
    generatedKeys = authManager.generateKeyPair();
    npub = nip19.npubEncode(generatedKeys.publicKey);
  }

  function copyToClipboard(text: string) {
    if (browser) {
      navigator.clipboard.writeText(text);
    }
  }

  async function continuestep() {
    disableStepButtons = true;

    if (step == 1) {
      // Generate keys and authenticate
      if (!generatedKeys) {
        generateNewKeys();
      }
      if (generatedKeys) {
        // Convert Uint8Array to hex string for authentication
        const privateKeyHex = Array.from(generatedKeys.privateKey)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await authManager.authenticateWithPrivateKey(privateKeyHex);
      }
    }

    if (step == 2 && name !== '') {
      // Create profile
      const metaEvent = new NDKEvent($ndk);
      metaEvent.kind = 0;
      metaEvent.tags = [];

      // Build profile content with username
      const profileContent: any = {
        displayName: name,
        picture
      };

      // Add username if provided with NIP-05 verification
      if (username.trim()) {
        profileContent.name = username.trim();
        profileContent.nip05 = `${username.trim()}@zap.cooking`;
      }

      metaEvent.content = JSON.stringify(profileContent);
      let relays = await metaEvent.publish();

      // Small delay to allow relays to propagate
      await new Promise((resolve) => setTimeout(resolve, 1000));
      relays.forEach((relay) => {
        relay.once('published', () => {
          console.log('published to', relay);
        });
        relay.once('publish:failed', (relay, err) => {
          console.log('publish failed to', relay, err);
        });
      });
    }

    if (step == 3) {
      goto('/');
    }

    step++;
    disableStepButtons = false;
  }

  function backstep() {
    disableStepButtons = true;
    if (step == 0) {
      goto('/login');
    }
    step--;
    disableStepButtons = false;
  }

  let input: HTMLInputElement;
  let uploadingPicture = false;
  let uploadError = '';

  async function handleImageUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    uploadingPicture = true;
    uploadError = '';

    try {
      const file = target.files[0];

      // Validate file type
      if (!file.type.startsWith('image/')) {
        uploadError = 'Please upload an image file';
        uploadingPicture = false;
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        uploadError = 'Image must be less than 10MB';
        uploadingPicture = false;
        return;
      }

      const body = new FormData();
      body.append('file[]', file);
      const result = await uploadToNostrBuild(body);
      if (result && result.data && result.data[0]?.url) {
        picture = result.data[0].url;
      } else {
        uploadError = 'Failed to upload image';
      }
    } catch (err) {
      console.error('Error uploading image:', err);
      uploadError = 'Failed to upload image. Please try again.';
    } finally {
      uploadingPicture = false;
      // Reset input
      if (input) {
        input.value = '';
      }
    }
  }

  async function uploadToNostrBuild(body: FormData) {
    const url = 'https://nostr.build/api/v2/upload/profile';

    // Check if we have a signer
    if (!$ndk.signer) {
      throw new Error('Not authenticated - please complete the previous step first');
    }

    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();

    // Ensure all fields are properly formatted according to NIP-98
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    return Fetch.fetchJson(url, {
      body,
      method: 'POST',
      headers: {
        Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
      }
    });
  }
</script>

<!-- TODO -->

<svelte:head>
  <title>Welcome - zap.cooking</title>
</svelte:head>

<div class="prose flex flex-col text-black mb-4 mx-auto">
  <h1>Welcome</h1>
  {#if step == 0}
    <p>
      Welcome to Nostr (Notes and Other Stuff Transmitted by Relays). Nostr is a decentralized,
      'uncensorable' social protocol. Built on top of Nostr, there are various clients/apps,
      including Twitter-like clients, Blog clients, and more, all tied to the same identity, secured
      through cryptography.
    </p>
    <p>For more information, please visit:</p>
    <ul>
      <li><a target="_blank" rel="noopener noreferrer" href="https://nostr.com">nostr.com</a></li>
      <li><a target="_blank" rel="noopener noreferrer" href="https://nostr.how">nostr.how</a></li>
    </ul>
    <div class="space-y-4">
      <div class="bg-red-50 border border-red-200 rounded-md p-4">
        <div class="text-sm font-medium text-red-800 mb-2">🔒 Security Warning</div>
        <div class="text-sm text-red-700 space-y-2">
          <p>• This will generate a new Nostr private key (nsec format)</p>
          <p>• <strong>Never share your private key with anyone</strong></p>
          <p>• Store it securely - if lost, your profile cannot be recovered</p>
          <p>• Consider using a hardware wallet for maximum security</p>
        </div>
      </div>

      <p>
        Here, you can securely generate a new Nostr private key. This key serves as your permanent
        password for the Nostr network. It's crucial to store it in a secure location and avoid
        sharing it with anyone.
      </p>

      <button
        class="w-full py-3 px-4 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50"
        on:click={generateNewKeys}
        disabled={disableStepButtons}
      >
        Generate New Profile
      </button>
    </div>
    <p>
      While generating a key on the web is convenient, it may not be the most secure option.
      Consider downloading a native Nostr client for a more robust and secure experience.
    </p>
  {:else if step == 1}
    <div class="space-y-4">
      <div class="bg-red-50 border border-red-200 rounded-md p-4">
        <div class="text-sm font-medium text-red-800 mb-2">🚨 CRITICAL: Save Your Private Key</div>
        <div class="text-sm text-red-700 space-y-2">
          <p>• <strong>Write down your private key (nsec) immediately</strong></p>
          <p>• Store it in a secure location (password manager, encrypted file)</p>
          <p>• <strong>Never share it with anyone</strong></p>
          <p>• If you lose this key, you cannot recover your profile</p>
          <p>• This is your only way to prove ownership of this profile</p>
        </div>
      </div>

      {#if generatedKeys}
        <div>
          <label for="private-key-textarea" class="block text-sm font-medium text-gray-700 mb-1"
            >Private Key (nsec) - SAVE THIS!</label
          >
          <div class="flex gap-2">
            <textarea
              id="private-key-textarea"
              readonly
              value={nip19.nsecEncode(generatedKeys.privateKey)}
              rows="3"
              class="flex-1 shadow-sm border-red-300 rounded-md text-sm font-mono bg-red-50"
            ></textarea>
            <button
              on:click={() =>
                generatedKeys && copyToClipboard(nip19.nsecEncode(generatedKeys.privateKey))}
              class="px-3 py-2 bg-red-100 hover:bg-red-200 rounded-md text-sm text-red-800 font-medium"
            >
              Copy
            </button>
          </div>
          <div class="text-xs text-red-600 mt-1">⚠️ This is your private key - keep it secret!</div>
        </div>

        <div>
          <label for="public-key-input" class="block text-sm font-medium text-gray-700 mb-1"
            >Public Key (npub)</label
          >
          <div class="flex gap-2">
            <input
              id="public-key-input"
              readonly
              value={nip19.npubEncode(generatedKeys.publicKey)}
              class="flex-1 shadow-sm border-gray-300 rounded-md text-sm font-mono"
            />
            <button
              on:click={() =>
                generatedKeys && copyToClipboard(nip19.npubEncode(generatedKeys.publicKey))}
              class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
            >
              Copy
            </button>
          </div>
          <div class="text-xs text-gray-500 mt-1">
            This is safe to share - it's your public identity
          </div>
        </div>
      {/if}

      <div class="bg-yellow-50 border border-yellow-200 rounded-md p-3">
        <div class="text-sm font-medium text-yellow-800 mb-1">⚠️ Important</div>
        <div class="text-sm text-yellow-700">
          Only continue if you have safely saved your private key (nsec). You cannot recover your
          profile without it.
        </div>
      </div>
    </div>
  {:else if step == 2}
    <p>
      Your public key, often referred to as npub, can be shared with anyone. With this public key,
      others can discover your profile and posts.
    </p>
    <input bind:value={npub} type="text" disabled class="input w-full" />
    <p>
      Regarding your profile, we need your input to create it. Please provide the following details
      for publication.
    </p>
    <div class="flex gap-4 md:gap-10 mx-auto">
      <div class="flex flex-col self-center">
        <div class="flex flex-col self-center">
          <h2 class="text-white mb-2">Profile Picture</h2>
          <div class="relative">
            <label
              for="file-upload"
              class="cursor-pointer self-center group {uploadingPicture
                ? 'pointer-events-none opacity-50'
                : ''}"
            >
              <div class="relative">
                <img
                  class="w-[100px] h-[100px] md:w-[200px] md:h-[200px] rounded-full bg-input self-center border-2 border-gray-300 group-hover:border-orange-500 transition-colors"
                  src={picture}
                  alt="Profile"
                />
                <div
                  class="absolute inset-0 rounded-full bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center"
                >
                  <div
                    class="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white text-sm font-medium"
                  >
                    {uploadingPicture ? '⏳ Uploading...' : '📷 Upload'}
                  </div>
                </div>
              </div>
              <input
                id="file-upload"
                bind:this={input}
                type="file"
                accept="image/*"
                class="sr-only self-center"
                on:change={handleImageUpload}
                disabled={uploadingPicture}
              />
            </label>
          </div>
          {#if uploadError}
            <p class="text-xs text-red-500 mt-1 text-center">{uploadError}</p>
          {/if}
          <p class="text-xs text-gray-400 mt-2 text-center max-w-[200px]">
            Click to upload a custom profile picture or keep the default ZapCooking logo
          </p>
        </div>
      </div>
      <div class="flex flex-col gap-4 self-center">
        <div class="flex flex-col gap-2">
          <h2>Display Name</h2>
          <p class="break-words hidden md:visible text-sm text-gray-400">
            This will be visible to others.
          </p>
          <input
            bind:value={name}
            class="input"
            type="text"
            placeholder="Zap Cooking Chef"
            id="display-name"
          />
        </div>

        <div class="flex flex-col gap-2">
          <h2>Username (Optional)</h2>
          <p class="break-words hidden md:visible text-sm text-gray-400">
            A unique identifier for your profile.
          </p>
          <input
            bind:value={username}
            class="input"
            type="text"
            placeholder="chef123"
            id="username"
          />
          <div class="text-xs text-gray-500">
            This will be your @username on Nostr. Leave empty if you prefer to use your public key.
          </div>
        </div>
      </div>
    </div>
  {:else}
    <p>Okay, now you are ready to explore Nostr.</p>
  {/if}

  <div class="flex mb-4">
    <div class="flex-1">
      <Button on:click={backstep} disabled={disableStepButtons} primary={false}>Back</Button>
    </div>
    <div>
      <Button on:click={continuestep} disabled={disableStepButtons || (step == 2 && name == '')}>
        {#if disableStepButtons == true}
          loading...
        {:else if step == 0}
          Continue with this key
        {:else if step == 1}
          I saved the private key
        {:else if step == 2}
          {#if name == ''}
            please enter a username
          {:else}
            Publish Profile
          {/if}
        {:else if step == 3}
          Go to zap.cooking!
        {:else}
          Continue
        {/if}
      </Button>
    </div>
  </div>
</div>
