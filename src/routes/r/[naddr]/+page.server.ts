import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, url }) => {
	const naddr = params.naddr;

	// Strip tracking parameters from the URL
	const trackingParams = [
		'fbclid', 'gclid', 'msclkid',
		'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
		'ref', 'source'
	];
	
	const hasTrackingParams = trackingParams.some(param => url.searchParams.has(param));
	
	if (hasTrackingParams) {
		// Redirect to clean URL without tracking params
		const cleanUrl = `/r/${naddr}`;
		throw redirect(301, cleanUrl);
	}

	// Validate naddr format
	if (!naddr?.startsWith('naddr1')) {
		throw redirect(302, '/recent');
	}

	return {
		naddr
	};
};

