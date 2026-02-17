declare module 'svelte-qrcode' {
  import type { SvelteComponentTyped } from 'svelte';

  export default class QRCode extends SvelteComponentTyped<{
    value: string;
    size?: number;
    level?: 'L' | 'M' | 'Q' | 'H';
    [key: string]: any;
  }> {}
}
