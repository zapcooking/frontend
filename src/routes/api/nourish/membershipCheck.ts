/**
 * Shared membership validation for Nourish API endpoints.
 * Fail-closed: requires valid pubkey and active membership when enabled.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Validate membership for a Nourish API request.
 * Returns a JSON error Response if validation fails, or null if the user is authorized.
 */
export async function requireMembership(
	pubkey: unknown,
	platform: any
): Promise<Response | null> {
	const MEMBERSHIP_ENABLED =
		(platform?.env as any)?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
	const membershipEnabled =
		typeof MEMBERSHIP_ENABLED === 'string'
			? MEMBERSHIP_ENABLED.toLowerCase() === 'true'
			: Boolean(MEMBERSHIP_ENABLED);

	if (!membershipEnabled) return null;

	if (typeof pubkey !== 'string' || pubkey.trim().length === 0) {
		return json(
			{ success: false, error: 'A valid pubkey is required for Nourish' },
			{ status: 400 }
		);
	}

	const API_SECRET = (platform?.env as any)?.RELAY_API_SECRET || env.RELAY_API_SECRET;
	if (!API_SECRET) {
		console.error('[Nourish] Membership API secret is missing');
		return json(
			{ success: false, error: 'Membership service unavailable' },
			{ status: 500 }
		);
	}

	try {
		const { hasActiveMembership } = await import('$lib/membershipApi.server');
		const isActive = await hasActiveMembership(pubkey, API_SECRET);
		if (!isActive) {
			return json(
				{ success: false, error: 'Premium membership required for Nourish' },
				{ status: 403 }
			);
		}
	} catch (err) {
		console.error('[Nourish] Error checking membership:', err);
		return json(
			{ success: false, error: 'Unable to verify membership at this time' },
			{ status: 500 }
		);
	}

	return null;
}
