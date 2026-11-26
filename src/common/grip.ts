/**
 * Whether an instrument is in the hand. A pinch has to last a moment to pick the instrument up, and the instrument
 * is only dropped when the hand has been open for a while or has been out of sight for a while. A flicker in the
 * pinch reading, or one lost frame, does not drop it.
 */
export class Grip {
  held = false;
  private pinchedFor = 0;
  private openFor = 0;
  private lostFor = 0;
  private lastT: number | null = null;
  private readonly engageMs: number;
  private readonly releaseMs: number;
  private readonly lossMs: number;

  constructor(engageMs = 80, releaseMs = 300, lossMs = 600) {
    this.engageMs = engageMs;
    this.releaseMs = releaseMs;
    this.lossMs = lossMs;
  }

  reset(): void {
    this.held = false;
    this.pinchedFor = 0;
    this.openFor = 0;
    this.lostFor = 0;
    this.lastT = null;
  }

  update(tMs: number, tracked: boolean, pinched: boolean): boolean {
    const dt = this.lastT === null ? 0 : Math.max(0, tMs - this.lastT);
    this.lastT = tMs;
    if (tracked) {
      this.lostFor = 0;
      if (pinched) {
        this.openFor = 0;
        this.pinchedFor += dt;
        if (!this.held && this.pinchedFor >= this.engageMs) this.held = true;
      } else {
        this.pinchedFor = 0;
        if (this.held) {
          this.openFor += dt;
          if (this.openFor >= this.releaseMs) this.held = false;
        } else {
          this.openFor = 0;
        }
      }
    } else {
      this.pinchedFor = 0;
      if (this.held) {
        this.lostFor += dt;
        if (this.lostFor >= this.lossMs) this.held = false;
      }
    }
    return this.held;
  }
}
