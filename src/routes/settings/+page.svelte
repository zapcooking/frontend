<script lang="ts">
  import { browser } from '$app/environment';
  import { standardRelays } from '$lib/consts';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import Button from '../../components/Button.svelte';
  import { nip19 } from 'nostr-tools';

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

  if (browser) {
    const a = localStorage.getItem('nostrcooking_relays');
    if (a) {
      relays = JSON.parse(a);
    } else {
      relays = standardRelays;
    }
  }

  let showPrivkey = false;
  let copiedKey = '';
  const sk = localStorage.getItem('nostrcooking_privateKey');
  const pk = localStorage.getItem('nostrcooking_loggedInPublicKey');

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

  function getEncodedPrivateKey(): string {
    if (!sk) return '';
    try {
      const bytes = new Uint8Array(sk.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
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
  <div class="flex flex-col gap-4">
    <h2>Relays</h2>
    <div class="flex flex-col gap-2">
      {#each relays as relay, index}
        <div class="flex bg-input p-3 rounded-xl">
          <span class="grow">{relay}</span>
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
        />
        <Button on:click={addRelay} primary={false}>Add</Button>
      </div>
    </div>
  </div>


  <Button on:click={saveData}>Save</Button>
  <hr />

  <div class="flex flex-col gap-5">
    <h2>Keys</h2>
    
    <!-- Public Key Section -->
    <div class="flex flex-col gap-3">
      <h3>Public Key (npub)</h3>
      <div class="text-sm text-gray-600 mb-2">
        This is your public identity. Safe to share with others.
      </div>
      {#if pk}
        <div class="flex gap-2">
          <div class="flex-1 bg-input p-3 rounded-xl font-mono text-sm break-all">
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
        <div class="text-gray-500 italic">No public key found</div>
      {/if}
    </div>

    <!-- Private Key Section -->
    <div class="flex flex-col gap-3">
      <h3>Private Key (nsec)</h3>
      <div class="text-sm text-gray-600 mb-2">
        <span class="text-red-600 font-bold">⚠️ KEEP THIS SECRET!</span> Never share this with anyone.
      </div>
      {#if sk}
        <div class="flex gap-2">
          <div class="flex-1 bg-input p-3 rounded-xl font-mono text-sm break-all min-h-[3rem] flex items-center">
            {#if showPrivkey}
              {getEncodedPrivateKey()}
            {:else}
              <span class="text-gray-400 font-mono">••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••</span>
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
        <div class="text-gray-500 italic">No private key found</div>
      {/if}
    </div>

  </div>
</div>
