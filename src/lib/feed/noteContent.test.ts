import { describe, expect, it } from 'vitest';
import { stripQuotedNoteReferences } from './noteContent';

const NEVENT =
  'nostr:nevent1qvzqqqqqqypzqvv660neqc6dh6r0zndec2v4kfhw833z30j4lzwycll2ntxqr4g2qy88wumn8ghj7mn0wvhxcmmv9uq3wamnwvaz7tmjv4kxz7fwwpexjmtpdshxuet59uqzpwelkuhmeara2plp6xpapjk3m9hvzzsapqtfq2wmfjk6k7euzjdscjpx7f';

describe('stripQuotedNoteReferences', () => {
  it('preserves paragraphs and profile mentions when removing a quoted event', () => {
    const content =
      'What do you call a sauce recipe on nostr:npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a? \n\nOpen sauce. 🍝\n' +
      NEVENT;

    expect(stripQuotedNoteReferences(content)).toBe(
      'What do you call a sauce recipe on nostr:npub1xxdd8eusvdxmaph3fkuu9x2mymhrcc3ghe2l38zv0l4f4nqp659qskkt7a? \n\nOpen sauce. 🍝'
    );
  });

  it('preserves line breaks after a leading quote reference', () => {
    expect(stripQuotedNoteReferences(`${NEVENT}\nFirst paragraph\n\nSecond paragraph`)).toBe(
      'First paragraph\n\nSecond paragraph'
    );
  });

  it('removes note references without changing ordinary spacing', () => {
    const note = `nostr:note1${'q'.repeat(58)}`;

    expect(stripQuotedNoteReferences(`Keep  these words\n${note}`)).toBe('Keep  these words');
  });
});
