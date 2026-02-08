<script lang="ts">
	import CustomAvatar from '../../../components/CustomAvatar.svelte';
	import CustomName from '../../../components/CustomName.svelte';

	export let sender: string;
	export let content: string;
	export let created_at: number;

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

<div class="flex items-start gap-2.5 mb-3 px-1">
	<div class="flex-shrink-0 mt-0.5">
		<CustomAvatar pubkey={sender} size={32} />
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-baseline gap-2">
			<span class="font-medium text-xs truncate" style="color: var(--color-text-primary);">
				<CustomName pubkey={sender} />
			</span>
			<span class="text-[10px] flex-shrink-0" style="color: var(--color-caption);">
				{timeString}
			</span>
		</div>
		<p class="text-sm whitespace-pre-wrap break-words mt-0.5" style="color: var(--color-text-primary);">
			{content}
		</p>
	</div>
</div>
