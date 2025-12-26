<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ReactionTrigger from '../Reactions/ReactionTrigger.svelte';

  export let event: NDKEvent;
</script>

<ReactionTrigger {event} targetType="recipe" />
