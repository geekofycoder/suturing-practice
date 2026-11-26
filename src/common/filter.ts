import type { Vec2 } from './geometry.ts';

/**
 * One-euro filter for a 2D point: steady when the hand is nearly still, and almost no lag when it moves.
 * The tracker reports about 15 times a second on a CPU, so the cutoff has to rise quickly with speed.
 */
export class OneEuro2D {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private x: Vec2 | null = null;
  private dx: Vec2 = { x: 0, y: 0 };
  private t: number | null = null;

  constructor(minCutoff = 1.2, beta = 4, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.x = null;
    this.t = null;
    this.dx = { x: 0, y: 0 };
  }

  /** `tSec` is the time of this reading in seconds. */
  filter(p: Vec2, tSec: number): Vec2 {
    if (this.x === null || this.t === null) {
      this.x = { ...p };
      this.t = tSec;
      this.dx = { x: 0, y: 0 };
      return { ...p };
    }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const alpha = (cutoff: number): number => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
    const raw = { x: (p.x - this.x.x) / dt, y: (p.y - this.x.y) / dt };
    const aD = alpha(this.dCutoff);
    this.dx = { x: this.dx.x + aD * (raw.x - this.dx.x), y: this.dx.y + aD * (raw.y - this.dx.y) };
    const a = alpha(this.minCutoff + this.beta * Math.hypot(this.dx.x, this.dx.y));
    this.x = { x: this.x.x + a * (p.x - this.x.x), y: this.x.y + a * (p.y - this.x.y) };
    return { ...this.x };
  }
}
