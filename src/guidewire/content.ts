// All the clinical content of the guidewire practice, in one place for review: the steps, what they say, every
// threshold, and where each one comes from. Anything no source states is marked as a placeholder. Nothing here has
// been reviewed by a clinician yet.

export type SourceId = 'merck' | 'amboss' | 'trial' | 'retention';

export const SOURCES: Record<SourceId, { label: string; url: string }> = {
  merck: {
    label: 'Merck Manual: internal jugular vein cannulation, ultrasound-guided',
    url: 'https://www.merckmanuals.com/professional/critical-care-medicine/how-to-do-central-vascular-procedures/how-to-do-internal-jugular-vein-cannulation,-ultrasound-guided',
  },
  amboss: { label: 'AMBOSS: central venous access', url: 'https://www.amboss.com/us/knowledge/central-venous-access' },
  trial: {
    label: 'Randomised comparison of three guidewire insertion depths (arrhythmias)',
    url: 'https://www.em-consulte.com/article/1146083/randomized-comparison-of-three-guidewire-insertion',
  },
  retention: {
    label: 'Central venous catheter guidewire retention: lessons from the English never-event database (PSNet)',
    url: 'https://psnet.ahrq.gov/issue/central-venous-catheter-guidewire-retention-lessons-englands-never-event-database',
  },
};

/** A number the simulation uses, with where it comes from. `placeholder` means no source states it. */
export interface Rule {
  value: number;
  note: string;
  sources: SourceId[];
  placeholder: boolean;
}

export const RULES = {
  /** Merck gives 10 to 15 cm for a right-sided vein. The window is narrowed to keep the wire ahead of the catheter. */
  wireDepthMin: { value: 12, note: 'Right-sided vein: Merck says 10 to 15 cm. Narrowed so the wire tip stays ahead of the catheter tip.', sources: ['merck'], placeholder: true },
  wireDepthMax: { value: 15, note: 'Merck: the right-sided range ends at 15 cm. Deeper is deeper than needed.', sources: ['merck'], placeholder: false },
  /** Merck: stop at ectopic beats and withdraw until they stop. The depth where the simulated ECG starts is a choice. */
  ectopyAbove: { value: 17.5, note: 'Merck: withdraw if ectopic beats appear. A trial found more arrhythmia as the wire went from 15 to 20 cm. The depth where this ECG starts is a simulation choice.', sources: ['merck', 'trial'], placeholder: true },
  runAbove: { value: 20, note: 'Simulation choice: a longer run of beats when the wire is far too deep.', sources: ['trial'], placeholder: true },
  /** The practice drill: where the wire meets resistance while advancing. */
  resistAt: { value: 9, note: 'Drill only. Merck: on resistance while advancing, stop, withdraw slightly, rotate, re-advance; or withdraw fully, re-establish venous return and reinsert.', sources: ['merck'], placeholder: true },
  /** Merck: do not force the wire. Pushing this far further against resistance counts as forcing. */
  forceAfter: { value: 0.06, note: 'Merck: do not force the guidewire. How much extra pushing counts as forcing is a simulation choice.', sources: ['merck'], placeholder: true },
  catheterDepthMin: { value: 10, note: 'No source here states a depth. AMBOSS gives about 16 cm for the right internal jugular. This page keeps the catheter shorter so it stays on the wire.', sources: ['amboss'], placeholder: true },
  catheterDepthMax: { value: 13.5, note: 'As above.', sources: ['amboss'], placeholder: true },
  /** The catheter tip must stay at least this far short of the wire tip. */
  catheterShortOfWire: { value: 1, note: 'The catheter goes over the wire, so its tip must not pass the wire tip.', sources: [], placeholder: true },
  dilatorZone: { value: 0, note: 'Merck: advance the dilator stepwise through the vein wall; no distance is stated. The depth zone here is a placeholder.', sources: ['merck'], placeholder: true },
} satisfies Record<string, Rule>;

export type PhaseId = 'access' | 'wire' | 'needle' | 'tract' | 'catheter' | 'wireout' | 'done';
export const PHASES: { id: PhaseId; title: string }[] = [
  { id: 'access', title: 'Hold the access' },
  { id: 'wire', title: 'Wire in' },
  { id: 'needle', title: 'Needle off' },
  { id: 'tract', title: 'Tract' },
  { id: 'catheter', title: 'Catheter' },
  { id: 'wireout', title: 'Wire out' },
];

export type StepId =
  | 'steady' | 'syringe' | 'blood' | 'feed' | 'wiregrip' | 'needleoff' | 'nick' | 'dilate' | 'dilatorout'
  | 'cathThread' | 'handoff' | 'advance' | 'wireout' | 'waste' | 'done';

export const STEP_ORDER: StepId[] = [
  'steady', 'syringe', 'blood', 'feed', 'wiregrip', 'needleoff', 'nick', 'dilate', 'dilatorout',
  'cathThread', 'handoff', 'advance', 'wireout', 'waste', 'done',
];

/** The words "right" and "left" for the two instruments, which depend on the needle-holder-hand setting. */
export interface Hands {
  primary: string;
  secondary: string;
}

export interface StepContent {
  phase: PhaseId;
  title: string;
  instruction: (h: Hands) => string;
  /** One line on why, for the step list. */
  why: string;
  sources: SourceId[];
  /** What no source states, if anything. */
  placeholder?: string;
  /** Something a source describes for this step that the page does not simulate. */
  notSimulated?: string;
}

export const STEPS: Record<StepId, StepContent> = {
  steady: {
    phase: 'access',
    title: 'Steady the needle',
    instruction: (h) => `The needle is in the vein and blood is flowing. Pinch with your ${h.secondary} hand and hold the needle hub on the ring. Keep the needle still.`,
    why: 'The needle must not move while the syringe comes off and the wire goes in.',
    sources: ['merck'],
    placeholder: 'Merck says to hold the needle motionless while the blood is checked. Holding it still through wire passage is common practice and is not stated on that page.',
  },
  syringe: {
    phase: 'access',
    title: 'Remove the syringe, cover the hub',
    instruction: (h) => `Keep your ${h.secondary} hand on the hub, as your thumb over it. With your ${h.primary} hand, pinch the syringe and pull it straight up and off.`,
    why: 'An open hub can let air in, which can cause an air embolism.',
    sources: ['merck'],
  },
  blood: {
    phase: 'access',
    title: 'Check the blood',
    instruction: (h) => `Blood should be dark red and not pulsing. If it were bright red and pulsing, you would stop. Confirm it with your ${h.primary} hand on the ring, and keep covering the hub.`,
    why: 'Bright, pulsing blood means an artery.',
    sources: ['merck'],
    notSimulated: 'Merck: if the blood is hard to judge, clear IV tubing can show whether it pulses, or a pressure transducer on the needle can show a venous waveform, before dilating. Neither is simulated.',
  },
  feed: {
    phase: 'wire',
    title: 'Feed the wire',
    instruction: (h) => `Keep the needle still. Pinch the wire with your ${h.primary} hand and push it down a little, open and slide back up, then pinch and push again. Stop at 12 to 15 cm. Never force it.`,
    why: 'The wire should slide smoothly. Too deep and it irritates the heart.',
    sources: ['merck', 'trial'],
    placeholder: 'Merck gives 10 to 15 cm for a right-sided vein. The window here is 12 to 15 so the wire stays ahead of the catheter.',
    notSimulated: 'Merck: ultrasound (short or long axis) may be used to check that the wire has entered the vein. That page presents it as optional. It is not simulated.',
  },
  wiregrip: {
    phase: 'wire',
    title: 'Take hold of the wire',
    instruction: (h) => `Hold the wire with your ${h.primary} hand. Then bring your ${h.secondary} hand to the wire at the skin and hold it there. The wire is never left unheld.`,
    why: 'A wire that is let go can slip in. A retained guidewire is a reportable never event.',
    sources: ['merck', 'retention'],
  },
  needleoff: {
    phase: 'needle',
    title: 'Remove the needle over the wire',
    instruction: (h) => `Keep holding the wire at the skin with your ${h.secondary} hand. With your ${h.primary} hand, pull the needle straight up along the wire and off.`,
    why: 'The needle slides off the end of the wire. The wire stays where it is.',
    sources: ['merck'],
  },
  nick: {
    phase: 'tract',
    title: 'Nick the skin beside the wire',
    instruction: (h) => `Keep holding the wire. Pinch with your ${h.primary} hand and touch the scalpel to the ring beside the wire for a small nick. Take care not to cut the wire.`,
    why: 'The nick lets the dilator and catheter through. It is about 4 mm.',
    sources: ['merck'],
    placeholder: 'Merck does not say which way the blade faces, so this page only says to avoid the wire.',
  },
  dilate: {
    phase: 'tract',
    title: 'Dilate over the wire',
    instruction: (h) => `Keep holding the wire. Pinch the dilator with your ${h.primary} hand, bring it to the top of the wire to thread it on, then slide it down and just through the vein wall.`,
    why: 'The dilator widens the track. Keep hold of the wire while you do it.',
    sources: ['merck'],
    placeholder: 'Merck gives no distance for the dilator. The depth zone here is a placeholder.',
  },
  dilatorout: {
    phase: 'tract',
    title: 'Remove the dilator',
    instruction: (h) => `Keep holding the wire at the skin with your ${h.secondary} hand. Pull the dilator straight up and off with your ${h.primary} hand.`,
    why: 'The wire stays in the vein.',
    sources: ['merck'],
  },
  cathThread: {
    phase: 'catheter',
    title: 'Thread the catheter',
    instruction: (h) => `Keep holding the wire. Pinch the catheter with your ${h.primary} hand, thread it onto the wire's end, and slide it down until the wire shows at the back of the hub. Stop just above the skin.`,
    why: 'The wire has to come out of the hub before the catheter goes in, or it cannot be held.',
    sources: ['merck'],
  },
  handoff: {
    phase: 'catheter',
    title: 'Grip the wire at the hub',
    instruction: (h) => `The wire shows at the hub. Pinch it there with your ${h.primary} hand and hold. Do not let go of the wire at any point.`,
    why: 'The hand on the wire at the skin is about to be freed, so the other hand has to have it first.',
    sources: ['merck'],
  },
  advance: {
    phase: 'catheter',
    title: 'Advance the catheter',
    instruction: (h) => `Keep holding the wire at the hub with your ${h.primary} hand. With your ${h.secondary} hand, pinch the catheter near the skin and push it in a little at a time. Stop at 10 to 13.5 cm.`,
    why: 'The catheter goes in over the wire in steps. The wire tip stays ahead of it.',
    sources: ['merck', 'amboss'],
    placeholder: 'No source on this page gives a catheter depth. AMBOSS gives about 16 cm for the right internal jugular; the range here is shorter so the catheter stays on the wire.',
  },
  wireout: {
    phase: 'wireout',
    title: 'Withdraw the wire',
    instruction: (h) => `Hold the catheter at the skin with your ${h.secondary} hand. With your ${h.primary} hand, draw the wire straight up and out through the catheter, in steps.`,
    why: 'The catheter must not move while the wire comes out.',
    sources: ['merck'],
  },
  waste: {
    phase: 'wireout',
    title: 'Check the wire and bin it',
    instruction: (h) => `Check the wire is whole, with its J tip. Carry it to the waste tray with your ${h.primary} hand and put it down. Keep holding the catheter.`,
    why: 'Checking that the whole wire is out and accounted for is a main defence against a retained wire.',
    sources: ['retention'],
    placeholder: 'Merck does not mention this check. It comes from the retained-guidewire literature.',
  },
  done: {
    phase: 'done',
    title: 'Catheter in place',
    instruction: () => 'The catheter is in. Still to do in real life, and not simulated here: use ultrasound to check the catheter is in the vein, draw back and flush every port, secure and dress the site, and get a chest X-ray before use.',
    why: '',
    sources: ['merck'],
  },
};
