import { translate as googletranslate } from 'google-translate-api-browser';
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
    const e = await googletranslate(string, {
      corsUrl: translateOption.data,
      to: translateOption.lang
    });
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
