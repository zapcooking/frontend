/** Pure presentation of a shared content pool. URL variants never fetch relays. */
import { isFastResizeImage, type Cook, type LongformCard } from './content';
import type { LandingData } from './landingData.server';

export const EDITION_SECONDS = 6 * 60 * 60;
export const EDITION_VARIANTS = 4;

export interface CollectionTile {
	slug: string;
	name: string;
	description: string;
	image: string;
	href: string;
}
export interface CookSpotlight extends Cook { recipe: LongformCard }
export interface LandingEdition extends LandingData {
	collections: CollectionTile[];
	spotlights: CookSpotlight[];
}

/** Four variants only; all unknown values select the ordinary edition. */
export function editionVariant(raw: string | null | undefined): number {
	if (raw === 'next') return 1;
	return raw === '2' || raw === '3' ? Number(raw) : 0;
}
export function nextEditionHref(raw: string | null | undefined): string {
	const next = (editionVariant(raw) + 1) % EDITION_VARIANTS;
	return next === 0 ? '/explore' : `/explore?edition=${next === 1 ? 'next' : next}`;
}

function uniqueRecipes(cards: LongformCard[]): LongformCard[] {
	const seen = new Set<string>();
	return cards.filter((c) => {
		if (c.type !== 'recipe' || !c.image || seen.has(c.coordinate)) return false;
		seen.add(c.coordinate);
		return true;
	});
}
function rotate<T>(items: T[], offset: number): T[] {
	if (!items.length) return [];
	const start = ((offset % items.length) + items.length) % items.length;
	return [...items.slice(start), ...items.slice(0, start)];
}

/** Three distinct cooks, with author-supplied tags breaking ties toward variety. */
export function selectCover(pool: LongformCard[], nowSeconds: number, variant = 0): LongformCard[] {
	const candidates = uniqueRecipes(pool).slice(0, 20);
	const bucket = Math.floor(nowSeconds / EDITION_SECONDS);
	const ordered = rotate(candidates, bucket + variant * 3);
	if (!ordered.length) return [];
	const lead = ordered.find((c) => isFastResizeImage(c.image)) ?? ordered[0];
	const selected = [lead];
	while (selected.length < 3) {
		const authors = new Set(selected.map((c) => c.author.pubkey));
		const tags = new Set(selected.flatMap((c) => c.tags ?? []));
		const options = ordered.filter((c) => !authors.has(c.author.pubkey));
		if (!options.length) break;
		// Stable sort preserves editorial/edition order when metadata is sparse.
		options.sort((a, b) =>
			(b.tags ?? []).filter((t) => !tags.has(t)).length -
			(a.tags ?? []).filter((t) => !tags.has(t)).length
		);
		selected.push(options[0]);
	}
	return selected;
}

interface CollectionRule {
	slug: string;
	name: string;
	description: string;
	/** UTC month numbers. Omitted means year-round. */
	months?: number[];
}
const COLLECTIONS: CollectionRule[] = [
	{ slug: 'pasta', name: 'Dinner around the table', description: 'Pasta recipes for your next shared meal.' },
	{ slug: 'soup', name: 'Something warming', description: 'Bowls of soup to settle into.', months: [0, 1, 2, 8, 9, 10, 11] },
	{ slug: 'salad', name: 'Fresh on the table', description: 'Salads full of color and crunch.', months: [3, 4, 5, 6, 7] },
	{ slug: 'bread', name: 'Weekend baking', description: 'Make time for a loaf of your own.' },
	{ slug: 'vegetables', name: 'Vegetables take the lead', description: 'Put the produce at the center of the plate.' },
	{ slug: 'drinks', name: 'Something to sip', description: 'A new drink for a quiet moment or good company.' },
	{ slug: 'dessert', name: 'A little something sweet', description: 'Find a reason to make dessert.' },
	{ slug: 'breakfast', name: 'A good start', description: 'Recipes to make the morning yours.' },
	{ slug: 'italian', name: 'At the Italian table', description: 'Explore Italian recipes shared by cooks.' },
	{ slug: 'mexican', name: 'From a Mexican kitchen', description: 'Discover Mexican recipes from the community.' }
];

/** A tile exists only when a real recipe bears its exact public browsing tag. */
export function selectCollections(recipes: LongformCard[], nowSeconds: number): CollectionTile[] {
	const month = new Date(nowSeconds * 1000).getUTCMonth();
	const used = new Set<string>();
	const result: CollectionTile[] = [];
	for (const rule of COLLECTIONS) {
		if (rule.months && !rule.months.includes(month)) continue;
		const recipe = recipes.find((c) => !used.has(c.coordinate) && c.tags?.includes(rule.slug));
		if (!recipe) continue;
		used.add(recipe.coordinate);
		result.push({ slug: rule.slug, name: rule.name, description: rule.description, image: recipe.image, href: `/tag/${encodeURIComponent(rule.slug)}` });
		if (result.length === 6) break;
	}
	return result;
}

export function selectLandingEdition(data: LandingData, nowSeconds: number, rawVariant?: string | null): LandingEdition {
	// Only an approved pool may supply the cover. Unavailable lists use their
	// last-good approved pool; without one the cover stays empty.
	const pool = data.coverPool ?? [];
	const coverCards = selectCover(pool, nowSeconds, editionVariant(rawVariant));
	const used = new Set(coverCards.map((c) => c.coordinate));
	const recipes = uniqueRecipes([...(data.recipePool ?? []), ...data.newRecipes]);
	const available = recipes.filter((c) => !used.has(c.coordinate));
	const spotlights: CookSpotlight[] = [];
	for (const cook of data.cooks) {
		if (!cook.about) continue; // An introduction must come from the cook's own profile.
		const recipe = available.find((c) => c.author.pubkey === cook.pubkey && !used.has(c.coordinate));
		if (!recipe) continue;
		spotlights.push({ ...cook, recipe });
		used.add(recipe.coordinate);
		if (spotlights.length === 3) break;
	}
	const dinnerTags = new Set(['dinner', 'main-course', 'pasta', 'rice', 'soup', 'vegetables', 'chicken', 'fish']);
	const practical = available.filter((c) => !used.has(c.coordinate));
	practical.sort((a, b) => Number(b.tags?.some((t) => dinnerTags.has(t)) ?? false) - Number(a.tags?.some((t) => dinnerTags.has(t)) ?? false));
	const newRecipes = practical.slice(0, 6);
	newRecipes.forEach((c) => used.add(c.coordinate));
	// Collection previews do not reuse a featured recipe's photograph.
	const collections = selectCollections(available.filter((c) => !used.has(c.coordinate)), nowSeconds);
	return {
		...data,
		cover: coverCards[0] ?? null,
		picks: coverCards.slice(1),
		newRecipes,
		reads: data.reads.filter((c) => !used.has(c.coordinate)).slice(0, 1),
		collections,
		spotlights
	};
}
