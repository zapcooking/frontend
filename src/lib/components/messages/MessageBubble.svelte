<script lang="ts">
	import { userPublickey } from '$lib/nostr';
	import LockSimpleIcon from 'phosphor-svelte/lib/LockSimple';
	import LockSimpleOpenIcon from 'phosphor-svelte/lib/LockSimpleOpen';

	export let sender: string;
	export let content: string;
	export let created_at: number;
	export let protocol: 'nip17' | 'nip04' = 'nip04';

	$: isMine = sender === $userPublickey;
	$: protocolTip = protocol === 'nip17'
		? 'Private — metadata hidden'
		: 'Compatible — metadata visible';

	$: timeString = formatTime(created_at);

	function formatTime(ts: number): string {
		const date = new Date(ts * 1000);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const oneDay = 86400000;

		if (diff < oneDay && date.getDate() === now.getDate()) {
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		if (diff < 7 * oneDay) {
			return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
		}
		return date.toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<div class="flex {isMine ? 'justify-end' : 'justify-start'} mb-2">
	<div
		class="max-w-[75%] rounded-2xl px-4 py-2.5 {isMine
			? 'rounded-br-md'
			: 'rounded-bl-md'}"
		style={isMine
			? (protocol === 'nip17'
				? 'background-color: rgba(124, 58, 237, 0.85); color: #ffffff;'
				: 'background-color: var(--color-primary); color: #ffffff;')
			: (protocol === 'nip17'
				? 'background-color: rgba(124, 58, 237, 0.12); color: var(--color-text-primary);'
				: 'background-color: var(--color-input-bg); color: var(--color-text-primary);')}
	>
		<p class="text-sm whitespace-pre-wrap break-words">{content}</p>
		<p
			class="text-[10px] mt-1 {isMine ? 'text-right' : 'text-left'}"
			style={isMine ? 'color: rgba(255,255,255,0.7);' : 'color: var(--color-caption);'}
		>
			{timeString}
			<span
				class="inline-flex items-center gap-px ml-1"
				title={protocolTip}
			>
				{#if protocol === 'nip17'}
					<LockSimpleIcon class="w-2.5 h-2.5" weight="bold" style="color: rgba(167, 139, 250, 0.8);" />
				{:else}
					<LockSimpleOpenIcon class="w-2.5 h-2.5" weight="bold" style="color: rgba(249, 115, 22, 0.6);" />
				{/if}
			</span>
		</p>
	</div>
</div>
