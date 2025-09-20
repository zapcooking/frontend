
<script lang="ts">
	import { page } from '$app/stores';
	export const error: any = {};
</script>

<h1>{$page.status} {$page.error?.message || 'Unknown error'}</h1>