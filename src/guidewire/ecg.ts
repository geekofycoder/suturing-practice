import type { Rhythm } from './machine.ts';

const g = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));

/** One normal beat, with the phase running 0 to 1: a small P wave, a sharp QRS, then a T wave. */
function sinusBeat(ph: number): number {
  return 0.12 * g(ph, 0.1, 0.03) - 0.1 * g(ph, 0.205, 0.008) + 1.0 * g(ph, 0.22, 0.01) - 0.18 * g(ph, 0.24, 0.01) + 0.25 * g(ph, 0.42, 0.05);
}

/** A wide, early beat of the kind the wire causes when it irritates the heart. */
function ectopicBeat(ph: number): number {
  return -0.95 * g(ph, 0.2, 0.06) + 0.45 * g(ph, 0.46, 0.08);
}

/**
 * A simulated ECG value at time t (seconds), from -1 to 1. Sinus rhythm is regular. In "ectopy" every third beat
 * comes early and wide. In "run" the beats are fast and wide. This is a picture for training, not a real trace.
 */
export function ecgValue(t: number, rhythm: Rhythm): number {
  if (rhythm === 'run') {
    const period = 0.36;
    return ectopicBeat((t % period) / period);
  }
  const period = 0.85;
  const beat = Math.floor(t / period);
  const ph = (t - beat * period) / period;
  if (rhythm === 'ectopy' && beat % 3 === 2) return ectopicBeat(Math.min(1, ph * 1.25));
  return sinusBeat(ph);
}
