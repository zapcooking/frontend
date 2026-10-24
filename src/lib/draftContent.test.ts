import { describe, it, expect } from 'vitest';
import { hasRecipeDraftContent, hasArticleDraftContent } from './draftContent';

const emptyRecipe: Parameters<typeof hasRecipeDraftContent>[0] = {
  title: '',
  images: [],
  tags: [],
  summary: '',
  chefsnotes: '',
  preptime: '',
  cooktime: '',
  servings: '',
  ingredients: [],
  directions: [],
  additionalMarkdown: ''
};

const emptyArticle = { title: '', subtitle: '', content: '', coverImage: '', tags: [] as string[] };

describe('hasRecipeDraftContent', () => {
  it('is false for an untouched form', () => {
    expect(hasRecipeDraftContent(emptyRecipe)).toBe(false);
  });

  it('treats whitespace-only fields and blank list entries as empty', () => {
    expect(
      hasRecipeDraftContent({
        ...emptyRecipe,
        title: '   ',
        ingredients: ['', '  '],
        directions: [''],
        images: ['']
      })
    ).toBe(false);
  });

  const singleRecipeFields: Array<[string, Partial<typeof emptyRecipe>]> = [
    ['title', { title: 'Soup' }],
    ['image', { images: ['https://x/y.jpg'] }],
    ['tag', { tags: [{ title: 'Dinner' }] }],
    ['summary', { summary: 'quick' }],
    ["chef's notes", { chefsnotes: 'n' }],
    ['prep time', { preptime: '5' }],
    ['cook time', { cooktime: '10' }],
    ['servings', { servings: '2' }],
    ['ingredient', { ingredients: ['', 'salt'] }],
    ['direction', { directions: ['stir'] }],
    ['additional markdown', { additionalMarkdown: '## Tips' }]
  ];
  for (const [label, fields] of singleRecipeFields) {
    it(`is true when only the ${label} is filled`, () => {
      expect(hasRecipeDraftContent({ ...emptyRecipe, ...fields })).toBe(true);
    });
  }

  it('tolerates a partial object from an older stored shape', () => {
    expect(hasRecipeDraftContent({ title: 'x' })).toBe(true);
    expect(hasRecipeDraftContent({})).toBe(false);
  });
});

describe('hasArticleDraftContent', () => {
  it('is false for a freshly created draft', () => {
    expect(hasArticleDraftContent(emptyArticle)).toBe(false);
  });

  it('is false for the editor\'s empty paragraph markup', () => {
    expect(hasArticleDraftContent({ ...emptyArticle, content: '<p></p>' })).toBe(false);
    expect(hasArticleDraftContent({ ...emptyArticle, content: '<p>   </p><p></p>' })).toBe(false);
  });

  const singleArticleFields: Array<[string, Partial<typeof emptyArticle>]> = [
    ['title', { title: 'Hello' }],
    ['subtitle', { subtitle: 'sub' }],
    ['cover image', { coverImage: 'https://x/c.jpg' }],
    ['tag', { tags: ['', 'food'] }],
    ['body text', { content: '<p>one word</p>' }],
    ['embedded image', { content: '<p></p><img src="https://x/a.png">' }],
    ['embedded video', { content: '<video src="https://x/a.mp4"></video>' }]
  ];
  for (const [label, fields] of singleArticleFields) {
    it(`is true when only the ${label} is present`, () => {
      expect(hasArticleDraftContent({ ...emptyArticle, ...fields })).toBe(true);
    });
  }
});
