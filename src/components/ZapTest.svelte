<script lang="ts">
  import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import { ZapManager } from '$lib/zapManager';
  import ZapButton from './ZapButton.svelte';
  import ZapDisplay from './ZapDisplay.svelte';
  import ZapModal from './ZapModal.svelte';
  import { onMount } from 'svelte';

  let zapManager: ZapManager;
  let testUser: NDKUser | null = null;
  let testEvent: NDKEvent | null = null;
  let zapModalOpen = false;
  let zapTotals = { count: 0, total: 0 };

  onMount(async () => {
    zapManager = new ZapManager($ndk);
    
    // Create a test user (you can replace this with a real pubkey)
    testUser = await $ndk.getUser({ pubkey: 'npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9' });
    
    // Try to find a test event (recipe)
    try {
      const events = await $ndk.fetchEvents({
        kinds: [30023],
        '#t': ['nostrcooking'],
        limit: 1
      });
      
      if (events.size > 0) {
        testEvent = Array.from(events)[0];
      }
    } catch (error) {
      console.log('No test events found:', error);
    }
  });

  async function testZapFlow() {
    if (!testUser) return;
    
    try {
      console.log('Testing zap flow...');
      
      // Test getting zap totals
      const totals = await zapManager.getZapTotals(testUser.hexpubkey);
      zapTotals = totals;
      console.log('Zap totals:', totals);
      
      // Test LNURL conversion (if user has lightning address)
      const profile = await testUser.fetchProfile();
      if (profile?.lud16 || profile?.lud06) {
        const lightningAddress = profile.lud16 || profile.lud06;
        console.log('User has lightning address:', lightningAddress);
        
        try {
          const lnurl = await zapManager.getLnurlFromAddress(lightningAddress!);
          console.log('LNURL endpoint:', lnurl);
          
          const lnurlPayRequest = await zapManager.fetchLnurlPayRequest(lnurl);
          console.log('LNURL pay request:', lnurlPayRequest);
        } catch (error) {
          console.log('LNURL test failed:', error);
        }
      } else {
        console.log('User has no lightning address configured');
      }
      
    } catch (error) {
      console.error('Zap test failed:', error);
    }
  }

  function handleZapComplete() {
    console.log('Zap completed!');
    zapModalOpen = false;
    // Refresh zap totals
    if (testUser) {
      zapManager.getZapTotals(testUser.hexpubkey).then(totals => {
        zapTotals = totals;
      });
    }
  }
</script>

<div class="p-6 bg-gray-100 rounded-lg">
  <h2 class="text-xl font-bold mb-4">Zap Functionality Test</h2>
  
  <div class="space-y-4">
    <div>
      <h3 class="font-semibold">Test User:</h3>
      {#if testUser}
        <div class="flex items-center gap-4">
          <ZapDisplay user={testUser} />
          <ZapButton user={testUser} />
        </div>
        <p class="text-sm text-gray-600 mt-2">
          Zap totals: {zapTotals.count} zaps, {zapTotals.total} sats
        </p>
      {:else}
        <p class="text-gray-500">Loading test user...</p>
      {/if}
    </div>

    <div>
      <h3 class="font-semibold">Test Event:</h3>
      {#if testEvent}
        <div class="flex items-center gap-4">
          <ZapDisplay event={testEvent} />
          <ZapButton event={testEvent} />
        </div>
        <p class="text-sm text-gray-600 mt-2">
          Event ID: {testEvent.id}
        </p>
      {:else}
        <p class="text-gray-500">No test events found</p>
      {/if}
    </div>

    <div>
      <button 
        class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        on:click={testZapFlow}
      >
        Test Zap Flow
      </button>
    </div>

    <div>
      <h3 class="font-semibold">WebLN Status:</h3>
      <p class="text-sm">
        WebLN Available: {zapManager?.isWebLNAvailable() ? 'Yes' : 'No'}
      </p>
    </div>
  </div>
</div>

{#if zapModalOpen}
  <ZapModal 
    bind:open={zapModalOpen} 
    user={testUser} 
    event={testEvent}
    on:zap-complete={handleZapComplete}
  />
{/if}