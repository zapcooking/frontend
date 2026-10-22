/**
 * Which Reads tab a reader last chose (per device, like Fresh/Global).
 * Curated is the default; "All reads" (the open hashtag search) is opt-in.
 */

export type ReadsSource = 'curated' | 'all';

export const READS_SOURCE_KEY = 'zapcooking_reads_source';

export function loadReadsSource(storage: Pick<Storage, 'getItem'> | null | undefined): ReadsSource {
	try {
		return storage?.getItem(READS_SOURCE_KEY) === 'all' ? 'all' : 'curated';
	} catch {
		return 'curated';
	}
}

export function saveReadsSource(storage: Pick<Storage, 'setItem'> | null | undefined, source: ReadsSource): void {
	try {
		storage?.setItem(READS_SOURCE_KEY, source);
	} catch {
		/* private mode / blocked storage: the default applies next time */
	}
}
