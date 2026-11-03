import { parseCoordinate } from '../coordinate';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { discoverRecipesForPlanning } from '$lib/services/recipeDiscoveryService';
import { cheffyDraft, openCheffy } from '$lib/stores/cheffyChat';
import { nip19 } from 'nostr-tools';
import type { KitchenIntegrations } from './companion';
/** Called only from results. Reuses Zap discovery, content validation and relay filters. */
export const zapKitchen: KitchenIntegrations = {
  async findRecipes(run, signal) {
    const client = get(ndk);
    if (!client) return [];
    const candidates = await discoverRecipesForPlanning({
      ndk: client,
      pubkey: '',
      source: 'explore'
    });
    if (signal.aborted) return [];
    const scored = candidates
      .map((r) => ({
        r,
        score: run.ingredients.filter((i) =>
          r.ingredients.some((line) =>
            line.toLowerCase().includes(i.toLowerCase().replace(/^(cooked|par-cooked) /, ''))
          )
        ).length
      }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return scored.flatMap(({ r }) => {
      const c = parseCoordinate(r.a);
      if (!c) return [];
      return {
        title: r.title,
        url: `/recipe/${nip19.naddrEncode(c)}`,
        image: r.image
      };
    });
  },
  askCheffy(run) {
    cheffyDraft.set(
      `I cooked with ${run.ingredients.join(', ')} at Cheffy’s Table. What could I make for dinner?`
    );
    openCheffy();
  }
};
