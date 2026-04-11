<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { subscribeToNotifications, unsubscribeFromNotifications } from '$lib/notificationStore';
  import { muteListStore } from '$lib/muteListStore';

  let lastSubscribedPubkey: string | null = null;

  onDestroy(() => {
    unsubscribeFromNotifications();
  });

  function isValidPubkey(pubkey: string | null | undefined): pubkey is string {
    return !!pubkey && pubkey.length === 64 && /^[a-f0-9]+$/i.test(pubkey);
  }

  // Subscribe when user changes (only re-subscribe if pubkey actually changed)
  $: if (isValidPubkey($userPublickey) && $ndk && $userPublickey !== lastSubscribedPubkey) {
    lastSubscribedPubkey = $userPublickey;
    subscribeToNotifications($ndk, $userPublickey);
    // Ensure mute list is loaded early so unreadCount excludes muted users
    muteListStore.load();
  } else if (!isValidPubkey($userPublickey) && lastSubscribedPubkey) {
    lastSubscribedPubkey = null;
    unsubscribeFromNotifications();
  }
</script>

<!-- no UI: just keeps notification subscription alive -->
