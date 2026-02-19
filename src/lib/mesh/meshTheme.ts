import type { MeshVisualTheme } from './meshTypes';

export interface MeshColorScheme {
  // Edge colors
  edgeRecipeTag: { base: string; highlighted: string; dim: string };
  edgeRecipeRecipe: { base: string; highlighted: string; dim: string; glow: string };
  edgeRecipeChef: { base: string; highlighted: string; dim: string };

  // Node colors
  nodeHeroBorder: string;
  nodeHeroGlow: string;
  nodeNotableBorder: string;
  nodeNotableGlow: string;
  nodeCommunityBorder: string;
  nodeTagBg: string;
  nodeTagBorder: string;
  nodeTagBgHover: string;
  nodeChefGlow: string;

  // Container
  containerBgDark: string;
  containerBgLight: string;

  // Legend
  legendBgDark: string;
  legendBgLight: string;
  legendBorderDark: string;
  legendBorderLight: string;
  legendTextDark: string;
  legendTextLight: string;
}

export const DEFAULT_COLORS: MeshColorScheme = {
  edgeRecipeTag: {
    base: 'rgba(255, 122, 61, 0.08)',
    highlighted: 'rgba(255, 122, 61, 0.25)',
    dim: 'rgba(255, 122, 61, 0.02)'
  },
  edgeRecipeRecipe: {
    base: 'rgba(251, 191, 36, 0.15)',
    highlighted: 'rgba(251, 191, 36, 0.5)',
    dim: 'rgba(251, 191, 36, 0.03)',
    glow: 'rgba(251, 191, 36, 0.2)'
  },
  edgeRecipeChef: {
    base: 'rgba(139, 92, 246, 0.12)',
    highlighted: 'rgba(139, 92, 246, 0.35)',
    dim: 'rgba(139, 92, 246, 0.02)'
  },

  nodeHeroBorder: 'rgb(249, 115, 22)',
  nodeHeroGlow: 'rgba(249, 115, 22, 0.5)',
  nodeNotableBorder: 'rgba(249, 115, 22, 0.5)',
  nodeNotableGlow: 'rgba(249, 115, 22, 0.15)',
  nodeCommunityBorder: 'var(--color-input-border)',
  nodeTagBg: 'rgba(249, 115, 22, 0.08)',
  nodeTagBorder: 'rgba(249, 115, 22, 0.2)',
  nodeTagBgHover: 'rgba(249, 115, 22, 0.15)',
  nodeChefGlow: 'rgba(139, 92, 246, 0.3)',

  containerBgDark: 'radial-gradient(ellipse at center, rgba(20,15,12,1) 0%, rgba(10,8,6,1) 100%)',
  containerBgLight: 'radial-gradient(ellipse at center, rgba(255,252,248,1) 0%, rgba(245,240,235,1) 100%)',

  legendBgDark: 'rgba(20, 15, 12, 0.7)',
  legendBgLight: 'rgba(255, 255, 255, 0.7)',
  legendBorderDark: 'rgba(255, 255, 255, 0.08)',
  legendBorderLight: 'rgba(0, 0, 0, 0.08)',
  legendTextDark: 'rgba(255, 255, 255, 0.5)',
  legendTextLight: 'rgba(0, 0, 0, 0.6)'
};

export const CONSTELLATION_COLORS: MeshColorScheme = {
  edgeRecipeTag: {
    base: 'rgba(180, 200, 240, 0.06)',
    highlighted: 'rgba(180, 200, 240, 0.25)',
    dim: 'rgba(180, 200, 240, 0.015)'
  },
  edgeRecipeRecipe: {
    base: 'rgba(180, 200, 240, 0.1)',
    highlighted: 'rgba(180, 200, 240, 0.4)',
    dim: 'rgba(180, 200, 240, 0.02)',
    glow: 'rgba(180, 200, 240, 0.15)'
  },
  edgeRecipeChef: {
    base: 'rgba(180, 200, 240, 0.08)',
    highlighted: 'rgba(180, 200, 240, 0.3)',
    dim: 'rgba(180, 200, 240, 0.015)'
  },

  nodeHeroBorder: 'rgba(220, 230, 255, 0.9)',
  nodeHeroGlow: 'rgba(200, 220, 255, 0.5)',
  nodeNotableBorder: 'rgba(180, 200, 240, 0.5)',
  nodeNotableGlow: 'rgba(180, 200, 240, 0.2)',
  nodeCommunityBorder: 'rgba(140, 160, 200, 0.3)',
  nodeTagBg: 'rgba(180, 200, 240, 0.08)',
  nodeTagBorder: 'rgba(180, 200, 240, 0.25)',
  nodeTagBgHover: 'rgba(180, 200, 240, 0.15)',
  nodeChefGlow: 'rgba(180, 200, 240, 0.3)',

  containerBgDark: 'radial-gradient(ellipse at center, rgba(10,12,25,1) 0%, rgba(3,5,15,1) 100%)',
  containerBgLight: 'radial-gradient(ellipse at center, rgba(15,18,35,1) 0%, rgba(5,8,20,1) 100%)',

  legendBgDark: 'rgba(10, 12, 25, 0.7)',
  legendBgLight: 'rgba(10, 12, 25, 0.7)',
  legendBorderDark: 'rgba(180, 200, 240, 0.1)',
  legendBorderLight: 'rgba(180, 200, 240, 0.1)',
  legendTextDark: 'rgba(180, 200, 240, 0.5)',
  legendTextLight: 'rgba(180, 200, 240, 0.5)'
};

/**
 * Get the color scheme for the given visual theme.
 * In constellation mode, dark/light distinction doesn't apply — always uses dark space palette.
 */
export function getThemeColors(visualTheme: MeshVisualTheme): MeshColorScheme {
  return visualTheme === 'constellation' ? CONSTELLATION_COLORS : DEFAULT_COLORS;
}

/**
 * Get edge color for dark mode, factoring in visual theme.
 */
export function getEdgeColors(
  visualTheme: MeshVisualTheme,
  isDarkMode: boolean
): {
  recipeTagBase: string;
  recipeTagHighlight: string;
  recipeTagDim: string;
  recipeRecipeGlow: string;
} {
  const colors = getThemeColors(visualTheme);
  // Constellation always uses its own palette
  if (visualTheme === 'constellation') {
    return {
      recipeTagBase: colors.edgeRecipeTag.base,
      recipeTagHighlight: colors.edgeRecipeTag.highlighted,
      recipeTagDim: colors.edgeRecipeTag.dim,
      recipeRecipeGlow: colors.edgeRecipeRecipe.glow
    };
  }
  // Default theme adapts to light/dark
  if (isDarkMode) {
    return {
      recipeTagBase: 'rgba(255, 122, 61, 0.08)',
      recipeTagHighlight: 'rgba(255, 122, 61, 0.25)',
      recipeTagDim: 'rgba(255, 122, 61, 0.02)',
      recipeRecipeGlow: 'rgba(251, 191, 36, 0.2)'
    };
  }
  return {
    recipeTagBase: 'rgba(236, 71, 0, 0.05)',
    recipeTagHighlight: 'rgba(236, 71, 0, 0.18)',
    recipeTagDim: 'rgba(236, 71, 0, 0.01)',
    recipeRecipeGlow: 'rgba(234, 88, 12, 0.15)'
  };
}
