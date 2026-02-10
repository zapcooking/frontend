<script lang="ts">
	import { totalUnreadCount } from '$lib/stores/messages';

	export let size: 'sm' | 'md' = 'sm';
</script>

{#if $totalUnreadCount > 0}
	{#if size === 'sm'}
		<!-- Dot badge for nav icons -->
		<span
			class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-red-500 border-2"
			style="border-color: var(--color-bg-primary);"
			aria-hidden="true"
		></span>
	{:else}
		<!-- Count badge -->
		<span
			class="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1"
		>
			{$totalUnreadCount > 99 ? '99+' : $totalUnreadCount}
		</span>
	{/if}
{/if}
