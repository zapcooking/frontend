// Re-export shim — all mesh logic now lives in src/lib/mesh/*
// This file exists for backward compatibility with existing imports.

export { fetchMeshRecipes, fetchMeshEngagement, extractRecipeTags, buildMeshGraph } from './mesh/meshData';
export type { RecipeNode, TagNode, ChefNode, MeshNode, MeshEdge, EngagementMap } from './mesh/meshTypes';
