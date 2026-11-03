/**
 * NIP-05 verification for "All reads", the pure half: which identifiers
 * are worth fetching, where from, and whether the answer names the author.
 * A NIP-05 counts only when the domain's nostr.json maps the name to the
 * author's key; one that's merely present in a profile doesn't.
 *
 * Names match case-insensitively: NIP-05 asks for lower-case names, but
 * real servers publish keys like "GoBrrr", and readers type them either way.
 */

export interface Nip05Id {
	/** Lower-cased local part ("_" for a bare domain). */
	name: string;
	/** Lower-cased host name. */
	domain: string;
}

const NAME = /^[a-z0-9._-]{1,64}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** Never fetched: they can't be a public NIP-05 host. */
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.invalid', '.test', '.example', '.onion', '.lan', '.home'];

/**
 * A public host name: dotted labels and an alphabetic TLD. That rules out IP
 * literals, ports, `localhost`, userinfo and anything else a Worker
 * shouldn't be sent to.
 */
export function isPublicHostname(domain: string): boolean {
	if (domain.length > 253) return false;
	const labels = domain.split('.');
	if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
	if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return false;
	return !RESERVED_SUFFIXES.some((s) => `.${domain}`.endsWith(s));
}

/** `name@domain` (or a bare `domain`) → its parts, or null when it can't be a NIP-05. */
export function parseNip05(raw: unknown): Nip05Id | null {
	if (typeof raw !== 'string') return null;
	const s = raw.trim().toLowerCase();
	if (!s || s.length > 320) return null;
	const at = s.lastIndexOf('@');
	const name = at === -1 ? '_' : s.slice(0, at);
	const domain = at === -1 ? s : s.slice(at + 1);
	if (!NAME.test(name) || !isPublicHostname(domain)) return null;
	return { name, domain };
}

export function nip05Key(id: Nip05Id): string {
	return `${id.name}@${id.domain}`;
}

export function nip05Url(id: Nip05Id): string {
	return `https://${id.domain}/.well-known/nostr.json?name=${encodeURIComponent(id.name)}`;
}

/** The keys a nostr.json body gives `name` (any letter case), lower-cased. */
export function pubkeysForName(body: unknown, name: string): string[] {
	const names = (body as { names?: unknown } | null)?.names;
	if (!names || typeof names !== 'object' || Array.isArray(names)) return [];
	const out: string[] = [];
	for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
		if (k.toLowerCase() !== name || typeof v !== 'string') continue;
		const pk = v.toLowerCase();
		if (/^[0-9a-f]{64}$/.test(pk) && !out.includes(pk)) out.push(pk);
	}
	return out;
}
