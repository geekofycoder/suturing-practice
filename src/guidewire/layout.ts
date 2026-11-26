import type { Vec2 } from '../common/geometry.ts';
import type { Hand } from '../common/rig.ts';

/**
 * Where everything is on the screen, in scene units (the picture is 1 tall and `aspect` wide).
 *
 * One schematic with a vertical axis: the skin is a horizontal line, the vein runs down from it towards the heart,
 * and the needle, wire, dilator and catheter all lie along the axis. Each hand works in its own lane, a fixed
 * distance either side of the axis, so the two hands stay well apart. The lanes are an interface concession, not real
 * technique: the instruments have drawn handles out to the lanes. Lengths above the skin are not to scale.
 *
 * Positions run top to bottom: the wire's tail, the needle hub, the skin, then the depth scale in the vein.
 */
export interface Layout {
  aspect: number;
  dominant: Hand;
  /** x of the axis. */
  axis: number;
  /** x of the lane the primary (dominant) hand works in, and of the secondary's. */
  primaryX: number;
  secondaryX: number;
  /** Scene units per centimetre inside the vein. */
  k: number;
  skinY: number;
  /** The free end of the wire, above the hub. The rest of the wire is off the top and not to scale. */
  tailY: number;
  needle: { hubY: number; tipY: number; offY: number };
  syringe: { y: number; offY: number };
  /** Where the primary hand confirms the blood is dark and not pulsing. */
  blood: Vec2;
  /** Pinch window for feeding the wire, and the wire tip's start. */
  feed: { top: number; bottom: number; startTipY: number };
  /** The secondary hand's holds: on the needle hub, and on the wire where it enters the skin. */
  anchors: { hub: Vec2; skin: Vec2 };
  nick: Vec2;
  waste: Vec2;
  /** A tool threads onto the wire's tail once its handle is at or above this y, in the primary lane. */
  snapY: number;
  dilator: { stub: number; handleOff: number; zone: [number, number] };
  catheter: { stub: number; handleOff: number; extFull: number };
  /** The secondary hand's pinch window for advancing the catheter, and the primary's for drawing the wire out. */
  advanceWindow: { top: number; bottom: number };
  pullWindow: { top: number; bottom: number };
  /** Where an instrument waits before it is picked up. */
  tray: Vec2;
  /** Radii: to take hold, to keep holding, and half the width of a lane. */
  r: { hold: number; keep: number; lane: number };
  depthY(cm: number): number;
  depthOf(y: number): number;
}

export function makeLayout(aspect: number, dominant: Hand = 'R'): Layout {
  const axis = aspect / 2;
  const sx = dominant === 'R' ? 1 : -1;
  const k = 0.0115;
  const skinY = 0.58;
  const hubY = skinY - 0.055;
  const trayDx = Math.min(0.58, aspect / 2 - 0.1);
  const primaryX = axis + sx * 0.22;
  return {
    aspect,
    dominant,
    axis,
    primaryX,
    secondaryX: axis - sx * 0.22,
    k,
    skinY,
    tailY: 0.17,
    needle: { hubY, tipY: skinY + 0.035, offY: 0.27 },
    syringe: { y: hubY - 0.1, offY: 0.27 },
    blood: { x: primaryX, y: 0.4 },
    feed: { top: hubY - 0.22, bottom: hubY - 0.04, startTipY: hubY - 0.03 },
    anchors: { hub: { x: axis - sx * 0.22, y: hubY }, skin: { x: axis - sx * 0.22, y: skinY } },
    nick: { x: axis + sx * 0.13, y: skinY },
    waste: { x: axis + sx * Math.min(0.55, aspect / 2 - 0.1), y: 0.4 },
    snapY: 0.25,
    dilator: { stub: 0.16, handleOff: 0.04, zone: [skinY + 0.03, skinY + 0.06] },
    catheter: { stub: 0.22, handleOff: 0.05, extFull: 0.06 },
    advanceWindow: { top: skinY - 0.16, bottom: skinY - 0.03 },
    pullWindow: { top: 0.2, bottom: 0.5 },
    tray: { x: axis + sx * trayDx, y: 0.45 },
    r: { hold: 0.08, keep: 0.14, lane: 0.14 },
    depthY: (cm: number) => skinY + cm * k,
    depthOf: (y: number) => (y - skinY) / k,
  };
}
