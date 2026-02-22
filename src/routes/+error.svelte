<script lang="ts">
	import { page } from '$app/stores';
</script>

<h1>{$page.status} {$page.error?.message || 'Unknown error'}</h1>
