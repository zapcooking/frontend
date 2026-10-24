/**
 * Reads cover and card images through the same routing table as /explore
 * (imageOptimizer via responsiveImg): a sized rendition first, the original
 * URL if that fails, the placeholder last. Pure; the components keep the
 * attempt count and bump it on `error`.
 */

import { responsiveImg, type ResponsiveImage } from '$lib/landing/responsiveImg';

export type ReadsImageSize = 'hero' | 'secondary' | 'tertiary' | 'card';

/** Rendered widths per slot (CSS px), so the browser picks a rendition near it. */
export const READS_IMAGE_SPEC: Record<ReadsImageSize, { widths: number[]; sizes: string }> = {
	hero: { widths: [480, 768, 1200], sizes: '(min-width: 1024px) 60vw, 100vw' },
	secondary: { widths: [320, 480, 640], sizes: '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw' },
	tertiary: { widths: [160], sizes: '80px' },
	card: { widths: [320, 480, 640], sizes: '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw' }
};

/**
 * The image for an attempt: 0 = routed rendition (srcset), 1 = the original
 * URL, 2+ (or no URL) = the placeholder.
 */
export function readsImage(
	url: string | null | undefined,
	size: ReadsImageSize,
	attempt: number,
	placeholder: string
): ResponsiveImage {
	if (!url || attempt >= 2) return { src: placeholder };
	if (attempt === 1) return { src: url };
	const { widths, sizes } = READS_IMAGE_SPEC[size];
	return responsiveImg(url, widths, sizes);
}
