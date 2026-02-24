/**
 * Group Cache Storage
 *
 * IndexedDB-based persistence for NIP-29 group data (messages, metadata, members, pending messages).
 * Follows the same pattern as offlineStorage.ts — raw IndexedDB, SSR-safe singleton, dbReady promise.
 */

import { browser } from '$app/environment';

const DB_NAME = 'zapcooking-groups';
const DB_VERSION = 1;

const MESSAGES_STORE = 'messages';
const METADATA_STORE = 'metadata';
const MEMBERS_STORE = 'members';
const PENDING_STORE = 'pendingMessages';

export interface CachedMessage {
	id: string;
	groupId: string;
	sender: string;
	content: string;
	created_at: number;
	status?: 'pending' | 'confirmed' | 'failed';
	cachedAt: number;
}

export interface CachedMetadata {
	id: string;
	name: string;
	picture: string;
	about: string;
	isPrivate: boolean;
	isClosed: boolean;
	isRestricted: boolean;
	updatedAt: number;
}

export interface CachedMembers {
	groupId: string;
	members: string[];
	updatedAt: number;
}

export interface PendingMessage {
	tempId: string;
	groupId: string;
	content: string;
	created_at: number;
	status: 'pending' | 'failed';
	retryCount: number;
}

class GroupCacheStorage {
	private db: IDBDatabase | null = null;
	private dbReady!: Promise<void>;
	private dbReadyResolve!: () => void;

	constructor() {
		this.dbReady = new Promise((resolve) => {
			this.dbReadyResolve = resolve;
		});

		const isBrowser = (() => {
			try {
				if (typeof browser !== 'undefined' && !browser) {
					return false;
				}
				return (
					typeof window !== 'undefined' &&
					typeof globalThis !== 'undefined' &&
					'indexedDB' in globalThis
				);
			} catch {
				return false;
			}
		})();

		if (isBrowser) {
			this.initDatabase().catch((error) => {
				console.warn('[GroupCache] Failed to initialize:', error);
				this.dbReadyResolve();
			});
		} else {
			this.dbReadyResolve();
		}
	}

	private async initDatabase(): Promise<void> {
		if (!browser || typeof window === 'undefined') {
			return;
		}

		const idb = (globalThis as any).indexedDB;
		if (!idb) {
			console.warn('[GroupCache] IndexedDB not available');
			this.dbReadyResolve();
			return;
		}

		return new Promise((resolve, reject) => {
			const request = idb.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error('[GroupCache] Failed to open database:', request.error);
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				console.log('[GroupCache] Database initialized');
				this.dbReadyResolve();
				resolve();
			};

			request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
				const db = (event.target as IDBOpenDBRequest).result;

				if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
					const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
					msgStore.createIndex('groupId', 'groupId', { unique: false });
					msgStore.createIndex('created_at', 'created_at', { unique: false });
					msgStore.createIndex('groupId_created_at', ['groupId', 'created_at'], {
						unique: false
					});
				}

				if (!db.objectStoreNames.contains(METADATA_STORE)) {
					db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
				}

				if (!db.objectStoreNames.contains(MEMBERS_STORE)) {
					db.createObjectStore(MEMBERS_STORE, { keyPath: 'groupId' });
				}

				if (!db.objectStoreNames.contains(PENDING_STORE)) {
					const pendingStore = db.createObjectStore(PENDING_STORE, { keyPath: 'tempId' });
					pendingStore.createIndex('groupId', 'groupId', { unique: false });
				}
			};
		});
	}

	async ready(): Promise<void> {
		return this.dbReady;
	}

	// ==================== Message Operations ====================

	async saveMessages(msgs: CachedMessage[]): Promise<void> {
		await this.ready();
		if (!this.db || msgs.length === 0) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
			const store = transaction.objectStore(MESSAGES_STORE);

			for (const msg of msgs) {
				store.put(msg);
			}

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	}

	async getMessages(groupId: string, limit: number = 1000): Promise<CachedMessage[]> {
		await this.ready();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MESSAGES_STORE], 'readonly');
			const store = transaction.objectStore(MESSAGES_STORE);
			const index = store.index('groupId_created_at');

			// Use a key range to get messages for this group, ordered by created_at
			const range = IDBKeyRange.bound([groupId, 0], [groupId, Infinity]);
			const results: CachedMessage[] = [];

			// Open cursor in reverse (newest first) to get the most recent messages
			const request = index.openCursor(range, 'prev');

			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor && results.length < limit) {
					results.push(cursor.value);
					cursor.continue();
				} else {
					// Reverse to get chronological order (oldest first)
					results.reverse();
					resolve(results);
				}
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getLatestTimestamp(groupId?: string): Promise<number | null> {
		await this.ready();
		if (!this.db) return null;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MESSAGES_STORE], 'readonly');
			const store = transaction.objectStore(MESSAGES_STORE);

			if (groupId) {
				const index = store.index('groupId_created_at');
				const range = IDBKeyRange.bound([groupId, 0], [groupId, Infinity]);
				const request = index.openCursor(range, 'prev');

				request.onsuccess = () => {
					const cursor = request.result;
					resolve(cursor ? cursor.value.created_at : null);
				};
				request.onerror = () => reject(request.error);
			} else {
				const index = store.index('created_at');
				const request = index.openCursor(null, 'prev');

				request.onsuccess = () => {
					const cursor = request.result;
					resolve(cursor ? cursor.value.created_at : null);
				};
				request.onerror = () => reject(request.error);
			}
		});
	}

	async pruneMessages(groupId: string, keep: number): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
			const store = transaction.objectStore(MESSAGES_STORE);
			const index = store.index('groupId_created_at');

			const range = IDBKeyRange.bound([groupId, 0], [groupId, Infinity]);
			const countReq = index.count(range);

			countReq.onsuccess = () => {
				const total = countReq.result;
				if (total <= keep) {
					resolve();
					return;
				}

				const deleteCount = total - keep;
				let deleted = 0;

				// Open cursor ascending (oldest first) to delete oldest
				const cursorReq = index.openCursor(range, 'next');
				cursorReq.onsuccess = () => {
					const cursor = cursorReq.result;
					if (cursor && deleted < deleteCount) {
						store.delete(cursor.primaryKey);
						deleted++;
						cursor.continue();
					} else {
						resolve();
					}
				};
				cursorReq.onerror = () => reject(cursorReq.error);
			};
			countReq.onerror = () => reject(countReq.error);
		});
	}

	// ==================== Metadata Operations ====================

	async saveMetadata(meta: CachedMetadata): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([METADATA_STORE], 'readwrite');
			const store = transaction.objectStore(METADATA_STORE);
			const request = store.put(meta);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getAllMetadata(): Promise<CachedMetadata[]> {
		await this.ready();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([METADATA_STORE], 'readonly');
			const store = transaction.objectStore(METADATA_STORE);
			const request = store.getAll();

			request.onsuccess = () => resolve(request.result || []);
			request.onerror = () => reject(request.error);
		});
	}

	async deleteMetadata(groupId: string): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([METADATA_STORE], 'readwrite');
			const store = transaction.objectStore(METADATA_STORE);
			const request = store.delete(groupId);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	// ==================== Members Operations ====================

	async saveMembers(groupId: string, members: string[]): Promise<void> {
		await this.ready();
		if (!this.db) return;

		const record: CachedMembers = { groupId, members, updatedAt: Date.now() };

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MEMBERS_STORE], 'readwrite');
			const store = transaction.objectStore(MEMBERS_STORE);
			const request = store.put(record);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getMembers(groupId: string): Promise<string[]> {
		await this.ready();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MEMBERS_STORE], 'readonly');
			const store = transaction.objectStore(MEMBERS_STORE);
			const request = store.get(groupId);

			request.onsuccess = () => {
				const result = request.result as CachedMembers | undefined;
				resolve(result?.members || []);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async getAllMembers(): Promise<CachedMembers[]> {
		await this.ready();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([MEMBERS_STORE], 'readonly');
			const store = transaction.objectStore(MEMBERS_STORE);
			const request = store.getAll();

			request.onsuccess = () => resolve(request.result || []);
			request.onerror = () => reject(request.error);
		});
	}

	// ==================== Pending Message Operations ====================

	async savePendingMessage(msg: PendingMessage): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
			const store = transaction.objectStore(PENDING_STORE);
			const request = store.put(msg);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	async getPendingMessages(groupId?: string): Promise<PendingMessage[]> {
		await this.ready();
		if (!this.db) return [];

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([PENDING_STORE], 'readonly');
			const store = transaction.objectStore(PENDING_STORE);

			if (groupId) {
				const index = store.index('groupId');
				const request = index.getAll(groupId);
				request.onsuccess = () => resolve(request.result || []);
				request.onerror = () => reject(request.error);
			} else {
				const request = store.getAll();
				request.onsuccess = () => resolve(request.result || []);
				request.onerror = () => reject(request.error);
			}
		});
	}

	async removePendingMessage(tempId: string): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
			const store = transaction.objectStore(PENDING_STORE);
			const request = store.delete(tempId);

			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	// ==================== Utility Operations ====================

	async clearAll(): Promise<void> {
		await this.ready();
		if (!this.db) return;

		return new Promise((resolve, reject) => {
			const transaction = this.db!.transaction(
				[MESSAGES_STORE, METADATA_STORE, MEMBERS_STORE, PENDING_STORE],
				'readwrite'
			);

			transaction.objectStore(MESSAGES_STORE).clear();
			transaction.objectStore(METADATA_STORE).clear();
			transaction.objectStore(MEMBERS_STORE).clear();
			transaction.objectStore(PENDING_STORE).clear();

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	}

	async clearGroup(groupId: string): Promise<void> {
		await this.ready();
		if (!this.db) return;

		// Delete messages for this group
		const msgs = await this.getMessages(groupId);
		if (msgs.length > 0) {
			await new Promise<void>((resolve, reject) => {
				const transaction = this.db!.transaction([MESSAGES_STORE], 'readwrite');
				const store = transaction.objectStore(MESSAGES_STORE);
				for (const msg of msgs) {
					store.delete(msg.id);
				}
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		}

		// Delete metadata
		await this.deleteMetadata(groupId);

		// Delete members
		await new Promise<void>((resolve, reject) => {
			const transaction = this.db!.transaction([MEMBERS_STORE], 'readwrite');
			const store = transaction.objectStore(MEMBERS_STORE);
			const request = store.delete(groupId);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});

		// Delete pending messages for this group
		const pending = await this.getPendingMessages(groupId);
		if (pending.length > 0) {
			await new Promise<void>((resolve, reject) => {
				const transaction = this.db!.transaction([PENDING_STORE], 'readwrite');
				const store = transaction.objectStore(PENDING_STORE);
				for (const msg of pending) {
					store.delete(msg.tempId);
				}
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		}
	}
}

export const groupCache = new GroupCacheStorage();
