<script lang="ts">
  import { browser } from '$app/environment';
  import { standardRelays } from '$lib/consts';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import Button from '../../components/Button.svelte';
  import { nip19 } from 'nostr-tools';
  import { theme, type Theme } from '$lib/themeStore';

  let relays: string[] = [];
  let newRelay = '';

  function removeRelay(index: number) {
    relays.splice(index, 1);
    relays = [...relays];
  }

  function addRelay() {
    if (newRelay) {
      relays.push(newRelay);
      newRelay = '';
      relays = [...relays];
    }
  }

  function saveData() {
    addRelay();
    if (relays !== standardRelays) {
      localStorage.setItem('nostrcooking_relays', JSON.stringify(relays));
    }
    setTimeout(() => {
      window.location.href = '';
    }, 1);
  }

  let sk: string | null = null;
  let pk: string | null = null;

  if (browser) {
    const a = localStorage.getItem('nostrcooking_relays');
    if (a) {
      relays = JSON.parse(a);
    } else {
      relays = standardRelays;
    }
    sk = localStorage.getItem('nostrcooking_privateKey');
    pk = localStorage.getItem('nostrcooking_loggedInPublicKey');
  }

  let showPrivkey = false;
  let copiedKey = '';

  async function copyToClipboard(text: string, keyType: string) {
    if (browser) {
      try {
        await navigator.clipboard.writeText(text);
        copiedKey = keyType;
        setTimeout(() => {
          copiedKey = '';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    }
  }

  // Theme state and handler
  let selectedTheme: Theme = 'system';

  if (browser) {
    theme.subscribe(value => {
      selectedTheme = value;
    });
  }

  function handleThemeChange(newTheme: Theme) {
    selectedTheme = newTheme;
    theme.setTheme(newTheme);
  }

  function getEncodedPrivateKey(): string {
    if (!sk) return '';
    try {
      const match = sk.match(/.{1,2}/g);  
      if (!match) {  
        console.error('Private key format is invalid:', sk);  
        return sk; // fallback to raw key  
      }  
      const bytes = new Uint8Array(match.map(byte => parseInt(byte, 16)));  

      return nip19.nsecEncode(bytes);
    } catch (error) {
      console.error('Error encoding private key:', error);
      return sk; // fallback to raw key
    }
  }
</script>

<svelte:head>
  <title>Settings - zap.cooking</title>
</svelte:head>

<div class="flex flex-col gap-5">
  <h1>Settings</h1>

  <!-- Theme Section -->
  <div class="flex flex-col gap-4">
    <h2>Theme</h2>
    <div class="flex flex-col gap-3">
      <p class="text-sm text-caption">
        Choose how Zap.Cooking looks to you.
      </p>

      <div class="flex flex-col gap-2">
        <!-- Light Option -->
        <label
          class="flex items-center gap-3 p-4 bg-input rounded-xl cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-200"
          class:ring-2={selectedTheme === 'light'}
          class:ring-primary={selectedTheme === 'light'}
        >
          <input
            type="radio"
            name="theme"
            value="light"
            checked={selectedTheme === 'light'}
            on:change={() => handleThemeChange('light')}
            class="w-4 h-4 text-primary focus:ring-primary"
          />
          <div class="flex flex-col">
            <span class="font-semibold" style="color: var(--color-text-primary)">Light</span>
            <span class="text-sm text-caption">Always use light theme</span>
          </div>
        </label>

        <!-- Dark Option -->
        <label
          class="flex items-center gap-3 p-4 bg-input rounded-xl cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-200"
          class:ring-2={selectedTheme === 'dark'}
          class:ring-primary={selectedTheme === 'dark'}
        >
          <input
            type="radio"
            name="theme"
            value="dark"
            checked={selectedTheme === 'dark'}
            on:change={() => handleThemeChange('dark')}
            class="w-4 h-4 text-primary focus:ring-primary"
          />
          <div class="flex flex-col">
            <span class="font-semibold" style="color: var(--color-text-primary)">Dark</span>
            <span class="text-sm text-caption">Always use dark theme</span>
          </div>
        </label>

        <!-- System Option -->
        <label
          class="flex items-center gap-3 p-4 bg-input rounded-xl cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-200"
          class:ring-2={selectedTheme === 'system'}
          class:ring-primary={selectedTheme === 'system'}
        >
          <input
            type="radio"
            name="theme"
            value="system"
            checked={selectedTheme === 'system'}
            on:change={() => handleThemeChange('system')}
            class="w-4 h-4 text-primary focus:ring-primary"
          />
          <div class="flex flex-col">
            <span class="font-semibold" style="color: var(--color-text-primary)">System</span>
            <span class="text-sm text-caption">Follow your device's theme</span>
          </div>
        </label>
      </div>
    </div>
  </div>

  <hr style="border-color: var(--color-input-border);" />

  <div class="flex flex-col gap-4">
    <h2>Relays</h2>
    <div class="flex flex-col gap-2">
      {#each relays as relay, index}
        <div class="flex bg-input p-3 rounded-xl">
          <span class="grow" style="color: var(--color-text-primary)">{relay}</span>
          <button class="self-center text-danger" on:click={() => removeRelay(index)}>
            <TrashIcon />
          </button>
        </div>
      {/each}
      <div class="flex gap-4 mx-0.5">
        <input
          bind:value={newRelay}
          placeholder="wss://relay.example.com"
          class="flex p-3 bg-input rounded-xl border-none"
          style="color: var(--color-text-primary);"
        />
        <Button on:click={addRelay} primary={false}>Add</Button>
      </div>
    </div>
  </div>


  <Button on:click={saveData}>Save</Button>
  <hr style="border-color: var(--color-input-border);" />

  <div class="flex flex-col gap-5">
    <h2>Keys</h2>

    <!-- Public Key Section -->
    <div class="flex flex-col gap-3">
      <h3>Public Key (npub)</h3>
      <div class="text-sm text-caption mb-2">
        This is your public identity. Safe to share with others.
      </div>
      {#if pk}
        <div class="flex gap-2">
          <div class="flex-1 bg-input p-3 rounded-xl font-mono text-sm break-all" style="color: var(--color-text-primary)">
            {nip19.npubEncode(pk)}
          </div>
          <button
            class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
            on:click={() => copyToClipboard(nip19.npubEncode(pk), 'public')}
          >
            {copiedKey === 'public' ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      {:else}
        <div class="text-caption italic">No public key found</div>
      {/if}
    </div>

    <!-- Private Key Section -->
    <div class="flex flex-col gap-3">
      <h3>Private Key (nsec)</h3>
      <div class="text-sm text-caption mb-2">
        <span class="text-danger font-bold">⚠️ KEEP THIS SECRET!</span> Never share this with anyone.
      </div>
      {#if sk}
        <div class="flex gap-2">
          <div class="flex-1 bg-input p-3 rounded-xl font-mono text-sm break-all min-h-[3rem] flex items-center" style="color: var(--color-text-primary)">
            {#if showPrivkey}
              {getEncodedPrivateKey()}
            {:else}
              <span class="text-caption font-mono">••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••</span>
            {/if}
          </div>
          <div class="flex flex-col gap-2">
            <button
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-xl text-sm font-medium transition-colors"
              on:click={() => (showPrivkey = !showPrivkey)}
            >
              {showPrivkey ? 'Hide' : 'Show'}
            </button>
            {#if showPrivkey}
              <button
                class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors"
                on:click={() => copyToClipboard(getEncodedPrivateKey(), 'private')}
              >
                {copiedKey === 'private' ? '✓ Copied' : 'Copy'}
              </button>
            {/if}
          </div>
        </div>
        {#if showPrivkey}
          <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
            <strong>Security Warning:</strong> Your private key is now visible. Make sure no one else can see your screen.
          </div>
        {/if}
      {:else}
        <div class="text-caption italic">No private key found</div>
      {/if}
    </div>

  </div>
</div>
