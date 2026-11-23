# Composer editing: the editor matrix

Every composer in this app, and any field where typed text has to come out exactly as it was
written, is checked against **[editor-matrix](https://github.com/dmnyc/editor-matrix)**: one
list of text-editing cases shared by Zap Cooking (web, iOS, Android) and Sidecar, run with real
input. Read this before changing a composer, and run the matrix before and after the change.

## Why

The composer bugs that reach people are ordinary text editing nobody checked: a space or a
blank line typed at the start of a note disappears, a word typed against a mention joins the
mention, Delete in front of a mention does nothing, rich text pasted or dragged in from a web
page keeps its fonts and colors, Undo after clearing the box brings nothing back. A person
expects every text box to behave like Notes or TextEdit. The matrix writes that expectation
down as cases, so a change is checked against all of it, not only the case that prompted it.

## What it covers here

- **Notes:** `src/components/PostComposer.svelte` (`contenteditable`, with its own paste
  and drop handling), state in `src/lib/postComposerStore.ts`, mentions in
  `src/lib/mentionComposer.ts`, `src/lib/mentionUtils.ts` and `src/components/MentionDropdown.svelte`.
- **Replies and comments:** `src/components/comments/ReplyComposer.svelte`.
- **Long-form articles:** `src/components/reads/TiptapEditor.svelte` (TipTap) with
  `src/components/reads/EditorToolbar.svelte`, `LongformEditorModal.svelte` and
  `src/lib/articleEditor.ts`.
- **Recipes:** `src/routes/create/+page.svelte` and `src/components/MarkdownEditor.svelte`
  (textareas that become the recipe's markdown sections).
- Any other field whose text is published as written: alt text
  (`src/components/AltTextEditorModal.svelte`), list descriptions, profile fields.

## The text that is checked

A case compares **the text the app would publish or save as a draft**, not what the screen
shows. For a note or a reply, that is the event's `content`. For an article, the markdown the
TipTap editor writes. For a recipe, the markdown built from its fields (`## Ingredients`
lines, numbered `## Directions`). A screen that shows one thing and publishes another fails.

## How to use it

1. Clone it beside this repository: `git clone https://github.com/dmnyc/editor-matrix`.
   `cases.js` is the list; `cases.json` is the same list for non-JavaScript runners.
2. This app has no adapter yet; the first composer change writes one (`adapters/zapcooking-web.js`
   in editor-matrix). Start the dev server, open each composer route in a fresh browser
   profile signed in with a throwaway key, drive it with `lib/web.js` (real keys, the real
   clipboard, real drag and drop in Chrome), and read the text from the function that builds
   the event, never from `innerText`. `adapters/sidecar.js` is a complete example, and
   `docs/writing-an-adapter.md` in editor-matrix describes the contract.
3. Run the matrix on the unchanged code first, so you know which failures were already
   there, then again after the change. A change to a composer does not add failures.
4. A composer bug that no case caught gets a case in editor-matrix, added before the fix and
   seen to fail. Keep cases app-neutral; behavior only this app has (mention chips, recipe
   sections) is tested in this repository.
5. When a case fails, decide whether the app is wrong or the expectation is. The reference is
   platform editing behavior (macOS and iOS for the shared expectations); a case whose
   expectation is wrong is fixed in editor-matrix with its reason, never skipped quietly.

## Where composers usually break

From the first full run against Sidecar's composers (Chrome and Firefox), the areas worth
checking first in any composer:

- **An empty editor.** Clearing the box when its trimmed text is empty eats a leading space
  or blank line as it is typed, and resetting its contents wipes the undo history (Select
  All, Delete, Undo then restores nothing).
- **Line breaks.** A first line, blank lines between paragraphs, a last empty line: each must
  survive a save and reopen, and serialize to the same `\n`s that were typed.
- **Paste.** Rich text must arrive as plain text (or as the markdown the editor writes), a
  clipboard holding only HTML must still paste its text, Windows line endings (`\r\n`) must
  not leave a stray `\r`, and a picture inside copied HTML must not sit inline unuploaded.
- **Drag and drop.** Text dragged in from a page bypasses the paste handler entirely; an
  editor that cleans paste but not drop shows bold, colored text it will not publish.
- **Mentions and other inline tokens.** Typing, deleting and moving the caret at either edge
  of a mention, and what is copied when a mention is selected.
- **Emoji and other scripts.** Backspace removes a whole emoji (flags, skin tones, family
  sequences), word moves work in Cyrillic and accented text, and right-to-left text keeps
  its direction.
