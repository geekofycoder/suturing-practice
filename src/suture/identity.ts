import { OVERLAP_PALMS, palmLength } from './hand-math.ts';
import type { Vec2 } from './geometry.ts';
import { dist } from './geometry.ts';
import type { RawHandLike } from './hand-input.ts';

export type Side = 'L' | 'R';
export interface Sides {
  L?: RawHandLike;
  R?: RawHandLike;
}

/** A hand last seen this long ago still counts as "where that hand was". */
const FRESH_MS = 700;
/** A single hand this close to where a hand was a moment ago is taken to be that hand. */
const NEAR = 0.3;
const MIN_VOTES = 20;

/**
 * Works out which hand is the trainee's left and which is the right.
 *
 * With two hands apart, the one on the left of the mirrored picture is the left hand: that needs no label at all.
 * The tracker's own Left/Right is compared with that whenever the hands are apart, so the page learns how this
 * camera labels hands. With one hand, or hands that overlap, it follows where each hand was a moment ago and
 * uses the learned labels as the tiebreak.
 */
export class Identity {
  /** A manual override on top of what was learned, for the rare case the labels are still wrong. */
  swap = false;
  private learned: 'asIs' | 'swapped' = 'asIs';
  private votes: boolean[] = [];
  private last: { L?: { pos: Vec2; t: number }; R?: { pos: Vec2; t: number } } = {};

  reset(): void {
    this.votes = [];
    this.learned = 'asIs';
    this.last = {};
  }

  /** How the tracker's labels are being read now. */
  get mapping(): 'asIs' | 'swapped' {
    return (this.learned === 'swapped') !== this.swap ? 'swapped' : 'asIs';
  }

  private fromLabel(label: 'Left' | 'Right'): Side {
    const asIs: Side = label === 'Left' ? 'L' : 'R';
    if (this.mapping === 'asIs') return asIs;
    return asIs === 'L' ? 'R' : 'L';
  }

  private fresh(side: Side, tMs: number): Vec2 | null {
    const seen = this.last[side];
    return seen && tMs - seen.t <= FRESH_MS ? seen.pos : null;
  }

  private vote(left: RawHandLike, right: RawHandLike): void {
    if (left.label === right.label) return; // same label twice says nothing about the mapping
    this.votes.push(left.label === 'Left');
    while (this.votes.length > 40) this.votes.shift();
    if (this.votes.length >= MIN_VOTES) {
      this.learned = this.votes.filter(Boolean).length / this.votes.length >= 0.5 ? 'asIs' : 'swapped';
    }
  }

  update(hands: RawHandLike[], aspect: number, tMs: number): Sides {
    const out: Sides = {};
    const best = [...hands].sort((a, b) => b.score - a.score).slice(0, 2);
    const wrist = (h: RawHandLike): Vec2 => ({ x: (1 - h.lm[0]) * aspect, y: h.lm[1] });

    if (best.length === 2) {
      const [a, b] = best;
      const wa = wrist(a);
      const wb = wrist(b);
      const mean = (palmLength(a.lm, aspect) + palmLength(b.lm, aspect)) / 2;
      const apart = mean > 1e-6 ? dist(wa, wb) / mean >= OVERLAP_PALMS : true;
      let left = wa.x <= wb.x ? a : b;
      let right = left === a ? b : a;
      if (apart) {
        this.vote(left, right);
      } else {
        const lp = this.fresh('L', tMs);
        const rp = this.fresh('R', tMs);
        if (lp && rp) {
          const straight = dist(wa, lp) + dist(wb, rp);
          const crossed = dist(wa, rp) + dist(wb, lp);
          left = straight <= crossed ? a : b;
          right = left === a ? b : a;
        }
      }
      out.L = left;
      out.R = right;
    } else if (best.length === 1) {
      const h = best[0];
      const w = wrist(h);
      const lp = this.fresh('L', tMs);
      const rp = this.fresh('R', tMs);
      const dl = lp ? dist(w, lp) : Infinity;
      const dr = rp ? dist(w, rp) : Infinity;
      let side = this.fromLabel(h.label);
      if (Math.min(dl, dr) < NEAR && (Math.abs(dl - dr) > 0.04 || !Number.isFinite(Math.max(dl, dr)))) {
        side = dl < dr ? 'L' : 'R';
      }
      out[side] = h;
    }

    for (const side of ['L', 'R'] as Side[]) {
      const hand = out[side];
      if (hand) this.last[side] = { pos: wrist(hand), t: tMs };
    }
    return out;
  }
}
