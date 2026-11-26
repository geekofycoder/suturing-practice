import { add, clamp, lerp, mul, norm, perp, smoothstep, sub } from '../common/geometry.ts';
import { ACCENT, aimDot, drawSkeleton, haloText, label, prepare, P } from '../common/draw.ts';
import type { Ctx } from '../common/draw.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { Sides } from '../common/identity.ts';
import type { Pad } from './pad.ts';
import type { ToolState } from './pipeline.ts';
import type { SiteView, Snapshot } from './steps.ts';

const AMBER = '#ffb84d';
const THREAD = '#2d5bd1';

/** How an instrument is drawn: it glides to the hand when picked up, follows it smoothly between tracker results, and stays put if dropped. */
export class ToolView {
  pos: Vec2;
  angle = -Math.PI / 2;
  picked = false;
  private readonly rest: Vec2;
  private boost = 0;

  constructor(rest: Vec2) {
    this.rest = rest;
    this.pos = { ...rest };
  }

  reset(): void {
    this.pos = { ...this.rest };
    this.angle = -Math.PI / 2;
    this.picked = false;
    this.boost = 0;
  }

  update(state: ToolState, dtSec: number): void {
    let target = this.pos;
    let angle = this.angle;
    if (state.held) {
      if (!this.picked) this.boost = 0.45;
      this.picked = true;
      target = state.pos;
      angle = state.angle;
    } else if (!this.picked) {
      target = this.rest;
    }
    const tau = this.boost > 0 ? 0.14 : 0.055;
    this.boost = Math.max(0, this.boost - dtSec);
    const k = 1 - Math.exp(-dtSec / tau);
    this.pos = lerp(this.pos, target, k);
    let d = angle - this.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.angle += d * k;
  }
}

/** The loose ends of the thread, which trail behind the hand a little. */
export class ThreadView {
  trail: Vec2 = { x: 0, y: 0 };
  tail: Vec2 = { x: 0, y: 0 };
  private inited = false;

  reset(): void {
    this.inited = false;
  }

  update(attach: Vec2, tailTarget: Vec2, dtSec: number): void {
    if (!this.inited) {
      this.trail = { x: attach.x - 0.1, y: attach.y + 0.12 };
      this.tail = { ...tailTarget };
      this.inited = true;
    }
    this.trail = lerp(this.trail, { x: attach.x - 0.18, y: attach.y + 0.16 }, 1 - Math.exp(-dtSec / 0.16));
    this.tail = lerp(this.tail, tailTarget, 1 - Math.exp(-dtSec / 0.2));
  }
}

export interface SceneView {
  pad: Pad;
  snap: Snapshot;
  needle: ToolView;
  forceps: ToolView;
  needleTool: ToolState;
  forcepsTool: ToolState;
  thread: ThreadView;
  /** How far healing has got after the last stitch, 0 to 1. It starts at the middle of the wound and spreads outward. */
  healed: number;
  /** How tightly each stitch has drawn the wound together, as drawn (smoothed), in the order of `snap.sites`. */
  closure: number[];
  /** How far each placed stitch's knot has settled in, 0 to 1. */
  tie: number[];
  hands: Sides;
  aspect: number;
  showSkeleton: boolean;
  /** Draw a backdrop, because there is no camera picture behind. */
  backdrop: boolean;
  /** How opaque the pad is: low over the live picture, so the trainee's real hands show through. */
  padAlpha: number;
  /** A short caption for the hint hand, drawn on this layer so it stays readable when the hint hand is faded. */
  hintCaption: { pos: Vec2; text: string } | null;
}


const TAU = Math.PI * 2;
const smooth01 = (t: number): number => smoothstep(clamp(t, 0, 1));
type RGB = [number, number, number];
const BLOOD: RGB = [112, 36, 46];
const SCAR: RGB = [226, 160, 152];
const mixRgb = (a: RGB, b: RGB, t: number): string => `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`;

/** A gentle irregularity along the wound. Both edges use it, so they fit together as a seam when they meet. */
function wobble(x: number): number {
  return 0.0022 * Math.sin(x * 31 + 0.6) + 0.0013 * Math.sin(x * 83 + 2.1) + 0.0008 * Math.sin(x * 157 + 4.2);
}

/** Skin pores: a fixed scatter over the pad (0 to 1 each way), so the texture does not shimmer from frame to frame. */
const PORES = (() => {
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 280 }, () => ({ u: rnd(), v: rnd(), r: 0.0011 + rnd() * 0.0017 }));
})();

/** How tightly the nearest stitches have drawn the wound together at x, 0 to 1. */
function closureAt(x: number, pad: Pad, closure: number[]): number {
  let m = 0;
  for (let i = 0; i < pad.sites.length; i++) m = Math.max(m, (closure[i] ?? 0) * Math.exp(-(((x - pad.sites[i].x) / 0.1) ** 2)));
  return m;
}

/** How far healing has got at x: it starts in the middle, where the first stitch went, and spreads outward. */
function healAt(x: number, pad: Pad, healed: number): number {
  const mid = (pad.wound.a.x + pad.wound.b.x) / 2;
  const half = (pad.wound.b.x - pad.wound.a.x) / 2;
  return smooth01(healed * 1.5 - (0.5 * Math.abs(x - mid)) / half);
}

/** How open the wound is at x: wide where nothing is stitched, drawn together near each stitch, pointed at the ends. */
function gapAt(x: number, s: SceneView): number {
  const { pad } = s;
  const end = smooth01(Math.min(x - pad.wound.a.x, pad.wound.b.x - x) / 0.07);
  return pad.gap0 * (1 - 0.9 * closureAt(x, pad, s.closure)) * (1 - 0.85 * healAt(x, pad, s.healed)) * (0.12 + 0.88 * end);
}

/** Strokes a polyline one short segment at a time, so the colour can change along it. */
function strokeSegments(c: Ctx, xs: number[], ys: number[], width: number, style: (i: number) => string | null): void {
  const { ctx, k } = c;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  for (let i = 0; i < xs.length - 1; i++) {
    const st = style(i);
    if (!st) continue;
    ctx.strokeStyle = st;
    ctx.beginPath();
    ctx.moveTo(xs[i] * k, ys[i] * k);
    ctx.lineTo(xs[i + 1] * k, ys[i + 1] * k);
    ctx.stroke();
  }
}

/** The pad, its skin, and the wound: how open it is, bunched and raised by the stitches, and then healing over. */
function drawPad(c: Ctx, s: SceneView): void {
  const { ctx, k } = c;
  const { pad, padAlpha: alpha } = s;
  const r = pad.rect;
  const padPath = (): void => {
    ctx.beginPath();
    ctx.roundRect(r.x * k, r.y * k, r.w * k, r.h * k, 0.05 * k);
  };
  padPath();
  const fill = ctx.createLinearGradient(0, r.y * k, 0, (r.y + r.h) * k);
  fill.addColorStop(0, `rgba(237,192,169,${alpha})`);
  fill.addColorStop(1, `rgba(217,157,135,${alpha})`);
  ctx.save();
  if (alpha > 0.8) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 0.03 * k;
    ctx.shadowOffsetY = 0.012 * k;
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(1.5, 0.004 * k);
  ctx.strokeStyle = `rgba(182,113,93,${Math.min(1, alpha + 0.3)})`;
  ctx.stroke();

  const { a, b } = pad.wound;
  const N = 96;
  const xs = Array.from({ length: N + 1 }, (_, i) => a.x + ((b.x - a.x) * i) / N);
  const clo = xs.map((x) => closureAt(x, pad, s.closure));
  const heal = xs.map((x) => healAt(x, pad, s.healed));
  const half = xs.map((x) => gapAt(x, s) / 2);
  const mid = xs.map((x) => a.y + wobble(x));
  const top = mid.map((y, i) => y - half[i]);
  const bottom = mid.map((y, i) => y + half[i]);
  const avg = (arr: number[], i: number): number => (arr[i] + arr[i + 1]) / 2;

  // Skin texture, and the red flush round the wound: it deepens where the stitches pull, and fades as it heals.
  ctx.save();
  padPath();
  ctx.clip();
  ctx.beginPath();
  for (const p of PORES) {
    const x = (r.x + p.u * r.w) * k;
    const y = (r.y + p.v * r.h) * k;
    const rad = p.r * k;
    ctx.moveTo(x + rad, y);
    ctx.arc(x, y, rad, 0, TAU);
  }
  ctx.fillStyle = `rgba(150,92,78,${0.2 * alpha})`;
  ctx.fill();
  const flushH = 0.075;
  const flush = ctx.createLinearGradient(0, (a.y - flushH) * k, 0, (a.y + flushH) * k);
  flush.addColorStop(0, 'rgba(224,92,92,0)');
  flush.addColorStop(0.5, 'rgba(224,92,92,1)');
  flush.addColorStop(1, 'rgba(224,92,92,0)');
  ctx.fillStyle = flush;
  for (let i = 0; i < N; i += 2) {
    const x0 = xs[i];
    const x1 = xs[i + 2];
    const xm = (x0 + x1) / 2;
    const red = (0.3 + 0.7 * closureAt(xm, pad, s.closure)) * (1 - healAt(xm, pad, s.healed)) * smooth01(Math.min(xm - a.x, b.x - xm) / 0.1);
    ctx.globalAlpha = 0.36 * alpha * red;
    ctx.fillRect(x0 * k - 0.5, (a.y - flushH) * k, (x1 - x0) * k + 1, 2 * flushH * k);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // The opening itself: blood-red, turning pink as it heals, with some depth to it while it is open.
  const bodyAlpha = 0.5 + 0.45 * alpha;
  ctx.beginPath();
  xs.forEach((x, i) => (i ? ctx.lineTo(x * k, top[i] * k) : ctx.moveTo(x * k, top[i] * k)));
  for (let i = N; i >= 0; i--) ctx.lineTo(xs[i] * k, bottom[i] * k);
  ctx.closePath();
  const body = ctx.createLinearGradient(a.x * k, 0, b.x * k, 0);
  for (let i = 0; i <= 12; i++) body.addColorStop(i / 12, `rgba(${mixRgb(BLOOD, SCAR, healAt(a.x + ((b.x - a.x) * i) / 12, pad, s.healed))},${bodyAlpha})`);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const depth = ctx.createLinearGradient(0, (a.y - 0.02) * k, 0, (a.y + 0.02) * k);
  depth.addColorStop(0, 'rgba(40,6,12,0)');
  depth.addColorStop(0.5, `rgba(40,6,12,${0.55 * (1 - s.healed)})`);
  depth.addColorStop(1, 'rgba(40,6,12,0)');
  ctx.fillStyle = depth;
  ctx.fillRect(a.x * k, (a.y - 0.03) * k, (b.x - a.x) * k, 0.06 * k);
  ctx.restore();
  // A wet shine along the middle of the open part.
  strokeSegments(c, xs, mid, Math.max(1, 0.0016 * k), (i) => {
    const open = (1 - avg(clo, i)) * (1 - avg(heal, i));
    return open > 0.05 ? `rgba(255,222,222,${0.26 * open})` : null;
  });

  // The two edges of the skin: they fade as the wound heals over.
  const edgeWidth = Math.max(2, 0.005 * k);
  strokeSegments(c, xs, top, edgeWidth, (i) => `rgba(250,222,208,${0.95 * (1 - 0.8 * avg(heal, i))})`);
  strokeSegments(c, xs, bottom, edgeWidth, (i) => `rgba(190,120,100,${0.95 * (1 - 0.8 * avg(heal, i))})`);

  // Where the stitches have drawn the edges together, the skin stands up a little along the seam (eversion).
  const ridge = (i: number): number => smooth01((avg(clo, i) - 0.25) / 0.6) * (1 - 0.75 * avg(heal, i));
  strokeSegments(c, xs, mid.map((y) => y - 0.0042), Math.max(1.5, 0.004 * k), (i) => (ridge(i) > 0.02 ? `rgba(255,238,228,${0.6 * ridge(i) * alpha})` : null));
  strokeSegments(c, xs, mid.map((y) => y + 0.0046), Math.max(1.5, 0.0045 * k), (i) => (ridge(i) > 0.02 ? `rgba(140,72,64,${0.5 * ridge(i) * alpha})` : null));

  // Healed: the seam settles into a faint pink line.
  strokeSegments(c, xs, mid, Math.max(2, 0.0065 * k), (i) => (avg(heal, i) > 0.02 ? `rgba(240,190,185,${0.24 * avg(heal, i) * alpha})` : null));

  // The skin bunches in small folds beside a stitch as it is drawn tight.
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, 0.0022 * k);
  pad.sites.forEach((site, i) => {
    const cl = s.closure[i] ?? 0;
    if (cl < 0.03) return;
    const fade = 1 - healAt(site.x, pad, s.healed);
    if (fade < 0.02) return;
    ctx.strokeStyle = `rgba(128,66,58,${0.4 * alpha * cl * fade})`;
    for (const side of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const x0 = site.x + (j - 1.5) * 0.015;
        const y0 = a.y + wobble(x0) + side * (gapAt(x0, s) / 2 + 0.005);
        const len = 0.03 + 0.008 * Math.abs(j - 1.5);
        ctx.beginPath();
        ctx.moveTo(x0 * k, y0 * k);
        ctx.quadraticCurveTo((x0 + (site.x - x0) * 0.1) * k, (y0 + side * len * 0.55) * k, (x0 + (site.x - x0) * 0.35) * k, (y0 + side * len) * k);
        ctx.stroke();
      }
    }
  });
}

type RingMode = 'active' | 'dim' | 'holding' | 'lapsed';

function ring(c: Ctx, pos: Vec2, radius: number, mode: RingMode, label: string, progress = 0): void {
  const { ctx, k } = c;
  const [x, y] = P(c, pos);
  const colour = mode === 'lapsed' ? AMBER : mode === 'dim' ? 'rgba(255,255,255,0.85)' : ACCENT;
  const width = mode === 'active' || mode === 'lapsed' ? Math.max(3, 0.007 * k) : Math.max(2, 0.004 * k);
  ctx.setLineDash(mode === 'dim' ? [0.012 * k, 0.012 * k] : []);
  // A dark ring under the coloured one keeps it visible on any background.
  ctx.beginPath();
  ctx.arc(x, y, radius * k, 0, Math.PI * 2);
  ctx.lineWidth = width + 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, radius * k, 0, Math.PI * 2);
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.setLineDash([]);
  if (progress > 0 && mode === 'active') {
    ctx.beginPath();
    ctx.arc(x, y, (radius + 0.014) * k, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(progress, 0, 1));
    ctx.lineWidth = Math.max(5, 0.011 * k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
  }
  // Above the ring: the instruments' shafts run down from their tips and would cover a label below.
  if (label) haloText(c, label, { x: pos.x, y: pos.y - radius - 0.04 }, 0.026, mode === 'lapsed' ? AMBER : '#ffffff');
}

/** Where the thread goes into and comes out of the skin: a small dimple, a pale rim and the puncture itself. */
function punctures(c: Ctx, pts: Vec2[], strength: number, fx: number): void {
  const { ctx, k } = c;
  for (const p of pts) {
    const [x, y] = P(c, p);
    const dimple = ctx.createRadialGradient(x, y, 0, x, y, 0.032 * k);
    dimple.addColorStop(0, `rgba(116,58,50,${0.34 * fx * strength})`);
    dimple.addColorStop(1, 'rgba(116,58,50,0)');
    ctx.fillStyle = dimple;
    ctx.beginPath();
    ctx.arc(x, y, 0.032 * k, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3, 0.0095 * k), 0, TAU);
    ctx.fillStyle = `rgba(255,226,216,${0.5 * fx})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.2, 0.0058 * k), 0, TAU);
    ctx.fillStyle = '#4a141c';
    ctx.fill();
  }
}

/** The knot of an interrupted stitch: it sits to one side of the wound, never on it, with two short cut ends. */
function drawKnot(c: Ctx, s: SiteView, tailSign: number, tie: number, fx: number): void {
  if (tie < 0.02) return;
  const { ctx, k } = c;
  const dir = norm(sub(s.exit, s.entry));
  const at = lerp(s.entry, s.exit, 0.36);
  const [x, y] = P(c, at);
  const grow = 0.86 + 0.14 * tie;
  const away = Math.atan2(-dir.y, -dir.x);
  const w = Math.max(2.2, 0.0048 * k);
  ctx.save();
  ctx.globalAlpha = clamp(tie * 1.3, 0, 1);
  ctx.lineCap = 'butt';
  for (const [spread, len, curl] of [[0.72, 0.058, 0.35], [-0.32, 0.046, -0.3]] as const) {
    const ang = away + spread * tailSign;
    const end: [number, number] = [x + Math.cos(ang) * len * k * grow, y + Math.sin(ang) * len * k * grow];
    const ctl: [number, number] = [x + Math.cos(ang + curl * tailSign) * len * 0.55 * k, y + Math.sin(ang + curl * tailSign) * len * 0.55 * k];
    for (const pass of [0, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + (pass === 0 ? 0.0015 * k : 0), y + (pass === 0 ? 0.003 * k : 0));
      ctx.quadraticCurveTo(ctl[0] + (pass === 0 ? 0.0015 * k : 0), ctl[1] + (pass === 0 ? 0.003 * k : 0), end[0] + (pass === 0 ? 0.0015 * k : 0), end[1] + (pass === 0 ? 0.003 * k : 0));
      ctx.lineWidth = pass === 0 ? w + 1.5 : w;
      ctx.strokeStyle = pass === 0 ? `rgba(50,14,14,${0.28 * fx})` : THREAD;
      ctx.stroke();
    }
  }
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dir.y, dir.x));
  ctx.scale(grow, grow);
  ctx.beginPath();
  ctx.ellipse(0.003 * k, 0.005 * k, 0.017 * k, 0.0125 * k, 0, 0, TAU);
  ctx.fillStyle = `rgba(40,10,10,${0.3 * fx})`;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.0165 * k, 0.0115 * k, 0, 0, TAU);
  ctx.fillStyle = '#2a4db3';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(8,16,60,0.7)';
  ctx.stroke();
  for (const dx of [-0.006, 0.007]) {
    ctx.beginPath();
    ctx.ellipse(dx * k, 0, 0.0085 * k, 0.0095 * k, 0, 0, TAU);
    ctx.fillStyle = '#3a5fcb';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(-0.003 * k, -0.004 * k, 0.005 * k, 0.0028 * k, -0.3, 0, TAU);
  ctx.fillStyle = 'rgba(190,210,255,0.7)';
  ctx.fill();
  ctx.restore();
}

/** A placed stitch: the thread across the wound, pulled taut, the knot to one side of it, and the two punctures. */
function drawStitch(c: Ctx, s: SiteView, tailSign: number, tie: number, fx: number): void {
  const { ctx, k } = c;
  const w = Math.max(2.6, 0.0055 * k);
  const off = 0.0035 * k;
  const [ex, ey] = P(c, s.entry);
  const [xx, xy] = P(c, s.exit);
  punctures(c, [s.entry, s.exit], 1, fx);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ex + off * 0.6, ey + off);
  ctx.lineTo(xx + off * 0.6, xy + off);
  ctx.lineWidth = w + 2;
  ctx.strokeStyle = `rgba(50,14,14,${0.3 * fx})`;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(xx, xy);
  ctx.lineWidth = w;
  ctx.strokeStyle = THREAD;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ex - 0.6, ey - 0.9);
  ctx.lineTo(xx - 0.6, xy - 0.9);
  ctx.lineWidth = Math.max(1, w * 0.32);
  ctx.strokeStyle = 'rgba(170,196,255,0.55)';
  ctx.stroke();
  drawKnot(c, s, tailSign, tie, fx);
}

function drawSites(c: Ctx, s: SceneView): void {
  const { ctx, k } = c;
  const { pad, snap } = s;
  const tailSign = pad.dominant === 'R' ? -1 : 1;
  const fx = 0.4 + 0.6 * s.padAlpha;
  for (const [i, site] of snap.sites.entries()) {
    if (site.state === 'done') drawStitch(c, site, tailSign, s.tie[i] ?? 1, fx);
    else if (site.state === 'todo') {
      const [x, y] = P(c, { x: site.x, y: pad.wound.a.y });
      ctx.beginPath();
      ctx.arc(x, y, 0.024 * k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,24,28,0.7)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      haloText(c, String(site.order), { x: site.x, y: pad.wound.a.y }, 0.024);
    }
  }

  const now = snap.sites.find((x) => x.state === 'now');
  if (!now) return;
  const step = snap.step;
  // The forceps ring: the thing to do, then the thing to keep doing, then gone.
  if (step === 'hold') ring(c, now.forceps, pad.forcepsRadius, 'active', 'Hold the edge here', snap.progress);
  else if (snap.forcepsNeeded) ring(c, now.forceps, pad.forcepsRadius, snap.forcepsOk ? 'holding' : 'lapsed', snap.forcepsOk ? 'Holding' : 'Hold the edge');
  // The needle's rings.
  if (step === 'enter') ring(c, now.entry, pad.entryRadius, 'active', 'Entry', snap.progress);
  else if (step === 'hold') ring(c, now.entry, pad.entryRadius, 'dim', 'Entry');
  if (step === 'drive') ring(c, now.exit, pad.exitRadius, 'active', 'Exit');
  else if (step === 'hold' || step === 'enter') ring(c, now.exit, pad.exitRadius, 'dim', 'Exit');
  if (step === 'pull') {
    const target = snap.target;
    if (!snap.pullArmed) {
      // The thread has slipped back: the exit ring is the place to start again, and the far ring waits.
      ring(c, now.exit, pad.exitRadius, 'active', 'Start the pull again here');
      if (target.pos && target.radius) ring(c, target.pos, target.radius, 'dim', 'Pull up to here');
    } else if (target.pos && target.radius) ring(c, target.pos, target.radius, 'active', 'Pull up to here', snap.progress);
  }
  if (step === 'drive') {
    const n = perp(pad.dir);
    const lane = (off: number, solid: boolean): void => {
      const a = add(now.entry, mul(n, off));
      const b = add(now.exit, mul(n, off));
      for (const pass of [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(a.x * k, a.y * k);
        ctx.lineTo(b.x * k, b.y * k);
        ctx.lineWidth = pass === 0 ? Math.max(5, 0.008 * k) : Math.max(2, 0.004 * k);
        ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.45)' : solid ? ACCENT : 'rgba(255,255,255,0.85)';
        ctx.setLineDash(solid ? [] : [0.014 * k, 0.014 * k]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    lane(0, false);
    lane(pad.corridor, true);
    lane(-pad.corridor, true);
    const reached = lerp(now.entry, now.exit, clamp(snap.driveProgress, 0, 1));
    ctx.beginPath();
    ctx.moveTo(now.entry.x * k, now.entry.y * k);
    ctx.lineTo(reached.x * k, reached.y * k);
    ctx.lineWidth = Math.max(4, 0.01 * k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
  }
}

function curve(c: Ctx, p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, width: number): void {
  const { ctx, k } = c;
  for (const pass of [0, 1]) {
    ctx.beginPath();
    ctx.moveTo(p0.x * k, p0.y * k);
    ctx.bezierCurveTo(p1.x * k, p1.y * k, p2.x * k, p2.y * k, p3.x * k, p3.y * k);
    ctx.lineWidth = pass === 0 ? width + 2.5 : width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.4)' : THREAD;
    ctx.stroke();
  }
}

/** A strand from a to b that sags by `sag` (scene units, downwards), more when it has slack. */
function strand(c: Ctx, a: Vec2, b: Vec2, sag: number, width: number): void {
  const m1 = lerp(a, b, 0.33);
  const m2 = lerp(a, b, 0.66);
  curve(c, a, { x: m1.x, y: m1.y + sag }, { x: m2.x, y: m2.y + sag }, b, width);
}

function needleGeometry(pos: Vec2, angle: number): { jaws: Vec2; back: Vec2; attach: Vec2; d: Vec2; q: Vec2 } {
  const d = { x: Math.cos(angle), y: Math.sin(angle) };
  const q = perp(d);
  const jaws = sub(pos, mul(d, 0.055));
  return { jaws, back: sub(jaws, mul(d, 0.3)), attach: sub(jaws, add(mul(d, 0.03), mul(q, 0.016))), d, q };
}

/** Where the thread leaves the needle, for a needle holder at this pinch point. */
export function needleAttach(pos: Vec2, angle: number): Vec2 {
  return needleGeometry(pos, angle).attach;
}

function drawNeedleHolder(c: Ctx, pos: Vec2, angle: number, alpha: number): void {
  const { ctx, k } = c;
  const { jaws, back, d, q } = needleGeometry(pos, angle);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    ctx.beginPath();
    ctx.moveTo(back.x * k, back.y * k);
    ctx.lineTo(jaws.x * k, jaws.y * k);
    ctx.lineWidth = pass === 0 ? Math.max(7, 0.017 * k) : Math.max(4.5, 0.011 * k);
    ctx.strokeStyle = pass === 0 ? '#39424b' : '#c9d0d6';
    ctx.stroke();
  }
  for (const side of [-1, 1]) {
    const centre = add(back, add(mul(q, side * 0.026), mul(d, -0.012)));
    ctx.beginPath();
    ctx.arc(centre.x * k, centre.y * k, 0.021 * k, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, 0.008 * k);
    ctx.strokeStyle = '#d9a93a';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(jaws.x * k, jaws.y * k);
  ctx.lineTo((jaws.x + d.x * 0.03) * k, (jaws.y + d.y * 0.03) * k);
  ctx.lineWidth = Math.max(5, 0.013 * k);
  ctx.strokeStyle = '#2d343b';
  ctx.stroke();
  const from = sub(jaws, mul(q, 0.012));
  ctx.beginPath();
  ctx.moveTo(from.x * k, from.y * k);
  ctx.quadraticCurveTo((jaws.x + q.x * 0.034) * k, (jaws.y + q.y * 0.034) * k, pos.x * k, pos.y * k);
  ctx.lineWidth = Math.max(2, 0.0045 * k);
  ctx.strokeStyle = '#eef1f3';
  ctx.stroke();
  ctx.restore();
}

function drawForceps(c: Ctx, pos: Vec2, angle: number, alpha: number): void {
  const { ctx, k } = c;
  const d = { x: Math.cos(angle), y: Math.sin(angle) };
  const q = perp(d);
  const tail = sub(pos, mul(d, 0.27));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const end = add(tail, mul(q, side * 0.022));
    for (const pass of [0, 1]) {
      ctx.beginPath();
      ctx.moveTo(pos.x * k, pos.y * k);
      ctx.lineTo(end.x * k, end.y * k);
      ctx.lineWidth = pass === 0 ? Math.max(5, 0.012 * k) : Math.max(3, 0.0075 * k);
      ctx.strokeStyle = pass === 0 ? '#39424b' : '#d3d9de';
      ctx.stroke();
    }
  }
  ctx.restore();
}




export function drawScene(canvas: HTMLCanvasElement, s: SceneView): void {
  const c = prepare(canvas);
  if (!c) return;
  const { pad, snap } = s;
  if (s.backdrop) {
    const back = c.ctx.createLinearGradient(0, 0, 0, c.h);
    back.addColorStop(0, '#2a333c');
    back.addColorStop(1, '#1b2128');
    c.ctx.fillStyle = back;
    c.ctx.fillRect(0, 0, c.w, c.h);
  }
  drawPad(c, s);
  drawSites(c, s);

  const nGeo = needleGeometry(s.needle.pos, s.needle.angle);
  const width = Math.max(2, 0.0048 * c.k);
  const now = snap.sites.find((x) => x.state === 'now');
  if (snap.step === 'pull' && now) {
    // Under the skin the thread runs from the entry to the exit, so it is dashed; the punctures are where it comes out.
    // A short tail stays at the entry, and the rest runs to the needle holder.
    const fx = 0.4 + 0.6 * s.padAlpha;
    c.ctx.setLineDash([0.012 * c.k, 0.01 * c.k]);
    c.ctx.beginPath();
    c.ctx.moveTo(now.entry.x * c.k, now.entry.y * c.k);
    c.ctx.lineTo(now.exit.x * c.k, now.exit.y * c.k);
    c.ctx.lineWidth = width;
    c.ctx.lineCap = 'butt';
    c.ctx.strokeStyle = 'rgba(45,91,209,0.55)';
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    punctures(c, [now.entry, now.exit], clamp(s.closure[snap.sites.indexOf(now)] ?? 0, 0, 1), fx);
    strand(c, now.entry, s.thread.tail, 0.03, width);
    const away = Math.hypot(nGeo.attach.x - now.exit.x, nGeo.attach.y - now.exit.y);
    strand(c, now.exit, nGeo.attach, Math.max(0.005, 0.12 - away * 0.25), width);
  } else if (s.needle.picked && !snap.done) {
    strand(c, nGeo.attach, s.thread.trail, 0.05, width);
  }

  drawForceps(c, s.forceps.pos, s.forceps.angle, s.forceps.picked ? (s.forcepsTool.held ? 1 : 0.5) : 0.6);
  drawNeedleHolder(c, s.needle.pos, s.needle.angle, s.needle.picked ? (s.needleTool.held ? 1 : 0.5) : 0.6);
  if (s.forceps.picked) aimDot(c, s.forceps.pos, s.forcepsTool.held);
  if (s.needle.picked) aimDot(c, s.needle.pos, s.needleTool.held);
  if (!s.needle.picked) label(c, 'Needle holder', pad.tray.needle, -0.075);
  if (!s.forceps.picked) label(c, 'Forceps', pad.tray.forceps, -0.075);
  if (s.hintCaption) label(c, s.hintCaption.text, s.hintCaption.pos, 0);
  if (s.showSkeleton) drawSkeleton(c, s.hands, s.aspect);
}

