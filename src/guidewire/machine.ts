import type { Vec2 } from '../common/geometry.ts';
import { clamp, dist } from '../common/geometry.ts';
import { PHASES, RULES, STEPS, STEP_ORDER } from './content.ts';
import type { Hands, PhaseId, StepId } from './content.ts';
import type { Layout } from './layout.ts';

export interface ToolIn {
  tracked: boolean;
  /** Debounced: use for "keep holding". */
  held: boolean;
  /** Undebounced: use for pushing and pulling. */
  pinched: boolean;
  pos: Vec2;
  angle: number;
}
export interface Frame {
  /** Milliseconds. */
  t: number;
  primary: ToolIn;
  secondary: ToolIn;
}

export type Rhythm = 'sinus' | 'ectopy' | 'run';
/** A complication to practise. */
export type Drill = 'none' | 'resistance';

export interface Ring {
  pos: Vec2;
  radius: number;
  mode: 'active' | 'holding' | 'lapsed' | 'dim';
  label: string;
  progress?: number;
}
/** A box in a lane where a pinch counts: the feed window, or where the wire shows at the hub. */
export interface Zone {
  x: number;
  top: number;
  bottom: number;
  mode: 'active' | 'holding' | 'lapsed';
  label: string;
}

export interface Metrics {
  seconds: number;
  stepSeconds: Record<string, number>;
  /** Times nobody was holding the wire while the hand was in view and open. */
  wireLapses: number;
  /** Times the hub was left uncovered, or the catheter unheld, while the hand was in view and open. */
  holdLapses: number;
  forced: number;
  ectopySeconds: number;
  maxWireDepth: number;
  attempts: number;
  skipped: number;
  catheterDepth: number | null;
}

export interface Snapshot {
  step: StepId;
  stepIndex: number;
  stepCount: number;
  phase: PhaseId;
  title: string;
  instruction: string;
  hint: string | null;
  progress: number;
  rings: Ring[];
  zones: Zone[];
  /** Where to pinch to take hold of a tool. */
  handles: { pos: Vec2; kind: string }[];
  needle: { present: boolean; hubY: number; tipY: number };
  syringe: { on: boolean; y: number };
  wire: { visible: boolean; depth: number; tipY: number; removed: boolean; carryPos: Vec2 | null };
  dilator: { visible: boolean; tipY: number; threaded: boolean; carryPos: Vec2 | null };
  catheter: { visible: boolean; tipY: number; hubY: number; depth: number; threaded: boolean; carryPos: Vec2 | null; wireAtHub: boolean };
  scalpel: { visible: boolean; pos: Vec2 | null };
  nicked: boolean;
  rhythm: Rhythm;
  resisted: boolean;
  /** The depth band to shade, and whose it is. */
  band: { min: number; max: number; of: 'wire' | 'catheter' } | null;
  control: { required: boolean; ok: boolean; lapsed: boolean; text: string };
  done: boolean;
  events: string[];
  metrics: Metrics | null;
}

type Name = 'primary' | 'secondary';
const NEEDLE_GRAB = 0.1;
const LAPSE_AFTER = 0.25;

export function handNames(layout: Layout): Hands {
  return layout.dominant === 'R' ? { primary: 'right', secondary: 'left' } : { primary: 'left', secondary: 'right' };
}

export class GuidewireMachine {
  private readonly L: Layout;
  private readonly drill: Drill;
  private idx = 0;
  private hold = 0;
  private sinceProgress = 0;
  private lastT: number | null = null;
  private startT: number | null = null;
  private stepStartT: number | null = null;
  private endT: number | null = null;
  private skipFlag = false;
  private stepSeconds: Record<string, number> = {};

  // the scene
  private syringeY: number;
  private syringeOff = false;
  private needleHubY: number;
  private needleOff = false;
  private readonly wireStart: number;
  private wireDepth: number;
  private wireMax: number;
  private wireRemoved = false;
  private wireCarry: Vec2 | null = null;
  private dil: { state: 'tray' | 'carry' | 'on' | 'out'; tipY: number; carry: Vec2 | null };
  private cat: { state: 'tray' | 'carry' | 'on'; tipY: number; carry: Vec2 | null };
  private scalpelHeld = false;
  private nicked = false;
  private wgPhase = 0;

  // the resistance drill
  private resisted = false;
  private drillDone = false;
  private forceAcc = 0;
  private withdrawAcc = 0;
  private forcedFlag = false;
  private pastFlag = false;
  private deepFlag = false;

  // hands
  private strokeY: Record<Name, number | null> = { primary: null, secondary: null };
  /** Where the hand was relative to the handle when the tool was taken hold of. */
  private dragOff: Record<Name, number> = { primary: 0, secondary: 0 };
  private grab: Record<Name, boolean> = { primary: false, secondary: false };
  private wasPinched: Record<Name, boolean> = { primary: false, secondary: false };
  private rising: Record<Name, boolean> = { primary: false, secondary: false };

  // scoring
  private openFor = 0;
  private lapsedNow = false;
  private wireLapses = 0;
  private holdLapses = 0;
  private forced = 0;
  private attempts = 1;
  private skips = 0;
  private ectopySeconds = 0;
  private maxDepth = 0;
  private rhythm: Rhythm = 'sinus';

  constructor(layout: Layout, drill: Drill = 'none') {
    this.L = layout;
    this.drill = drill;
    this.wireStart = layout.depthOf(layout.feed.startTipY);
    this.syringeY = layout.syringe.y;
    this.needleHubY = layout.needle.hubY;
    this.wireDepth = this.wireStart;
    this.wireMax = this.wireStart;
    this.dil = { state: 'tray', tipY: layout.snapY + layout.dilator.handleOff, carry: null };
    this.cat = { state: 'tray', tipY: layout.snapY + layout.catheter.handleOff, carry: null };
  }

  /** Counts the current step as done, for a trainee who is stuck. It takes effect on the next update. */
  skip(): void {
    this.skipFlag = true;
  }

  private get step(): StepId {
    return STEP_ORDER[this.idx];
  }

  private catHubY(): number {
    const { L } = this;
    const tip = this.cat.tipY;
    if (tip <= L.skinY) return tip - L.catheter.stub;
    const frac = clamp((tip - L.skinY) / (16 * L.k), 0, 1);
    return L.skinY - (L.catheter.stub + (L.catheter.extFull - L.catheter.stub) * frac);
  }

  private resetHands(): void {
    this.strokeY = { primary: null, secondary: null };
    this.grab = { primary: false, secondary: false };
  }

  private advance(tMs: number, events: string[]): void {
    const id = this.step;
    this.stepSeconds[id] = Math.round(((tMs - (this.stepStartT ?? tMs)) / 1000) * 10) / 10;
    this.idx = Math.min(this.idx + 1, STEP_ORDER.length - 1);
    this.hold = 0;
    this.sinceProgress = 0;
    this.stepStartT = tMs;
    this.wgPhase = 0;
    this.resetHands();
    events.push(`step:${this.step}`);
    if (this.step === 'done') {
      this.endT = tMs;
      events.push('done');
    }
  }

  private goTo(id: StepId, tMs: number, events: string[]): void {
    this.idx = STEP_ORDER.indexOf(id);
    this.hold = 0;
    this.sinceProgress = 0;
    this.stepStartT = tMs;
    this.wgPhase = 0;
    this.resetHands();
    events.push(`step:${id}`);
  }

  // ---- hand helpers -------------------------------------------------------------------------------------------

  private inLane(x: number, laneX: number): boolean {
    return Math.abs(x - laneX) <= this.L.r.lane;
  }

  private holdsAt(tool: ToolIn, at: Vec2, r: number): boolean {
    return tool.tracked && tool.held && dist(tool.pos, at) <= r;
  }

  /** Movement while the fingers are really closed, inside a window of a lane. Nothing moves while the hand is open. */
  private stroke(name: Name, tool: ToolIn, laneX: number, top: number, bottom: number): number {
    const active = tool.tracked && tool.pinched && this.inLane(tool.pos.x, laneX) && tool.pos.y >= top - 0.03 && tool.pos.y <= bottom + 0.03;
    if (!active) {
      this.strokeY[name] = null;
      return 0;
    }
    const prev = this.strokeY[name];
    this.strokeY[name] = tool.pos.y;
    return prev === null ? 0 : clamp(tool.pos.y - prev, -0.12, 0.12);
  }

  /**
   * Takes hold of a handle on a fresh pinch near it. While held it returns where the handle now is, which follows the
   * hand's position (so small drifts do not add up); otherwise null.
   */
  private drag(name: Name, tool: ToolIn, laneX: number, handleY: number, radius: number): number | null {
    if (!(tool.tracked && tool.pinched)) {
      this.grab[name] = false;
      return null;
    }
    if (!this.grab[name]) {
      if (this.rising[name] && this.inLane(tool.pos.x, laneX) && Math.abs(tool.pos.y - handleY) <= radius) {
        this.grab[name] = true;
        this.dragOff[name] = tool.pos.y - handleY;
      }
      return null;
    }
    return tool.pos.y - this.dragOff[name];
  }

  // ---- the wire ---------------------------------------------------------------------------------------------

  private feedWire(dy: number, events: string[]): void {
    if (dy === 0) return;
    const L = this.L;
    const dcm = dy / L.k;
    if (dy > 0) {
      if (this.resisted) {
        this.forceAcc += dy;
        if (this.forceAcc >= RULES.forceAfter.value && !this.forcedFlag) {
          this.forcedFlag = true;
          this.forced++;
          events.push('forced');
        }
        return;
      }
      const next = this.wireDepth + dcm;
      if (this.drill === 'resistance' && !this.drillDone && next >= RULES.resistAt.value) {
        this.wireDepth = RULES.resistAt.value;
        this.resisted = true;
        this.forceAcc = 0;
        this.withdrawAcc = 0;
        this.forcedFlag = false;
        events.push('resistance');
        return;
      }
      this.wireDepth = Math.min(24, next);
    } else {
      this.wireDepth = Math.max(this.wireStart, this.wireDepth + dcm);
      if (this.resisted) {
        this.withdrawAcc += -dy;
        if (this.withdrawAcc >= 0.03) {
          // Merck: stop, withdraw slightly, rotate, re-advance.
          this.resisted = false;
          this.drillDone = true;
          this.forceAcc = 0;
          events.push('resistance:cleared');
        }
      }
    }
    this.wireMax = Math.max(this.wireMax, this.wireDepth);
    this.maxDepth = Math.max(this.maxDepth, this.wireDepth);
  }

  // ---- the update ---------------------------------------------------------------------------------------------

  update(f: Frame): Snapshot {
    const { L } = this;
    const events: string[] = [];
    const dt = this.lastT === null ? 0 : clamp((f.t - this.lastT) / 1000, 0, 0.25);
    this.lastT = f.t;
    if (this.startT === null) this.startT = f.t;
    if (this.stepStartT === null) this.stepStartT = f.t;
    this.sinceProgress += dt;
    const P = f.primary;
    const S = f.secondary;
    this.rising = { primary: P.tracked && P.pinched && !this.wasPinched.primary, secondary: S.tracked && S.pinched && !this.wasPinched.secondary };
    const names = handNames(L);

    if (this.skipFlag && this.step !== 'done') {
      this.skipFlag = false;
      this.skips++;
      events.push('skip');
      this.applySkip();
      this.advance(f.t, events);
    }

    const step = this.step;
    let hint: string | null = null;
    let progress = 0;
    const rings: Ring[] = [];
    const zones: Zone[] = [];
    const handles: { pos: Vec2; kind: string }[] = [];
    const stale = this.sinceProgress > 4;
    const bump = (cond: boolean, need: number): boolean => {
      if (cond) {
        this.hold += dt;
        this.sinceProgress = 0;
      } else {
        this.hold = Math.max(0, this.hold - dt * 2);
      }
      progress = clamp(this.hold / need, 0, 1);
      return this.hold >= need;
    };
    const showHand = (name: Name): string => `Show your ${names[name]} hand to the camera.`;

    const hubOk = this.holdsAt(S, L.anchors.hub, L.r.keep);
    const skinOk = this.holdsAt(S, L.anchors.skin, L.r.keep);
    const feedTop = L.feed.top - 0.04;
    const feedBottom = L.feed.bottom + 0.04;
    const primaryHoldsWire = P.tracked && P.held && this.inLane(P.pos.x, L.primaryX) && P.pos.y >= feedTop && P.pos.y <= feedBottom;
    const catHub = this.catHubY();
    const primaryHoldsTail = P.tracked && P.held && this.inLane(P.pos.x, L.primaryX) && P.pos.y >= L.tailY - 0.05 && P.pos.y <= catHub + 0.03;
    const catHubAt: Vec2 = { x: L.secondaryX, y: catHub };
    const catOk = this.holdsAt(S, catHubAt, L.r.keep);
    const ringHub = (label: string): void => {
      rings.push({ pos: L.anchors.hub, radius: L.r.hold, mode: hubOk ? 'holding' : 'lapsed', label });
    };
    const ringSkin = (): void => {
      rings.push({ pos: L.anchors.skin, radius: L.r.hold, mode: skinOk ? 'holding' : 'lapsed', label: skinOk ? 'Holding the wire' : 'Hold the wire here' });
    };

    switch (step) {
      case 'steady': {
        rings.push({ pos: L.anchors.hub, radius: L.r.hold, mode: hubOk ? 'holding' : 'active', label: 'Hold the hub', progress });
        if (bump(hubOk, 0.4)) this.advance(f.t, events);
        else if (!S.tracked) hint = showHand('secondary');
        else if (stale) hint = `Pinch with your ${names.secondary} hand on the ring.`;
        break;
      }
      case 'syringe': {
        ringHub('Thumb over the hub');
        const held = this.drag('primary', P, L.primaryX, this.syringeY, NEEDLE_GRAB);
        if (held !== null) this.syringeY = clamp(held, L.syringe.offY, L.syringe.y);
        handles.push({ pos: { x: L.primaryX, y: this.syringeY }, kind: 'syringe' });
        progress = (L.syringe.y - this.syringeY) / (L.syringe.y - L.syringe.offY);
        if (this.syringeY <= L.syringe.offY + 0.005) {
          this.syringeOff = true;
          this.advance(f.t, events);
        } else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch the syringe handle with your ${names.primary} hand and pull straight up.`;
        break;
      }
      case 'blood': {
        ringHub('Thumb over the hub');
        const ok = this.holdsAt(P, L.blood, L.r.hold);
        rings.push({ pos: L.blood, radius: L.r.hold, mode: ok ? 'holding' : 'active', label: 'Dark, not pulsing', progress });
        if (bump(ok, 0.5)) this.advance(f.t, events);
        else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Hold your ${names.primary} hand on the ring to confirm.`;
        break;
      }
      case 'feed': {
        ringHub('Thumb over the hub');
        zones.push({ x: L.primaryX, top: L.feed.top, bottom: L.feed.bottom, mode: primaryHoldsWire ? 'holding' : 'active', label: 'Pinch the wire here' });
        const feedDy = this.stroke('primary', P, L.primaryX, L.feed.top, L.feed.bottom);
        if (feedDy !== 0) this.sinceProgress = 0;
        this.feedWire(feedDy, events);
        const inWindow = this.wireDepth >= RULES.wireDepthMin.value && this.wireDepth <= RULES.wireDepthMax.value;
        const done = bump(inWindow && !this.resisted, 0.6);
        this.noteDepth();
        if (this.wireDepth <= this.wireStart + 0.01 && this.wireMax > this.wireStart + 1) {
          // Withdrawn right out: re-establish venous return before trying again (Merck).
          this.wireMax = this.wireStart;
          this.attempts++;
          this.resisted = false;
          this.drillDone = true;
          events.push('rewire');
          this.goTo('blood', f.t, events);
        } else if (done) this.advance(f.t, events);
        else if (this.resisted) hint = 'Resistance. Do not force it. Stop, pull the wire back a little, then try again.';
        else if (this.wireDepth > RULES.ectopyAbove.value) hint = 'The ECG shows extra beats. Pull the wire back until they stop.';
        else if (this.wireDepth > RULES.wireDepthMax.value) hint = 'That is deeper than needed for a right-sided vein. Pull the wire back a little.';
        else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch the wire in the box with your ${names.primary} hand and push down a little at a time.`;
        break;
      }
      case 'wiregrip': {
        zones.push({ x: L.primaryX, top: L.feed.top, bottom: L.feed.bottom, mode: primaryHoldsWire ? 'holding' : 'active', label: 'Hold the wire here' });
        if (this.wgPhase === 0) {
          rings.push({ pos: L.anchors.hub, radius: L.r.hold, mode: hubOk ? 'holding' : 'lapsed', label: 'Thumb over the hub' });
          if (bump(primaryHoldsWire, 0.3)) {
            this.wgPhase = 1;
            this.hold = 0;
          } else if (!P.tracked) hint = showHand('primary');
          else if (stale) hint = `Pinch the wire with your ${names.primary} hand.`;
        } else {
          const ok = this.holdsAt(S, L.anchors.skin, L.r.hold);
          rings.push({ pos: L.anchors.skin, radius: L.r.hold, mode: ok ? 'holding' : 'active', label: 'Hold the wire here', progress });
          if (bump(ok, 0.4)) this.advance(f.t, events);
          else if (!S.tracked) hint = showHand('secondary');
          else if (stale) hint = `Bring your ${names.secondary} hand to the ring at the skin, while the ${names.primary} hand keeps the wire.`;
        }
        break;
      }
      case 'needleoff': {
        ringSkin();
        const held = this.drag('primary', P, L.primaryX, this.needleHubY, NEEDLE_GRAB);
        if (held !== null) this.needleHubY = clamp(held, L.needle.offY, L.needle.hubY);
        handles.push({ pos: { x: L.primaryX, y: this.needleHubY }, kind: 'needle' });
        progress = (L.needle.hubY - this.needleHubY) / (L.needle.hubY - L.needle.offY);
        if (this.needleHubY <= L.needle.offY + 0.005) {
          this.needleOff = true;
          this.advance(f.t, events);
        } else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch the needle's wings with your ${names.primary} hand and pull straight up.`;
        break;
      }
      case 'nick': {
        ringSkin();
        this.scalpelHeld = P.tracked && P.held;
        const ok = this.scalpelHeld && dist(P.pos, L.nick) <= L.r.hold;
        rings.push({ pos: L.nick, radius: L.r.hold, mode: ok ? 'holding' : 'active', label: 'Small nick', progress });
        if (bump(ok, 0.4)) {
          this.nicked = true;
          this.scalpelHeld = false;
          this.advance(f.t, events);
        } else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch with your ${names.primary} hand to pick up the scalpel, then touch it to the ring.`;
        break;
      }
      case 'dilate':
      case 'dilatorout': {
        ringSkin();
        this.moveThreaded('primary', P, this.dil, L.dilator.handleOff, events);
        const dil = this.dil;
        const handleY = dil.tipY - L.dilator.handleOff;
        if (step === 'dilate') {
          const zone = L.dilator.zone;
          if (dil.state === 'on') handles.push({ pos: { x: L.primaryX, y: handleY }, kind: 'dilator' });
          zones.push({ x: L.primaryX, top: 0.04, bottom: L.snapY, mode: dil.state === 'carry' ? 'holding' : 'active', label: dil.state === 'on' ? '' : 'Thread it on here' });
          const inZone = dil.state === 'on' && dil.tipY >= zone[0] && dil.tipY <= zone[1];
          if (dil.state === 'on' && dil.tipY > zone[1] + 0.04 && !this.deepFlag) {
            this.deepFlag = true;
            events.push('dilator:deep');
          }
          if (bump(inZone, 0.35)) this.advance(f.t, events);
          else if (!P.tracked) hint = showHand('primary');
          else if (dil.state === 'on' && dil.tipY > zone[1] + 0.04) hint = 'Too deep. Just through the vein wall is enough. Pull back a little.';
          else if (stale) hint = dil.state === 'tray' ? `Pinch with your ${names.primary} hand to pick up the dilator.` : 'Thread it on at the top of the wire, then slide it down to the skin and just through.';
        } else {
          handles.push({ pos: { x: L.primaryX, y: handleY }, kind: 'dilator' });
          progress = clamp((L.dilator.zone[0] - dil.tipY + 0.3) / 0.3, 0, 1);
          if (dil.state === 'out') this.advance(f.t, events);
          else if (!P.tracked) hint = showHand('primary');
          else if (stale) hint = `Pinch the dilator with your ${names.primary} hand and pull it straight up and off.`;
        }
        break;
      }
      case 'cathThread': {
        ringSkin();
        this.moveThreaded('primary', P, this.cat, L.catheter.handleOff, events);
        const cat = this.cat;
        if (cat.state === 'on') {
          cat.tipY = Math.min(cat.tipY, L.skinY - 0.005);
          handles.push({ pos: { x: L.primaryX, y: cat.tipY - L.catheter.handleOff }, kind: 'catheter' });
        }
        zones.push({ x: L.primaryX, top: 0.04, bottom: L.snapY, mode: cat.state === 'carry' ? 'holding' : 'active', label: cat.state === 'on' ? '' : 'Thread it on here' });
        const wireAtHub = this.catHubY() >= L.tailY;
        const ok = cat.state === 'on' && wireAtHub && cat.tipY >= L.skinY - 0.06;
        if (bump(ok, 0.3)) this.advance(f.t, events);
        else if (!P.tracked) hint = showHand('primary');
        else if (cat.state === 'on' && cat.tipY >= L.skinY - 0.02 && !wireAtHub) hint = 'The wire has to show at the back of the hub first.';
        else if (stale) hint = cat.state === 'tray' ? `Pinch with your ${names.primary} hand to pick up the catheter.` : 'Thread it on at the top of the wire and slide it down until the wire shows at the hub. Stop just above the skin.';
        break;
      }
      case 'handoff': {
        ringSkin();
        const top = L.tailY - 0.05;
        zones.push({ x: L.primaryX, top, bottom: catHub + 0.03, mode: primaryHoldsTail ? 'holding' : 'active', label: 'Wire at the hub: hold here' });
        if (bump(primaryHoldsTail, 0.5)) this.advance(f.t, events);
        else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch the wire in the box, above the hub, with your ${names.primary} hand.`;
        break;
      }
      case 'advance': {
        zones.push({ x: L.primaryX, top: L.tailY - 0.05, bottom: catHub + 0.03, mode: primaryHoldsTail ? 'holding' : 'lapsed', label: primaryHoldsTail ? 'Holding the wire' : 'Hold the wire here' });
        zones.push({ x: L.secondaryX, top: L.advanceWindow.top, bottom: L.advanceWindow.bottom, mode: 'active', label: 'Pinch the catheter here' });
        const dy = this.stroke('secondary', S, L.secondaryX, L.advanceWindow.top, L.advanceWindow.bottom);
        if (dy !== 0) {
          this.sinceProgress = 0;
          const maxTip = L.depthY(this.wireDepth - RULES.catheterShortOfWire.value);
          const next = this.cat.tipY + dy;
          if (next > maxTip) {
            this.cat.tipY = Math.max(this.cat.tipY, maxTip);
            if (!this.pastFlag) {
              this.pastFlag = true;
              events.push('catheter:past-wire');
            }
          } else {
            this.cat.tipY = Math.max(L.skinY - 0.05, next);
          }
        }
        const depth = L.depthOf(this.cat.tipY);
        const ok = depth >= RULES.catheterDepthMin.value && depth <= RULES.catheterDepthMax.value && primaryHoldsTail;
        if (bump(ok, 0.5)) this.advance(f.t, events);
        else if (this.pastFlag && this.cat.tipY >= L.depthY(this.wireDepth - RULES.catheterShortOfWire.value) - 0.005) hint = 'Stop. The wire tip has to stay ahead of the catheter tip.';
        else if (!S.tracked) hint = showHand('secondary');
        else if (stale) hint = `Pinch the catheter in the box with your ${names.secondary} hand and push it in a little at a time.`;
        break;
      }
      case 'wireout': {
        rings.push({ pos: catHubAt, radius: L.r.hold, mode: catOk ? 'holding' : 'lapsed', label: catOk ? 'Holding the catheter' : 'Hold the catheter here' });
        zones.push({ x: L.primaryX, top: L.pullWindow.top, bottom: L.pullWindow.bottom, mode: 'active', label: 'Pinch the wire, pull up' });
        const dy = this.stroke('primary', P, L.primaryX, L.pullWindow.top, L.pullWindow.bottom);
        if (dy !== 0) {
          this.sinceProgress = 0;
          this.wireDepth = Math.max(-40, this.wireDepth + dy / L.k);
        }
        const tipY = L.depthY(this.wireDepth);
        progress = clamp((L.depthY(this.wireMax) - tipY) / Math.max(0.05, L.depthY(this.wireMax) - (catHub - 0.04)), 0, 1);
        this.noteDepth();
        if (tipY <= catHub - 0.04) {
          this.wireRemoved = true;
          this.wireCarry = { ...P.pos };
          this.advance(f.t, events);
        } else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Pinch the wire with your ${names.primary} hand and draw it up, a little at a time.`;
        break;
      }
      case 'waste': {
        rings.push({ pos: catHubAt, radius: L.r.hold, mode: catOk ? 'holding' : 'lapsed', label: catOk ? 'Holding the catheter' : 'Hold the catheter here' });
        if (P.tracked && P.held) this.wireCarry = { ...P.pos };
        const ok = P.tracked && P.held && dist(P.pos, L.waste) <= L.r.hold + 0.02;
        rings.push({ pos: L.waste, radius: L.r.hold + 0.02, mode: ok ? 'holding' : 'active', label: 'Waste tray', progress });
        if (bump(ok, 0.5)) this.advance(f.t, events);
        else if (!P.tracked) hint = showHand('primary');
        else if (stale) hint = `Carry the wire to the waste tray with your ${names.primary} hand.`;
        break;
      }
      case 'done':
        progress = 1;
        break;
    }

    // ---- who is holding what -----------------------------------------------------------------------------------
    const ctrl = this.controlRule(f, { hubOk, skinOk, primaryHoldsWire, primaryHoldsTail, catOk });
    let lapsedNow = false;
    if (ctrl.required && !ctrl.ok) {
      if (ctrl.relevant.every((t) => t.tracked)) {
        this.openFor += dt;
        if (this.openFor >= LAPSE_AFTER) {
          lapsedNow = true;
          if (!this.lapsedNow) {
            if (ctrl.kind === 'wire') this.wireLapses++;
            else this.holdLapses++;
            events.push(ctrl.kind === 'wire' ? 'lapse:wire' : 'lapse:hold');
          }
        }
      } else {
        // A hand that is simply out of the picture is a camera problem, not a lapse.
        this.openFor = 0;
        if (!hint) hint = `Show your ${ctrl.relevant[0] === P ? names.primary : names.secondary} hand to the camera.`;
      }
    } else {
      this.openFor = 0;
    }
    this.lapsedNow = lapsedNow;
    if (lapsedNow && !hint) hint = ctrl.lapse;

    // ---- the heart -----------------------------------------------------------------------------------------------
    const wireInVein = this.wireDepth > 0 && !this.wireRemoved && STEP_ORDER.indexOf(this.step) >= STEP_ORDER.indexOf('feed');
    this.rhythm = !wireInVein ? 'sinus' : this.wireDepth > RULES.runAbove.value ? 'run' : this.wireDepth > RULES.ectopyAbove.value ? 'ectopy' : 'sinus';
    if (this.rhythm !== 'sinus') this.ectopySeconds += dt;

    this.wasPinched = { primary: P.tracked && P.pinched, secondary: S.tracked && S.pinched };

    // ---- the picture ---------------------------------------------------------------------------------------------
    const cur = this.step;
    const content = STEPS[cur];
    const wireTipY = L.depthY(this.wireDepth);
    const catDepth = L.depthOf(this.cat.tipY);
    const catThreaded = this.cat.state === 'on' || (this.idx > STEP_ORDER.indexOf('cathThread') && !this.wireRemoved);
    const band =
      cur === 'feed' || cur === 'wiregrip'
        ? { min: RULES.wireDepthMin.value, max: RULES.wireDepthMax.value, of: 'wire' as const }
        : cur === 'advance'
          ? { min: RULES.catheterDepthMin.value, max: RULES.catheterDepthMax.value, of: 'catheter' as const }
          : null;
    return {
      step: cur,
      stepIndex: this.idx,
      stepCount: STEP_ORDER.length - 1,
      phase: content.phase,
      title: content.title,
      instruction: content.instruction(names),
      hint,
      progress: cur === 'done' ? 1 : progress,
      rings,
      zones,
      handles,
      needle: { present: !this.needleOff, hubY: this.needleHubY, tipY: this.needleHubY + (L.needle.tipY - L.needle.hubY) },
      syringe: { on: !this.syringeOff, y: this.syringeY },
      wire: {
        visible: this.idx >= STEP_ORDER.indexOf('feed') || this.wireDepth > this.wireStart,
        depth: this.wireDepth,
        tipY: wireTipY,
        removed: this.wireRemoved,
        carryPos: this.wireRemoved ? this.wireCarry : null,
      },
      dilator: { visible: this.dil.state !== 'out' && (this.dil.state !== 'tray' || cur === 'dilate'), tipY: this.dil.tipY, threaded: this.dil.state === 'on', carryPos: this.dil.state === 'carry' ? this.dil.carry : null },
      catheter: {
        visible: this.cat.state !== 'tray' || cur === 'cathThread',
        tipY: this.cat.tipY,
        hubY: this.catHubY(),
        depth: catDepth,
        threaded: catThreaded,
        carryPos: this.cat.state === 'carry' ? this.cat.carry : null,
        wireAtHub: this.catHubY() >= L.tailY,
      },
      scalpel: { visible: cur === 'nick', pos: this.scalpelHeld ? { ...P.pos } : null },
      nicked: this.nicked,
      rhythm: this.rhythm,
      resisted: this.resisted,
      band,
      control: { required: ctrl.required, ok: ctrl.ok, lapsed: lapsedNow, text: ctrl.text },
      done: cur === 'done',
      events,
      metrics:
        cur === 'done'
          ? {
              seconds: Math.round((((this.endT ?? f.t) - (this.startT ?? f.t)) / 1000) * 10) / 10,
              stepSeconds: { ...this.stepSeconds },
              wireLapses: this.wireLapses,
              holdLapses: this.holdLapses,
              forced: this.forced,
              ectopySeconds: Math.round(this.ectopySeconds * 10) / 10,
              maxWireDepth: Math.round(this.maxDepth * 10) / 10,
              attempts: this.attempts,
              skipped: this.skips,
              catheterDepth: this.cat.state === 'on' ? Math.round(catDepth * 10) / 10 : null,
            }
          : null,
    };
  }

  private noteDepth(): void {
    this.maxDepth = Math.max(this.maxDepth, this.wireDepth);
  }

  /** Moves a tool that threads onto the wire's end (the dilator or the catheter), carried first, then slid along the wire. */
  private moveThreaded(name: Name, tool: ToolIn, item: { state: 'tray' | 'carry' | 'on' | 'out'; tipY: number; carry: Vec2 | null }, handleOff: number, events: string[]): void {
    const L = this.L;
    const pinched = tool.tracked && tool.pinched;
    if (item.state === 'tray' && this.rising[name]) item.state = 'carry';
    if (item.state === 'carry') {
      if (!pinched) {
        item.state = 'tray';
        item.carry = null;
      } else {
        item.carry = { ...tool.pos };
        if (this.inLane(tool.pos.x, L.primaryX) && tool.pos.y <= L.snapY) {
          item.state = 'on';
          item.tipY = L.snapY + handleOff;
          item.carry = null;
          this.grab[name] = true;
          this.dragOff[name] = tool.pos.y - L.snapY;
          events.push('threaded');
        }
      }
      return;
    }
    if (item.state === 'on') {
      const held = this.drag(name, tool, L.primaryX, item.tipY - handleOff, 0.12);
      if (held !== null) item.tipY = clamp(held + handleOff, L.snapY + handleOff - 0.06, L.skinY + 0.15);
      if (this.step === 'dilatorout' && item.tipY - handleOff <= L.snapY + 0.005) item.state = 'out';
    }
  }

  /** The rule that decides whether the right things are being held right now, and what to say if not. */
  private controlRule(
    f: Frame,
    h: { hubOk: boolean; skinOk: boolean; primaryHoldsWire: boolean; primaryHoldsTail: boolean; catOk: boolean },
  ): { required: boolean; ok: boolean; kind: 'wire' | 'hold'; relevant: ToolIn[]; text: string; lapse: string } {
    const names = handNames(this.L);
    const P = f.primary;
    const S = f.secondary;
    const none = { required: false, ok: true, kind: 'wire' as const, relevant: [] as ToolIn[], text: '', lapse: '' };
    switch (this.step) {
      case 'syringe':
      case 'blood':
      case 'feed':
        return { required: true, ok: h.hubOk, kind: 'hold', relevant: [S], text: h.hubOk ? 'Hub covered' : 'Hub uncovered', lapse: `Keep your ${names.secondary} thumb over the hub, or air can get in.` };
      case 'wiregrip': {
        const ok = h.primaryHoldsWire || h.skinOk || (this.wgPhase === 0 && h.hubOk);
        return { required: true, ok, kind: 'wire', relevant: [P, S], text: ok ? 'Wire held' : 'Nobody is holding the wire', lapse: 'Never let go of the wire: one hand must hold it at all times.' };
      }
      case 'needleoff':
      case 'nick':
      case 'dilate':
      case 'dilatorout':
      case 'cathThread':
        return { required: true, ok: h.skinOk, kind: 'wire', relevant: [S], text: h.skinOk ? `Wire held at the skin (${names.secondary} hand)` : 'Nobody is holding the wire', lapse: `Never let go of the wire: keep your ${names.secondary} hand on it at the skin.` };
      case 'handoff': {
        const ok = h.skinOk || h.primaryHoldsTail;
        return { required: true, ok, kind: 'wire', relevant: [P, S], text: ok ? 'Wire held' : 'Nobody is holding the wire', lapse: 'Never let go of the wire: take hold at the hub before the other hand lets go.' };
      }
      case 'advance':
        return { required: true, ok: h.primaryHoldsTail, kind: 'wire', relevant: [P], text: h.primaryHoldsTail ? `Wire held at the hub (${names.primary} hand)` : 'Nobody is holding the wire', lapse: `Never let go of the wire: keep your ${names.primary} hand on it at the hub.` };
      case 'wireout':
      case 'waste':
        return { required: true, ok: h.catOk, kind: 'hold', relevant: [S], text: h.catOk ? `Catheter held (${names.secondary} hand)` : 'Catheter not held', lapse: `Keep your ${names.secondary} hand on the catheter while the wire comes out.` };
      default:
        return none;
    }
  }

  /** The scene as it would be if the current step had been done, for Skip. */
  private applySkip(): void {
    const L = this.L;
    switch (this.step) {
      case 'syringe':
        this.syringeOff = true;
        this.syringeY = L.syringe.offY;
        break;
      case 'feed':
        this.wireDepth = (RULES.wireDepthMin.value + RULES.wireDepthMax.value) / 2;
        this.wireMax = this.wireDepth;
        this.maxDepth = Math.max(this.maxDepth, this.wireDepth);
        this.resisted = false;
        break;
      case 'needleoff':
        this.needleOff = true;
        this.needleHubY = L.needle.offY;
        break;
      case 'nick':
        this.nicked = true;
        break;
      case 'dilate':
        this.dil.state = 'on';
        this.dil.tipY = (L.dilator.zone[0] + L.dilator.zone[1]) / 2;
        break;
      case 'dilatorout':
        this.dil.state = 'out';
        break;
      case 'cathThread':
        this.cat.state = 'on';
        this.cat.tipY = L.skinY - 0.05;
        break;
      case 'advance':
        this.cat.state = 'on';
        this.cat.tipY = L.depthY((RULES.catheterDepthMin.value + RULES.catheterDepthMax.value) / 2);
        break;
      case 'wireout':
        this.wireRemoved = true;
        this.wireDepth = -40;
        this.wireCarry = { ...L.tray };
        break;
      default:
        break;
    }
  }
}

export { PHASES };
