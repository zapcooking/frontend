/**
 * Pantry Connection Manager
 *
 * Dedicated connection state machine for the pantry relay (wss://pantry.zap.cooking).
 * Provides reactive connection status, exponential backoff reconnection, heartbeat,
 * and hooks for auto-resubscribe on reconnect.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'error';

export const pantryConnectionStatus = writable<{
	state: ConnectionState;
	reconnectAttempts: number;
	lastError: string | null;
}>({ state: 'disconnected', reconnectAttempts: 0, lastError: null });

type Callback = () => void;

class PantryConnectionManager {
	private ndkInstance: NDK | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private lastDataReceived = 0;
	private maxReconnectAttempts = 10;
	private onReadyCallbacks: Callback[] = [];
	private onDisconnectCallbacks: Callback[] = [];
	private listenersAttached = false;
	private destroyed = false;

	init(ndkInstance: NDK): void {
		if (!browser) return;
		this.ndkInstance = ndkInstance;
		this.attachListeners();
		this.startHeartbeat();
	}

	destroy(): void {
		this.destroyed = true;
		this.stopHeartbeat();
		this.clearReconnectTimer();
		this.detachListeners();
		this.ndkInstance = null;
		this.onReadyCallbacks = [];
		this.onDisconnectCallbacks = [];
		pantryConnectionStatus.set({ state: 'disconnected', reconnectAttempts: 0, lastError: null });
	}

	onReady(cb: Callback): () => void {
		this.onReadyCallbacks.push(cb);
		return () => {
			this.onReadyCallbacks = this.onReadyCallbacks.filter((c) => c !== cb);
		};
	}

	onDisconnect(cb: Callback): () => void {
		this.onDisconnectCallbacks.push(cb);
		return () => {
			this.onDisconnectCallbacks = this.onDisconnectCallbacks.filter((c) => c !== cb);
		};
	}

	markDataReceived(): void {
		this.lastDataReceived = Date.now();
	}

	private getPantryRelay(): any | null {
		if (!this.ndkInstance) return null;
		const relaySet = NDKRelaySet.fromRelayUrls([PANTRY_RELAY], this.ndkInstance, true);
		return Array.from(relaySet.relays)[0] || null;
	}

	private attachListeners(): void {
		if (this.listenersAttached) return;
		const relay = this.getPantryRelay();
		if (!relay) return;

		relay.on('connect', this.handleConnect);
		relay.on('disconnect', this.handleDisconnect);
		relay.on('authed', this.handleAuthed);

		this.listenersAttached = true;

		// Check current state
		if (relay.connectivity?.status === 1) {
			this.setState('ready');
		}
	}

	private detachListeners(): void {
		if (!this.listenersAttached) return;
		const relay = this.getPantryRelay();
		if (relay) {
			relay.removeListener('connect', this.handleConnect);
			relay.removeListener('disconnect', this.handleDisconnect);
			relay.removeListener('authed', this.handleAuthed);
		}
		this.listenersAttached = false;
	}

	private handleConnect = (): void => {
		if (this.destroyed) return;
		this.setState('authenticating');
	};

	private handleDisconnect = (): void => {
		if (this.destroyed) return;
		const status = get(pantryConnectionStatus);
		const prevState = status.state;

		this.setState('disconnected');

		for (const cb of this.onDisconnectCallbacks) {
			try {
				cb();
			} catch (e) {
				console.error('[PantryManager] onDisconnect callback error:', e);
			}
		}

		// Only auto-reconnect if we were fully authenticated before.
		// Disconnects during 'authenticating' are expected (nip29.ts may
		// intentionally disconnect/reconnect during initial AUTH handshake).
		if (prevState === 'ready') {
			this.scheduleReconnect();
		}
	};

	private handleAuthed = (): void => {
		if (this.destroyed) return;
		this.setState('ready');
		this.lastDataReceived = Date.now();

		// Reset reconnect attempts on successful auth
		pantryConnectionStatus.update((s) => ({ ...s, reconnectAttempts: 0 }));

		for (const cb of this.onReadyCallbacks) {
			try {
				cb();
			} catch (e) {
				console.error('[PantryManager] onReady callback error:', e);
			}
		}
	};

	private setState(state: ConnectionState): void {
		pantryConnectionStatus.update((s) => ({
			...s,
			state,
			lastError: state === 'error' ? s.lastError : state === 'ready' ? null : s.lastError
		}));
	}

	private scheduleReconnect(): void {
		if (this.destroyed) return;
		this.clearReconnectTimer();

		const status = get(pantryConnectionStatus);
		if (status.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error('[PantryManager] Max reconnect attempts reached');
			pantryConnectionStatus.update((s) => ({
				...s,
				state: 'error',
				lastError: 'Max reconnect attempts reached'
			}));
			return;
		}

		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
		const delay = Math.min(1000 * Math.pow(2, status.reconnectAttempts), 30000);
		console.log(
			`[PantryManager] Scheduling reconnect in ${delay}ms (attempt ${status.reconnectAttempts + 1})`
		);

		pantryConnectionStatus.update((s) => ({
			...s,
			state: 'connecting',
			reconnectAttempts: s.reconnectAttempts + 1
		}));

		this.reconnectTimer = setTimeout(() => {
			this.attemptReconnect();
		}, delay);
	}

	private async attemptReconnect(): Promise<void> {
		if (this.destroyed || !this.ndkInstance) return;

		const relay = this.getPantryRelay();
		if (!relay) {
			console.warn('[PantryManager] Cannot find pantry relay for reconnect');
			this.scheduleReconnect();
			return;
		}

		try {
			await relay.connect();
		} catch (e) {
			console.warn('[PantryManager] Reconnect attempt failed:', e);
			this.scheduleReconnect();
		}
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = setInterval(() => {
			this.checkHealth();
		}, 45000);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private checkHealth(): void {
		if (this.destroyed || !this.ndkInstance) return;

		const relay = this.getPantryRelay();
		if (!relay) return;

		const status = get(pantryConnectionStatus);

		// If we think we're connected but the WebSocket is actually closed, force reconnect
		if (status.state === 'ready' && relay.connectivity?.status !== 1) {
			console.warn('[PantryManager] Heartbeat detected stale connection, reconnecting...');
			this.handleDisconnect();
		}
	}
}

export const pantryManager = new PantryConnectionManager();
