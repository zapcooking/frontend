/**
 * The one stream player state, shared by every surface.
 *
 * One surface (page player, floating dock, pop-out window) owns the video
 * at a time; handing off re-assigns ownership without reloading the media.
 * `generation` bumps on every switch so async work from a previous stream
 * (zap scans, liveness probes) dies instead of painting the wrong stream —
 * the same guard Sidecar uses.
 */

import { writable, derived, get } from 'svelte/store';
import type { PlayerSurface, StreamItem, StreamPlayStatus } from '$lib/streams/types';

export interface StreamPlayerState {
  item: StreamItem | null;
  /** Media URL: the live stream while live, the recording for replays. */
  mediaUrl: string | null;
  surface: PlayerSurface;
  expanded: boolean;
  muted: boolean;
  status: StreamPlayStatus;
  /** Playback position for replays (seconds), so a reload can restore. */
  position: number | null;
  /** Bump on every selection change; stale async continuations check it. */
  generation: number;
}

const initial: StreamPlayerState = {
  item: null,
  mediaUrl: null,
  surface: null,
  expanded: false,
  muted: false,
  status: 'idle',
  position: null,
  generation: 0
};

export const streamPlayer = writable<StreamPlayerState>(initial);

/** Current generation — read at the start of async work, compare after. */
export const playerGeneration = derived(streamPlayer, ($s) => $s.generation);

function mediaUrlFor(item: StreamItem): string | null {
  return item.status === 'ended' ? item.recording || item.url : item.url || item.recording;
}

/**
 * Select a stream. The layout-level dock (`StreamDock`) owns playback —
 * including while its container is slotted into the stream page — so the
 * video element never tears down on navigation.
 */
export function selectStream(item: StreamItem, surface: PlayerSurface = 'dock'): void {
  const current = get(streamPlayer);
  const sameStream = current.item?.key === item.key;
  streamPlayer.set({
    item,
    mediaUrl: mediaUrlFor(item),
    surface,
    expanded: sameStream ? current.expanded : false,
    muted: current.muted,
    status: sameStream ? current.status : 'idle',
    position: sameStream ? current.position : null,
    generation: current.generation + (sameStream ? 0 : 1)
  });
}

/** Hand playback between surfaces (page ⇄ dock) without a media reload. */
export function setSurface(surface: PlayerSurface): void {
  streamPlayer.update((s) => (s.surface === surface ? s : { ...s, surface }));
}

export function setStreamStatus(status: StreamPlayStatus): void {
  streamPlayer.update((s) => ({ ...s, status }));
}

export function setStreamExpanded(expanded: boolean): void {
  streamPlayer.update((s) => ({ ...s, expanded }));
}

export function setStreamMuted(muted: boolean): void {
  streamPlayer.update((s) => ({ ...s, muted }));
}

export function setStreamPosition(position: number | null): void {
  streamPlayer.update((s) => ({ ...s, position }));
}

/** A late update to the selected stream's announcement (viewers, status). */
export function updateStreamItem(item: StreamItem): void {
  streamPlayer.update((s) => {
    if (!s.item || s.item.key !== item.key) return s;
    const updated = { ...s, item, mediaUrl: mediaUrlFor(item) };
    return updated;
  });
}

/** Stop everything: the next selection starts the player from scratch. */
export function stopStream(): void {
  const current = get(streamPlayer);
  streamPlayer.set({ ...initial, generation: current.generation + 1 });
}
