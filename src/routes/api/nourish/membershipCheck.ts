/**
 * Shared membership validation for Nourish API endpoints.
 * Fail-closed: requires valid pubkey and active membership when enabled.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { verifyNip98 } from '$lib/nip98.server';

/** Is the membership gate on for this deployment? */
export function isMembershipEnabled(platform: any): boolean {
	const MEMBERSHIP_ENABLED =
		(platform?.env as any)?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
	return typeof MEMBERSHIP_ENABLED === 'string'
		? MEMBERSHIP_ENABLED.toLowerCase() === 'true'
		: Boolean(MEMBERSHIP_ENABLED);
}

/**
 * Who is calling? Identity comes from a NIP-98 signature over this exact
 * request (method, URL, body hash), never from a `pubkey` field in the body:
 * a body pubkey is a claim anyone can type, and it used to be interpolated
 * straight into the pantry lookup URL with the server's bearer.
 *
 * Returns the verified pubkey, or a 401 Response when the gate is on and the
 * signature is missing or invalid. When the gate is off no identity is needed.
 */
export async function authenticateNourish(
	request: Request,
	bodyBytes: Uint8Array,
	platform: any
): Promise<{ pubkey: string | null } | Response> {
	if (!isMembershipEnabled(platform)) return { pubkey: null };
	const verification = await verifyNip98(request, { bodyBytes });
	if (!verification.ok) {
		console.warn(`[Nourish] NIP-98 rejected (${verification.reason})`);
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}
	return { pubkey: verification.pubkey };
}

/**
 * Validate membership for a Nourish API request.
 * Returns a JSON error Response if validation fails, or null if the user is authorized.
 */
export async function requireMembership(
	pubkey: unknown,
	platform: any
): Promise<Response | null> {
	if (!isMembershipEnabled(platform)) return null;

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
