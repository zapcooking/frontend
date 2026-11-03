/**
 * Shared motion helpers for transitions.dev-based animations.
 *
 * Svelte 4's easing module has no custom cubic-bezier factory, so the
 * recipes' curves are evaluated here with Newton–Raphson.
 */

/** True when the user has asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Build an easing function for a CSS cubic-bezier curve.
 * Clamps to 0..1 at the endpoints, as CSS does.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = 3 * u * (1 - u) ** 2 * x1 + 3 * u * u * (1 - u) * x2 + u ** 3 - t;
      if (Math.abs(x) < 1e-5) break;
      const d = 3 * (1 - u) ** 2 * x1 + 6 * u * (1 - u) * (x2 - x1) + 3 * u * u * (1 - x2);
      if (Math.abs(d) < 1e-6) break;
      u -= x / d;
    }
    return 3 * u * (1 - u) ** 2 * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
  };
}
