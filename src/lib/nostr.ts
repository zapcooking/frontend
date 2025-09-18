import { browser } from '$app/environment';
import NDK from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { writable, type Writable } from 'svelte/store';
import { standardRelays } from './consts';

export const relays = JSON.parse(
  (browser && localStorage.getItem('nostrcooking_relays')) || JSON.stringify(standardRelays)
)

const dexieAdapter = new NDKCacheAdapterDexie({ dbName: 'zapcooking-ndk-cache-db' });
const Ndk: NDK = new NDK({ 
  outboxRelayUrls: ["wss://purplepag.es"], 
  enableOutboxModel: true, 
  explicitRelayUrls: relays, 
  cacheAdapter: dexieAdapter,
  autoConnectUserRelays: false
});

browser && (async () => {
  try {
    console.log('🔗 Connecting to NDK relays...');
    await Ndk.connect();
    console.log('✅ NDK connected successfully');
  } catch (error) {
    console.error('❌ NDK connection failed:', error);
    // Don't throw here, let individual operations handle connection failures
  }
})()

export const ndk: Writable<NDK> = writable(Ndk);

export const userPublickey: Writable<string> = writable(
  (browser && localStorage.getItem('nostrcooking_loggedInPublicKey')) || ''
);
