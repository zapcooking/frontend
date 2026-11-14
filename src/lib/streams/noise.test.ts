import { describe, expect, it } from 'vitest';
import { isEmptyShell, isPastNoise, isTestStream, isUntitledWithoutReplay } from './noise';

const item = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  categories: [] as string[],
  recording: null as string | null,
  image: null as string | null,
  thumb: null as string | null,
  ...extra
});

describe('isTestStream', () => {
  for (const title of [
    'Test',
    'test',
    'Test A',
    'Test B',
    'Test D',
    'Test 2',
    'Testing',
    'testing 1 2 3',
    'Test stream',
    'Stream test',
    'Livestream testing',
    'Canary stage (automated test)',
    '[test] kickoff'
  ]) {
    it(`flags ${title}`, () => {
      expect(isTestStream(item(title))).toBe(true);
    });
  }

  for (const title of [
    'Test Kitchen Live',
    'Blind taste test: store-bought vs homemade',
    'Contesting the sourdough starter',
    'Latest bread bake',
    'Cooking with Chef Test',
    'Early morning bull shit again'
  ]) {
    it(`keeps ${title}`, () => {
      expect(isTestStream(item(title))).toBe(false);
    });
  }

  it('flags a test tag', () => {
    expect(isTestStream(item('Dinner', { categories: ['Test'] }))).toBe(true);
    expect(isTestStream(item('Dinner', { categories: ['cooking'] }))).toBe(false);
  });
});

describe('isPastNoise', () => {
  const replay = 'https://cdn.example.com/a.m3u8';

  it('hides an empty shell', () => {
    expect(isEmptyShell(item('Real title'))).toBe(true);
    expect(isPastNoise(item('Real title'))).toBe(true);
  });

  it('hides an untitled stream with no replay, even with a picture', () => {
    const untitled = item('Untitled livestream', { image: 'https://x.test/i.png' });
    expect(isUntitledWithoutReplay(untitled)).toBe(true);
    expect(isPastNoise(untitled)).toBe(true);
  });

  it('keeps an untitled stream that has a replay', () => {
    expect(isPastNoise(item('Untitled livestream', { recording: replay }))).toBe(false);
  });

  it('keeps a titled stream with a picture but no replay', () => {
    expect(isPastNoise(item('Sunday roast', { image: 'https://x.test/i.png' }))).toBe(false);
  });

  it('hides a test run even when it has a replay', () => {
    expect(isPastNoise(item('Canary stage (automated test)', { recording: replay }))).toBe(true);
  });

  it('keeps a normal replay', () => {
    expect(isPastNoise(item('The System is Splitting', { recording: replay, image: 'https://x.test/i.png' }))).toBe(false);
  });
});
