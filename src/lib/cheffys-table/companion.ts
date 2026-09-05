export type RunResult = {
  version: 1;
  mode: string;
  date: string;
  seed: number;
  score: number;
  dishes: number;
  bestChain: number;
  ingredients: string[];
  discoveries: string[];
};
export interface KitchenIntegrations {
  findRecipes: (
    run: RunResult,
    signal: AbortSignal
  ) => Promise<{ title: string; url: string; creator?: string; image?: string }[]>;
  askCheffy?: (run: RunResult) => void;
  generateRecipe?: (run: RunResult, signal: AbortSignal) => Promise<string>;
  saveIngredients?: (run: RunResult) => Promise<void>;
  analyzeNourish?: (run: RunResult, signal: AbortSignal) => Promise<string>;
  prepareSocial?: (run: RunResult) => void;
}
/** Browser generated effects. No audio assets or copyrighted music. */
export class KitchenFeedback {
  private ctx: AudioContext | null = null;
  play(event: 'select' | 'match' | 'dish' | 'finish', sound: boolean, haptics: boolean) {
    if (haptics && typeof navigator.vibrate === 'function')
      navigator.vibrate(event === 'dish' ? [15, 30, 15] : 10);
    if (!sound) return;
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume().catch(() => {});
      const c = this.ctx,
        o = c.createOscillator(),
        g = c.createGain();
      o.connect(g);
      g.connect(c.destination);
      o.frequency.value = { select: 320, match: 520, dish: 780, finish: 440 }[event];
      g.gain.setValueAtTime(0.035, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.16);
      o.start();
      o.stop(c.currentTime + 0.17);
    } catch {}
  }
  close() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
