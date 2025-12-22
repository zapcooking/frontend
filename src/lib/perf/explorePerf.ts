/**
 * Performance instrumentation for the Explore page route
 * Measures timings to understand cold load performance
 */

let startTime: number | null = null;
const markedLabels = new Set<string>();

/**
 * Initialize the performance timer (should be called at the earliest point of Explore route)
 */
export function init(): void {
  startTime = performance.now();
  markedLabels.clear();
}

/**
 * Mark a performance point and log it
 * @param label - The label for this performance mark
 */
export function mark(label: string): void {
  if (startTime === null) {
    console.warn(`[perf:explore] mark() called before init() for label: ${label}`);
    return;
  }
  const elapsed = performance.now() - startTime;
  console.log(`[perf:explore] ${label} +${Math.round(elapsed)}ms`);
}

/**
 * Mark a performance point only once per navigation
 * @param label - The label for this performance mark
 */
export function markOnce(label: string): void {
  if (markedLabels.has(label)) {
    return;
  }
  markedLabels.add(label);
  mark(label);
}

/**
 * Reset the performance timer and clear marked labels
 * Call this when navigating to the Explore route
 */
export function reset(): void {
  startTime = null;
  markedLabels.clear();
}

