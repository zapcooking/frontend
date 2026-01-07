# Directions Phases Implementation

## Overview
Implemented phase-based collapsible sections for recipe directions, replacing the flat numbered list with grouped accordion sections for better UX on recipes with many steps (e.g., 46-step recipes).

## Files Modified

### 1. `src/lib/parser.ts`
- **Added**: `extractAndGroupDirections()` function
  - Extracts directions from markdown content
  - Groups steps into phases using heuristic keyword matching
  - Returns grouped phases and markdown without the Directions section
- **Added**: `DirectionPhase` interface
  - Defines structure for phase data (id, title, steps)
- **Added**: `PHASE_KEYWORDS` constant
  - Maps phase IDs to keyword arrays for heuristic matching

### 2. `src/components/Recipe/DirectionsPhases.svelte` (NEW)
- New component for rendering collapsible direction phases
- Features:
  - Accordion-style collapsible sections
  - Expand/Collapse all controls
  - URL hash support for deep linking (#directions-crust, etc.)
  - Preview of first 1-2 steps when collapsed
  - Full step list with original numbering when expanded
  - Accessibility: ARIA attributes, keyboard navigation
  - Smooth transitions and dark theme styling

### 3. `src/components/Recipe/Recipe.svelte`
- **Modified**: Import statements to include `extractAndGroupDirections` and `DirectionsPhases`
- **Modified**: Added logic to split markdown into before/after Directions sections
- **Modified**: Replaced single markdown rendering with:
  - Markdown before Directions section
  - DirectionsPhases component
  - Markdown after Directions section

## Phase Grouping Logic

### Default Phases
The system uses generic phases that work for various recipe types:

1. **Preparation** - Initial setup, prep work, separating ingredients
2. **Mixing & Combining** - Combining ingredients, mixing, blending, whisking
3. **Baking & Cooking** - Preheating, baking, cooking, temperature-related steps
4. **Finishing & Serving** - Cooling, garnishing, decorating, serving

### Grouping Algorithm
1. **Keyword Matching**: Match step text against phase keywords to determine which phase it belongs to
2. **Forward-Only Progression**: Phases can only move forward (prevents steps from being assigned to earlier phases)
3. **Fallback**: Steps without matching keywords stay in the current phase
4. **Preserve All Text**: All step text is preserved exactly as written - no labels are removed

### Keyword Examples
- Preparation: "crust", "dough", "pastry", "base", "prepare", "separate bowl"
- Mixing: "mix", "combine", "blend", "beat", "whisk", "fold", "cream", "batter", "add ingredients"
- Baking: "preheat", "bake", "oven", "degrees", "minutes", "scoop", "cookie sheet", "cook"
- Finishing: "cool", "chill", "garnish", "serve", "sprinkle", "decorate", "chocolate", "melt"

## How Recipe Phases Are Grouped

Steps are automatically grouped into phases based on keyword matching in the step text. The system analyzes each step and assigns it to the appropriate phase based on the words it contains.

**Examples:**
- Steps containing "preheat", "bake", "oven", "degrees" → Baking & Cooking phase
- Steps containing "mix", "combine", "whisk", "fold" → Mixing & Combining phase
- Steps containing "garnish", "serve", "decorate" → Finishing & Serving phase
- Steps containing "separate bowl", "prepare" → Preparation phase

## How Developers Edit Phases

### Adding a New Phase
1. Add phase definition to `phases` array in `extractAndGroupDirections()`:
   ```typescript
   { id: 'newphase', title: 'New Phase Name', steps: [] }
   ```
2. Add keywords to `PHASE_KEYWORDS`:
   ```typescript
   newphase: ['keyword1', 'keyword2', 'keyword3']
   ```

### Modifying Phase Keywords
Edit the `PHASE_KEYWORDS` constant in `src/lib/parser.ts`:
```typescript
const PHASE_KEYWORDS: Record<string, string[]> = {
  crust: ['crust', 'dough', ...], // Add/remove keywords here
  // ...
};
```

### Changing Phase Titles
Update the `title` field in the `phases` array in `extractAndGroupDirections()`. Note: Recipe authors can still use the old phase ID in labels (e.g., `crust:` will work even if title changes).

## Assumptions Made

1. **Markdown Structure**: 
   - Primary: Assumes directions are in a `## Directions` section with numbered list format (1. Step one, 2. Step two, etc.)
   - Fallback: Handles unnumbered directions, plain text lines, and various markdown formats
   - Flexible: Can extract directions even without strict markdown structure
2. **Phase Detection**: Relies on keyword matching and explicit phase labels. Recipes without clear phase indicators will group steps sequentially into generic phases.
3. **Step Numbering**: Preserves original global step numbers when available (e.g., step 15 in a phase still shows as "15."). For unnumbered directions, assigns sequential numbers.
4. **Backward Compatibility**: 
   - If directions can't be parsed or grouped, falls back to original markdown rendering
   - Supports legacy phase names (Crust, Cheesecake, Ganache, Garnish) and maps them to new generic phases
5. **Translation**: Directions phases are not translated separately; they use the same translation system as the rest of the recipe content
6. **Recipe Types**: Generic phases work for various recipe types (cookies, cakes, main dishes, etc.), not just cheesecakes

## Testing Considerations

- Test with recipes that have explicit phase labels (e.g., "Crust:", "Ganache:")
- Test with recipes that rely on keyword matching
- Test with recipes that have no clear phase structure (should still group reasonably)
- Test URL hash navigation (#directions-crust, etc.)
- Test expand/collapse all functionality
- Test keyboard navigation and accessibility
- Test on mobile and desktop viewports
- Verify original step numbering is preserved
- Verify all step text is preserved exactly

## Performance Notes

- Grouping happens reactively when recipe content changes
- No backend API changes required
- Markdown parsing is lightweight
- Component uses efficient Svelte reactivity
- Smooth CSS transitions for expand/collapse animations

## Future Improvements

- Allow recipe authors to explicitly tag phases in markdown
- Support custom phase definitions per recipe
- Add phase summaries/descriptions
- Analytics tracking for which phases users expand most
- Print-friendly styles (expand all phases when printing)

