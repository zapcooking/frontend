import { describe, it, expect } from 'vitest';
import {
  isDefaultLiveTitle,
  LIVE_DEFAULT_TITLE,
  liveRecipeName,
  liveStreamName
} from './streamName';

describe('liveStreamName', () => {
  it('with a recipe: "<host> is cooking <recipe>"', () => {
    expect(
      liveStreamName({
        title: 'Refried Beans',
        hasRecipe: true,
        recipeTitle: 'Refried Beans',
        hostName: 'Seth'
      })
    ).toBe('Seth is cooking Refried Beans');
  });

  it('uses the fetched recipe title over the stored one', () => {
    expect(
      liveStreamName({
        title: 'old',
        hasRecipe: true,
        recipeTitle: 'Refried Beans',
        hostName: 'Seth'
      })
    ).toBe('Seth is cooking Refried Beans');
  });

  it('without the host name: "Cooking <recipe>"', () => {
    expect(liveStreamName({ title: 'Refried Beans', hasRecipe: true, hostName: null })).toBe(
      'Cooking Refried Beans'
    );
    expect(liveStreamName({ title: 'Refried Beans', hasRecipe: true, hostName: '   ' })).toBe(
      'Cooking Refried Beans'
    );
  });

  it('without a recipe: the typed title, or Live from Zap Cooking for the default', () => {
    expect(liveStreamName({ title: 'Taco Tuesday', hasRecipe: false, hostName: 'Seth' })).toBe(
      'Taco Tuesday'
    );
    for (const t of ['Live cook-along', 'live from zap cooking', '', '  ']) {
      expect(liveStreamName({ title: t, hasRecipe: false, hostName: 'Seth' })).toBe(
        LIVE_DEFAULT_TITLE
      );
    }
  });

  it('a recipe stream whose stored title is the default and recipe is unknown reads as Live from Zap Cooking', () => {
    expect(liveStreamName({ title: 'Live cook-along', hasRecipe: true, hostName: 'Seth' })).toBe(
      LIVE_DEFAULT_TITLE
    );
    expect(liveRecipeName({ title: 'Live cook-along', hasRecipe: true })).toBeNull();
  });

  it('collapses whitespace in names', () => {
    expect(
      liveStreamName({
        title: 'x',
        hasRecipe: true,
        recipeTitle: ' Refried\n Beans ',
        hostName: ' Seth  S '
      })
    ).toBe('Seth S is cooking Refried Beans');
  });

  it('never says Live cook-along', () => {
    expect(isDefaultLiveTitle('Live cook-along')).toBe(true);
    expect(liveStreamName({ title: 'Live cook-along', hasRecipe: false })).not.toMatch(
      /cook-along/i
    );
  });
});
