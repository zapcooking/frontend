/**
 * `src` / `srcset` / `sizes` for a landing image, through the image routing
 * table (imageOptimizer). Hosts that can't be resized get the original as
 * `src` and no srcset.
 */

import { imageRoute, optimizeImageUrl } from '$lib/imageOptimizer';

export interface ResponsiveImage {
	src: string;
	srcset?: string;
	sizes?: string;
}

export function responsiveImg(url: string, widths: number[], sizes: string): ResponsiveImage {
	if (imageRoute(url) === 'skip') return { src: url };
	const sorted = [...widths].sort((a, b) => a - b);
	const seen = new Set<string>();
	const entries: string[] = [];
	for (const w of sorted) {
		const u = optimizeImageUrl(url, { width: w });
		if (seen.has(u)) continue; // native hosts serve fixed renditions
		seen.add(u);
		entries.push(`${u} ${w}w`);
	}
	if (entries.length === 0 || (entries.length === 1 && [...seen][0] === url)) return { src: url };
	// Middle width as the fallback src: browsers without srcset get a sane size.
	const src = optimizeImageUrl(url, { width: sorted[Math.floor((sorted.length - 1) / 2)] });
	return { src, srcset: entries.join(', '), sizes };
}
