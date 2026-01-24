<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { subscribeToNotifications, unsubscribeFromNotifications } from '$lib/notificationStore';

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
  } else if (!isValidPubkey($userPublickey) && lastSubscribedPubkey) {
    lastSubscribedPubkey = null;
    unsubscribeFromNotifications();
  }
</script>

<!-- no UI: just keeps notification subscription alive -->
