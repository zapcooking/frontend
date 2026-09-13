import type { TranslateOption } from './state';

type TranslationResult = {
  text: string;
  from: { language: { iso: string } };
};

export async function translate(
  translateOption: TranslateOption,
  string: string
): Promise<TranslationResult | ''> {
  if (translateOption.option == 'google') {
    // Lazy-load the translator so it only downloads when a user actually
    // translates something, instead of riding along on every recipe page
    // load.
    const { translate: googletranslate } = await import('google-translate-api-browser');
    const e = await googletranslate(string, {
      corsUrl: translateOption.data,
      to: translateOption.lang
    });
    return e;
  }

  return '';
}
