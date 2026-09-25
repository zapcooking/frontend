import { describe, it, expect } from 'vitest';
import {
  composeNoteContent,
  imetaTagsForMedia,
  stripAttachmentUrlLines,
  attachableUrlCandidates,
  removeBareUrlOccurrence,
  capByCodePoints,
  MAX_ALT_CODEPOINTS,
  type MediaAttachment
} from './composerMedia';

describe('composeNoteContent', () => {
  it('returns trimmed prose alone when there is no media', () => {
    expect(composeNoteContent('  hello  ', [])).toBe('hello');
    expect(composeNoteContent('', [])).toBe('');
  });

  it('returns the urls alone, one per line, when there is no prose', () => {
    const media: MediaAttachment[] = [
      { url: 'https://a/1.png' },
      { url: 'https://a/2.mp4', isVideo: true }
    ];
    expect(composeNoteContent('   ', media)).toBe('https://a/1.png\nhttps://a/2.mp4');
  });

  it('joins prose and urls with one blank line', () => {
    const media: MediaAttachment[] = [{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }];
    expect(composeNoteContent('look', media)).toBe('look\n\nhttps://a/1.png\nhttps://a/2.png');
  });

  it('uses draft order as the only ordering', () => {
    // Reordered (video first) — the array is authoritative.
    const media: MediaAttachment[] = [
      { url: 'https://a/2.mp4', isVideo: true },
      { url: 'https://a/1.png' }
    ];
    expect(composeNoteContent('look', media)).toBe('look\n\nhttps://a/2.mp4\nhttps://a/1.png');
  });

  it('ignores null-ish entries and empty url slots', () => {
    const media = [
      { url: 'https://a/1.png' },
      null,
      undefined,
      { url: '' }
    ] as unknown as MediaAttachment[];
    expect(composeNoteContent('look', media)).toBe('look\n\nhttps://a/1.png');
  });

  it('keeps the wire format byte-identical to the previous append', () => {
    // The old composer built `${prose}\n\n${[...images, ...videos].join('\n')}`.
    const images = ['https://a/1.png', 'https://a/2.png'];
    const videos = ['https://a/3.mp4'];
    const media: MediaAttachment[] = [
      ...images.map((url) => ({ url, isVideo: false })),
      ...videos.map((url) => ({ url, isVideo: true }))
    ];
    const legacy = `dinner\n\n${[...images, ...videos].join('\n')}`;
    expect(composeNoteContent('dinner', media)).toBe(legacy);
  });

  it('carries a duplicate URL twice, as the text era did', () => {
    const media: MediaAttachment[] = [
      { url: 'https://a/1.png' },
      { url: 'https://a/1.png' }
    ];
    expect(composeNoteContent('twice', media)).toBe('twice\n\nhttps://a/1.png\nhttps://a/1.png');
  });
});

describe('imetaTagsForMedia', () => {
  it('emits one tag per described attachment, in draft order', () => {
    const media: MediaAttachment[] = [
      { url: 'https://a/1.png', alt: 'soup' },
      { url: 'https://a/2.png' },
      { url: 'https://a/3.png', alt: 'bread' }
    ];
    expect(imetaTagsForMedia(media)).toEqual([
      ['imeta', 'url https://a/1.png', 'alt soup'],
      ['imeta', 'url https://a/3.png', 'alt bread']
    ]);
  });

  it('emits nothing when no attachment is described', () => {
    const media: MediaAttachment[] = [{ url: 'https://a/1.png' }, { url: 'https://a/2.mp4', isVideo: true }];
    expect(imetaTagsForMedia(media)).toEqual([]);
  });

  it('never emits a tag for a whitespace-only description', () => {
    expect(imetaTagsForMedia([{ url: 'https://a/1.png', alt: '   \n  ' }])).toEqual([]);
    expect(imetaTagsForMedia([{ url: 'https://a/1.png', alt: '' }])).toEqual([]);
  });

  it('caps alt by code points, never splitting a surrogate pair', () => {
    // 1999 a's + three emoji = 2002 code points; the cap must land on 2000
    // with the last emoji intact, not halfway through its surrogate pair.
    const long = 'a'.repeat(1999) + '🎉🎉🎉';
    const [tag] = imetaTagsForMedia([{ url: 'https://a/1.png', alt: long }]);
    expect(tag).toBeDefined();
    const alt = tag![2];
    expect(alt.startsWith('alt ')).toBe(true);
    const body = alt.slice(4);
    expect(Array.from(body).length).toBe(MAX_ALT_CODEPOINTS);
    expect(body).toBe('a'.repeat(1999) + '🎉');
    // No lone surrogate at the boundary.
    expect(body.endsWith('🎉')).toBe(true);
  });

  it('normalizes alt line breaks the way the feed parser expects', () => {
    const [tag] = imetaTagsForMedia([{ url: 'https://a/1.png', alt: 'line one\r\n\r\n\r\nline two' }]);
    expect(tag![2]).toBe('alt line one\n\nline two');
  });

  it('dedupes by URL: one tag per picture even when attached twice', () => {
    const media: MediaAttachment[] = [
      { url: 'https://a/1.png', alt: 'soup' },
      { url: 'https://a/1.png', alt: 'soup' },
      { url: 'https://a/2.png', alt: 'bread' }
    ];
    expect(imetaTagsForMedia(media)).toEqual([
      ['imeta', 'url https://a/1.png', 'alt soup'],
      ['imeta', 'url https://a/2.png', 'alt bread']
    ]);
  });

  it('lets a later described occurrence supply the alt of an undescribed duplicate', () => {
    const media: MediaAttachment[] = [
      { url: 'https://a/1.png' },
      { url: 'https://a/1.png', alt: 'soup' }
    ];
    expect(imetaTagsForMedia(media)).toEqual([['imeta', 'url https://a/1.png', 'alt soup']]);
  });
});

describe('capByCodePoints', () => {
  it('counts characters, not code units', () => {
    expect(capByCodePoints('🎉🎉🎉🎉', 2)).toBe('🎉🎉');
    expect(Array.from(capByCodePoints('a🎉b', 3)).length).toBe(3);
  });
});

describe('stripAttachmentUrlLines', () => {
  const urls = ['https://a/1.png', 'https://a/2.mp4'];

  it('strips a line that is exactly an attachment url', () => {
    expect(stripAttachmentUrlLines('dinner\n\nhttps://a/1.png', urls)).toBe('dinner\n');
  });

  it('strips every boundary occurrence of every url', () => {
    expect(stripAttachmentUrlLines('https://a/1.png\nmid\nhttps://a/2.mp4', urls)).toBe('mid');
  });

  it('keeps a url a person deliberately wrote inside a sentence', () => {
    const text = 'mirror at https://a/1.png if the first dies';
    expect(stripAttachmentUrlLines(text, urls)).toBe(text);
  });

  it('leaves a url that appears twice on one line', () => {
    const text = 'https://a/1.png https://a/1.png';
    expect(stripAttachmentUrlLines(text, urls)).toBe(text);
  });

  it('returns the original text untouched when nothing matches', () => {
    const text = 'just prose\nand more prose';
    expect(stripAttachmentUrlLines(text, urls)).toBe(text);
    expect(stripAttachmentUrlLines('', urls)).toBe('');
    expect(stripAttachmentUrlLines(text, [])).toBe(text);
  });
});

describe('attachableUrlCandidates', () => {
  it('offers every URL on a URL-only line, in order', () => {
    expect(attachableUrlCandidates('https://a/1.png https://a/2.mp4')).toEqual([
      'https://a/1.png',
      'https://a/2.mp4'
    ]);
  });

  it('offers each occurrence of a duplicate paste', () => {
    expect(attachableUrlCandidates('https://a/1.png\nhttps://a/1.png')).toEqual([
      'https://a/1.png',
      'https://a/1.png'
    ]);
  });

  it('skips prose lines entirely — a URL inside a sentence is never offered', () => {
    expect(attachableUrlCandidates('mirror at https://a/1.png if the first dies')).toEqual([]);
  });

  it('mixes: only the URL-only lines contribute', () => {
    const text = 'check this\nhttps://a/1.png\nmore words here\nhttps://a/2.png https://a/3.mp4';
    expect(attachableUrlCandidates(text)).toEqual([
      'https://a/1.png',
      'https://a/2.png',
      'https://a/3.mp4'
    ]);
  });

  it('ignores non-http(s) tokens, empty and prose-only text', () => {
    expect(attachableUrlCandidates('ftp://a/1.png')).toEqual([]);
    expect(attachableUrlCandidates('')).toEqual([]);
    expect(attachableUrlCandidates('just saying hi')).toEqual([]);
  });
});

describe('removeBareUrlOccurrence', () => {
  it('consumes one occurrence and removes the emptied line entirely', () => {
    expect(removeBareUrlOccurrence('para\nhttps://a/1.png\npara2', 'https://a/1.png')).toBe(
      'para\npara2'
    );
  });

  it('keeps the other tokens on a multi-URL line', () => {
    expect(removeBareUrlOccurrence('https://a/1.png https://a/2.png', 'https://a/1.png')).toBe(
      'https://a/2.png'
    );
  });

  it('consumes only the first occurrence of a duplicate', () => {
    expect(removeBareUrlOccurrence('https://a/1.png\nhttps://a/1.png', 'https://a/1.png')).toBe(
      'https://a/1.png'
    );
  });

  it('never touches a URL on a prose line', () => {
    const text = 'mirror at https://a/1.png if the first dies';
    expect(removeBareUrlOccurrence(text, 'https://a/1.png')).toBe(text);
  });

  it('returns the original text when there is nothing to consume', () => {
    expect(removeBareUrlOccurrence('para', 'https://a/1.png')).toBe('para');
    expect(removeBareUrlOccurrence('', 'https://a/1.png')).toBe('');
  });
});
