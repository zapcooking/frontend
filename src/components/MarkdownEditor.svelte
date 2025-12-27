<script lang="ts">
  import { parseMarkdown } from '$lib/parser';
  import TextB from 'phosphor-svelte/lib/TextB';
  import TextItalic from 'phosphor-svelte/lib/TextItalic';
  import Link from 'phosphor-svelte/lib/Link';
  import ListBullets from 'phosphor-svelte/lib/ListBullets';
  import ListNumbers from 'phosphor-svelte/lib/ListNumbers';
  import Quotes from 'phosphor-svelte/lib/Quotes';
  import Code from 'phosphor-svelte/lib/Code';

  export let value: string = '';
  export let placeholder: string = '';
  export let rows: number = 6;

  let activeTab: 'write' | 'preview' = 'write';
  let textarea: HTMLTextAreaElement;

  function insertMarkdown(before: string, after: string = '', defaultText: string = '') {
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end) || defaultText;

    const newValue =
      value.substring(0, start) +
      before +
      selectedText +
      after +
      value.substring(end);

    value = newValue;

    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + before.length + selectedText.length;
      textarea.setSelectionRange(
        start + before.length,
        newCursorPos
      );
    }, 0);
  }

  function handleBold() {
    insertMarkdown('**', '**', 'bold text');
  }

  function handleItalic() {
    insertMarkdown('*', '*', 'italic text');
  }

  function handleLink() {
    const url = prompt('Enter URL:');
    if (url) {
      insertMarkdown('[', `](${url})`, 'link text');
    }
  }

  function handleBulletList() {
    insertMarkdown('\n- ', '', 'list item');
  }

  function handleNumberedList() {
    insertMarkdown('\n1. ', '', 'list item');
  }

  function handleQuote() {
    insertMarkdown('\n> ', '', 'quote');
  }

  function handleCode() {
    insertMarkdown('`', '`', 'code');
  }

  function handleKeydown(e: KeyboardEvent) {
    // Cmd/Ctrl + B for bold
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      handleBold();
    }
    // Cmd/Ctrl + I for italic
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      handleItalic();
    }
    // Cmd/Ctrl + K for link
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      handleLink();
    }
  }
</script>

<div class="markdown-editor rounded-xl overflow-hidden" style="border: 1px solid var(--color-input-border); background-color: var(--color-input-bg);">
  <!-- Tabs -->
  <div class="flex border-b" style="border-color: var(--color-input-border); background-color: var(--color-input-bg);">
    <button
      type="button"
      class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'write'
        ? 'border-b-2 border-primary text-primary'
        : 'text-caption hover:text-primary'}"
      on:click={() => (activeTab = 'write')}
    >
      Write
    </button>
    <button
      type="button"
      class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'preview'
        ? 'border-b-2 border-primary text-primary'
        : 'text-caption hover:text-primary'}"
      on:click={() => (activeTab = 'preview')}
    >
      Preview
    </button>
  </div>

  {#if activeTab === 'write'}
    <!-- Toolbar -->
    <div
      class="flex gap-1 p-2 border-b"
      style="border-color: var(--color-input-border); background-color: var(--color-input-bg);"
    >
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleBold}
        title="Bold (Ctrl+B)"
      >
        <TextB size={18} weight="bold" />
      </button>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleItalic}
        title="Italic (Ctrl+I)"
      >
        <TextItalic size={18} />
      </button>
      <div class="w-px mx-1" style="background-color: var(--color-input-border);"></div>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleLink}
        title="Link (Ctrl+K)"
      >
        <Link size={18} />
      </button>
      <div class="w-px mx-1" style="background-color: var(--color-input-border);"></div>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleBulletList}
        title="Bullet List"
      >
        <ListBullets size={18} />
      </button>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleNumberedList}
        title="Numbered List"
      >
        <ListNumbers size={18} />
      </button>
      <div class="w-px mx-1" style="background-color: var(--color-input-border);"></div>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleQuote}
        title="Quote"
      >
        <Quotes size={18} />
      </button>
      <button
        type="button"
        class="p-1.5 rounded hover:bg-accent-gray transition-colors text-caption hover:text-primary"
        on:click={handleCode}
        title="Inline Code"
      >
        <Code size={18} />
      </button>
    </div>

    <!-- Textarea -->
    <textarea
      bind:this={textarea}
      bind:value
      {placeholder}
      {rows}
      on:keydown={handleKeydown}
      class="w-full p-3 resize-y border-none outline-none"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary); min-height: 150px;"
    />
  {:else}
    <!-- Preview -->
    <div
      class="prose p-4 min-h-[150px]"
      style="background-color: var(--color-input-bg); color: var(--color-text-primary);"
    >
      {#if value.trim()}
        {@html parseMarkdown(value)}
      {:else}
        <p class="text-caption italic">Nothing to preview</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .markdown-editor :global(.prose) {
    max-width: none;
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose p) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose ul),
  .markdown-editor :global(.prose ol) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose li) {
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose h1),
  .markdown-editor :global(.prose h2),
  .markdown-editor :global(.prose h3),
  .markdown-editor :global(.prose h4),
  .markdown-editor :global(.prose h5),
  .markdown-editor :global(.prose h6) {
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose strong) {
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose code) {
    color: var(--color-text-primary);
    background-color: var(--color-bg-secondary);
  }

  .markdown-editor :global(.prose pre) {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }

  .markdown-editor :global(.prose blockquote) {
    color: var(--color-text-secondary);
    border-left-color: var(--color-input-border);
  }

  .markdown-editor :global(.prose a) {
    color: var(--color-primary);
  }

  .markdown-editor :global(.prose hr) {
    border-color: var(--color-input-border);
  }
</style>
