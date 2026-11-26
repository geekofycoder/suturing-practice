import { ACCENT, FONT, aimDot, drawSkeleton, haloText, label, prepare, P } from '../common/draw.ts';
import type { Ctx } from '../common/draw.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { Sides } from '../common/identity.ts';
import type { RigTool } from '../common/rig.ts';
import { RULES } from './content.ts';
import type { Hands } from './content.ts';
import { ecgValue } from './ecg.ts';
import type { Layout } from './layout.ts';
import type { Rhythm, Ring, Snapshot, Zone } from './machine.ts';

const AMBER = '#ffb84d';
const ALERT = '#ff7a66';
const GREEN = '#5cf08a';
const STEEL = '#d9e0e5';
const SHADOW = 'rgba(0,0,0,0.5)';
const BLOOD = 'rgba(122,24,44,0.92)';

/** A value that glides toward its target, so a drawing keeps moving smoothly between the tracker's results. */
class Glide {
  v: number | null = null;
  update(target: number, dt: number, tau = 0.05): number {
    if (this.v === null) this.v = target;
    else this.v += (target - this.v) * (1 - Math.exp(-dt / tau));
    return this.v;
  }
  reset(): void {
    this.v = null;
  }
}

class Glide2 {
  x = new Glide();
  y = new Glide();
  get pos(): Vec2 | null {
    return this.x.v === null || this.y.v === null ? null : { x: this.x.v, y: this.y.v };
  }
  update(target: Vec2, dt: number): void {
    this.x.update(target.x, dt);
    this.y.update(target.y, dt);
  }
  reset(): void {
    this.x.reset();
    this.y.reset();
  }
}

/** The smoothed positions of everything that moves. */
export class Motion {
  wireTipY = new Glide();
  needleHubY = new Glide();
  syringeY = new Glide();
  dilTipY = new Glide();
  catTipY = new Glide();
  catHubY = new Glide();
  primary = new Glide2();
  secondary = new Glide2();

  update(snap: Snapshot, tools: Record<'primary' | 'secondary', RigTool>, dt: number): void {
    this.wireTipY.update(snap.wire.tipY, dt);
    this.needleHubY.update(snap.needle.hubY, dt);
    this.syringeY.update(snap.syringe.y, dt);
    this.dilTipY.update(snap.dilator.tipY, dt);
    this.catTipY.update(snap.catheter.tipY, dt);
    this.catHubY.update(snap.catheter.hubY, dt);
    if (tools.primary.tracked) this.primary.update(tools.primary.pos, dt);
    if (tools.secondary.tracked) this.secondary.update(tools.secondary.pos, dt);
  }

  reset(): void {
    for (const g of [this.wireTipY, this.needleHubY, this.syringeY, this.dilTipY, this.catTipY, this.catHubY]) g.reset();
    this.primary.reset();
    this.secondary.reset();
  }
}

/** A rolling picture of the simulated ECG: new samples are added as time passes and the rhythm at that moment is kept. */
export class EcgTrace {
  static readonly HZ = 60;
  static readonly SAMPLES = 200;
  buf: number[] = [];
  private t = 0;
  private acc = 0;

  update(dt: number, rhythm: Rhythm): void {
    this.acc += dt;
    while (this.acc >= 1 / EcgTrace.HZ) {
      this.acc -= 1 / EcgTrace.HZ;
      this.t += 1 / EcgTrace.HZ;
      this.buf.push(ecgValue(this.t, rhythm));
      if (this.buf.length > EcgTrace.SAMPLES) this.buf.shift();
    }
  }
}

export interface SceneView {
  L: Layout;
  snap: Snapshot;
  motion: Motion;
  tools: Record<'primary' | 'secondary', RigTool>;
  ecg: EcgTrace;
  names: Hands;
  hands: Sides;
  aspect: number;
  showSkeleton: boolean;
  /** Draw a backdrop, because there is no camera picture behind. */
  backdrop: boolean;
  /** How opaque the tissue is: low over the live picture, so the trainee's real hands show through. */
  tissueAlpha: number;
  hintCaption: { pos: Vec2; text: string } | null;
  /** Seconds, for flashing a lapse. */
  time: number;
}

// ---------------------------------------------------------------- small drawing helpers

/** Text with a halo, aligned left, right or centre. */
function tag(c: Ctx, text: string, x: number, y: number, align: CanvasTextAlign, size = 0.021, fill = '#ffffff'): void {
  const { ctx, k } = c;
  const px = Math.max(11, size * k);
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, px * 0.3);
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x * k, y * k);
  ctx.fillStyle = fill;
  ctx.fillText(text, x * k, y * k);
}

function segment(c: Ctx, a: Vec2, b: Vec2, width: number, colour: string, cap: CanvasLineCap = 'round'): void {
  const { ctx } = c;
  ctx.beginPath();
  ctx.moveTo(...P(c, a));
  ctx.lineTo(...P(c, b));
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.strokeStyle = colour;
  ctx.stroke();
}

/** A line drawn with a dark edge first, so it reads over any background. */
function edged(c: Ctx, a: Vec2, b: Vec2, width: number, colour: string): void {
  segment(c, a, b, width + 3, SHADOW);
  segment(c, a, b, width, colour);
}

function block(c: Ctx, cx: number, top: number, w: number, h: number, fill: string, stroke = 'rgba(0,0,0,0.55)', radius = 0.006): void {
  const { ctx, k } = c;
  ctx.beginPath();
  ctx.roundRect((cx - w / 2) * k, top * k, w * k, h * k, radius * k);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, 0.003 * k);
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

const wd = (c: Ctx, units: number): number => Math.max(2, units * c.k);

// ---------------------------------------------------------------- the body: skin, vein, heart, depth scale

function drawLanes(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L } = v;
  const lanes: [number, string][] = [
    [L.primaryX, `Your ${v.names.primary} hand`],
    [L.secondaryX, `Your ${v.names.secondary} hand`],
  ];
  for (const [x, name] of lanes) {
    ctx.beginPath();
    ctx.roundRect((x - L.r.lane) * k, 0.05 * k, L.r.lane * 2 * k, 0.9 * k, 0.03 * k);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.stroke();
    ctx.setLineDash([]);
    tag(c, name, x, 0.032, 'center', 0.02, 'rgba(255,255,255,0.8)');
  }
}

function drawBody(c: Ctx, v: SceneView): void {
  const { ctx, k, w } = c;
  const { L } = v;
  const a = v.tissueAlpha;
  const top = L.skinY * k;
  const tissue = ctx.createLinearGradient(0, top, 0, k);
  tissue.addColorStop(0, `rgba(240,190,165,${a})`);
  tissue.addColorStop(1, `rgba(196,124,104,${a})`);
  ctx.fillStyle = tissue;
  ctx.fillRect(0, top, w, k - top);

  // The vein runs down from just below the skin and opens into the heart.
  const vx = L.axis;
  const vTop = L.skinY + 0.02;
  const vBottom = L.depthY(19);
  const half = 0.032;
  ctx.beginPath();
  ctx.roundRect((vx - half) * k, vTop * k, half * 2 * k, (vBottom - vTop) * k, half * k);
  ctx.fillStyle = `rgba(104,24,48,${0.55 + 0.35 * a})`;
  ctx.fill();
  ctx.lineWidth = Math.max(2, 0.005 * k);
  ctx.strokeStyle = 'rgba(86,110,210,0.9)';
  ctx.stroke();

  // The heart's top edge is where the simulated ECG starts to show extra beats.
  const heartRy = 0.045;
  const hy = L.depthY(RULES.ectopyAbove.value) + heartRy;
  ctx.beginPath();
  ctx.ellipse(vx * k, hy * k, 0.17 * k, heartRy * k, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(190,52,70,${0.3 + 0.35 * a})`;
  ctx.fill();
  ctx.lineWidth = Math.max(2, 0.004 * k);
  ctx.strokeStyle = 'rgba(255,140,150,0.8)';
  ctx.stroke();
  tag(c, 'Heart', vx + 0.115, hy, 'center', 0.022, '#ffd4d8');

  // The skin line, with a note that the lengths above it are not to scale.
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(w, top);
  ctx.lineWidth = Math.max(2, 0.005 * k);
  ctx.strokeStyle = `rgba(150,84,66,${Math.min(1, a + 0.45)})`;
  ctx.stroke();
  tag(c, 'Skin', 0.04, L.skinY - 0.022, 'left', 0.02, 'rgba(255,255,255,0.85)');
}

function drawScale(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L, snap } = v;
  const x = L.axis;
  for (let cm = 5; cm <= 20; cm += 5) {
    const y = L.depthY(cm);
    segment(c, { x: x - 0.05, y }, { x: x - 0.068, y }, 2, 'rgba(255,255,255,0.8)', 'butt');
    tag(c, `${cm} cm`, x - 0.075, y, 'right', 0.019, 'rgba(255,255,255,0.85)');
  }
  if (snap.band) {
    const y0 = L.depthY(snap.band.min);
    const y1 = L.depthY(snap.band.max);
    ctx.fillStyle = 'rgba(47,211,192,0.26)';
    ctx.fillRect((x - 0.058) * k, y0 * k, 0.116 * k, (y1 - y0) * k);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    for (const y of [y0, y1]) {
      ctx.beginPath();
      ctx.moveTo((x - 0.058) * k, y * k);
      ctx.lineTo((x + 0.058) * k, y * k);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const aim = snap.band.of === 'wire' ? `Aim: wire tip ${snap.band.min} to ${snap.band.max} cm` : `Aim: catheter tip ${snap.band.min} to ${snap.band.max} cm, now ${Math.max(0, snap.catheter.depth).toFixed(1)}`;
    tag(c, aim, x + 0.075, y0 - 0.022, 'left', 0.02, '#aef2ea');
  }
}

// ---------------------------------------------------------------- instruments

/** A vertical rod with a tapered tip at `tipY` and its hub `len` above. */
function rod(c: Ctx, x: number, tipY: number, len: number, width: number, fill: string, hubFill: string, hubW: number, hubH: number): void {
  const { ctx, k } = c;
  const topY = tipY - len;
  const taper = Math.min(0.035, len / 3);
  ctx.beginPath();
  ctx.moveTo((x - width / 2) * k, topY * k);
  ctx.lineTo((x + width / 2) * k, topY * k);
  ctx.lineTo((x + width / 2) * k, (tipY - taper) * k);
  ctx.lineTo((x + width * 0.14) * k, tipY * k);
  ctx.lineTo((x - width * 0.14) * k, tipY * k);
  ctx.lineTo((x - width / 2) * k, (tipY - taper) * k);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, 0.003 * k);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  block(c, x, topY - hubH, hubW, hubH, hubFill);
}

/** An instrument lying on the tray, waiting to be picked up. */
function onTray(c: Ctx, v: SceneView, name: string, length: number): void {
  const { ctx, k } = c;
  const at = v.L.tray;
  ctx.save();
  ctx.translate(at.x * k, at.y * k);
  ctx.rotate(-0.12);
  ctx.beginPath();
  ctx.roundRect((-length / 2) * k, -0.012 * k, length * k, 0.024 * k, 0.008 * k);
  ctx.fillStyle = 'rgba(223,230,235,0.95)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.restore();
  label(c, name, at, -0.075);
  tag(c, 'Pinch to pick up', at.x, at.y + 0.06, 'center', 0.019, '#ffffff');
}

function drawNeedle(c: Ctx, v: SceneView): void {
  const { L, snap, motion } = v;
  if (!snap.needle.present) return;
  const hubY = motion.needleHubY.v ?? snap.needle.hubY;
  const tipY = hubY + (L.needle.tipY - L.needle.hubY);
  edged(c, { x: L.axis, y: hubY }, { x: L.axis, y: tipY }, wd(c, 0.007), STEEL);
  block(c, L.axis, hubY - 0.034, 0.034, 0.034, '#7fb8e8');
}

function drawSyringe(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L, snap, motion } = v;
  if (!snap.syringe.on) return;
  const y = motion.syringeY.v ?? snap.syringe.y;
  const x = L.axis;
  edged(c, { x, y: y - 0.07 }, { x, y }, wd(c, 0.006), '#9aa5ad');
  block(c, x, y - 0.082, 0.05, 0.012, '#c3ccd2');
  ctx.beginPath();
  ctx.roundRect((x - 0.019) * k, y * k, 0.038 * k, 0.1 * k, 0.005 * k);
  ctx.fillStyle = 'rgba(225,235,242,0.6)';
  ctx.fill();
  ctx.fillStyle = BLOOD;
  ctx.fillRect((x - 0.015) * k, (y + 0.03) * k, 0.03 * k, 0.067 * k);
  ctx.lineWidth = Math.max(1.5, 0.003 * k);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect((x - 0.019) * k, y * k, 0.038 * k, 0.1 * k, 0.005 * k);
  ctx.stroke();
}

function drawDilator(c: Ctx, v: SceneView): void {
  const { L, snap, motion } = v;
  const d = snap.dilator;
  if (!d.visible) return;
  const len = L.dilator.stub;
  if (d.carryPos) rod(c, d.carryPos.x, d.carryPos.y + 0.08, len, 0.018, '#cfd8dd', '#eef2f4', 0.034, 0.024);
  else if (d.threaded) rod(c, L.axis, motion.dilTipY.v ?? d.tipY, len, 0.018, '#cfd8dd', '#eef2f4', 0.034, 0.024);
  else onTray(c, v, 'Dilator', 0.17);
}

function drawCatheter(c: Ctx, v: SceneView): void {
  const { L, snap, motion } = v;
  const cat = snap.catheter;
  if (!cat.visible) return;
  const tip = motion.catTipY.v ?? cat.tipY;
  const hub = motion.catHubY.v ?? cat.hubY;
  if (cat.carryPos) rod(c, cat.carryPos.x, cat.carryPos.y + 0.08, L.catheter.stub, 0.022, 'rgba(236,244,252,0.8)', '#9ad0ff', 0.042, 0.03);
  else if (cat.threaded) rod(c, L.axis, tip, tip - hub, 0.022, 'rgba(236,244,252,0.7)', '#9ad0ff', 0.042, 0.03);
  else onTray(c, v, 'Catheter', 0.22);
}

function drawWire(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L, snap, motion } = v;
  const wire = snap.wire;
  if (!wire.visible) return;
  if (wire.removed) {
    if (!wire.carryPos) return;
    // The wire is out and coiled in the hand.
    const at = wire.carryPos;
    for (const [r, lw] of [[0.05, 3.5], [0.036, 2.5]] as const) {
      ctx.beginPath();
      ctx.arc(at.x * k, (at.y + 0.07) * k, r * k, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(lw + 3, lw * 1.6);
      ctx.strokeStyle = SHADOW;
      ctx.stroke();
      ctx.lineWidth = Math.max(lw, lw);
      ctx.strokeStyle = STEEL;
      ctx.stroke();
    }
    return;
  }
  const tipY = motion.wireTipY.v ?? wire.tipY;
  const a = { x: L.axis, y: L.tailY };
  const b = { x: L.axis, y: tipY };
  edged(c, a, b, wd(c, 0.0045), STEEL);
  // The soft J-shaped tip.
  const jx = L.axis;
  ctx.beginPath();
  ctx.moveTo(jx * k, (tipY - 0.01) * k);
  ctx.quadraticCurveTo(jx * k, (tipY + 0.016) * k, (jx + 0.017) * k, (tipY + 0.004) * k);
  ctx.lineWidth = wd(c, 0.0045) + 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
  ctx.lineWidth = wd(c, 0.0045);
  ctx.strokeStyle = STEEL;
  ctx.stroke();
  // The end of the wire above the hub, where a tool threads on.
  ctx.beginPath();
  ctx.arc(L.axis * k, L.tailY * k, Math.max(3, 0.007 * k), 0, Math.PI * 2);
  ctx.fillStyle = STEEL;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
  if (wire.depth > 0.5) tag(c, `Wire ${wire.depth.toFixed(1)} cm`, L.axis + 0.05, tipY - 0.005, 'left', 0.02, '#ffffff');
}

function drawScalpel(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L, snap } = v;
  if (!snap.scalpel.visible) return;
  const tip = snap.scalpel.pos ?? L.tray;
  ctx.save();
  ctx.translate(tip.x * k, tip.y * k);
  ctx.rotate(0.45);
  ctx.beginPath();
  ctx.roundRect(-0.009 * k, -0.2 * k, 0.018 * k, 0.17 * k, 0.005 * k);
  ctx.fillStyle = '#3d474f';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.007 * k, -0.03 * k);
  ctx.lineTo(0.007 * k, -0.03 * k);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = '#eef2f4';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
  ctx.restore();
  if (!snap.scalpel.pos) {
    label(c, 'Scalpel', L.tray, -0.075);
    tag(c, 'Pinch to pick up', L.tray.x, L.tray.y + 0.06, 'center', 0.019);
  }
  if (snap.nicked) segment(c, { x: L.nick.x, y: L.skinY - 0.012 }, { x: L.nick.x, y: L.skinY + 0.012 }, wd(c, 0.004), '#a01c24');
}

function drawBin(c: Ctx, v: SceneView): void {
  const { L, snap } = v;
  if (snap.step !== 'wireout' && snap.step !== 'waste') return;
  const at = L.waste;
  block(c, at.x, at.y - 0.03, 0.11, 0.1, 'rgba(60,70,78,0.8)', 'rgba(255,255,255,0.7)', 0.012);
  segment(c, { x: at.x - 0.065, y: at.y - 0.036 }, { x: at.x + 0.065, y: at.y - 0.036 }, wd(c, 0.006), 'rgba(255,255,255,0.85)');
  if (snap.step === 'wireout') tag(c, 'Waste tray', at.x, at.y + 0.1, 'center', 0.02);
}

/** A handle out to a hand's lane: the drawn instruments are on the axis, so each has a grip to pinch. */
function drawHandle(c: Ctx, v: SceneView, h: { pos: Vec2; kind: string }): void {
  const { ctx, k } = c;
  const { L, snap, motion } = v;
  let y = h.pos.y;
  if (h.kind === 'needle') y = motion.needleHubY.v ?? y;
  else if (h.kind === 'syringe') y = motion.syringeY.v ?? y;
  else if (h.kind === 'dilator') y = (motion.dilTipY.v ?? snap.dilator.tipY) - L.dilator.handleOff;
  else if (h.kind === 'catheter') y = (motion.catTipY.v ?? snap.catheter.tipY) - L.catheter.handleOff;
  const side = h.pos.x > L.axis ? 1 : -1;
  segment(c, { x: L.axis + side * 0.02, y }, { x: h.pos.x - side * 0.022, y }, wd(c, 0.004), 'rgba(255,255,255,0.7)');
  ctx.beginPath();
  ctx.arc(h.pos.x * k, y * k, 0.024 * k, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(h.pos.x * k, y * k, 0.042 * k, 0, Math.PI * 2);
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
  ctx.setLineDash([]);
  const name: Record<string, string> = { needle: 'Needle', syringe: 'Syringe', dilator: 'Dilator', catheter: 'Catheter' };
  tag(c, name[h.kind] ?? h.kind, h.pos.x, y - 0.062, 'center', 0.02);
}

// ---------------------------------------------------------------- guidance: zones and rings

function ringColour(mode: Ring['mode'] | Zone['mode'], pulse: boolean): string {
  if (mode === 'holding') return ACCENT;
  if (mode === 'lapsed') return pulse ? ALERT : AMBER;
  if (mode === 'dim') return 'rgba(255,255,255,0.7)';
  return '#ffffff';
}

function drawZone(c: Ctx, z: Zone, pulse: boolean): void {
  const { ctx, k } = c;
  const colour = ringColour(z.mode, pulse);
  const halfW = 0.075;
  ctx.beginPath();
  ctx.roundRect((z.x - halfW) * k, z.top * k, halfW * 2 * k, (z.bottom - z.top) * k, 0.02 * k);
  ctx.fillStyle = z.mode === 'holding' ? 'rgba(47,211,192,0.16)' : z.mode === 'lapsed' ? 'rgba(255,122,102,0.16)' : 'rgba(255,255,255,0.1)';
  ctx.fill();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = Math.max(2, 0.004 * k);
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.setLineDash([]);
  if (z.label) tag(c, z.label, z.x, z.top + 0.034, 'center', 0.02, z.mode === 'lapsed' ? AMBER : '#ffffff');
}

function drawRing(c: Ctx, v: SceneView, r: Ring, pulse: boolean): void {
  const { ctx, k } = c;
  const colour = ringColour(r.mode, pulse);
  if (Math.abs(r.pos.x - v.L.secondaryX) < 0.01) {
    // The free hand works in its own lane; a thin line joins the ring to the axis it stands for.
    ctx.setLineDash([4, 5]);
    segment(c, { x: v.L.axis + (r.pos.x > v.L.axis ? 0.03 : -0.03), y: r.pos.y }, { x: r.pos.x + (r.pos.x > v.L.axis ? -r.radius : r.radius), y: r.pos.y }, 2, 'rgba(255,255,255,0.55)', 'butt');
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.arc(r.pos.x * k, r.pos.y * k, r.radius * k, 0, Math.PI * 2);
  ctx.fillStyle = r.mode === 'holding' ? 'rgba(47,211,192,0.18)' : 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, 0.005 * k) * (r.mode === 'lapsed' && pulse ? 1.4 : 1);
  ctx.strokeStyle = colour;
  ctx.stroke();
  if (r.progress && r.progress > 0.01) {
    ctx.beginPath();
    ctx.arc(r.pos.x * k, r.pos.y * k, (r.radius + 0.012) * k, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, r.progress));
    ctx.lineWidth = Math.max(3, 0.007 * k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
  }
  if (r.label) haloText(c, r.label, { x: r.pos.x, y: r.pos.y - r.radius - 0.036 }, 0.021, r.mode === 'lapsed' ? AMBER : '#ffffff');
}

// ---------------------------------------------------------------- the monitor

function drawEcg(c: Ctx, v: SceneView): void {
  const { ctx, k } = c;
  const { L, snap, ecg } = v;
  const w = Math.min(0.32, Math.max(0.22, L.axis - L.r.lane - 0.22 - 0.06));
  const h = 0.19;
  const x0 = L.dominant === 'R' ? 0.03 : v.aspect - 0.03 - w;
  const y0 = 0.11;
  ctx.beginPath();
  ctx.roundRect(x0 * k, y0 * k, w * k, h * k, 0.012 * k);
  ctx.fillStyle = 'rgba(8,14,12,0.88)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
  const colour = snap.rhythm === 'sinus' ? GREEN : snap.rhythm === 'ectopy' ? AMBER : ALERT;
  const gx = x0 + 0.01;
  const gw = w - 0.02;
  const gy = y0 + 0.042;
  const gh = h - 0.042 - 0.048;
  ctx.strokeStyle = 'rgba(92,240,138,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    ctx.moveTo((gx + (gw * i) / 6) * k, gy * k);
    ctx.lineTo((gx + (gw * i) / 6) * k, (gy + gh) * k);
  }
  ctx.stroke();
  const n = ecg.buf.length;
  if (n > 1) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = (gx + (gw * i) / (EcgTrace.SAMPLES - 1)) * k;
      const py = (gy + gh / 2 - ecg.buf[i] * (gh / 2) * 0.9) * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.8, 0.0035 * k);
    ctx.strokeStyle = colour;
    ctx.stroke();
  }
  const text = snap.rhythm === 'sinus' ? 'Normal rhythm' : snap.rhythm === 'ectopy' ? 'Extra beats: pull back' : 'Fast run: pull back now';
  tag(c, 'ECG (simulated)', x0 + 0.012, y0 + 0.022, 'left', 0.017, 'rgba(255,255,255,0.75)');
  tag(c, text, x0 + 0.012, y0 + h - 0.026, 'left', 0.017, colour);
}

// ---------------------------------------------------------------- the scene

export function drawScene(canvas: HTMLCanvasElement, v: SceneView): void {
  const c = prepare(canvas);
  if (!c) return;
  const { snap } = v;
  if (v.backdrop) {
    const back = c.ctx.createLinearGradient(0, 0, 0, c.h);
    back.addColorStop(0, '#2a333c');
    back.addColorStop(1, '#1b2128');
    c.ctx.fillStyle = back;
    c.ctx.fillRect(0, 0, c.w, c.h);
  }
  const pulse = Math.floor(v.time * 3) % 2 === 0;
  drawLanes(c, v);
  drawBody(c, v);
  drawScale(c, v);
  drawBin(c, v);
  drawNeedle(c, v);
  drawSyringe(c, v);
  drawDilator(c, v);
  drawCatheter(c, v);
  drawWire(c, v);
  drawScalpel(c, v);
  for (const z of snap.zones) drawZone(c, z, pulse);
  for (const r of snap.rings) drawRing(c, v, r, pulse);
  for (const h of snap.handles) drawHandle(c, v, h);
  drawEcg(c, v);
  for (const name of ['primary', 'secondary'] as const) {
    const pos = v.motion[name].pos;
    if (v.tools[name].tracked && pos) aimDot(c, pos, v.tools[name].held);
  }
  if (v.hintCaption) label(c, v.hintCaption.text, v.hintCaption.pos, 0);
  if (v.showSkeleton) drawSkeleton(c, v.hands, v.aspect);
}
