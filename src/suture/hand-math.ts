// Distances on a hand's 21 points. `lm` is the points flattened as [x0, y0, z0, x1, ...] in the tracker's picture
// (x and y from 0 to 1). Erasable TypeScript only, so this also runs under plain `node file.ts`.

/** Wrists closer than this many palm lengths count as overlapping hands, which is when the tracker tends to lose one. */
export const OVERLAP_PALMS = 1.6;

interface Pt {
  x: number;
  y: number;
}

/** A point with x scaled by the picture's aspect, so distances are in picture heights. */
function at(lm: number[], i: number, aspect: number): Pt {
  return { x: lm[i * 3] * aspect, y: lm[i * 3 + 1] };
}

function gap(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Wrist to middle-finger knuckle, in picture heights. */
export function palmLength(lm: number[], aspect: number): number {
  return gap(at(lm, 0, aspect), at(lm, 9, aspect));
}

/** Thumb tip to index tip over palm length. Small means pinched. */
export function pinchRatio(lm: number[], aspect: number): number {
  const palm = palmLength(lm, aspect);
  return palm > 1e-6 ? gap(at(lm, 4, aspect), at(lm, 8, aspect)) / palm : Infinity;
}
