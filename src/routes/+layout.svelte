<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import '../app.css';
  import Header from '../components/Header.svelte';
  import { browser } from '$app/environment';
  import { ndk, userPublickey } from '$lib/nostr';
  import BottomNav from '../components/BottomNav.svelte';
  import { createAuthManager, type AuthState } from '$lib/authManager';

  let authManager = createAuthManager($ndk);
  let authState: AuthState = authManager.getState();
  let unsubscribe: (() => void) | null = null;

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
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });
</script>

<div class="h-[100%] scroll-smooth">
  <div class="flex h-screen">
    <div class="mx-auto flex-1 pt-2 print:pt-[0] px-4">
      <Header />
      <div class="container mx-auto mt-6 pb-24">
        <slot />
      </div>
      <BottomNav />
    </div>
  </div>
</div>
