import { add, mul, perp, sub } from './geometry.ts';
import type { Vec2 } from './geometry.ts';
import type { Sides } from './identity.ts';
import { handPoints } from './synthetic.ts';

// Canvas helpers shared by the practice pages: the canvas setup, text with a halo, the hand outlines, the hint hand.

export const SIDE_COLOUR = { L: '#56b4e9', R: '#e69f00' };
export const ACCENT = '#2fd3c0';
export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
export const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export interface Ctx {
  ctx: CanvasRenderingContext2D;
  k: number;
  w: number;
  h: number;
}

export function prepare(canvas: HTMLCanvasElement): Ctx | null {
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

export const P = (c: Ctx, p: Vec2): [number, number] => [p.x * c.k, p.y * c.k];

/** Text with a dark halo, so it reads over a skin-coloured pad, a dark backdrop or a live picture alike. */
export function haloText(c: Ctx, text: string, at: Vec2, size: number, fill = '#ffffff'): void {
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

/** A small dot exactly at an instrument's tip, so it is plain where the tip is relative to the rings. */
export function aimDot(c: Ctx, pos: Vec2, held: boolean): void {
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

export function drawSkeleton(c: Ctx, hands: Sides, aspect: number): void {
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

export function label(c: Ctx, text: string, at: Vec2, below: number): void {
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
