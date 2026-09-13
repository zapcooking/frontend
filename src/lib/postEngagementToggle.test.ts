import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('focused thread engagement details', () => {
  it('opts parent notes into the drawer without enabling every compact action bar', () => {
    const actionBar = readFileSync('src/components/NoteActionBar.svelte', 'utf8');
    const focusedNote = readFileSync('src/routes/[nip19]/+page.svelte', 'utf8');
    // Replies moved into ThreadRow.svelte when the thread became a
    // flattened list; the rule they have to keep is the same one.
    const threadRow = readFileSync('src/components/comments/ThreadRow.svelte', 'utf8');

    expect(actionBar).toContain(
      'export let showEngagementDetails: boolean | undefined = undefined'
    );
    expect(actionBar).toContain('showEngagementDetails ?? !isCompact');
    expect(focusedNote).toMatch(
      /<NoteActionBar\s+event=\{parentNote\}\s+variant="compact"\s+showEngagementDetails=\{true\}/
    );
    // A nested reply's action bar stays compact and opts into nothing:
    // the drawer belongs to the note being focused, not to every row.
    expect(threadRow).toContain('<NoteActionBar {event}');
    expect(threadRow).toContain("variant={isReply ? 'compact' : 'default'}");
    expect(threadRow).not.toContain('showEngagementDetails');
  });
});
