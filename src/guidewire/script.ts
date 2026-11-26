import { lerp, smoothstep } from '../common/geometry.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { RawHandLike } from '../common/hand-input.ts';
import { syntheticHand } from '../common/synthetic.ts';
import { RULES } from './content.ts';
import type { Layout } from './layout.ts';

interface Key {
  t: number;
  pos: Vec2;
  pinch: boolean;
}

function sample(keys: Key[], t: number): { pos: Vec2; pinch: boolean } {
  let pinch = keys[0].pinch;
  for (const k of keys) if (k.t <= t) pinch = k.pinch;
  if (t <= keys[0].t) return { pos: keys[0].pos, pinch };
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      return { pos: lerp(a.pos, b.pos, smoothstep((t - a.t) / (b.t - a.t))), pinch };
    }
  }
  return { pos: keys[keys.length - 1].pos, pinch };
}

/** Faults to put into a scripted performance, to check the flow copes with what a real tracker does. */
export interface Faults {
  swapLabels?: boolean;
  sameLabels?: boolean;
  /** A hand is out of the picture for this window (seconds). */
  lose?: { hand: 'primary' | 'secondary'; from: number; to: number }[];
  /** A hand's pinch reads open for this window (seconds). */
  flicker?: { hand: 'primary' | 'secondary'; from: number; to: number }[];
  jitter?: number;
}

export interface Plan {
  primary: Key[];
  secondary: Key[];
  total: number;
  /** When each step is being done, for tests to aim faults at. */
  at: Record<string, number>;
}

/**
 * The scripted performance as two lists of keyframes. `drill` plays the resistance drill: the wire meets resistance,
 * is drawn back a little, and goes in on the second try, which is the response Merck describes.
 */
export function planDemo(L: Layout, drill: boolean): Plan {
  const P: Key[] = [];
  const S: Key[] = [];
  const at: Record<string, number> = {};
  const pt = (x: number, y: number): Vec2 => ({ x, y });
  const p = (t: number, pos: Vec2, pinch: boolean): void => void P.push({ t, pos, pinch });
  const s = (t: number, pos: Vec2, pinch: boolean): void => void S.push({ t, pos, pinch });
  const px = L.primaryX;
  const sx = L.secondaryX;
  const tray = L.tray;
  /** Pinch at `from`, move to `to` over `dur`, still pinched. Returns when it ends. */
  const pStroke = (start: number, from: number, to: number, dur: number): number => {
    p(start, pt(px, from), false);
    p(start + 0.05, pt(px, from), true);
    p(start + 0.05 + dur, pt(px, to), true);
    return start + 0.05 + dur;
  };
  const sStroke = (start: number, from: number, to: number, dur: number): number => {
    s(start, pt(sx, from), false);
    s(start + 0.05, pt(sx, from), true);
    s(start + 0.05 + dur, pt(sx, to), true);
    return start + 0.05 + dur;
  };
  /** Goes to the tray, which takes 0.7 s from wherever the hand was, and pinches. Returns when pinched. */
  const pickUp = (t: number): number => {
    p(t + 0.7, tray, false);
    p(t + 0.75, tray, true);
    return t + 0.75;
  };

  p(0, tray, false);
  s(0, pt(sx, 0.7), false);

  // Steady the needle.
  s(0.8, pt(sx, 0.7), false);
  s(1.6, L.anchors.hub, false);
  s(1.65, L.anchors.hub, true);
  at.steady = 1.65;

  // Remove the syringe.
  const handle = pt(px, L.syringe.y);
  const syringeOff = pt(px, L.syringe.offY - 0.02);
  p(1.0, tray, false);
  p(2.9, handle, false);
  p(2.95, handle, true);
  p(3.9, syringeOff, true);
  p(3.95, syringeOff, false);
  at.syringe = 2.95;

  // Check the blood.
  p(4.5, L.blood, false);
  p(4.55, L.blood, true);
  p(5.4, L.blood, true);
  p(5.45, L.blood, false);
  at.blood = 4.55;

  // Feed the wire in strokes: push down inside the window, open, slide back, pinch, push.
  const top = L.feed.top + 0.02;
  let depth = L.depthOf(L.feed.startTipY);
  p(5.8, pt(px, top), false);
  at.feed = 6.0;
  const e1 = pStroke(6.0, top, top + 0.15, 0.9);
  depth += 0.15 / L.k;
  p(e1 + 0.05, pt(px, top + 0.15), false);
  p(e1 + 0.75, pt(px, top), false);
  let t = e1 + 0.8;
  if (drill) {
    // Run into resistance, stop, draw back a little, then go on (Merck).
    const toResist = (RULES.resistAt.value - depth) * L.k;
    const e2 = pStroke(t, top, top + toResist + 0.01, 0.8);
    p(e2 + 0.9, pt(px, top + toResist + 0.01), true);
    const back = top + toResist - 0.05;
    p(e2 + 1.6, pt(px, back), true);
    p(e2 + 1.65, pt(px, back), false);
    p(e2 + 2.3, pt(px, top), false);
    depth = RULES.resistAt.value - 0.06 / L.k;
    at.resist = e2;
    t = e2 + 2.35;
  }
  const target = (RULES.wireDepthMin.value + RULES.wireDepthMax.value) / 2;
  const need = (target - depth) * L.k;
  const e3 = pStroke(t, top, top + need, Math.max(0.9, need * 6));
  p(e3 + 1.3, pt(px, top + need), true);
  p(e3 + 1.35, pt(px, top + need), false);
  at.wiregrip = e3 + 0.7;

  // Take hold: the secondary moves from the hub to the wire at the skin while the primary still holds the wire.
  s(e3 + 1.0, L.anchors.hub, true);
  s(e3 + 1.5, L.anchors.skin, true);

  // Needle off.
  const needleStart = e3 + 2.3;
  const wing = pt(px, L.needle.hubY);
  const needleOff = pt(px, L.needle.offY - 0.02);
  p(needleStart, wing, false);
  p(needleStart + 0.05, wing, true);
  p(needleStart + 1.3, needleOff, true);
  p(needleStart + 1.35, needleOff, false);
  at.needleoff = needleStart + 0.05;
  t = needleStart + 1.4;

  // Nick.
  const pick = pickUp(t);
  p(pick + 0.85, L.nick, true);
  p(pick + 1.55, L.nick, true);
  p(pick + 1.6, L.nick, false);
  at.nick = pick + 0.85;
  t = pick + 1.7;

  // Dilate, then draw the dilator out. A tool being slid follows the hand, offset by where it was taken hold of.
  const snapHand = pt(px, L.snapY - 0.03);
  const zoneMid = (L.dilator.zone[0] + L.dilator.zone[1]) / 2;
  const dilEnd = pt(px, zoneMid - L.dilator.handleOff);
  const dp = pickUp(t);
  p(dp + 0.95, snapHand, true);
  p(dp + 2.45, dilEnd, true);
  p(dp + 3.15, dilEnd, true);
  p(dp + 3.2, dilEnd, false);
  p(dp + 3.35, dilEnd, false);
  p(dp + 3.4, dilEnd, true);
  p(dp + 4.65, snapHand, true);
  p(dp + 4.7, snapHand, false);
  at.dilate = dp + 2.45;
  at.dilatorout = dp + 3.4;
  t = dp + 4.8;

  // Catheter: thread, slide down to just above the skin, stop.
  const cp = pickUp(t);
  const catEnd = pt(px, L.skinY - 0.03 - L.catheter.handleOff);
  p(cp + 0.95, snapHand, true);
  p(cp + 2.65, catEnd, true);
  p(cp + 3.35, catEnd, true);
  p(cp + 3.4, catEnd, false);
  at.cathThread = cp + 2.65;
  t = cp + 3.5;

  // Hand-off: the primary goes to the wire where it shows at the hub and holds; then the secondary lets go.
  const catHub = L.skinY - 0.03 - L.catheter.stub;
  const tailHold = pt(px, (L.tailY + catHub) / 2);
  p(t + 0.8, tailHold, false);
  p(t + 0.85, tailHold, true);
  at.handoff = t + 0.85;
  const free = t + 2.0;
  s(free, L.anchors.skin, true);
  s(free + 0.05, L.anchors.skin, false);
  const adTop = L.advanceWindow.top + 0.02;
  s(free + 0.85, pt(sx, adTop), false);
  t = free + 0.9;

  // Advance the catheter in strokes with the secondary, the primary holding the wire throughout.
  const catStartTip = L.skinY - 0.03;
  const wantTip = L.depthY(11.6);
  const total = wantTip - catStartTip;
  const s1 = total / 2;
  at.advance = t;
  const a1 = sStroke(t, adTop, adTop + s1, 0.9);
  s(a1 + 0.05, pt(sx, adTop + s1), false);
  s(a1 + 0.75, pt(sx, adTop), false);
  const a2 = sStroke(a1 + 0.8, adTop, adTop + (total - s1), 1.0);
  s(a2 + 1.0, pt(sx, adTop + (total - s1)), true);
  t = a2 + 0.4;

  // Wire out: the secondary moves to the catheter hub and holds; the primary draws the wire up in strokes.
  const depthNow = (wantTip - L.skinY) / L.k;
  const frac = Math.min(1, Math.max(0, depthNow / 16));
  const hubY = L.skinY - (L.catheter.stub + (L.catheter.extFull - L.catheter.stub) * frac);
  // A margin on top of the exact distance: the first pinched sample of each stroke does not count as movement.
  const mustPull = L.depthY(target) - (hubY - 0.04) + 0.06;
  const pullTop = L.pullWindow.top + 0.1;
  let pe = t + 1.0;
  at.wireout = pe;
  // Open the hand and let the tracker see it open before it moves, or the move down would push the wire in.
  p(pe - 0.5, tailHold, true);
  p(pe - 0.4, tailHold, false);
  let pulled = 0;
  while (pulled < mustPull) {
    const d = Math.min(0.14, mustPull - pulled);
    const from = pullTop + d;
    p(pe, pt(px, from), false);
    p(pe + 0.05, pt(px, from), true);
    p(pe + 0.2, pt(px, from), true);
    p(pe + 0.85, pt(px, pullTop), true);
    p(pe + 0.9, pt(px, pullTop), false);
    pe += 1.5;
    pulled += d;
  }
  // The wire is out and in the hand: carry it to the waste tray and hold there.
  p(pe, pt(px, pullTop), false);
  p(pe + 0.05, pt(px, pullTop), true);
  p(pe + 1.3, L.waste, true);
  p(pe + 2.2, L.waste, true);
  at.waste = pe + 1.3;
  const finish = pe + 2.6;
  s(pe + 2.2, pt(sx, adTop + (total - s1)), true);
  s(finish, pt(sx, adTop + (total - s1)), true);
  p(finish, L.waste, true);
  return { primary: P, secondary: S, total: finish, at };
}

/** The plan as the hands the tracker would report, at a given time. */
export function demoHands(L: Layout, aspect: number, drill = false, faults: Faults = {}): { hands: (tSec: number) => RawHandLike[]; plan: Plan } {
  const plan = planDemo(L, drill);
  const jitter = faults.jitter ?? 0.003;
  const labelOf = (hand: 'primary' | 'secondary'): 'Left' | 'Right' => {
    const right = (hand === 'primary') === (L.dominant === 'R');
    let shown: 'Left' | 'Right' = right ? 'Right' : 'Left';
    if (faults.swapLabels) shown = shown === 'Left' ? 'Right' : 'Left';
    if (faults.sameLabels) shown = 'Left';
    return shown;
  };
  const inWindow = (list: { hand: 'primary' | 'secondary'; from: number; to: number }[] | undefined, hand: string, s: number): boolean =>
    !!list && list.some((w) => w.hand === hand && s >= w.from && s < w.to);
  const hands = (s: number): RawHandLike[] => {
    const out: RawHandLike[] = [];
    const make = (hand: 'primary' | 'secondary', keys: Key[], salt: number): void => {
      if (inWindow(faults.lose, hand, s)) return;
      const k = sample(keys, s);
      const pos = { x: k.pos.x + jitter * Math.sin(s * 37.1 + salt), y: k.pos.y + jitter * Math.cos(s * 29.3 + salt) };
      out.push(syntheticHand(pos, -Math.PI / 2, k.pinch && !inWindow(faults.flicker, hand, s), labelOf(hand), aspect));
    };
    make('primary', plan.primary, 1);
    make('secondary', plan.secondary, 2);
    return out;
  };
  return { hands, plan };
}
