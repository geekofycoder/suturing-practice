import { OneEuro2D } from './filter.ts';
import { angleDiff } from './geometry.ts';
import type { Vec2 } from './geometry.ts';
import { Grip } from './grip.ts';
import { PinchDetector, sampleOf } from './hand-input.ts';
import type { RawHandLike } from './hand-input.ts';
import { Identity } from './identity.ts';
import type { Sides } from './identity.ts';

export type Hand = 'R' | 'L';
export type ToolName = 'primary' | 'secondary';

export interface RigTool {
  /** The hand is in the picture right now. */
  tracked: boolean;
  /** The instrument is in the hand: debounced, so a flicker or a short loss does not let go. Use it for "keep holding". */
  held: boolean;
  /** The fingers are closed right now, undebounced. Use it for pushing and pulling, so nothing moves while the hand is open. */
  pinched: boolean;
  /** Filtered position of the pinch point, in scene units on the mirrored view. */
  pos: Vec2;
  /** Where the hand points, in radians, smoothed. */
  angle: number;
}

/**
 * Turns the tracker's hands into two instruments: the primary (the dominant hand) and the secondary (the other).
 * Which hand is which comes from where the hands are on the screen; the tracker's own labels only break ties.
 * No camera or drawing code, so scripted hands can drive it as well as a webcam.
 */
export class Rig {
  readonly identity = new Identity();
  tools: Record<ToolName, RigTool>;
  /** The hands as last seen and assigned, for drawing outlines. */
  seen: Sides = {};
  private readonly filters: Record<ToolName, OneEuro2D> = { primary: new OneEuro2D(), secondary: new OneEuro2D() };
  private readonly pinch: Record<ToolName, PinchDetector> = { primary: new PinchDetector(), secondary: new PinchDetector() };
  private readonly grips: Record<ToolName, Grip> = { primary: new Grip(), secondary: new Grip() };
  private readonly seenAngle: Record<ToolName, boolean> = { primary: false, secondary: false };
  private readonly side: Record<ToolName, 'L' | 'R'>;
  private lastResultT = -Infinity;
  /** A reading older than this means the tracker has stopped giving results. */
  private readonly staleMs = 300;

  constructor(dominant: Hand, rest: Record<ToolName, Vec2>) {
    this.side = { primary: dominant, secondary: dominant === 'R' ? 'L' : 'R' };
    this.tools = this.resting(rest);
  }

  private resting(rest: Record<ToolName, Vec2>): Record<ToolName, RigTool> {
    return {
      primary: { tracked: false, held: false, pinched: false, pos: { ...rest.primary }, angle: -Math.PI / 2 },
      secondary: { tracked: false, held: false, pinched: false, pos: { ...rest.secondary }, angle: -Math.PI / 2 },
    };
  }

  /** Starts again. What was learned about the camera's labels is kept. */
  reset(rest: Record<ToolName, Vec2>): void {
    for (const tool of ['primary', 'secondary'] as ToolName[]) {
      this.filters[tool].reset();
      this.pinch[tool].reset();
      this.grips[tool].reset();
      this.seenAngle[tool] = false;
    }
    this.tools = this.resting(rest);
    this.seen = {};
    this.lastResultT = -Infinity;
  }

  private feed(tool: ToolName, hand: RawHandLike | undefined, aspect: number, tMs: number): void {
    const state = this.tools[tool];
    if (hand) {
      const sample = sampleOf(hand, aspect);
      state.pos = this.filters[tool].filter(sample.pos, tMs / 1000);
      state.angle = this.seenAngle[tool] ? state.angle + angleDiff(sample.angle, state.angle) * 0.4 : sample.angle;
      this.seenAngle[tool] = true;
      state.pinched = this.pinch[tool].update(sample.pinchRatio);
      state.tracked = true;
    } else {
      state.tracked = false;
    }
    state.held = this.grips[tool].update(tMs, state.tracked, state.pinched);
  }

  /** One result from the tracker. */
  push(tMs: number, hands: RawHandLike[], aspect: number): void {
    this.lastResultT = tMs;
    this.seen = this.identity.update(hands, aspect, tMs);
    this.feed('primary', this.seen[this.side.primary], aspect, tMs);
    this.feed('secondary', this.seen[this.side.secondary], aspect, tMs);
  }

  /** Call every drawn frame, so a stalled tracker counts as hands lost and the grips' timers keep running. */
  tick(tMs: number): void {
    if (tMs - this.lastResultT > this.staleMs) {
      this.seen = {};
      for (const tool of ['primary', 'secondary'] as ToolName[]) {
        this.tools[tool].tracked = false;
        this.tools[tool].held = this.grips[tool].update(tMs, false, this.tools[tool].pinched);
      }
    }
  }
}
