import { describe, expect, it } from 'vitest';
import { EXPLORE_STYLES } from './themeStyles';

describe('mood registry', () => {
  it('always lists Cast Iron last', () => {
    expect(EXPLORE_STYLES.at(-1)?.value).toBe('cast-iron');
    expect(EXPLORE_STYLES.filter((style) => style.value === 'cast-iron')).toHaveLength(1);
  });

  it('keeps Zap Original first as the default', () => {
    expect(EXPLORE_STYLES[0].value).toBe('original');
  });
});
