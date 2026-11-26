import type { Vec2 } from '../common/geometry.ts';
import { angleDiff, clamp, cross, dist, dot, sub } from '../common/geometry.ts';
import type { Pad } from './pad.ts';

/** The needle holder is picked up once; then every stitch goes hold, enter, drive, pull. */
export type StepId = 'grip-needle' | 'hold' | 'enter' | 'drive' | 'pull' | 'done';
/** The steps that repeat for every stitch. */
export const STITCH_STEPS: StepId[] = ['hold', 'enter', 'drive', 'pull'];

export const STEP_TITLES: Record<StepId, string> = {
  'grip-needle': 'Pick up the needle holder',
  hold: 'Hold the wound edge',
  enter: 'Position the needle',
  drive: 'Pass the needle across',
  pull: 'Draw the thread through',
  done: 'Wound closed',
};

/** Seconds a position must be held, and when hints appear. Placeholders until a clinician reviews them. */
export const TIMING = {
  grip: 0.4,
  hold: 0.3,
  enter: 0.35,
  exit: 0.2,
  pull: 0.25,
  regrip: 0.3,
  /** A hint for the step appears after this long without progress. */
  hintAfter: 4,
  /** A hint raised by a mistake stays this long. */
  hintShow: 3,
  /** The needle-direction tip appears only once the pass has stalled this long. */
  tipAfter: 2,
  /** Part-way through drawing the thread, stopping this long brings a warning, and this long lets it slip back. */
  pullWarn: 1,
  pullSlip: 2.2,
};
/** Drawing the thread counts as under way past this share of the pull, and as finished from `PULL_DONE`. */
const PULL_MIN = 0.05;
const PULL_DONE = 0.95;
/** Progress smaller than this on a hand that is still is tracker noise, not drawing the thread through. */
const PULL_STEP = 0.02;
/** The needle should point roughly along the line; a tip appears past this angle (radians), and only a tip. */
const NEEDLE_ANGLE_TIP = 1.1;

export interface ToolFrame {
  tracked: boolean;
  held: boolean;
  pos: Vec2;
  /** Where the hand points, in radians. */
  angle: number;
}
export interface MachineFrame {
  /** Milliseconds. */
  t: number;
  needle: ToolFrame;
  forceps: ToolFrame;
}
export interface Target {
  kind: 'none' | 'ring' | 'line';
  pos?: Vec2;
  radius?: number;
}
export interface SiteView {
  order: number;
  x: number;
  entry: Vec2;
  exit: Vec2;
  forceps: Vec2;
  state: 'todo' | 'now' | 'done';
  /** How far the edges have been drawn together at this stitch, 0 to 1. */
  closed: number;
}
export interface StitchMetrics {
  seconds: number;
  /** Average distance from the line while passing the needle, as a share of the lane's half-width. */
  meanDeviation: number | null;
}
export interface Metrics {
  seconds: number;
  stitches: StitchMetrics[];
  needleDrops: number;
  leftLane: number;
  forcepsLapses: number;
  /** Times the thread slipped back because the pull stopped, was let go of, or left the line. */
  pullRetries: number;
  skipped: number;
}
export interface Snapshot {
  step: StepId;
  /** The stitch being worked on, counting from 1. */
  stitch: number;
  stitchCount: number;
  title: string;
  instruction: string;
  hint: string | null;
  /** 0 to 1 within the current step. */
  progress: number;
  target: Target;
  /** The forceps have to be holding the edge right now (positioning and passing the needle). */
  forcepsNeeded: boolean;
  /** ...and they are. */
  forcepsOk: boolean;
  /** The needle holder has been dropped and has to be picked up again. */
  needleLocked: boolean;
  driveProgress: number;
  pullProgress: number;
  /** False after the thread has slipped back: the needle holder has to go back to the exit ring to start the pull again. */
  pullArmed: boolean;
  sites: SiteView[];
  done: boolean;
  /** What happened on this update, for logging and tests. */
  events: string[];
  metrics: Metrics | null;
}

function copy(step: StepId, needleHand: string, forcepsHand: string, count: number): { instruction: string } {
  switch (step) {
    case 'grip-needle':
      return { instruction: `Pinch your thumb and index finger together with your ${needleHand} hand to pick up the needle holder.` };
    case 'hold':
      return { instruction: `Pinch with your ${forcepsHand} hand and hold the forceps on the ring at the edge of the wound.` };
    case 'enter':
      return { instruction: 'Keep the forceps held. Touch the needle tip to the entry ring and hold still.' };
    case 'drive':
      return { instruction: 'Keep the forceps held. Follow the line from the entry ring to the exit ring, between the guide lines.' };
    case 'pull':
      return { instruction: 'You can let go of the forceps. Draw the needle holder straight up along the line in one steady pull until the wound edges meet. If you stop or let go, the thread slips back and you try again.' };
    default:
      return { instruction: `The wound is closed with ${count} stitches. Each knot is drawn for you; tying knots is not practised here.` };
  }
}

export class SutureMachine {
  private readonly pad: Pad;
  private step: StepId = 'grip-needle';
  private stitch = 0;
  private hold = 0;
  private maxS = 0;
  private pullP = 0;
  /** How far the pull had got the last time it clearly moved, and how long it has been still since. */
  private pullMark = 0;
  private pullStall = 0;
  private pullRetries = 0;
  /** False after the thread has slipped back, until the needle holder is back inside the exit ring. */
  private pullArmed = true;
  /** Where along the pull the needle holder was when it was last armed: progress counts from there. */
  private pullBase = 0;
  /** The thread slipped back because the needle holder was dropped: say so once it is picked up again. */
  private slipNote = false;
  private closed: number[];
  private needsRegrip = false;
  private regrip = 0;
  private forcepsLapsed = false;
  private sinceProgress = 0;
  private lastT: number | null = null;
  private startT: number | null = null;
  private stitchStartT: number | null = null;
  private endT: number | null = null;
  private drops = 0;
  private leaves = 0;
  private lapses = 0;
  private skips = 0;
  private skipFlag = false;
  private devSum: number[];
  private devN: number[];
  private stitchSeconds: number[] = [];
  /** How long the needle hand was out of sight just before the current update. */
  private needleLost = 0;
  private override: { text: string; until: number } | null = null;

  constructor(pad: Pad) {
    this.pad = pad;
    this.closed = pad.sites.map(() => 0);
    this.devSum = pad.sites.map(() => 0);
    this.devN = pad.sites.map(() => 0);
  }

  reset(): void {
    this.step = 'grip-needle';
    this.stitch = 0;
    this.hold = 0;
    this.maxS = 0;
    this.pullP = 0;
    this.pullMark = 0;
    this.pullStall = 0;
    this.pullRetries = 0;
    this.pullArmed = true;
    this.pullBase = 0;
    this.slipNote = false;
    this.closed = this.pad.sites.map(() => 0);
    this.needsRegrip = false;
    this.regrip = 0;
    this.forcepsLapsed = false;
    this.sinceProgress = 0;
    this.lastT = null;
    this.startT = null;
    this.stitchStartT = null;
    this.endT = null;
    this.drops = 0;
    this.leaves = 0;
    this.lapses = 0;
    this.skips = 0;
    this.skipFlag = false;
    this.devSum = this.pad.sites.map(() => 0);
    this.devN = this.pad.sites.map(() => 0);
    this.stitchSeconds = [];
    this.needleLost = 0;
    this.override = null;
  }

  /** Counts the current step as done, for a trainee who is stuck. It takes effect on the next update. */
  skip(): void {
    this.skipFlag = true;
  }

  private advance(tMs: number, events: string[]): void {
    this.hold = 0;
    this.sinceProgress = 0;
    this.override = null;
    this.pullArmed = true;
    this.pullBase = 0;
    if (this.step === 'grip-needle') {
      this.step = 'hold';
      this.stitchStartT = tMs;
    } else if (this.step === 'hold') {
      this.step = 'enter';
    } else if (this.step === 'enter') {
      this.step = 'drive';
    } else if (this.step === 'drive') {
      this.step = 'pull';
      this.maxS = 1;
    } else if (this.step === 'pull') {
      this.closed[this.stitch] = 1;
      this.stitchSeconds[this.stitch] = Math.round(((tMs - (this.stitchStartT ?? tMs)) / 1000) * 10) / 10;
      events.push(`stitch:placed:${this.stitch + 1}`);
      this.stitch++;
      this.maxS = 0;
      this.pullP = 0;
      this.pullMark = 0;
      this.pullStall = 0;
      this.forcepsLapsed = false;
      if (this.stitch >= this.pad.sites.length) {
        this.step = 'done';
        this.endT = tMs;
      } else {
        this.step = 'hold';
        this.stitchStartT = tMs;
      }
    }
    events.push(`step:${this.step}`);
    if (this.step === 'done') events.push('done');
  }

  private raise(text: string, tMs: number): void {
    this.override = { text, until: tMs + TIMING.hintShow * 1000 };
  }

  /** The thread slips back to where it started, and the pull has to be done again. */
  private slipBack(events: string[]): void {
    this.pullP = 0;
    this.pullMark = 0;
    this.pullStall = 0;
    this.hold = 0;
    this.sinceProgress = 0;
    this.pullArmed = false;
    this.pullRetries++;
    events.push('pull:retry');
  }

  update(f: MachineFrame): Snapshot {
    const pad = this.pad;
    const events: string[] = [];
    const dt = this.lastT === null ? 0 : clamp((f.t - this.lastT) / 1000, 0, 0.25);
    this.lastT = f.t;
    if (this.startT === null) this.startT = f.t;
    this.sinceProgress += dt;
    // After a short loss of the hand the needle is found further along, so a bigger step forward is allowed.
    const lostBefore = f.needle.tracked ? this.needleLost : 0;
    this.needleLost = f.needle.tracked ? 0 : this.needleLost + dt;
    const needleHand = pad.dominant === 'R' ? 'right' : 'left';
    const forcepsHand = pad.dominant === 'R' ? 'left' : 'right';
    let hint: string | null = null;
    let progress = 0;
    let forcepsOk = false;

    if (this.skipFlag && this.step !== 'done') {
      this.skipFlag = false;
      this.skips++;
      events.push('skip');
      if (this.step === 'drive') this.maxS = 1;
      if (this.step === 'pull') this.pullP = 1;
      this.advance(f.t, events);
    }

    const site = pad.sites[Math.min(this.stitch, pad.sites.length - 1)];

    if (this.step !== 'done') {
      // After the first step the needle holder has to stay in the hand.
      if (this.step !== 'grip-needle') {
        if (!f.needle.held && !this.needsRegrip) {
          this.needsRegrip = true;
          this.drops++;
          this.regrip = 0;
          this.hold = 0;
          if (this.step === 'drive') this.maxS = 0;
          if (this.step === 'pull' && this.pullP > PULL_MIN && this.pullP < PULL_DONE) {
            this.slipBack(events);
            this.slipNote = true;
          }
          events.push('drop:needle');
        }
        if (this.needsRegrip) {
          if (f.needle.held) {
            this.regrip += dt;
            if (this.regrip >= TIMING.regrip) {
              this.needsRegrip = false;
              this.regrip = 0;
              this.sinceProgress = 0;
              events.push('regrip');
              if (this.slipNote) {
                this.slipNote = false;
                this.raise('The thread slipped back when you let go. Go back to the exit ring and draw it through again in one steady pull.', f.t);
              }
            }
          } else {
            this.regrip = 0;
          }
        }
      }

      const forcepsDist = dist(f.forceps.pos, site.forceps);
      forcepsOk = f.forceps.held && forcepsDist <= pad.forcepsKeep;

      if (this.needsRegrip) {
        hint = f.needle.tracked
          ? `Pinch with your ${needleHand} hand to pick the needle holder up again.`
          : `Show your ${needleHand} hand to the camera.`;
      } else {
        const needForceps = this.step === 'enter' || this.step === 'drive';
        // A lapse is counted and hinted at. It stops the hold in "enter" and the finish of the pass in "drive",
        // but the path is still followed, so a trainee who keeps going can take hold again and finish.
        let forcepsHint: string | null = null;
        if (needForceps) {
          if (!forcepsOk) {
            if (!this.forcepsLapsed) {
              this.forcepsLapsed = true;
              this.lapses++;
              this.hold = 0;
              events.push('lapse:forceps');
            }
            forcepsHint = f.forceps.tracked
              ? `Keep the forceps held on the ring with your ${forcepsHand} hand.`
              : `Show your ${forcepsHand} hand to the camera.`;
          } else {
            this.forcepsLapsed = false;
          }
        }
        const stale = this.sinceProgress > TIMING.hintAfter;

        if (this.step === 'grip-needle') {
          if (f.needle.held) {
            this.hold += dt;
            this.sinceProgress = 0;
          } else {
            this.hold = Math.max(0, this.hold - dt * 2);
          }
          progress = clamp(this.hold / TIMING.grip, 0, 1);
          if (this.hold >= TIMING.grip) this.advance(f.t, events);
          else if (!f.needle.tracked) hint = `Show your ${needleHand} hand to the camera.`;
          else if (stale) hint = 'Bring your thumb and index fingertip together.';
        } else if (this.step === 'hold') {
          if (f.forceps.held && forcepsDist <= pad.forcepsRadius) {
            this.hold += dt;
            this.sinceProgress = 0;
          } else {
            this.hold = Math.max(0, this.hold - dt * 2);
          }
          progress = clamp(this.hold / TIMING.hold, 0, 1);
          if (this.hold >= TIMING.hold) this.advance(f.t, events);
          else if (!f.forceps.tracked) hint = `Show your ${forcepsHand} hand to the camera.`;
          else if (stale) hint = f.forceps.held ? 'Move the forceps onto the ring.' : `Pinch with your ${forcepsHand} hand.`;
        } else if (this.step === 'enter') {
          if (!forcepsOk) {
            hint = forcepsHint;
          } else {
            if (dist(f.needle.pos, site.entry) <= pad.entryRadius) {
              this.hold += dt;
              this.sinceProgress = 0;
            } else {
              this.hold = Math.max(0, this.hold - dt * 2);
            }
            progress = clamp(this.hold / TIMING.enter, 0, 1);
            if (this.hold >= TIMING.enter) this.advance(f.t, events);
            else if (stale) hint = 'Bring the needle tip onto the entry ring.';
          }
        } else if (this.step === 'drive') {
          const rel = sub(f.needle.pos, site.entry);
          const s = dot(rel, pad.dir) / pad.driveLength;
          const off = Math.abs(cross(pad.dir, rel));
          if (off > pad.corridor * 1.4 && this.maxS > 0.05) {
            this.leaves++;
            this.maxS = 0;
            this.hold = 0;
            events.push('leave:lane');
            this.raise('Stay between the guide lines. Start again from the entry ring.', f.t);
          } else if (off <= pad.corridor) {
            if (s > this.maxS && s - this.maxS < 0.4 + 1.5 * lostBefore) {
              this.maxS = Math.min(1, s);
              this.sinceProgress = 0;
            }
            if (s > 0.02 && s <= 1.05) {
              this.devSum[this.stitch] += off / pad.corridor;
              this.devN[this.stitch]++;
            }
          }
          const atExit = forcepsOk && this.maxS >= 0.9 && dist(f.needle.pos, site.exit) <= pad.exitRadius * 1.3;
          if (atExit) this.hold += dt;
          else this.hold = 0;
          progress = clamp(this.maxS, 0, 1);
          if (this.hold >= TIMING.exit) {
            this.maxS = 1;
            this.advance(f.t, events);
          } else if (this.maxS === 0 && s > 0.3) {
            hint = 'Go back to the entry ring and start the line from there.';
          } else if (stale) {
            hint = 'Follow the line toward the exit ring.';
          }
          if (forcepsHint) hint = forcepsHint;
          if (!hint && f.needle.tracked && this.sinceProgress > TIMING.tipAfter && this.maxS < 0.9
            && Math.abs(angleDiff(f.needle.angle, Math.atan2(pad.dir.y, pad.dir.x))) > NEEDLE_ANGLE_TIP) {
            hint = 'Tip: turn your hand so the needle points along the line.';
          }
        } else if (this.step === 'pull') {
          const rel = sub(f.needle.pos, site.exit);
          const along = dot(rel, pad.dir) / pad.pullLength;
          const off = Math.abs(cross(pad.dir, rel));
          if (off > pad.pullCorridor * 1.4 && this.pullP > PULL_MIN && this.pullP < PULL_DONE) {
            // Drifting off the line lets the thread slip back, like leaving the lane while passing the needle.
            this.slipBack(events);
            this.raise('You drifted off the line and the thread slipped back. Go back to the exit ring and draw it straight up.', f.t);
          } else {
            // After a slip the needle holder has to be inside the exit ring again, the ring that is drawn, to start over.
            if (!this.pullArmed && f.needle.tracked && dist(f.needle.pos, site.exit) <= pad.exitRadius) {
              this.pullArmed = true;
              this.pullBase = clamp(along, 0, 0.5);
            }
            if (this.pullArmed && off <= pad.pullCorridor) {
              const p = clamp((along - this.pullBase) / (1 - this.pullBase), 0, 1);
              if (p > this.pullP) this.pullP = p;
            }
            if (this.pullP >= this.pullMark + PULL_STEP) {
              // Clear movement: the clock for a stalled pull starts again.
              this.pullMark = this.pullP;
              this.pullStall = 0;
              this.sinceProgress = 0;
            } else if (f.needle.tracked && f.needle.held && this.pullP > PULL_MIN && this.pullP < PULL_DONE) {
              // Only a hand that is in view and closed counts as having stopped; losing the hand is not the trainee's fault.
              this.pullStall += dt;
              this.sinceProgress = 0;
            }
            if (this.pullStall >= TIMING.pullSlip) {
              this.slipBack(events);
              this.raise('The thread slipped back because the pull stopped. Go back to the exit ring and draw it through again in one steady pull.', f.t);
            }
          }
          if (this.pullP >= PULL_DONE) this.hold += dt;
          else this.hold = 0;
          progress = clamp(this.pullP, 0, 1);
          if (this.hold >= TIMING.pull) {
            this.pullP = 1;
            this.advance(f.t, events);
          } else if (this.pullStall >= TIMING.pullWarn) {
            hint = 'Keep drawing the thread through, or it will slip back.';
          } else if (!this.pullArmed && !(this.override && f.t < this.override.until)) {
            hint = 'Bring the needle holder back to the exit ring, then draw it up again.';
          } else if (stale) {
            hint = 'Draw the needle holder straight up along the line.';
          }
        }
      }
    }

    if (!hint && this.override && f.t < this.override.until) hint = this.override.text;
    const cur = this.step;
    const done = cur === 'done';
    const curSite = pad.sites[Math.min(this.stitch, pad.sites.length - 1)];
    let target: Target = { kind: 'none' };
    if (cur === 'hold') target = { kind: 'ring', pos: curSite.forceps, radius: pad.forcepsRadius };
    else if (cur === 'enter') target = { kind: 'ring', pos: curSite.entry, radius: pad.entryRadius };
    else if (cur === 'drive') target = { kind: 'line', pos: curSite.exit, radius: pad.exitRadius };
    else if (cur === 'pull') target = { kind: 'ring', pos: curSite.pullTarget, radius: 0.07 };
    if (done) progress = 1;
    const forcepsNeeded = cur === 'enter' || cur === 'drive';

    const sites: SiteView[] = pad.sites.map((s, i) => ({
      order: s.order,
      x: s.x,
      entry: s.entry,
      exit: s.exit,
      forceps: s.forceps,
      state: done || i < this.stitch ? 'done' : i === this.stitch ? 'now' : 'todo',
      closed: i === this.stitch && !done ? (cur === 'pull' ? this.pullP : 0) : this.closed[i],
    }));

    return {
      step: cur,
      stitch: Math.min(this.stitch + 1, pad.sites.length),
      stitchCount: pad.sites.length,
      title: STEP_TITLES[cur],
      instruction: copy(cur, needleHand, forcepsHand, pad.sites.length).instruction,
      hint,
      progress,
      target,
      forcepsNeeded,
      forcepsOk: forcepsNeeded ? forcepsOk : false,
      needleLocked: this.needsRegrip,
      driveProgress: this.maxS,
      pullProgress: this.pullP,
      pullArmed: this.pullArmed,
      sites,
      done,
      events,
      metrics: done
        ? {
            seconds: Math.round((((this.endT ?? f.t) - (this.startT ?? f.t)) / 1000) * 10) / 10,
            stitches: this.stitchSeconds.map((seconds, i) => ({
              seconds,
              meanDeviation: this.devN[i] ? this.devSum[i] / this.devN[i] : null,
            })),
            needleDrops: this.drops,
            leftLane: this.leaves,
            forcepsLapses: this.lapses,
            pullRetries: this.pullRetries,
            skipped: this.skips,
          }
        : null,
    };
  }
}
