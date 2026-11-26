import { palmLength, pinchRatio } from './hand-math.ts';
import type { Vec2 } from './geometry.ts';

/** What the page needs from one tracked hand. `lm` is 21 points flattened, in the tracker's unmirrored picture. */
export interface RawHandLike {
  label: 'Left' | 'Right';
  score: number;
  lm: number[];
}

export interface HandSample {
  /** Midpoint between thumb tip and index tip, in scene units on the mirrored view. */
  pos: Vec2;
  wrist: Vec2;
  /** Direction from the wrist to the middle knuckle, in radians: where the hand points. */
  angle: number;
  /** Thumb tip to index tip over palm length. Small means pinched. */
  pinchRatio: number;
  palm: number;
}

/** Scene units are picture heights, with x mirrored so the view behaves like a mirror. */
export function sampleOf(hand: RawHandLike, aspect: number): HandSample {
  const lm = hand.lm;
  const X = (i: number): number => (1 - lm[i * 3]) * aspect;
  const Y = (i: number): number => lm[i * 3 + 1];
  const wrist = { x: X(0), y: Y(0) };
  const knuckle = { x: X(9), y: Y(9) };
  return {
    pos: { x: (X(4) + X(8)) / 2, y: (Y(4) + Y(8)) / 2 },
    wrist,
    angle: Math.atan2(knuckle.y - wrist.y, knuckle.x - wrist.x),
    pinchRatio: pinchRatio(lm, aspect),
    palm: palmLength(lm, aspect),
  };
}

/** Pinch with hysteresis: closes below `on`, opens above `off`, so a hand near the threshold does not flicker. */
export class PinchDetector {
  state = false;
  private readonly on: number;
  private readonly off: number;

  constructor(on = 0.35, off = 0.55) {
    this.on = on;
    this.off = off;
  }

  reset(): void {
    this.state = false;
  }

  update(ratio: number): boolean {
    if (this.state) {
      if (ratio > this.off) this.state = false;
    } else if (ratio < this.on) {
      this.state = true;
    }
    return this.state;
  }
}
