<script lang="ts">
  import CheffyAvatar from '../../../components/CheffyAvatar.svelte';
  export let text: string;
  export let happy = false;
</script>

<div class="coach">
  <CheffyAvatar size={32} expression={happy ? 'excited' : 'neutral'} />
  <p>{text}</p>
</div>

<style>
  .coach {
    display: flex;
    gap: 12px;
    align-items: center;
    color: var(--table-muted);
    text-align: left;
    max-width: 420px;
    margin: 20px auto 0;
  }
  .coach p {
    font-size: 14px;
    line-height: 1.5;
  }
</style>
