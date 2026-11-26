import { add, lerp, mul, sub } from './geometry.ts';
import type { Vec2 } from './geometry.ts';
import type { RawHandLike } from './hand-input.ts';

/**
 * The 21 points of a hand, in scene units, built from where its pinch point is, where it points and whether it is
 * pinched. Not anatomy: just enough structure to read position, direction and pinch from it, and to draw a hint.
 */
export function handPoints(pos: Vec2, angle: number, pinched: boolean, palm = 0.13): Vec2[] {
  const d: Vec2 = { x: Math.cos(angle), y: Math.sin(angle) };
  const q: Vec2 = { x: -d.y, y: d.x };
  const delta = (pinched ? 0.05 : 0.45) * palm;
  const wrist = sub(pos, mul(d, palm * 1.5));
  const knuckle = add(wrist, mul(d, palm));
  const pts: Vec2[] = new Array<Vec2>(21);
  pts[0] = wrist;
  pts[9] = knuckle;
  pts[5] = sub(knuckle, mul(q, 0.3 * palm));
  pts[13] = add(knuckle, mul(q, 0.3 * palm));
  pts[17] = add(knuckle, mul(q, 0.6 * palm));
  pts[4] = sub(pos, mul(q, delta));
  pts[8] = add(pos, mul(q, delta));
  const thumbBase = add(wrist, mul(q, -0.2 * palm));
  for (let i = 1; i <= 3; i++) pts[i] = lerp(thumbBase, pts[4], i / 4);
  pts[6] = lerp(pts[5], pts[8], 1 / 3);
  pts[7] = lerp(pts[5], pts[8], 2 / 3);
  for (const m of [9, 13, 17]) for (let k = 1; k <= 3; k++) pts[m + k] = add(pts[m], mul(d, palm * 0.3 * k));
  return pts;
}

/** The same hand as the tracker would report it: the unmirrored picture, 21 points flattened. Used by the demo and the offline checks. */
export function syntheticHand(
  pos: Vec2,
  angle: number,
  pinched: boolean,
  label: 'Left' | 'Right',
  aspect: number,
  palm = 0.13,
  score = 0.97,
): RawHandLike {
  // Scene units are mirrored, the tracker's picture is not: x_raw = 1 - X / aspect.
  const lm: number[] = [];
  for (const p of handPoints(pos, angle, pinched, palm)) lm.push(1 - p.x / aspect, p.y, 0);
  return { label, score, lm };
}
