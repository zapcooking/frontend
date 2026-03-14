import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

const NOSTR_BUILD_URL = 'https://nostr.build/api/v2/upload/files';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_DURATION = 60; // seconds

/**
 * Upload files to nostr.build with NIP-98 authentication.
 */
export async function uploadToNostrBuild(ndk: NDK, body: FormData) {
	const template = new NDKEvent(ndk);
	template.kind = 27235;
	template.created_at = Math.floor(Date.now() / 1000);
	template.content = '';
	template.tags = [
		['u', NOSTR_BUILD_URL],
		['method', 'POST']
	];

	await template.sign();

	const authEvent = {
		id: template.id,
		pubkey: template.pubkey,
		created_at: template.created_at,
		kind: template.kind,
		tags: template.tags,
		content: template.content,
		sig: template.sig
	};

	const response = await fetch(NOSTR_BUILD_URL, {
		body,
		method: 'POST',
		headers: {
			Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
		}
	});

	if (!response.ok) {
		const errorText = await response.text();
		let errorData;
		try {
			errorData = JSON.parse(errorText);
		} catch {
			errorData = { message: errorText || `HTTP ${response.status}: ${response.statusText}` };
		}
		throw new Error(
			errorData.message || errorData.error || `Upload failed with status ${response.status}`
		);
	}

	return await response.json();
}

/**
 * Upload an image file, returning the URL on success.
 * Throws on validation failure or upload error.
 */
export async function uploadImage(ndk: NDK, file: File): Promise<string> {
	if (file.size > MAX_IMAGE_SIZE) {
		throw new Error('Image must be less than 5MB');
	}

	const body = new FormData();
	body.append('file[]', file);
	const result = await uploadToNostrBuild(ndk, body);

	if (result?.data?.[0]?.url) {
		return result.data[0].url;
	}
	throw new Error(result?.message || result?.error || 'Failed to upload image');
}

/**
 * Upload a video file, returning the URL on success.
 * Validates size and duration. Throws on failure.
 */
export async function uploadVideo(ndk: NDK, file: File): Promise<string> {
	if (file.size > MAX_VIDEO_SIZE) {
		throw new Error('Video must be less than 50MB');
	}

	// Validate video duration
	try {
		const video = document.createElement('video');
		video.preload = 'metadata';
		const objectUrl = URL.createObjectURL(file);

		try {
			const duration = await new Promise<number>((resolve, reject) => {
				video.onloadedmetadata = () => resolve(video.duration);
				video.onerror = () => reject(new Error('Failed to load video metadata'));
				video.src = objectUrl;
			});

			if (duration > 0 && duration > MAX_VIDEO_DURATION) {
				throw new Error('Video must be less than 60 seconds');
			}
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	} catch (metaError) {
		// Re-throw validation errors, but ignore metadata read failures
		if (metaError instanceof Error && metaError.message.includes('less than')) {
			throw metaError;
		}
		console.warn('Could not read video metadata:', metaError);
	}

	const body = new FormData();
	body.append('file[]', file);
	const result = await uploadToNostrBuild(ndk, body);

	if (result?.data?.[0]?.url) {
		return result.data[0].url;
	}
	throw new Error(result?.message || result?.error || 'Failed to upload video');
}
