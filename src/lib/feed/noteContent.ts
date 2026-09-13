const QUOTED_NOTE_REFERENCE =
  /nostr:(?:nevent1[023456789acdefghjklmnpqrstuvwxyz]+|note1[023456789acdefghjklmnpqrstuvwxyz]+)/g;

/** Remove embedded quote references without collapsing the author's line breaks. */
export function stripQuotedNoteReferences(content: string): string {
  if (!content) return '';

  return content.replace(QUOTED_NOTE_REFERENCE, '').trim();
}
