import { writable } from 'svelte/store';
import type { MeshFilters, MeshLayers, MeshVisualTheme } from './meshTypes';

export const meshFilters = writable<MeshFilters>({
  search: '',
  cuisine: [],
  ingredient: [],
  difficulty: [],
  time: [],
  dietary: [],
  lightningGated: null,
  membershipTier: null,
  creator: null
});

export const meshLayers = writable<MeshLayers>({
  recipes: true,
  tags: true,
  chefs: false
});

export const meshVisualTheme = writable<MeshVisualTheme>('default');

export const meshSelectedNodeId = writable<string | null>(null);
