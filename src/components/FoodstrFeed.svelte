<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { formatDistanceToNow } from 'date-fns';
  import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import AuthorName from './AuthorName.svelte';

  let events: NDKEvent[] = [];
  let loading = true;
  let error = false;
  let hasMore = true;
  let loadingMore = false;
  let debugInfo = '';
  let testMode = false; // Set to true to show sample data for testing
  
  // Reactive statement to update debug info when NDK changes
  $: if ($ndk) {
    console.log('🔄 NDK store updated');
  }

  async function loadFoodstrFeed() {
    try {
      loading = true;
      error = false;
      events = []; // Reset events
      
      console.log('🍽️ Starting foodstr feed...');
      console.log('🔗 NDK instance:', $ndk);
      
      debugInfo = `NDK connected, loading feed...`;
      
      const filter = {
        kinds: [1],
        '#t': ['foodstr'],
        limit: 20
      };
      
      console.log('🔍 Filter object:', JSON.stringify(filter, null, 2));
      console.log('📋 Filter:', filter);
      
      // Use fetchEvents directly (same as working test functions)
      console.log('🔄 Using fetchEvents (same as working tests)...');
      
      // Add timeout to prevent hanging
      const fetchPromise = $ndk.fetchEvents(filter);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('fetchEvents timeout')), 5000)
      );
      
      const fetchedEvents = await Promise.race([fetchPromise, timeoutPromise]) as Set<NDKEvent>;
      console.log('📊 fetchEvents result:', fetchedEvents.size, 'events');
      
      if (fetchedEvents.size > 0) {
        const eventArray = Array.from(fetchedEvents);
        // Sort by creation time (newest first)
        const sortedEvents = eventArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        events = sortedEvents;
        loading = false;
        error = false; // Explicitly clear error state
        debugInfo = `Found ${events.length} events (sorted by newest first).`;
        
        console.log('✅ fetchEvents found events:', events.length);
        // Log first 5 events for debugging
        events.slice(0, 5).forEach((event, index) => {
          console.log(`Event ${index + 1}:`, {
            id: event.id,
            pubkey: event.pubkey,
            content: event.content?.substring(0, 100) + '...',
            created_at: event.created_at,
            created_at_date: event.created_at ? new Date(event.created_at * 1000).toISOString() : 'unknown',
            tags: event.tags,
            author: event.author?.hexpubkey
          });
        });
      } else {
        console.log('❌ fetchEvents found no events');
        loading = false;
        error = false; // Don't set error for no events, just show empty state
        debugInfo = `No #foodstr events found.`;
      }
      
    } catch (err) {
      console.error('❌ Error loading foodstr feed:', err);
      
      // If fetchEvents times out, try subscription as fallback
      if (err instanceof Error && err.message.includes('timeout')) {
        console.log('🔄 fetchEvents timed out, trying subscription fallback...');
        try {
          await trySubscriptionFallback(filter);
        } catch (subErr) {
          console.error('❌ Subscription fallback also failed:', subErr);
          error = true;
          loading = false;
          debugInfo = `Both fetchEvents and subscription failed.`;
        }
      } else {
        error = true;
        loading = false;
        debugInfo = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  async function trySubscriptionFallback(filter: any) {
    return new Promise<void>((resolve, reject) => {
      console.log('🔄 Trying subscription fallback...');
      const subscription = $ndk.subscribe(filter);
      let eventCount = 0;
      const receivedEvents: NDKEvent[] = [];
      
      subscription.on('event', (event: NDKEvent) => {
        eventCount++;
        console.log(`📨 Fallback event ${eventCount}:`, {
          id: event.id,
          content: event.content?.substring(0, 50),
          created_at: event.created_at,
          created_at_date: event.created_at ? new Date(event.created_at * 1000).toISOString() : 'unknown'
        });
        
        receivedEvents.push(event);
      });

      subscription.on('eose', () => {
        console.log('🏁 Fallback subscription completed - Total received:', receivedEvents.length);
        
        if (receivedEvents.length > 0) {
          // Sort events by creation time (newest first)
          const sortedEvents = receivedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          events = sortedEvents;
          loading = false;
          error = false; // Explicitly clear error state
          debugInfo = `Found ${events.length} events via subscription fallback (sorted by newest first).`;
          
          console.log('✅ Subscription fallback found events:', events.length);
        } else {
          console.log('❌ No events found via subscription fallback');
          loading = false;
          error = false; // Don't set error for no events
          debugInfo = `No #foodstr events found via subscription fallback.`;
        }
        resolve();
      });

      // Timeout for subscription fallback
      setTimeout(() => {
        if (loading) {
          console.log('⏰ Subscription fallback timeout reached');
          loading = false;
          debugInfo = `Subscription fallback timeout - no #foodstr events found.`;
          reject(new Error('Subscription fallback timeout'));
        }
      }, 8000);
    });
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    
    try {
      loadingMore = true;
      
      const oldestEvent = events[events.length - 1];
      if (!oldestEvent?.created_at) return;
      
      const filter = {
        kinds: [1],
        '#t': ['foodstr'],
        until: oldestEvent.created_at - 1,
        limit: 20
      };

      const fetchedEvents = await $ndk.fetchEvents(filter);
      const newEvents = Array.from(fetchedEvents);
      events = [...events, ...newEvents];
      hasMore = newEvents.length === 20;
    } catch (err) {
      console.error('Error loading more events:', err);
    } finally {
      loadingMore = false;
    }
  }

  async function testBroaderSearch() {
    console.log('🔍 Testing broader search for any kind 1 events...');
    debugInfo = 'Testing broader search...';
    try {
      const testFilter = { kinds: [1], limit: 10 };
      const testEvents = await $ndk.fetchEvents(testFilter);
      console.log('🧪 Test search results:', testEvents.size, 'events found');
      debugInfo = `Found ${testEvents.size} kind 1 events in test search`;
      
      if (testEvents.size > 0) {
        const firstEvent = Array.from(testEvents)[0];
        console.log('📝 Sample event:', {
          id: firstEvent.id,
          content: firstEvent.content?.substring(0, 100),
          tags: firstEvent.tags
        });
        
        // Check if any events have #foodstr tag
        const foodstrEvents = Array.from(testEvents).filter(event => 
          event.tags.some(tag => tag[0] === 't' && tag[1] === 'foodstr')
        );
        console.log('🍽️ Events with #foodstr tag:', foodstrEvents.length);
        
        // Check for other common tags
        const allTags = new Set();
        Array.from(testEvents).forEach(event => {
          event.tags.forEach(tag => {
            if (tag[0] === 't') {
              allTags.add(tag[1]);
            }
          });
        });
        console.log('🏷️ All tags found:', Array.from(allTags).slice(0, 20));
        
        // Test if we can find posts with a common tag like 'nostr'
        const nostrEvents = Array.from(testEvents).filter(event => 
          event.tags.some(tag => tag[0] === 't' && tag[1] === 'nostr')
        );
        console.log('📝 Events with #nostr tag:', nostrEvents.length);
        
        debugInfo = `Test: ${testEvents.size} events, ${foodstrEvents.length} #foodstr, ${nostrEvents.length} #nostr`;
      } else {
        debugInfo = 'Test search found NO kind 1 events at all';
        console.log('❌ No kind 1 events found in test search');
      }
    } catch (err) {
      console.error('❌ Test search failed:', err);
      debugInfo = `Test search failed: ${err.message}`;
    }
  }

  async function testAllKind1Events() {
    console.log('🧪 Testing all kind 1 events to verify subscription works...');
    try {
      const testFilter = { kinds: [1], limit: 10 };
      const subscription = $ndk.subscribe(testFilter);
      let testEvents: NDKEvent[] = [];
      
      subscription.on('event', (event: NDKEvent) => {
        testEvents.push(event);
        console.log('📨 Test event received:', {
          id: event.id,
          content: event.content?.substring(0, 50),
          tags: event.tags
        });
        
        // Check if this event has #foodstr tag
        const hasFoodstrTag = event.tags.some(tag => tag[0] === 't' && tag[1] === 'foodstr');
        if (hasFoodstrTag) {
          console.log('🍽️ Found #foodstr tag in event:', event.id);
        }
      });
      
      subscription.on('eose', () => {
        console.log('🧪 Test completed. Total kind 1 events:', testEvents.length);
        
        // Count events with #foodstr tag
        const foodstrEvents = testEvents.filter(event => 
          event.tags.some(tag => tag[0] === 't' && tag[1] === 'foodstr')
        );
        console.log('🍽️ Events with #foodstr tag:', foodstrEvents.length);
        
        debugInfo = `Test found ${testEvents.length} kind 1 events, ${foodstrEvents.length} with #foodstr tag.`;
      });
      
    } catch (err) {
      console.error('❌ Test failed:', err);
    }
  }

  async function testRelayConnection() {
    console.log('🌐 Testing relay connection...');
    debugInfo = 'Testing relay connection...';
    try {
      // Try to get a simple event to test connection
      const testFilter = { kinds: [1], limit: 1 };
      const startTime = Date.now();
      const testEvents = await $ndk.fetchEvents(testFilter);
      const endTime = Date.now();
      
      console.log('⏱️ Connection test took:', endTime - startTime, 'ms');
      console.log('📊 Test events found:', testEvents.size);
      
      if (testEvents.size > 0) {
        const event = Array.from(testEvents)[0];
        console.log('✅ Connection working! Sample event:', {
          id: event.id,
          content: event.content?.substring(0, 50),
          created_at: new Date(event.created_at * 1000).toISOString()
        });
        debugInfo = `✅ Connection working! Found ${testEvents.size} events in ${endTime - startTime}ms`;
      } else {
        debugInfo = '❌ Connection working but no events found';
        console.log('❌ Connection working but no events found');
      }
    } catch (err) {
      console.error('❌ Connection test failed:', err);
      debugInfo = `❌ Connection failed: ${err.message}`;
    }
  }

  async function waitForNDKConnection() {
    console.log('⏳ Waiting for NDK connection...');
    let attempts = 0;
    while (attempts < 10) {
      if ($ndk) {
        console.log('✅ NDK connected');
        return true;
      }
      console.log(`⏳ Attempt ${attempts + 1}: NDK not ready yet...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    console.log('❌ NDK connection timeout');
    return false;
  }

  onMount(async () => {
    if (testMode) {
      // Show sample data for testing
      loading = false;
      debugInfo = 'Test mode: Showing sample data';
      events = [
        {
          id: 'test1',
          pubkey: 'testpubkey1',
          content: 'Just made an amazing pasta dish! #foodstr #italian #pasta',
          created_at: Math.floor(Date.now() / 1000) - 3600,
          tags: [['t', 'foodstr'], ['t', 'italian'], ['t', 'pasta']],
          author: { hexpubkey: 'testpubkey1', profile: { display_name: 'Test Chef', image: null } }
        } as any,
        {
          id: 'test2',
          pubkey: 'testpubkey2',
          content: 'Homemade pizza night! 🍕 #foodstr #pizza #italian',
          created_at: Math.floor(Date.now() / 1000) - 7200,
          tags: [['t', 'foodstr'], ['t', 'pizza'], ['t', 'italian']],
          author: { hexpubkey: 'testpubkey2', profile: { display_name: 'Pizza Master', image: null } }
        } as any
      ];
    } else {
      const connected = await waitForNDKConnection();
      if (connected) {
        testBroaderSearch();
        testAllKind1Events();
        loadFoodstrFeed();
      } else {
        error = true;
        loading = false;
        debugInfo = 'Failed to connect to NDK';
      }
    }
  });

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }


  function getProfileImage(event: NDKEvent): string | undefined {
    return event.author?.profile?.image;
  }
</script>

<div class="max-w-2xl mx-auto">
  {#if debugInfo}
    <div class="mb-4 p-3 bg-gray-100 rounded-lg text-sm text-gray-600">
      Debug: {debugInfo}
    </div>
  {/if}
  
  <!-- Temporary debug info -->
  <div class="mb-4 p-3 bg-blue-100 rounded-lg text-sm text-blue-800">
    <strong>Debug Info:</strong><br>
    Loading: {loading}<br>
    Events: {events.length}<br>
    Error: {error}<br>
    NDK Connected: {$ndk ? 'Yes' : 'No'}<br>
    Debug Message: {debugInfo}<br>
    <strong>Events Array:</strong> {JSON.stringify(events.slice(0, 2).map(e => ({id: e.id, content: e.content?.substring(0, 50)})))}
    <div class="mt-2 space-x-2">
      <button 
        on:click={() => {
          console.log('🔧 Clearing error state...');
          error = false;
          loading = false;
          debugInfo = 'Error state cleared manually';
        }}
        class="px-3 py-1 bg-pink-600 text-white rounded text-xs"
      >
        Clear Error
      </button>
      <button 
        on:click={() => {
          console.log('🔍 Manual test - checking for any kind 1 events...');
          testBroaderSearch();
        }}
        class="px-3 py-1 bg-blue-600 text-white rounded text-xs"
      >
        Test Broader Search
      </button>
      <button 
        on:click={() => {
          console.log('🍽️ Manual test - checking for #foodstr events...');
          loadFoodstrFeed();
        }}
        class="px-3 py-1 bg-green-600 text-white rounded text-xs"
      >
        Test #foodstr Search
      </button>
      <button 
        on:click={() => {
          console.log('🌐 Testing relay connection...');
          testRelayConnection();
        }}
        class="px-3 py-1 bg-purple-600 text-white rounded text-xs"
      >
        Test Relay Connection
      </button>
    </div>
  </div>
  {#if loading}
    <div class="space-y-6">
      {#each Array(5) as _}
        <div class="border-b border-gray-200 py-6">
          <div class="flex space-x-3">
            <div class="h-10 w-10 rounded-full bg-gray-200 animate-pulse flex-shrink-0"></div>
            <div class="flex-1 space-y-3">
              <div class="flex items-center space-x-2">
                <div class="h-4 w-24 bg-gray-200 animate-pulse rounded"></div>
                <div class="h-4 w-16 bg-gray-200 animate-pulse rounded"></div>
              </div>
              <div class="space-y-2">
                <div class="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
                <div class="h-4 w-4/5 bg-gray-200 animate-pulse rounded"></div>
                <div class="h-4 w-3/5 bg-gray-200 animate-pulse rounded"></div>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">Unable to load #foodstr posts</p>
          <p class="text-sm">Please check your connection and try again.</p>
        </div>
        <button 
          on:click={loadFoodstrFeed}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  {:else if events.length === 0}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">No Foodstr posts found</p>
          <p class="text-sm">Try posting with tag #foodstr.</p>
        </div>
        <button 
          on:click={loadFoodstrFeed}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Refresh Feed
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-0">
      {#each events as event}
        <article class="border-b border-gray-200 py-6 first:pt-0">
          <div class="flex space-x-3">
            <!-- Avatar -->
            <div class="flex-shrink-0">
              <Avatar
                class="h-10 w-10 rounded-full cursor-pointer"
                ndk={$ndk}
                pubkey={event.author.hexpubkey}
              />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <!-- Header -->
              <div class="flex items-center space-x-2 mb-2">
                <AuthorName {event} />
                <span class="text-gray-500 text-sm">·</span>
                <span class="text-gray-500 text-sm">
                  {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                </span>
              </div>

              <!-- Content -->
              <div class="text-sm leading-relaxed mb-3 text-gray-900">
                {event.content}
              </div>

              <!-- Actions placeholder -->
              <div class="flex items-center space-x-4 text-sm text-gray-500">
                <button class="hover:text-gray-700 transition-colors">
                  Like
                </button>
                <button class="hover:text-gray-700 transition-colors">
                  Reply
                </button>
                <button class="hover:text-gray-700 transition-colors">
                  Zap
                </button>
              </div>
            </div>
          </div>
        </article>
      {/each}

      {#if hasMore}
        <div class="py-4 text-center">
          {#if loadingMore}
            <div class="flex justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          {:else}
            <button 
              on:click={loadMore}
              class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Load More
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
