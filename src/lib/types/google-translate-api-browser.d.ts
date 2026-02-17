declare module 'google-translate-api-browser' {
  export interface GoogleTranslateResult {
    text: string;
    from: { language: { iso: string } };
  }

  export function setCORS(
    apiUrl?: string
  ): (text: string, options: { to: string }) => Promise<GoogleTranslateResult>;
}
