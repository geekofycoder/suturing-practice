import { add, clamp, lerp, mul, perp, sub } from './geometry.ts';
import type { Vec2 } from './geometry.ts';
import type { Sides } from './identity.ts';
import type { Pad } from './pad.ts';
import type { ToolState } from './pipeline.ts';
import type { SiteView, Snapshot } from './steps.ts';
import { handPoints } from './synthetic.ts';

const SIDE_COLOUR = { L: '#56b4e9', R: '#e69f00' };
const ACCENT = '#2fd3c0';
const AMBER = '#ffb84d';
const THREAD = '#2d5bd1';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

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
  /** How closed the wound looks after the last stitch, 0 to 1. */
  healed: number;
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

interface Ctx {
  ctx: CanvasRenderingContext2D;
  k: number;
  w: number;
  h: number;
}

function prepare(canvas: HTMLCanvasElement): Ctx | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, k: h, w, h };
}

const P = (c: Ctx, p: Vec2): [number, number] => [p.x * c.k, p.y * c.k];

/** Text with a dark halo, so it reads over a skin-coloured pad, a dark backdrop or a live picture alike. */
function haloText(c: Ctx, text: string, at: Vec2, size: number, fill = '#ffffff'): void {
  const { ctx } = c;
  const px = Math.max(11, size * c.k);
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const [x, y] = P(c, at);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, px * 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** How far apart the wound edges are at x: open where nothing is stitched, drawn together near each stitch. */
function gapAt(x: number, pad: Pad, sites: SiteView[], healed: number): number {
  let closure = 0;
  for (const s of sites) closure = Math.max(closure, s.closed * Math.exp(-(((x - s.x) / 0.1) ** 2)));
  return pad.gap0 * (1 - 0.88 * closure) * (1 - 0.85 * healed);
}

function drawPad(c: Ctx, s: SceneView): void {
  const { ctx, k } = c;
  const { pad, snap, padAlpha: alpha } = s;
  const r = pad.rect;
  ctx.beginPath();
  ctx.roundRect(r.x * k, r.y * k, r.w * k, r.h * k, 0.05 * k);
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

  // The wound, with the opening varying along it.
  const { a, b } = pad.wound;
  const steps = 64;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const half = gapAt(x, pad, snap.sites, s.healed) / 2;
    top.push([x * k, (a.y - half) * k]);
    bottom.push([x * k, (a.y + half) * k]);
  }
  ctx.beginPath();
  top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(112,36,46,${0.5 + 0.45 * alpha})`;
  ctx.fill();
  for (const [edge, colour] of [[top, 'rgba(250,222,208,0.95)'], [bottom, 'rgba(190,120,100,0.95)']] as const) {
    ctx.beginPath();
    edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineWidth = Math.max(2, 0.005 * k);
    ctx.strokeStyle = colour;
    ctx.stroke();
  }
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

/** A placed stitch: the thread across the wound, with a short tail at each end. */
function drawStitch(c: Ctx, s: SiteView, tailSign: number): void {
  const { ctx, k } = c;
  const [ex, ey] = P(c, s.entry);
  const [xx, xy] = P(c, s.exit);
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.45)' : THREAD;
    ctx.lineWidth = pass === 0 ? Math.max(4, 0.009 * k) : Math.max(2, 0.005 * k);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(xx, xy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.quadraticCurveTo(ex + tailSign * 0.02 * k, ey + 0.04 * k, ex + tailSign * 0.07 * k, ey + 0.065 * k);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xx, xy);
    ctx.quadraticCurveTo(xx - tailSign * 0.02 * k, xy - 0.03 * k, xx - tailSign * 0.06 * k, xy - 0.05 * k);
    ctx.stroke();
  }
  for (const [px, py] of [[ex, ey], [xx, xy]]) {
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.5, 0.007 * k), 0, Math.PI * 2);
    ctx.fillStyle = '#3a1218';
    ctx.fill();
  }
}

function drawSites(c: Ctx, s: SceneView): void {
  const { ctx, k } = c;
  const { pad, snap } = s;
  const tailSign = pad.dominant === 'R' ? -1 : 1;
  for (const site of snap.sites) {
    if (site.state === 'done') drawStitch(c, site, tailSign);
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
    if (target.pos && target.radius) ring(c, target.pos, target.radius, 'active', 'Pull up to here', snap.progress);
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

/** A small dot exactly at an instrument's tip, so it is plain where the tip is relative to the rings. */
function aimDot(c: Ctx, pos: Vec2, held: boolean): void {
  const { ctx } = c;
  const [x, y] = P(c, pos);
  const r = Math.max(4, 0.012 * c.k);
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = held ? ACCENT : '#ffffff';
  ctx.fill();
}

function drawSkeleton(c: Ctx, hands: Sides, aspect: number): void {
  const { ctx, k } = c;
  ctx.lineCap = 'round';
  for (const side of ['L', 'R'] as const) {
    const hand = hands[side];
    if (!hand) continue;
    const at = (i: number): [number, number] => [(1 - hand.lm[i * 3]) * aspect * k, hand.lm[i * 3 + 1] * k];
    ctx.strokeStyle = SIDE_COLOUR[side];
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1.5, 0.003 * k);
    ctx.beginPath();
    for (const [f, t] of BONES) {
      const [fx, fy] = at(f);
      const [tx, ty] = at(t);
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function label(c: Ctx, text: string, at: Vec2, below: number): void {
  const { ctx, k } = c;
  ctx.font = `700 ${Math.max(11, 0.026 * k)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const [x, y] = P(c, at);
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2 - 8, y + below * k - 14, w + 16, 22, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y + below * k + 2);
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
    // The thread runs through the tissue; a short tail stays at the entry, the rest runs to the needle holder.
    c.ctx.beginPath();
    c.ctx.moveTo(now.entry.x * c.k, now.entry.y * c.k);
    c.ctx.lineTo(now.exit.x * c.k, now.exit.y * c.k);
    c.ctx.lineWidth = width;
    c.ctx.lineCap = 'round';
    c.ctx.strokeStyle = THREAD;
    c.ctx.stroke();
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

/**
 * A translucent hint hand, drawn solid on its own canvas. The page fades the whole canvas, so fingers that
 * overlap do not show through each other.
 */
export function drawGhost(canvas: HTMLCanvasElement, show: { pos: Vec2; angle: number } | null): void {
  const c = prepare(canvas);
  if (!c || !show) return;
  const { ctx, k } = c;
  const pts = handPoints(show.pos, show.angle, true);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#6fdcf0';
  ctx.strokeStyle = '#6fdcf0';
  ctx.beginPath();
  for (const i of [0, 5, 9, 13, 17]) {
    const [x, y] = P(c, pts[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.03 * k;
  ctx.beginPath();
  for (const [f, t] of BONES) {
    const [fx, fy] = P(c, pts[f]);
    const [tx, ty] = P(c, pts[t]);
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
  }
  ctx.stroke();
}
