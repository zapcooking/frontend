<script lang="ts" context="module">
  export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
</script>

<script lang="ts">
  export let variant: ButtonVariant = 'primary';
  /**
   * Legacy alias. When `primary` is explicitly passed (true/false) it
   * wins over `variant` so older call sites that say `primary={false}`
   * still render as the secondary (gray) button. New code should use
   * `variant="..."` and leave `primary` unset.
   */
  export let primary: boolean | null = null;
  export let type: 'button' | 'reset' | 'submit' = 'button';
  export let disabled = false;

  $: effectiveVariant =
    primary === false ? 'secondary' : primary === true ? 'primary' : variant;

  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-primary text-white hover:opacity-80 disabled:bg-primary/50',
    secondary: 'bg-gray-700 text-white hover:bg-gray-600 disabled:bg-gray-700/50',
    outline:
      'bg-transparent border border-primary text-primary hover:bg-primary/10 disabled:opacity-50',
    ghost:
      'bg-transparent text-primary hover:bg-primary/10 disabled:opacity-50'
  };
</script>

<button
  {type}
  class="rounded-full whitespace-nowrap flex items-center justify-center gap-2 px-4 py-2.5 font-semibold transition duration-300 {variantClasses[
    effectiveVariant
  ]} {$$props.class}"
  on:click
  {disabled}
  {...$$restProps}
>
  <slot />
</button>
