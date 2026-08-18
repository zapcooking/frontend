import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('focused thread engagement details', () => {
  it('opts parent notes into the drawer without enabling every compact action bar', () => {
    const actionBar = readFileSync('src/components/NoteActionBar.svelte', 'utf8');
    const focusedNote = readFileSync('src/routes/[nip19]/+page.svelte', 'utf8');

    expect(actionBar).toContain(
      'export let showEngagementDetails: boolean | undefined = undefined'
    );
    expect(actionBar).toContain('showEngagementDetails ?? !isCompact');
    expect(focusedNote).toMatch(
      /<NoteActionBar\s+event=\{parentNote\}\s+variant="compact"\s+showEngagementDetails=\{true\}/
    );
    expect(focusedNote).toContain('<NoteActionBar event={nestedReply} variant="compact" />');
  });
});
