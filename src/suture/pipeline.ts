import { OneEuro2D } from './filter.ts';
import { angleDiff } from './geometry.ts';
import type { Vec2 } from './geometry.ts';
import { Grip } from './grip.ts';
import { PinchDetector, sampleOf } from './hand-input.ts';
import type { RawHandLike } from './hand-input.ts';
import { Identity } from './identity.ts';
import type { Sides } from './identity.ts';
import { makePad } from './pad.ts';
import type { Hand, Pad } from './pad.ts';
import { SutureMachine } from './steps.ts';
import type { MachineFrame, Snapshot } from './steps.ts';

export interface ToolState {
  tracked: boolean;
  held: boolean;
  pinched: boolean;
  /** Filtered position of the pinch point, in scene units. */
  pos: Vec2;
  /** Where the hand points, in radians, smoothed. */
  angle: number;
}

type Tool = 'needle' | 'forceps';

/**
 * Everything between the tracker's hands and the step machine, with no camera or drawing in it, so the whole flow
 * can be driven by scripted hands as well as by a webcam.
 */
export class Pipeline {
  readonly pad: Pad;
  readonly identity = new Identity();
  private readonly machine: SutureMachine;
  private readonly filters: Record<Tool, OneEuro2D> = { needle: new OneEuro2D(), forceps: new OneEuro2D() };
  private readonly pinch: Record<Tool, PinchDetector> = { needle: new PinchDetector(), forceps: new PinchDetector() };
  private readonly grips: Record<Tool, Grip> = { needle: new Grip(), forceps: new Grip() };
  private readonly seenAngle: Record<Tool, boolean> = { needle: false, forceps: false };
  private readonly needleSide: 'L' | 'R';
  private readonly forcepsSide: 'L' | 'R';
  tools: Record<Tool, ToolState>;
  /** The hands as last seen and assigned, for drawing the skeletons. */
  seen: Sides = {};
  snapshot: Snapshot;
  private lastResultT = -Infinity;
  /** A reading older than this means the tracker has stopped giving results. */
  private readonly staleMs = 300;

  constructor(aspect: number, dominant: Hand = 'R') {
    this.pad = makePad(aspect, dominant);
    this.machine = new SutureMachine(this.pad);
    this.needleSide = dominant;
    this.forcepsSide = dominant === 'R' ? 'L' : 'R';
    this.tools = this.restingTools();
    this.snapshot = new SutureMachine(this.pad).update(this.frame(0));
  }

  private restingTools(): Record<Tool, ToolState> {
    return {
      needle: { tracked: false, held: false, pinched: false, pos: { ...this.pad.tray.needle }, angle: -Math.PI / 2 },
      forceps: { tracked: false, held: false, pinched: false, pos: { ...this.pad.tray.forceps }, angle: -Math.PI / 2 },
    };
  }

  /** Starts the procedure again. What was learned about the camera's labels is kept. */
  reset(): void {
    this.machine.reset();
    for (const tool of ['needle', 'forceps'] as Tool[]) {
      this.filters[tool].reset();
      this.pinch[tool].reset();
      this.grips[tool].reset();
      this.seenAngle[tool] = false;
    }
    this.tools = this.restingTools();
    this.seen = {};
    this.lastResultT = -Infinity;
    this.snapshot = new SutureMachine(this.pad).update(this.frame(0));
  }

  private frame(tMs: number): MachineFrame {
    const { needle, forceps } = this.tools;
    return {
      t: tMs,
      needle: { tracked: needle.tracked, held: needle.held, pos: needle.pos, angle: needle.angle },
      forceps: { tracked: forceps.tracked, held: forceps.held, pos: forceps.pos, angle: forceps.angle },
    };
  }

  private feed(tool: Tool, hand: RawHandLike | undefined, aspect: number, tMs: number): void {
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
  push(tMs: number, hands: RawHandLike[], aspect: number): Snapshot {
    this.lastResultT = tMs;
    this.seen = this.identity.update(hands, aspect, tMs);
    this.feed('needle', this.seen[this.needleSide], aspect, tMs);
    this.feed('forceps', this.seen[this.forcepsSide], aspect, tMs);
    this.snapshot = this.machine.update(this.frame(tMs));
    return this.snapshot;
  }

  /** Counts the current step as done, for a trainee who is stuck. It takes effect on the next update. */
  skip(): void {
    this.machine.skip();
  }

  /** Call every drawn frame so timers keep running between tracker results, and a stalled tracker counts as hands lost. */
  tick(tMs: number): Snapshot {
    if (tMs - this.lastResultT > this.staleMs) {
      this.seen = {};
      for (const tool of ['needle', 'forceps'] as Tool[]) {
        this.tools[tool].tracked = false;
        this.tools[tool].held = this.grips[tool].update(tMs, false, this.tools[tool].pinched);
      }
    }
    this.snapshot = this.machine.update(this.frame(tMs));
    return this.snapshot;
  }
}
