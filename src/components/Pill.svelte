<script lang="ts">
  export let text: string;
  export let onClick: () => void;
  export let selected: boolean;
</script>

<button
  on:click={onClick}
  type="button"
  class={`
    md:px-4
    py-3
    font-semibold
    rounded-full
    text-center
    ${selected ? 'bg-accent-gray' : 'bg-input'}
    `}
  style="color: var(--color-text-primary)"
>{text}</button
>
