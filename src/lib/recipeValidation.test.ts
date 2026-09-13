import { describe, it, expect } from 'vitest';
import { getMissingFields, type RecipeRequiredFields } from './recipeValidation';

function complete(): RecipeRequiredFields {
  return {
    title: 'Beef Wellington',
    tags: [{ title: 'beef' }],
    ingredients: ['1 lb beef tenderloin'],
    directions: ['Sear the beef on all sides'],
    images: ['https://example.com/wellington.jpg']
  };
}

describe('getMissingFields', () => {
  it('returns an empty list when every field is present', () => {
    expect(getMissingFields(complete())).toEqual([]);
  });

  it('reports a missing title', () => {
    expect(getMissingFields({ ...complete(), title: '' })).toEqual(['a title']);
  });

  it('treats a whitespace-only title as missing', () => {
    // Previously a truthy check let "   " through, producing a d tag of
    // pure dashes. Behavior change: trim before counting the title.
    expect(getMissingFields({ ...complete(), title: '   ' })).toEqual(['a title']);
  });

  it('reports missing tags', () => {
    expect(getMissingFields({ ...complete(), tags: [] })).toEqual(['at least one tag']);
  });

  it('reports missing ingredients', () => {
    expect(getMissingFields({ ...complete(), ingredients: [] })).toEqual(['ingredients']);
  });

  it('reports missing directions', () => {
    expect(getMissingFields({ ...complete(), directions: [] })).toEqual(['directions']);
  });

  it('reports a missing photo', () => {
    expect(getMissingFields({ ...complete(), images: [] })).toEqual(['a photo']);
  });

  it('reports several missing fields in stable order', () => {
    expect(
      getMissingFields({ ...complete(), tags: [], directions: [], images: [] })
    ).toEqual(['at least one tag', 'directions', 'a photo']);
  });

  it('reports all five fields for an empty form', () => {
    expect(
      getMissingFields({ title: '', tags: [], ingredients: [], directions: [], images: [] })
    ).toEqual(['a title', 'at least one tag', 'ingredients', 'directions', 'a photo']);
  });
});
