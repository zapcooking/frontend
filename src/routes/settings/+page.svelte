<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { standardRelays } from '$lib/consts';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import WalletIcon from 'phosphor-svelte/lib/Wallet';
  import CircleIcon from 'phosphor-svelte/lib/Circle';
  import BroadcastIcon from 'phosphor-svelte/lib/Broadcast';
  import PlugsIcon from 'phosphor-svelte/lib/Plugs';
  import Button from '../../components/Button.svelte';
  import Accordion from '../../components/Accordion.svelte';
  import { nip19 } from 'nostr-tools';
  import { theme, type Theme } from '$lib/themeStore';
  import { displayCurrency, SUPPORTED_CURRENCIES, type CurrencyCode } from '$lib/currencyStore';
  import { getAuthManager, type NIP46ConnectionInfo } from '$lib/authManager';
  import {
    userPublickey,
    ndk,
    ndkReady,
    switchRelays,
    ndkSwitching,
    getCurrentRelays,
    type RelayMode
  } from '$lib/nostr';
  import { wallets, navBalanceVisible, setNavBalanceVisible } from '$lib/wallet/walletStore';
  import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from '$lib/wallet/bitcoinConnect';
  import { weblnConnected, weblnWalletName } from '$lib/wallet/webln';
  import {
    oneTapZapEnabled,
    oneTapZapAmount,
    setOneTapZapEnabled,
    setOneTapZapAmount,
    MAX_ONE_TAP_ZAP_AMOUNT
  } from '$lib/autoZapSettings';
  import { hellthreadThreshold } from '$lib/hellthreadFilterSettings';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { getConnectionManager } from '$lib/connectionManager';
  import SparkLogo from '../../components/icons/SparkLogo.svelte';
  import NwcLogo from '../../components/icons/NwcLogo.svelte';
  import WeblnLogo from '../../components/icons/WeblnLogo.svelte';
  import BitcoinConnectLogo from '../../components/icons/BitcoinConnectLogo.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  // Relays state
  let relays: string[] = [];
  let newRelay = '';
  let connectedRelays: string[] = [];
  let savingRelays = false;

  // NIP-65 announced relays
  interface NIP65Relays {
    readWrite: string[];
    writeOnly: string[];
    readOnly: string[];
    lastUpdated: number | null;
  }
  let nip65Relays: NIP65Relays = { readWrite: [], writeOnly: [], readOnly: [], lastUpdated: null };
  let loadingNip65 = false;

  function removeRelay(index: number) {
    relays.splice(index, 1);
    relays = [...relays];
  }

  function addRelay() {
    if (newRelay && newRelay.startsWith('wss://')) {
      relays.push(newRelay);
      newRelay = '';
      relays = [...relays];
    }
  }

  async function saveRelays() {
    addRelay();
    if (relays.length === 0) {
      return;
    }

    savingRelays = true;
    try {
      // Use 'default' mode when switching relays from settings
      await switchRelays('default', relays);
      // Update connected relays after switch
      updateConnectedRelays();
    } catch (error) {
      console.error('Failed to switch relays:', error);
      if (browser) {
        alert('Failed to switch relays. Please check your relay URLs and try again.');
      }
    } finally {
      savingRelays = false;
    }
  }

  // Check relay connection status
  function updateConnectedRelays() {
    const cm = getConnectionManager();
    if (cm) {
      connectedRelays = cm.getConnectedRelays();
    }
  }

  // Fetch NIP-65 relay list (kind:10002)
  async function fetchNIP65Relays() {
    const pubkey = get(userPublickey);
    if (!pubkey) return;

    loadingNip65 = true;
    try {
      await ndkReady;
      const ndkInstance = get(ndk);

      const events = await ndkInstance.fetchEvents({
        kinds: [10002],
        authors: [pubkey],
        limit: 1
      });

      if (events.size > 0) {
        const event = Array.from(events)[0];
        const readWrite: string[] = [];
        const writeOnly: string[] = [];
        const readOnly: string[] = [];

        for (const tag of event.tags) {
          if (tag[0] !== 'r' || !tag[1]) continue;
          const relay = tag[1];
          const marker = tag[2]?.toLowerCase();

          if (!marker) {
            readWrite.push(relay);
          } else if (marker === 'write') {
            writeOnly.push(relay);
          } else if (marker === 'read') {
            readOnly.push(relay);
          }
        }

        nip65Relays = {
          readWrite,
          writeOnly,
          readOnly,
          lastUpdated: event.created_at ? event.created_at * 1000 : null
        };
      }
    } catch (err) {
      console.error('[Settings] Failed to fetch NIP-65 relays:', err);
    } finally {
      loadingNip65 = false;
    }
  }

  // Keys state
  let sk: string | null = null;
  let pk: string | null = null;
  let authMethod: string | null = null;
  let nip46Info: NIP46ConnectionInfo | null = null;
  let disconnectingBunker = false;
  let privateKeyRevealed = false;

  if (browser) {
    relays = getCurrentRelays();
    sk = localStorage.getItem('nostrcooking_privateKey');
    pk = localStorage.getItem('nostrcooking_loggedInPublicKey');
    authMethod = localStorage.getItem('nostrcooking_authMethod');

    const authManager = getAuthManager();
    if (authManager) {
      nip46Info = authManager.getNIP46Info();
    }
  }

  onMount(() => {
    updateConnectedRelays();
    fetchNIP65Relays();
    // Update connection status periodically
    const interval = setInterval(updateConnectedRelays, 5000);
    return () => clearInterval(interval);
  });

  async function disconnectBunker() {
    if (!browser) return;
    disconnectingBunker = true;

    try {
      const authManager = getAuthManager();
      if (authManager) {
        await authManager.disconnectNIP46();
      }
      userPublickey.set('');
      goto('/login');
    } catch (error) {
      console.error('Failed to disconnect bunker:', error);
    } finally {
      disconnectingBunker = false;
    }
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

  // Theme state
  let selectedTheme: Theme = 'system';

  if (browser) {
    theme.subscribe((value) => {
      selectedTheme = value;
    });
  }

  function handleThemeChange(newTheme: Theme) {
    selectedTheme = newTheme;
    theme.setTheme(newTheme);
  }

  // Currency state
  let selectedCurrency: CurrencyCode = 'USD';

  if (browser) {
    displayCurrency.subscribe((value) => {
      selectedCurrency = value;
    });
  }

  // Hellthread threshold state
  let currentThreshold = $hellthreadThreshold;

  function handleThresholdChange() {
    hellthreadThreshold.setThreshold(currentThreshold);
  }

  function handleCurrencyChange(newCurrency: CurrencyCode) {
    selectedCurrency = newCurrency;
    displayCurrency.setCurrency(newCurrency);
  }

  function getEncodedPrivateKey(): string {
    if (!sk) return '';
    try {
      const match = sk.match(/.{1,2}/g);
      if (!match) {
        return sk;
      }
      const bytes = new Uint8Array(match.map((byte) => parseInt(byte, 16)));
      return nip19.nsecEncode(bytes);
    } catch (error) {
      console.error('Error encoding private key:', error);
      return sk;
    }
  }

  // Helper to normalize relay URL for comparison
  function normalizeRelayUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^wss?:\/\//, '')
      .replace(/\/+$/, '');
  }

  // Build a reactive Set of connected relay URLs for efficient lookup
  $: connectedRelaySet = new Set(connectedRelays.map(normalizeRelayUrl));

  // Wallet info
  $: connectedWallets = $wallets.filter((w) => w.kind !== 0);
  $: activeWallet = connectedWallets.find((w) => w.active);
  // Check if user has an in-app wallet (Spark kind=4 or NWC kind=3) for auto-zap
  $: hasInAppWallet = $wallets.some((w) => w.kind === 3 || w.kind === 4);
  $: hasNavWallet =
    connectedWallets.length > 0 ||
    $weblnConnected ||
    ($bitcoinConnectEnabled && $bitcoinConnectWalletInfo.connected);

  function getWalletTypeName(kind: number): string {
    switch (kind) {
      case 1:
        return 'WebLN';
      case 3:
        return 'NWC';
      case 4:
        return 'Spark';
      default:
        return 'Unknown';
    }
  }
</script>

<svelte:head>
  <title>Settings - zap.cooking</title>
</svelte:head>

<div class="max-w-2xl mx-auto">
  <h1 class="mb-6">Settings</h1>

  <div class="flex flex-col gap-4">
    <!-- Appearance Section -->
    <Accordion title="Appearance" open={true}>
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-sm font-medium mb-3" style="color: var(--color-text-primary)">Theme</p>
          <p class="text-xs text-caption mb-3">Choose how Zap.Cooking looks to you.</p>
        </div>

        <div class="flex gap-2">
          <button
            type="button"
            class="px-4 py-2 rounded-full text-sm font-medium transition-colors
              {selectedTheme === 'light'
              ? 'bg-primary text-white'
              : 'bg-secondary hover:bg-accent-gray'}"
            style={selectedTheme !== 'light' ? 'color: var(--color-text-primary)' : ''}
            on:click={() => handleThemeChange('light')}
          >
            Light
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-full text-sm font-medium transition-colors
              {selectedTheme === 'dark'
              ? 'bg-primary text-white'
              : 'bg-secondary hover:bg-accent-gray'}"
            style={selectedTheme !== 'dark' ? 'color: var(--color-text-primary)' : ''}
            on:click={() => handleThemeChange('dark')}
          >
            Dark
          </button>
          <button
            type="button"
            class="px-4 py-2 rounded-full text-sm font-medium transition-colors
              {selectedTheme === 'system'
              ? 'bg-primary text-white'
              : 'bg-secondary hover:bg-accent-gray'}"
            style={selectedTheme !== 'system' ? 'color: var(--color-text-primary)' : ''}
            on:click={() => handleThemeChange('system')}
          >
            System
          </button>
        </div>
      </div>
    </Accordion>

    <!-- Relays Section -->
    <Accordion title="Relays" open={false}>
      <div class="flex flex-col gap-6">
        <!-- NIP-65 Announced Relays -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <BroadcastIcon size={18} class="text-primary" />
            <p class="text-sm font-medium" style="color: var(--color-text-primary)">
              Your Announced Relays (NIP-65)
            </p>
          </div>
          <p class="text-xs text-caption mb-3">
            These are your publicly announced relay preferences from your kind:10002 event.
          </p>

          {#if loadingNip65}
            <div class="text-sm text-caption italic">Loading...</div>
          {:else if nip65Relays.readWrite.length === 0 && nip65Relays.writeOnly.length === 0 && nip65Relays.readOnly.length === 0}
            <div class="bg-secondary p-3 rounded-lg text-sm text-caption italic">
              No NIP-65 relay list found. Your relay preferences aren't published yet.
            </div>
          {:else}
            {#if nip65Relays.lastUpdated}
              <div class="text-xs text-caption mb-3">
                Last updated: {new Date(nip65Relays.lastUpdated).toLocaleString()}
              </div>
            {/if}

            <div class="flex flex-col gap-3">
              {#if nip65Relays.readWrite.length > 0}
                <div>
                  <p class="text-xs font-medium text-caption mb-1.5">
                    Read & Write ({nip65Relays.readWrite.length})
                  </p>
                  <div class="flex flex-col gap-1">
                    {#each nip65Relays.readWrite as relay}
                      <div class="flex items-center gap-2 bg-secondary px-3 py-2 rounded-lg">
                        <CircleIcon
                          size={8}
                          weight="fill"
                          class={connectedRelaySet.has(normalizeRelayUrl(relay))
                            ? 'text-green-500'
                            : 'text-gray-400'}
                        />
                        <span
                          class="text-xs font-mono truncate"
                          style="color: var(--color-text-primary)">{relay}</span
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if nip65Relays.writeOnly.length > 0}
                <div>
                  <p class="text-xs font-medium text-caption mb-1.5">
                    Write Only ({nip65Relays.writeOnly.length})
                  </p>
                  <div class="flex flex-col gap-1">
                    {#each nip65Relays.writeOnly as relay}
                      <div class="flex items-center gap-2 bg-secondary px-3 py-2 rounded-lg">
                        <CircleIcon
                          size={8}
                          weight="fill"
                          class={connectedRelaySet.has(normalizeRelayUrl(relay))
                            ? 'text-green-500'
                            : 'text-gray-400'}
                        />
                        <span
                          class="text-xs font-mono truncate"
                          style="color: var(--color-text-primary)">{relay}</span
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if nip65Relays.readOnly.length > 0}
                <div>
                  <p class="text-xs font-medium text-caption mb-1.5">
                    Read Only ({nip65Relays.readOnly.length})
                  </p>
                  <div class="flex flex-col gap-1">
                    {#each nip65Relays.readOnly as relay}
                      <div class="flex items-center gap-2 bg-secondary px-3 py-2 rounded-lg">
                        <CircleIcon
                          size={8}
                          weight="fill"
                          class={connectedRelaySet.has(normalizeRelayUrl(relay))
                            ? 'text-green-500'
                            : 'text-gray-400'}
                        />
                        <span
                          class="text-xs font-mono truncate"
                          style="color: var(--color-text-primary)">{relay}</span
                        >
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Manual Relay Configuration -->
        <div class="border-t border-[var(--color-input-border)] pt-4">
          <div class="flex items-center gap-2 mb-2">
            <PlugsIcon size={18} class="text-primary" />
            <p class="text-sm font-medium" style="color: var(--color-text-primary)">
              Manual Relay Configuration
            </p>
          </div>
          <p class="text-xs text-caption mb-3">
            These are the relays this app uses directly. Green dot indicates connected.
          </p>

          <div class="flex flex-col gap-0.5 mb-3">
            {#each relays as relay, index}
              <div class="flex items-center gap-2 bg-secondary px-3 py-2 rounded-lg">
                <CircleIcon
                  size={8}
                  weight="fill"
                  class={connectedRelaySet.has(normalizeRelayUrl(relay))
                    ? 'text-green-500'
                    : 'text-gray-400'}
                />
                <span
                  class="flex-1 text-xs font-mono truncate"
                  style="color: var(--color-text-primary)">{relay}</span
                >
                <button
                  type="button"
                  class="p-1.5 text-caption hover:text-red-500 transition-colors"
                  on:click={() => removeRelay(index)}
                  aria-label="Remove relay"
                >
                  <TrashIcon size={18} />
                </button>
              </div>
            {/each}
          </div>

          <div class="flex gap-2">
            <input
              bind:value={newRelay}
              placeholder="wss://relay.example.com"
              class="flex-1 p-3 bg-secondary rounded-lg border-none text-sm"
              style="color: var(--color-text-primary);"
              on:keydown={(e) => e.key === 'Enter' && addRelay()}
            />
            <button
              type="button"
              class="px-4 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm font-medium transition-colors"
              style="color: var(--color-text-primary)"
              on:click={addRelay}
            >
              Add
            </button>
          </div>

          <div class="text-xs text-caption mt-4">
            {connectedRelays.length} of {relays.length} relays connected
          </div>

          <div class="mt-4">
            <Button on:click={saveRelays} disabled={savingRelays || $ndkSwitching}>
              {#if savingRelays || $ndkSwitching}
                Switching relays...
              {:else}
                Save Changes
              {/if}
            </Button>
          </div>
        </div>
      </div>
    </Accordion>

    <!-- Wallet Section -->
    <Accordion title="Wallet" open={false}>
      <div class="flex flex-col gap-4">
        <p class="text-xs text-caption">Manage your Lightning wallet for zaps.</p>

        <!-- WebLN External Wallet (takes priority) -->
        {#if $weblnConnected}
          <div
            class="flex items-center gap-4 p-4 rounded-xl"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            <div
              class="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center flex-shrink-0"
            >
              <WeblnLogo size={24} className="text-white" />
            </div>
            <div class="flex-1">
              <p class="font-medium" style="color: var(--color-text-primary)">
                {$weblnWalletName || 'Browser Wallet'}
              </p>
              <p class="text-sm text-caption">WebLN</p>
            </div>
            <span
              class="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400"
              >Active</span
            >
          </div>
        {/if}

        <!-- Embedded wallets -->
        {#if connectedWallets.length > 0}
          <div class="flex flex-col gap-2">
            {#each connectedWallets as wallet}
              <div
                class="flex items-center gap-4 p-4 rounded-xl"
                style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
              >
                {#if wallet.kind === 4}
                  <div
                    class="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center"
                  >
                    <SparkLogo size={24} className="text-orange-500" />
                  </div>
                {:else if wallet.kind === 3}
                  <div
                    class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center"
                  >
                    <NwcLogo size={28} />
                  </div>
                {:else}
                  <div
                    class="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center"
                  >
                    <WalletIcon size={24} class="text-amber-500" weight="fill" />
                  </div>
                {/if}
                <div class="flex-1">
                  <p class="font-medium" style="color: var(--color-text-primary)">
                    {wallet.name}
                  </p>
                  <p class="text-sm text-caption">{getWalletTypeName(wallet.kind)}</p>
                </div>
                {#if wallet.active && !$weblnConnected}
                  <span
                    class="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400"
                    >Active</span
                  >
                {:else if $weblnConnected}
                  <span class="text-xs px-2 py-1 rounded-full bg-gray-500/20 text-gray-500"
                    >Paused</span
                  >
                {/if}
              </div>
            {/each}
          </div>
        {:else if $bitcoinConnectEnabled && !$weblnConnected}
          <div
            class="flex items-center gap-4 p-4 rounded-xl"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            <div class="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center">
              <BitcoinConnectLogo size={20} className="text-white" />
            </div>
            <div class="flex-1">
              <p class="font-medium" style="color: var(--color-text-primary)">External Wallet</p>
              <p class="text-sm text-caption">Bitcoin Connect</p>
            </div>
            <span
              class="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400"
              >Connected</span
            >
          </div>
        {:else if !$weblnConnected}
          <div
            class="p-4 rounded-xl text-center"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            <p class="text-sm text-caption">No wallets connected</p>
          </div>
        {/if}

        <div
          class="p-4 rounded-xl {!hasNavWallet ? 'opacity-50' : ''}"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
        >
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <div class="font-medium" style="color: var(--color-text-primary)">Wallet Widget</div>
              <p class="text-sm text-caption mt-1">Show the wallet widget in the top navigation.</p>
            </div>
            <button
              role="switch"
              aria-checked={$navBalanceVisible}
              disabled={!hasNavWallet}
              class="relative w-12 h-7 rounded-full transition-colors {hasNavWallet
                ? 'cursor-pointer'
                : 'cursor-not-allowed'} {$navBalanceVisible
                ? 'bg-amber-500'
                : 'bg-gray-300 dark:bg-gray-600'}"
              on:click={() => hasNavWallet && setNavBalanceVisible(!$navBalanceVisible)}
            >
              <span
                class="absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform {$navBalanceVisible
                  ? 'translate-x-5'
                  : ''}"
              ></span>
            </button>
          </div>
          {#if !hasNavWallet}
            <p class="text-xs text-amber-500 mt-3">Connect a wallet to enable this setting.</p>
          {/if}
        </div>

        <Button on:click={() => goto('/wallet')}>Manage Wallets</Button>
      </div>
    </Accordion>

    <!-- Zap Settings Section -->
    <Accordion title="Zap Settings" open={false}>
      <div class="flex flex-col gap-4">
        <p class="text-xs text-caption">Configure one-tap zap behavior for in-app wallets.</p>

        <!-- One-Tap Zap Toggle -->
        <div
          class="p-4 rounded-xl {!hasInAppWallet ? 'opacity-50' : ''}"
          style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
        >
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <LightningIcon size={18} weight="fill" class="text-amber-500" />
                <span class="font-medium" style="color: var(--color-text-primary)"
                  >One-Tap Zaps</span
                >
              </div>
              <p class="text-sm text-caption mt-1">Zap a preset amount instantly.</p>
            </div>
            <button
              role="switch"
              aria-checked={$oneTapZapEnabled}
              disabled={!hasInAppWallet}
              class="relative w-12 h-7 rounded-full transition-colors {hasInAppWallet
                ? 'cursor-pointer'
                : 'cursor-not-allowed'} {$oneTapZapEnabled && hasInAppWallet
                ? 'bg-amber-500'
                : 'bg-gray-300 dark:bg-gray-600'}"
              on:click={() => hasInAppWallet && setOneTapZapEnabled(!$oneTapZapEnabled)}
            >
              <span
                class="absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow transition-transform {$oneTapZapEnabled
                  ? 'translate-x-5'
                  : ''}"
              ></span>
            </button>
          </div>

          <!-- Amount Setting -->
          {#if $oneTapZapEnabled && hasInAppWallet}
            <div class="mt-4 pt-4 border-t" style="border-color: var(--color-input-border);">
              <label
                class="block text-sm font-medium mb-2"
                style="color: var(--color-text-primary)"
              >
                Default zap amount
              </label>
              <div class="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max={MAX_ONE_TAP_ZAP_AMOUNT}
                  value={$oneTapZapAmount}
                  on:change={(e) => setOneTapZapAmount(parseInt(e.currentTarget.value) || 21)}
                  class="input w-32 text-center"
                />
                <span class="text-caption">sats</span>
              </div>
              <p class="text-xs text-caption mt-2">
                Your preferred zap amount. Pressing the zap button will instantly zap this amount.
              </p>
            </div>
          {/if}

          <!-- No in-app wallet warning -->
          {#if !hasInAppWallet}
            <p class="text-xs text-amber-500 mt-3">
              Connect a Spark or NWC wallet to enable one-tap zaps.
            </p>
          {/if}
        </div>
      </div>
    </Accordion>

    <!-- Currency Section -->
    <Accordion title="Currency" open={false}>
      <div class="flex flex-col gap-4">
        <div>
          <p class="text-sm font-medium mb-3" style="color: var(--color-text-primary)">
            Display Currency
          </p>
          <p class="text-xs text-caption mb-3">
            Choose a currency to display alongside your sats balance in the wallet.
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          {#each SUPPORTED_CURRENCIES as currency}
            <button
              type="button"
              class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                {selectedCurrency === currency.code
                ? 'bg-primary text-white'
                : 'bg-secondary hover:bg-accent-gray'}"
              style={selectedCurrency !== currency.code ? 'color: var(--color-text-primary)' : ''}
              on:click={() => handleCurrencyChange(currency.code)}
            >
              {currency.code}
            </button>
          {/each}
        </div>

        <p class="text-xs text-caption">
          Your balance will show sats as the primary amount with the selected currency shown below.
        </p>
      </div>
    </Accordion>

    <!-- Content Filters Section -->
    <Accordion title="Content Filters" open={false}>
      <div class="flex flex-col gap-4">
        <!-- Hellthread Filter -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium" style="color: var(--color-text-primary)">
            Hellthread Threshold
          </label>
          <p class="text-xs" style="color: var(--color-caption)">
            Hide notes with too many mentions (common in spam threads). Set to 0 to disable.
          </p>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              bind:value={currentThreshold}
              on:change={handleThresholdChange}
              class="flex-1"
            />
            <input
              type="number"
              min="0"
              max="500"
              bind:value={currentThreshold}
              on:change={handleThresholdChange}
              class="w-20 px-2 py-1 rounded text-sm"
              style="background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
            />
          </div>
          <div class="flex justify-between text-xs" style="color: var(--color-caption)">
            <span>Disabled</span>
            <span>Current: {currentThreshold} mentions</span>
            <span>Very strict</span>
          </div>
        </div>
      </div>
    </Accordion>

    <!-- Security Section -->
    <Accordion title="Security" open={false}>
      <div class="flex flex-col gap-5">
        <!-- Public Key -->
        <div>
          <p class="text-sm font-medium mb-1" style="color: var(--color-text-primary)">
            Public Key (npub)
          </p>
          <p class="text-xs text-caption mb-3">Your public identity. Safe to share.</p>
          {#if pk}
            <div class="flex gap-2">
              <div
                class="flex-1 bg-secondary p-2.5 rounded-lg font-mono text-xs break-all"
                style="color: var(--color-text-primary)"
              >
                {nip19.npubEncode(pk)}
              </div>
              <button
                type="button"
                class="px-3 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm transition-colors flex items-center gap-1.5"
                style="color: var(--color-text-primary)"
                on:click={() => copyToClipboard(nip19.npubEncode(pk), 'public')}
              >
                {#if copiedKey === 'public'}
                  <CheckIcon size={16} class="text-green-500" />
                {:else}
                  <CopyIcon size={16} />
                {/if}
              </button>
            </div>
          {:else}
            <p class="text-caption text-sm italic">No public key found</p>
          {/if}
        </div>

        <!-- Private Key -->
        {#if sk}
          <div class="border-t border-[var(--color-input-border)] pt-5">
            <p class="text-sm font-medium mb-1 text-red-500">Private Key (nsec)</p>
            <p class="text-xs text-caption mb-3">Never share this with anyone. Keep it secret.</p>

            {#if !privateKeyRevealed}
              <button
                type="button"
                class="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-sm font-medium transition-colors"
                on:click={() => (privateKeyRevealed = true)}
              >
                Reveal Private Key
              </button>
            {:else}
              <div
                class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3"
              >
                <p class="text-xs text-red-700 dark:text-red-300 font-medium">
                  Warning: Your private key is visible. Make sure no one can see your screen.
                </p>
              </div>

              <div class="flex gap-2">
                <div
                  class="flex-1 bg-secondary p-2.5 rounded-lg font-mono text-xs break-all"
                  style="color: var(--color-text-primary)"
                >
                  {#if showPrivkey}
                    {getEncodedPrivateKey()}
                  {:else}
                    <span class="text-caption">••••••••••••••••••••••••••••••••</span>
                  {/if}
                </div>
                <div class="flex flex-col gap-1.5">
                  <button
                    type="button"
                    class="px-3 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-xs font-medium transition-colors"
                    style="color: var(--color-text-primary)"
                    on:click={() => (showPrivkey = !showPrivkey)}
                  >
                    {showPrivkey ? 'Hide' : 'Show'}
                  </button>
                  {#if showPrivkey}
                    <button
                      type="button"
                      class="px-3 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                      style="color: var(--color-text-primary)"
                      on:click={() => copyToClipboard(getEncodedPrivateKey(), 'private')}
                    >
                      {#if copiedKey === 'private'}
                        <CheckIcon size={14} class="text-green-500" />
                      {:else}
                        <CopyIcon size={14} />
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>

              <button
                type="button"
                class="mt-3 text-xs text-caption hover:text-primary transition-colors"
                on:click={() => {
                  privateKeyRevealed = false;
                  showPrivkey = false;
                }}
              >
                Hide this section
              </button>
            {/if}
          </div>
        {:else if authMethod === 'nip46'}
          <div class="border-t border-[var(--color-input-border)] pt-5">
            <p class="text-sm text-caption italic">
              Using remote signer - no private key stored on this device
            </p>
          </div>
        {/if}

        <!-- NIP-46 Bunker Section -->
        {#if authMethod === 'nip46' && nip46Info}
          <div class="border-t border-[var(--color-input-border)] pt-5">
            <p class="text-sm font-medium mb-1" style="color: var(--color-text-primary)">
              Remote Signer (NIP-46)
            </p>
            <div class="flex items-center gap-2 text-sm mb-3">
              <CircleIcon size={10} weight="fill" class="text-green-500" />
              <span class="text-green-600 dark:text-green-400">Connected to bunker</span>
            </div>

            <div class="text-xs space-y-1.5 mb-4 bg-secondary p-3 rounded-lg">
              <div>
                <span class="text-caption">Signer:</span>
                <span class="font-mono" style="color: var(--color-text-primary)">
                  {nip19.npubEncode(nip46Info.signerPubkey).slice(0, 24)}...
                </span>
              </div>
              <div>
                <span class="text-caption">Relays:</span>
                <span style="color: var(--color-text-primary)">
                  {nip46Info.relays.join(', ')}
                </span>
              </div>
            </div>

            <button
              type="button"
              on:click={disconnectBunker}
              disabled={disconnectingBunker}
              class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {disconnectingBunker ? 'Disconnecting...' : 'Disconnect Bunker'}
            </button>
          </div>
        {/if}
      </div>
    </Accordion>
  </div>
</div>
