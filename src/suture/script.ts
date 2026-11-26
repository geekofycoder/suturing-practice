import { lerp, norm, smoothstep } from '../common/geometry.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { RawHandLike } from '../common/hand-input.ts';
import type { Pad } from './pad.ts';
import { syntheticHand } from '../common/synthetic.ts';

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

/** When each part of each stitch happens in the scripted performance, in seconds. */
export interface StitchTimes {
  start: number;
  /** Both hands are at their rings. */
  arrive: number;
  driveFrom: number;
  driveTo: number;
  pullFrom: number;
  pullTo: number;
  end: number;
}
export interface Schedule {
  /** The needle holder is picked up. */
  gripAt: number;
  stitches: StitchTimes[];
  total: number;
}

/**
 * The timing of the scripted stitches. Every hold lasts longer than the step needs, and the two hands always move
 * together and stay apart, so the run finishes on its own and never has the hands overlap.
 */
export function demoSchedule(count: number): Schedule {
  const gripAt = 1.0;
  const first = 1.7;
  const span = 5.8;
  const stitches: StitchTimes[] = [];
  for (let k = 0; k < count; k++) {
    const t0 = first + k * span;
    stitches.push({ start: t0, arrive: t0 + 1.0, driveFrom: t0 + 2.5, driveTo: t0 + 3.7, pullFrom: t0 + 4.15, pullTo: t0 + 5.25, end: t0 + 5.7 });
  }
  return { gripAt, stitches, total: first + count * span + 0.4 };
}

/** Faults to put into a scripted performance, to check the flow copes with what a real tracker does. */
export interface Faults {
  /** Use the tracker's labels the wrong way round. */
  swapLabels?: boolean;
  /** Give both hands the same label. */
  sameLabels?: boolean;
  /** A hand is out of the picture for this window (seconds). */
  lose?: { hand: 'needle' | 'forceps'; from: number; to: number }[];
  /** A hand's pinch reads open for this window (seconds). */
  flicker?: { hand: 'needle' | 'forceps'; from: number; to: number }[];
  /** The needle hand strays sideways by this much for this window. */
  detour?: { from: number; to: number; by: number }[];
  /** Hand position noise, in scene units. */
  jitter?: number;
}

/** A scripted run through every stitch, as the hands the tracker would report. */
export function demoHands(pad: Pad, aspect: number, faults: Faults = {}): (tSec: number) => RawHandLike[] {
  const times = demoSchedule(pad.sites.length);
  const tray = pad.tray;
  const needleKeys: Key[] = [
    { t: 0, pos: tray.needle, pinch: false },
    { t: times.gripAt, pos: tray.needle, pinch: false },
    { t: times.gripAt + 0.05, pos: tray.needle, pinch: true },
  ];
  const forcepsKeys: Key[] = [{ t: 0, pos: tray.forceps, pinch: false }];
  pad.sites.forEach((site, k) => {
    const st = times.stitches[k];
    const prevNeedle = k === 0 ? tray.needle : pad.sites[k - 1].pullTarget;
    const prevForceps = k === 0 ? tray.forceps : pad.sites[k - 1].forceps;
    needleKeys.push(
      { t: st.start, pos: prevNeedle, pinch: true },
      { t: st.arrive, pos: site.entry, pinch: true },
      { t: st.driveFrom, pos: site.entry, pinch: true },
      { t: st.driveTo, pos: site.exit, pinch: true },
      { t: st.pullFrom, pos: site.exit, pinch: true },
      { t: st.pullTo, pos: site.pullTarget, pinch: true },
      { t: st.end, pos: site.pullTarget, pinch: true },
    );
    forcepsKeys.push(
      { t: st.start, pos: prevForceps, pinch: false },
      { t: st.arrive, pos: site.forceps, pinch: false },
      { t: st.arrive + 0.05, pos: site.forceps, pinch: true },
      { t: st.driveTo + 0.6, pos: site.forceps, pinch: true },
      { t: st.driveTo + 0.65, pos: site.forceps, pinch: false },
    );
  });
  needleKeys.push({ t: times.total, pos: pad.sites[pad.sites.length - 1].pullTarget, pinch: true });
  forcepsKeys.push({ t: times.total, pos: pad.sites[pad.sites.length - 1].forceps, pinch: false });

  const needleLabel: 'Left' | 'Right' = pad.dominant === 'R' ? 'Right' : 'Left';
  const forcepsLabel: 'Left' | 'Right' = pad.dominant === 'R' ? 'Left' : 'Right';
  const jitter = faults.jitter ?? 0.004;
  const inWindow = (list: { hand: 'needle' | 'forceps'; from: number; to: number }[] | undefined, hand: string, s: number): boolean =>
    !!list && list.some((w) => w.hand === hand && s >= w.from && s < w.to);
  const unit = norm(pad.dir);
  const dirPerp = { x: -unit.y, y: unit.x };

  return (s: number): RawHandLike[] => {
    const hands: RawHandLike[] = [];
    const make = (hand: 'needle' | 'forceps', keys: Key[], label: 'Left' | 'Right', salt: number): void => {
      if (inWindow(faults.lose, hand, s)) return;
      const k = sample(keys, s);
      let pos = { x: k.pos.x + jitter * Math.sin(s * 37.1 + salt), y: k.pos.y + jitter * Math.cos(s * 29.3 + salt) };
      if (hand === 'needle') {
        for (const d of faults.detour ?? []) if (s >= d.from && s < d.to) pos = { x: pos.x + dirPerp.x * d.by, y: pos.y + dirPerp.y * d.by };
      }
      let shown = label;
      if (faults.swapLabels) shown = label === 'Left' ? 'Right' : 'Left';
      if (faults.sameLabels) shown = 'Left';
      hands.push(syntheticHand(pos, -Math.PI / 2, k.pinch && !inWindow(faults.flicker, hand, s), shown, aspect));
    };
    make('needle', needleKeys, needleLabel, 1);
    make('forceps', forcepsKeys, forcepsLabel, 2);
    return hands;
  };
}
