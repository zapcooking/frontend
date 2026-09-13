declare module 'google-translate-api-browser' {
  export interface GoogleTranslateResult {
    text: string;
    from: { language: { iso: string } };
  }

  export function translate(
    text: string,
    options?: {
      corsUrl?: string;
      to?: string;
      from?: string;
      raw?: boolean;
    }
  ): Promise<GoogleTranslateResult>;
}
