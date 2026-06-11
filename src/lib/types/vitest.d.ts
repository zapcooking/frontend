declare module 'vitest' {
  export const describe: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const expect: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => any;
  export const afterEach: (...args: any[]) => any;
  export const vi: {
    stubGlobal: (name: string, value: unknown) => void;
    unstubAllGlobals: () => void;
    [key: string]: any;
  };
}
