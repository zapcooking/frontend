import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import type { ShortenedURL } from '$lib/shortlinks/types';
import { normalizeShortCode } from '$lib/shortlinks/code';
import { redirectPath } from '$lib/shortlinks/parse.server';

export const load: PageServerLoad = async ({ params, platform }) => {
  const kv = platform?.env?.SHORTLINKS;
  if (!kv) {
    return { record: null, targetPath: null, error: 'Short links are not configured' };
  }

  const code = params?.code?.trim();
  if (!code) {
    throw redirect(302, '/recent');
  }

  const key = normalizeShortCode(code);
  const record = await kv.get(key, 'json') as ShortenedURL | null;
  if (!record) {
    throw redirect(302, '/recent');
  }

  const targetPath = redirectPath(record.naddr, record.type);
  return { record, targetPath, error: null };
};
