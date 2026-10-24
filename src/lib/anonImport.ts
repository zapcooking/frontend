/** Session-scoped recipe staging, shared by the landing form and editor. */
export interface NormalizedRecipe {
  title: string;
  summary: string;
  chefsnotes: string;
  preptime: string;
  cooktime: string;
  servings: string;
  ingredients: string[];
  directions: string[];
  tags: string[];
  imageUrls: string[];
}

export const ANON_IMPORT_HANDOFF_KEY = 'zapcooking:anon-import-handoff';
export const ANON_IMPORT_INPUT_KEY = 'zapcooking:anon-import-url';
// A full day allows time to sign in and review. Data remains confined to this tab.
export const ANON_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface AnonImportHandoff {
  recipe: NormalizedRecipe;
  sourceUrl: string;
  additionalMarkdown?: string;
  at: number;
}

export function sourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function readImportHandoff(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  now = Date.now()
): AnonImportHandoff | null {
  try {
    const raw = storage.getItem(ANON_IMPORT_HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as AnonImportHandoff;
    const r = data?.recipe;
    const valid =
      data &&
      typeof data.at === 'number' &&
      data.at <= now &&
      now - data.at <= ANON_IMPORT_MAX_AGE_MS &&
      typeof data.sourceUrl === 'string' &&
      !!sourceUrl(data.sourceUrl) &&
      (data.additionalMarkdown === undefined || typeof data.additionalMarkdown === 'string') &&
      r &&
      ['title', 'summary', 'chefsnotes', 'preptime', 'cooktime', 'servings'].every(
        (k) => typeof r[k as keyof NormalizedRecipe] === 'string'
      ) &&
      ['ingredients', 'directions', 'tags', 'imageUrls'].every(
        (k) =>
          Array.isArray(r[k as keyof NormalizedRecipe]) &&
          (r[k as keyof NormalizedRecipe] as unknown[]).every((v) => typeof v === 'string')
      );
    if (valid) return data;
    storage.removeItem(ANON_IMPORT_HANDOFF_KEY);
  } catch {
    /* Invalid or unavailable storage cannot break the editor. */
  }
  return null;
}

/** Returns false when storage is unavailable, so navigation can be stopped. */
export function writeImportHandoff(
  storage: Pick<Storage, 'setItem'>,
  data: AnonImportHandoff
): boolean {
  try {
    storage.setItem(ANON_IMPORT_HANDOFF_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Visible attribution survives draft editing and publishing via the existing markdown field. */
export function withSourceAttribution(markdown: string, raw: string): string {
  const url = sourceUrl(raw);
  if (!url) return markdown;
  const line = `Original recipe: <${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
  return markdown.includes(line) ? markdown : `${markdown.trim()}\n\n${line}`.trim();
}
