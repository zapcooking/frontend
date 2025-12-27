<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ReactionPills from './Reactions/ReactionPills.svelte';

  export let event: NDKEvent;
</script>

<ReactionPills {event} targetType="note" />
