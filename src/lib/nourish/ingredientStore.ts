/**
 * Ingredient Signal Store
 *
 * IndexedDB-backed persistence for per-ingredient signals extracted
 * during Nourish scoring. Builds a local dataset over time.
 *
 * Writes are fire-and-forget — they never block the main scoring flow.
 */

import { browser } from '$app/environment';
import type { IngredientSignal, IngredientRecord } from './types';

const DB_NAME = 'zapcooking-ingredient-store';
const DB_VERSION = 1;
const STORE_NAME = 'ingredients';
const MAX_RECORDS = 5000;

class IngredientStoreManager {
	private db: IDBDatabase | null = null;
	private dbReady: Promise<void>;

	constructor() {
		this.dbReady = browser ? this.initDatabase() : Promise.resolve();
	}

	private initDatabase(): Promise<void> {
		return new Promise((resolve) => {
			try {
				const request = indexedDB.open(DB_NAME, DB_VERSION);

				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains(STORE_NAME)) {
						const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
						store.createIndex('name', 'name', { unique: false });
						store.createIndex('createdAt', 'createdAt', { unique: false });
						store.createIndex('contribution', 'contribution', { unique: false });
					}
				};

				request.onsuccess = () => {
					this.db = request.result;
					resolve();
				};

				request.onerror = () => {
					console.warn('[IngredientStore] Failed to open database');
					resolve();
				};
			} catch {
				resolve();
			}
		});
	}

	/**
	 * Save ingredient signals from a scoring result.
	 * Fire-and-forget — errors are logged but never thrown.
	 */
	async saveIngredients(
		signals: IngredientSignal[],
		source: 'recipe' | 'scan',
		sourceId?: string
	): Promise<void> {
		if (!browser || signals.length === 0) return;
		await this.dbReady;
		if (!this.db) return;

		try {
			const tx = this.db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			const now = Date.now();

			for (const signal of signals) {
				const record: IngredientRecord = {
					id: `${now}_${Math.random().toString(36).slice(2, 9)}`,
					name: signal.name.toLowerCase().trim(),
					signals: signal.signals,
					contribution: signal.contribution,
					source,
					sourceId,
					createdAt: now
				};
				store.put(record);
			}

			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			// Prune if over limit
			this.pruneIfNeeded().catch(() => {});
		} catch (err) {
			console.warn('[IngredientStore] Failed to save ingredients:', err);
		}
	}

	/** Get all records for a given ingredient name. */
	async getByName(name: string): Promise<IngredientRecord[]> {
		if (!browser) return [];
		await this.dbReady;
		if (!this.db) return [];

		return new Promise((resolve) => {
			try {
				const tx = this.db!.transaction(STORE_NAME, 'readonly');
				const index = tx.objectStore(STORE_NAME).index('name');
				const request = index.getAll(name.toLowerCase().trim());
				request.onsuccess = () => resolve(request.result || []);
				request.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
	}

	/** Get basic stats about the store. */
	async getStats(): Promise<{ count: number }> {
		if (!browser) return { count: 0 };
		await this.dbReady;
		if (!this.db) return { count: 0 };

		return new Promise((resolve) => {
			try {
				const tx = this.db!.transaction(STORE_NAME, 'readonly');
				const request = tx.objectStore(STORE_NAME).count();
				request.onsuccess = () => resolve({ count: request.result });
				request.onerror = () => resolve({ count: 0 });
			} catch {
				resolve({ count: 0 });
			}
		});
	}

	/** Remove oldest records when over MAX_RECORDS. */
	private async pruneIfNeeded(): Promise<void> {
		if (!this.db) return;

		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const countReq = tx.objectStore(STORE_NAME).count();
		const count = await new Promise<number>((resolve) => {
			countReq.onsuccess = () => resolve(countReq.result);
			countReq.onerror = () => resolve(0);
		});

		if (count <= MAX_RECORDS) return;

		const deleteTx = this.db.transaction(STORE_NAME, 'readwrite');
		const store = deleteTx.objectStore(STORE_NAME);
		const index = store.index('createdAt');
		const toDelete = count - MAX_RECORDS;

		let deleted = 0;
		const cursor = index.openCursor();
		cursor.onsuccess = () => {
			const c = cursor.result;
			if (c && deleted < toDelete) {
				store.delete(c.primaryKey);
				deleted++;
				c.continue();
			}
		};
	}
}

export const ingredientStore = new IngredientStoreManager();
