<script lang="ts">
  import { pantry } from './service';
  export let id: string;
  $: index = pantry.findIndex((f) => f.id === id);
</script>

<span
  aria-hidden="true"
  class="food-art"
  style={`background-position:${(index % 5) * 25}% ${(Math.floor(index / 5) * 100) / 3}%`}
></span>
