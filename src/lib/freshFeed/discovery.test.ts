import { describe, it, expect } from 'vitest';
import {
  suggestedRows,
  isQuestion,
  firstImage,
  pickConversation,
  conversationPool,
  SUGGESTED_SHOWN,
  TOP_ROWS_EXCLUDED,
  type ConversationCandidate
} from './discovery';
import { parseSuggested } from './topicList';

const NOW = 1_760_000_000;
const H = 3600;

describe('suggestedRows', () => {
  it("keeps the relay's order: name, blurb, picture and the 14-day pill", () => {
    const list = parseSuggested({
      topics: {
        suggested: [
          { slug: 'soups-stews', label: 'Soups & stews', count_14d: 35 },
          {
            slug: 'beer',
            label: 'Beer & brewing',
            blurb: 'Brewed, poured, shared.',
            image: 'https://img.example/beer.jpg',
            count_14d: 11
          },
          { slug: 'tea', label: 'Tea' }
        ]
      }
    });
    expect(suggestedRows(list)).toEqual([
      { slug: 'soups-stews', name: 'Soups & stews', blurb: '', image: '', pill: '35 new' },
      {
        slug: 'beer',
        name: 'Beer & brewing',
        blurb: 'Brewed, poured, shared.',
        image: 'https://img.example/beer.jpg',
        pill: '11 new'
      },
      { slug: 'tea', name: 'Tea', blurb: '', image: '', pill: '' }
    ]);
  });

  it(`shows the first ${SUGGESTED_SHOWN}, in order`, () => {
    const list = parseSuggested({
      topics: {
        suggested: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((slug) => ({
          slug,
          label: slug.toUpperCase()
        }))
      }
    });
    expect(suggestedRows(list).map((r) => r.slug)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('has no rows (the section hides) when the list is missing, empty or malformed', () => {
    expect(suggestedRows(parseSuggested({ topics: {} }))).toEqual([]);
    expect(suggestedRows(parseSuggested(null))).toEqual([]);
    expect(suggestedRows(parseSuggested({ topics: { suggested: [] } }))).toEqual([]);
    expect(suggestedRows(parseSuggested({ topics: { suggested: 'x' } }))).toEqual([]);
    expect(suggestedRows(null)).toEqual([]);
  });
});

describe('parseSuggested', () => {
  it('drops bad entries and repeats, trims labels and blurbs, keeps only web pictures', () => {
    expect(
      parseSuggested({
        topics: {
          suggested: [
            { slug: 'Bad Slug', label: 'x' },
            { slug: 'ok', label: '  ' },
            null,
            {
              slug: 'beef',
              label: ' Beef ',
              blurb: '  ',
              image: 'javascript:alert(1)',
              count_14d: '40'
            },
            { slug: 'beef', label: 'Beef again' },
            { slug: 'pasta', label: 'Pasta', image: ' https://img.example/p.webp ' }
          ]
        }
      })
    ).toEqual([
      { slug: 'beef', label: 'Beef', count14d: 40 },
      { slug: 'pasta', label: 'Pasta', image: 'https://img.example/p.webp', count14d: 0 }
    ]);
    expect(parseSuggested({ topics: {} })).toBeNull();
  });
});

describe('firstImage', () => {
  it('takes the image tag, else the first image link, else nothing', () => {
    expect(
      firstImage({
        tags: [['image', 'https://a.example/t.jpg']],
        content: 'x https://b.example/c.png'
      })
    ).toBe('https://a.example/t.jpg');
    expect(
      firstImage({ tags: [], content: 'Look https://b.example/page https://b.example/c.png' })
    ).toBe('https://b.example/c.png');
    expect(firstImage({ tags: [], content: 'Just words?' })).toBe('');
  });
});

describe('isQuestion', () => {
  it('counts a ? in the words, not in links, references or tags', () => {
    expect(isQuestion('What do I do with all this zucchini?')).toBe(true);
    expect(isQuestion('どうやって作るの？')).toBe(true);
    expect(isQuestion('Dinner https://x.com/a?b=1 #what?')).toBe(false);
    expect(isQuestion('Look nostr:nevent1abc')).toBe(false);
  });
});

/** The feed's first rows (never picked), then the given posts. */
function feed(...rest: Partial<ConversationCandidate>[]): ConversationCandidate[] {
  const top = Array.from({ length: TOP_ROWS_EXCLUDED }, (_, i) => ({
    id: `top${i}`,
    kind: 1,
    createdAt: NOW - H,
    content: 'Anyone else cooking tonight?',
    replies: 50
  }));
  return [
    ...top,
    ...rest.map((r, i) => ({
      id: `p${i}`,
      kind: 1,
      createdAt: NOW - 2 * H,
      content: 'Soup.',
      replies: 3,
      ...r
    }))
  ];
}

describe('pickConversation', () => {
  it('never picks a post near the top of the feed or one already on screen', () => {
    const list = feed({ id: 'a', replies: 9 }, { id: 'b', replies: 4 });
    expect(pickConversation(list, new Set(), NOW)).toBe('a');
    expect(pickConversation(list, new Set(['a']), NOW)).toBe('b');
    expect(pickConversation(list, new Set(['a', 'b']), NOW)).toBeNull();
  });

  it('is null (the section is omitted) when nothing qualifies', () => {
    expect(pickConversation([], new Set(), NOW)).toBeNull();
    expect(
      pickConversation(
        feed(
          { id: 'old', createdAt: NOW - 49 * H, replies: 20 },
          { id: 'quiet', replies: 1 },
          { id: 'unknown', replies: null },
          { id: 'recipe', kind: 30023, replies: 20 },
          { id: 'poll', kind: 1068, replies: 20 }
        ),
        new Set(),
        NOW
      )
    ).toBeNull();
  });

  it('prefers a question, then the most replies, then the newest', () => {
    const list = feed(
      { id: 'busy', replies: 12 },
      { id: 'ask', content: 'How long do you rest a brisket?', replies: 2 },
      { id: 'ask-more', content: 'Salt before or after?', replies: 5, createdAt: NOW - 30 * H }
    );
    expect(pickConversation(list, new Set(), NOW)).toBe('ask-more');
    expect(pickConversation(list, new Set(['ask-more']), NOW)).toBe('ask');
    expect(pickConversation(list, new Set(['ask-more', 'ask']), NOW)).toBe('busy');
    const tie = feed(
      { id: 'older', createdAt: NOW - 10 * H },
      { id: 'newer', createdAt: NOW - 5 * H }
    );
    expect(pickConversation(tie, new Set(), NOW)).toBe('newer');
  });

  it('fetches reply counts only for notes in the window, past the top rows', () => {
    const list = feed(
      { id: 'a' },
      { id: 'old', createdAt: NOW - 49 * H },
      { id: 'r', kind: 30023 }
    );
    expect(conversationPool(list, NOW)).toEqual(['a']);
  });
});
