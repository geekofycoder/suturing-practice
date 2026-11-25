import type { Vec2 } from './geometry.ts';
import { norm, sub } from './geometry.ts';

export type Hand = 'R' | 'L';

/** How many interrupted stitches close the wound. */
export const STITCH_COUNT = 5;
/**
 * Which position along the wound is stitched first, second, and so on (1 is the left end, before any mirroring):
 * the middle first, then outward either side so the edges stay level. A placeholder until a clinician reviews it.
 */
export const STITCH_ORDER = [3, 2, 4, 1, 5];
/** How far the forceps ring sits from the needle's line, so the two hands stay clear of each other. */
const FORCEPS_SIDE = 0.26;

/** One stitch: where the needle goes in and comes out, where the forceps hold the near edge, and where to pull to. */
export interface Site {
  /** 1 for the first stitch placed. */
  order: number;
  /** Position along the wound, 1 to STITCH_COUNT from the left end. */
  slot: number;
  /** Where the stitch sits along the wound, in scene units. */
  x: number;
  entry: Vec2;
  exit: Vec2;
  forceps: Vec2;
  pullTarget: Vec2;
}

/**
 * The practice pad and every mark and tolerance on it, in scene units (the picture is 1 tall). This is the one place
 * to read or change the layout. The positions and tolerances are placeholders until a clinician reviews them.
 */
export interface Pad {
  aspect: number;
  /** Which hand holds the needle holder. */
  dominant: Hand;
  rect: { x: number; y: number; w: number; h: number };
  wound: { a: Vec2; b: Vec2 };
  /** How far apart the wound edges lie before any stitch. */
  gap0: number;
  /** The stitches, in the order they are placed. */
  sites: Site[];
  /** Unit vector from an entry mark to its exit mark. The same for every stitch. */
  dir: Vec2;
  driveLength: number;
  /** Half the width of the lane the needle has to stay in. */
  corridor: number;
  entryRadius: number;
  exitRadius: number;
  /** How close the forceps must be to the ring to take hold. */
  forcepsRadius: number;
  /** How far the forceps may drift once holding before it counts as let go. */
  forcepsKeep: number;
  pullLength: number;
  pullCorridor: number;
  /** Where the instruments lie before they are picked up. */
  tray: { needle: Vec2; forceps: Vec2 };
}

export function makePad(aspect: number, dominant: Hand = 'R'): Pad {
  const cx = aspect / 2;
  const cy = 0.5;
  const mirror = (p: Vec2): Vec2 => (dominant === 'R' ? p : { x: 2 * cx - p.x, y: p.y });
  // The pad narrows on a narrow picture, and the instruments lie either side of it, where the hands reach them.
  const half = Math.min(1.12, aspect - 0.55) / 2;
  const trayX = Math.min(half + 0.24, aspect / 2 - 0.1);
  const a: Vec2 = { x: cx - (half - 0.1), y: cy };
  const b: Vec2 = { x: cx + (half - 0.1), y: cy };
  const pullLength = 0.18;
  const sites: Site[] = STITCH_ORDER.map((slot, i) => {
    const x = a.x + ((b.x - a.x) * slot) / (STITCH_COUNT + 1);
    const entry = mirror({ x, y: cy + 0.13 });
    const exit = mirror({ x, y: cy - 0.13 });
    return {
      order: i + 1,
      slot,
      x: mirror({ x, y: cy }).x,
      entry,
      exit,
      // On the near edge, beside the needle's line and away from the needle hand.
      forceps: mirror({ x: x - FORCEPS_SIDE, y: cy + 0.05 }),
      pullTarget: { x: exit.x, y: exit.y - pullLength },
    };
  });
  const dir = norm(sub(sites[0].exit, sites[0].entry));
  return {
    aspect,
    dominant,
    rect: { x: cx - half, y: cy - 0.28, w: half * 2, h: 0.56 },
    wound: { a, b },
    gap0: 0.032,
    sites,
    dir,
    driveLength: 0.26,
    corridor: 0.06,
    entryRadius: 0.07,
    exitRadius: 0.08,
    forcepsRadius: 0.08,
    forcepsKeep: 0.14,
    pullLength,
    pullCorridor: 0.12,
    tray: { needle: mirror({ x: cx + trayX, y: 0.52 }), forceps: mirror({ x: cx - trayX, y: 0.52 }) },
  };
}
