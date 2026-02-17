import { setCORS as googletranslate } from 'google-translate-api-browser';
import type { TranslateOption } from './state';
//import { translate as libretranslate } from 'libretranslate';

type TranslationResult = {
  text: string;
  from: { language: { iso: string } };
};

export async function translate(
  translateOption: TranslateOption,
  string: string
): Promise<TranslationResult | ''> {
  if (translateOption.option == 'google') {
    const gTranslate = googletranslate(translateOption.data) as (
      text: string,
      options: { to: string }
    ) => Promise<TranslationResult>;
    const e = await gTranslate(string, { to: translateOption.lang });
    return e;
  }
  /*if (translateOption.option == 'libretranslate') {
    const e = await libretranslate({
        query: string,
        target: translateOption.lang,
        apiurl: translateOption.data,
    });
    return e;
  }*/

  return '';
}
