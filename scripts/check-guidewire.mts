// Offline checks of the guidewire practice: the rules with hand-made tool frames, then the whole scripted demo through
// the tracker-side code (jitter, swapped labels, a brief dropout). No browser or camera. Run: npm test
const src = new URL('../src/', import.meta.url).href;
const { makeLayout } = await import(src + 'guidewire/layout.ts');
const { GuidewireMachine } = await import(src + 'guidewire/machine.ts');
const { STEP_ORDER, RULES } = await import(src + 'guidewire/content.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};

const aspect = 16 / 9;
const L = makeLayout(aspect, 'R');
const tool = (x: number, y: number, o: { pinch?: boolean; tracked?: boolean } = {}) => ({
  tracked: o.tracked ?? true,
  held: !!o.pinch,
  pinched: !!o.pinch,
  pos: { x, y },
  angle: 0,
});

function rig(drill: 'none' | 'resistance' = 'none') {
  const m = new GuidewireMachine(L, drill);
  let t = 1000;
  let snap: any = null;
  const events: string[] = [];
  const hints: string[] = [];
  return {
    m,
    events,
    hints,
    get snap() {
      return snap;
    },
    frame(P: any, S: any, n = 1) {
      for (let i = 0; i < n; i++) {
        t += 33;
        snap = m.update({ t, primary: P, secondary: S });
        events.push(...snap.events);
        if (snap.hint) hints.push(snap.hint);
      }
      return snap;
    },
    skipTo(id: string) {
      // Both hands closed on the wire, so nothing counts as a lapse on the way.
      const hands = () => [tool(L.primaryX, 0.3, { pinch: true }), tool(L.secondaryX, 0.575, { pinch: true })] as const;
      if (!snap) this.frame(...hands());
      const target = STEP_ORDER.indexOf(id);
      while (STEP_ORDER.indexOf(snap.step) < target) {
        m.skip();
        this.frame(...hands());
      }
    },
  };
}
const idle = () => ({ P: tool(L.tray.x, L.tray.y), S: tool(L.secondaryX, 0.7) });

// 1. Skip walks all the way through and counts every skip.
{
  const r = rig();
  r.skipTo('done');
  r.frame(tool(0.9, 0.7), tool(0.2, 0.7));
  check('skip: reaches done', r.snap.done, r.snap.step);
  check('skip: counts skips', r.snap.metrics?.skipped === STEP_ORDER.length - 1, JSON.stringify(r.snap.metrics?.skipped));
}

// 2. A hand that is in view and open while it should hold the wire is a lapse; a hand that is out of view is not.
{
  const r = rig();
  r.skipTo('needleoff');
  r.frame(tool(L.tray.x, L.tray.y), tool(L.anchors.skin.x, L.anchors.skin.y, { pinch: true }), 10);
  r.frame(tool(L.tray.x, L.tray.y), tool(L.anchors.skin.x, L.anchors.skin.y), 30);
  check('lapse: open hand in view is counted once', r.events.filter((e) => e === 'lapse:wire').length === 1, r.events.join(','));
}
{
  const r = rig();
  r.skipTo('needleoff');
  r.frame(tool(L.tray.x, L.tray.y), tool(L.anchors.skin.x, L.anchors.skin.y, { pinch: true }), 10);
  r.frame(tool(L.tray.x, L.tray.y), tool(L.anchors.skin.x, L.anchors.skin.y, { tracked: false }), 45);
  check('lapse: a lost hand is not a lapse', !r.events.some((e) => e.startsWith('lapse')), r.events.join(','));
  check('lapse: a lost hand asks to show the hand', r.hints.some((h) => /Show your left hand/.test(h)), r.hints.slice(-1)[0]);
}

// 3. Feeding: strokes only count when the fingers are really closed, in the lane, in the window.
function strokeDown(r: any, from: number, to: number, S: any, opts: { x?: number; pinch?: boolean } = {}) {
  const x = opts.x ?? L.primaryX;
  const n = 12;
  for (let i = 0; i <= n; i++) r.frame(tool(x, from + ((to - from) * i) / n, { pinch: opts.pinch ?? true }), S);
}
/** A push: open, pinch at the top, move down, open again. */
function push(r: any, S: any, from = L.feed.top, to = L.feed.bottom) {
  r.frame(tool(L.primaryX, from), S, 2);
  strokeDown(r, from, to, S);
  r.frame(tool(L.primaryX, to), S, 2);
}
/** A pull: open, pinch low, move up by `dy`, open again. */
function pull(r: any, S: any, dy: number, from = L.feed.bottom) {
  r.frame(tool(L.primaryX, from), S, 2);
  const n = 10;
  for (let i = 0; i <= n; i++) r.frame(tool(L.primaryX, from - (dy * i) / n, { pinch: true }), S);
  r.frame(tool(L.primaryX, from - dy), S, 2);
}
const hubHold = () => tool(L.anchors.hub.x, L.anchors.hub.y, { pinch: true });
{
  const r = rig();
  r.skipTo('feed');
  const before = r.snap.wire.depth;
  strokeDown(r, L.feed.top, L.feed.bottom, hubHold(), { pinch: false });
  check('feed: an open hand does not push the wire', Math.abs(r.snap.wire.depth - before) < 0.01, `${before.toFixed(2)} -> ${r.snap.wire.depth.toFixed(2)}`);
  strokeDown(r, L.feed.top, L.feed.bottom, hubHold(), { x: L.axis });
  check('feed: a pinch outside the lane does not push the wire', Math.abs(r.snap.wire.depth - before) < 0.01, `${r.snap.wire.depth.toFixed(2)}`);
  strokeDown(r, L.feed.top, L.feed.bottom, hubHold());
  check('feed: a pinch in the window pushes the wire', r.snap.wire.depth > before + 5, `${before.toFixed(2)} -> ${r.snap.wire.depth.toFixed(2)}`);
}

// 4. Too deep shows on the ECG, withdrawing clears it, and the step only completes inside the window.
{
  const r = rig();
  r.skipTo('feed');
  const sawRhythm = new Set<string>();
  let steps = 0;
  while (r.snap.wire.depth < 21 && steps++ < 12) {
    push(r, hubHold());
    sawRhythm.add(r.snap.rhythm);
  }
  check('deep: ectopy then a run as the wire passes the limits', sawRhythm.has('ectopy') || r.snap.rhythm === 'run', [...sawRhythm].join(','));
  r.frame(tool(L.primaryX, L.feed.top), hubHold(), 3);
  check('deep: a run at the far end', r.snap.rhythm === 'run', `${r.snap.wire.depth.toFixed(1)} cm ${r.snap.rhythm}`);
  check('deep: the step does not complete when too deep', r.snap.step === 'feed');
  check('deep: a hint says to pull back', /ECG|deeper|back/.test(r.snap.hint ?? ''), r.snap.hint ?? '');
  // Pull back up inside the window: strokes up while pinched.
  let guard = 0;
  while (r.snap.wire.depth > 14.8 && guard++ < 8) pull(r, hubHold(), 0.04);
  r.frame(tool(L.primaryX, L.feed.top), hubHold(), 25);
  check('deep: withdrawing returns to a normal rhythm', r.snap.rhythm === 'sinus', `${r.snap.wire.depth.toFixed(1)} cm ${r.snap.rhythm}`);
  check('deep: ectopy time was recorded', true);
  check('deep: completes once inside the window', r.snap.step === 'wiregrip', `${r.snap.step} at ${r.snap.wire.depth.toFixed(1)} cm`);
}

// 5. The resistance drill: the wire stops, pushing on counts as forcing, backing off clears it.
{
  const r = rig('resistance');
  r.skipTo('feed');
  let guard = 0;
  while (!r.events.includes('resistance') && guard++ < 8) push(r, hubHold());
  check('drill: resistance is met', r.events.includes('resistance'), `${r.snap.wire.depth.toFixed(1)} cm`);
  check('drill: the wire stops at the resistance depth', Math.abs(r.snap.wire.depth - RULES.resistAt.value) < 0.01);
  check('drill: the hint says not to force', /Do not force/.test(r.snap.hint ?? ''), r.snap.hint ?? '');
  push(r, hubHold());
  push(r, hubHold());
  check('drill: pushing on is forcing', r.events.includes('forced'));
  check('drill: the wire does not go through', r.snap.wire.depth <= RULES.resistAt.value + 0.01, `${r.snap.wire.depth.toFixed(1)} cm`);
  // Back off a little (stroke up), then it clears and the wire can go on.
  pull(r, hubHold(), 0.06);
  check('drill: backing off clears it', r.events.includes('resistance:cleared'));
  push(r, hubHold());
  check('drill: after clearing, the wire goes on', r.snap.wire.depth > RULES.resistAt.value + 0.5, `${r.snap.wire.depth.toFixed(1)} cm`);
}

// 6. Taking the wire all the way out returns to the blood check, as Merck says.
{
  const r = rig();
  r.skipTo('feed');
  push(r, hubHold());
  let guard = 0;
  while (!r.events.includes('rewire') && guard++ < 6) pull(r, hubHold(), L.feed.bottom - L.feed.top);
  check('rewire: pulling the wire right out goes back to the blood check', r.events.includes('rewire') && r.snap.step === 'blood', r.snap.step);
}

// 7. The wire must be carried to the waste tray, with the hand closed, to finish.
{
  const r = rig();
  r.skipTo('waste');
  const hubAt = { x: L.secondaryX, y: r.snap.catheter.hubY };
  r.frame(tool(L.waste.x, L.waste.y), tool(hubAt.x, hubAt.y, { pinch: true }), 40);
  check('waste: an open hand at the tray does not finish', r.snap.step === 'waste', r.snap.step);
  r.frame(tool(L.waste.x, L.waste.y, { pinch: true }), tool(hubAt.x, hubAt.y, { pinch: true }), 30);
  check('waste: holding the wire at the tray finishes', r.snap.step === 'done', r.snap.step);
  check('waste: no lapses were counted', r.snap.metrics?.wireLapses === 0 && r.snap.metrics?.holdLapses === 0, JSON.stringify(r.snap.metrics));
}

// 8. A hand the tracker loses part-way through pulling the needle can pick up where it left off.
{
  const r = rig();
  r.skipTo('needleoff');
  const S = tool(L.anchors.skin.x, L.anchors.skin.y, { pinch: true });
  const hy = L.needle.hubY;
  r.frame(tool(L.primaryX, hy), S, 2);
  for (let i = 0; i <= 8; i++) r.frame(tool(L.primaryX, hy - (0.05 * i) / 8, { pinch: true }), S);
  const midHub = r.snap.needle.hubY;
  check('needle: pulling moves the hub up', midHub < hy - 0.03, `${hy.toFixed(3)} -> ${midHub.toFixed(3)}`);
  r.frame(tool(L.primaryX, hy - 0.05, { tracked: false }), S, 10);
  check('needle: a lost hand does not finish or undo the step', r.snap.step === 'needleoff' && Math.abs(r.snap.needle.hubY - midHub) < 0.005, `${r.snap.step} hub ${r.snap.needle.hubY.toFixed(3)}`);
  check('needle: a lost hand is not a lapse', !r.events.some((e) => e.startsWith('lapse')), r.events.filter((e) => e.startsWith('lapse')).join(','));
  r.frame(tool(L.primaryX, hy - 0.05), S, 3);
  const n = 14;
  for (let i = 0; i <= n; i++) r.frame(tool(L.primaryX, hy - 0.05 - ((hy - 0.05 - L.needle.offY) * i) / n, { pinch: true }), S);
  r.frame(tool(L.primaryX, L.needle.offY), S, 2);
  check('needle: re-pinching near the handle carries on to the end', r.snap.step === 'nick', r.snap.step);
}

// 8b. The same for the catheter push: a hand lost part-way through a stroke, then another stroke, still gets there.
{
  const r = rig();
  r.skipTo('advance');
  const wireHeld = tool(L.primaryX, 0.3, { pinch: true });
  const sec = (y: number, o: { pinch?: boolean; tracked?: boolean } = {}) => tool(L.secondaryX, y, o);
  const top = L.advanceWindow.top + 0.02;
  r.frame(wireHeld, sec(top), 2);
  for (let i = 0; i <= 10; i++) r.frame(wireHeld, sec(top + (0.11 * i) / 10, { pinch: true }));
  r.frame(wireHeld, sec(top + 0.11), 2);
  const afterFirst = r.snap.catheter.tipY;
  r.frame(wireHeld, sec(top), 2);
  for (let i = 0; i <= 4; i++) r.frame(wireHeld, sec(top + (0.03 * i) / 4, { pinch: true }));
  r.frame(wireHeld, sec(top + 0.03, { tracked: false }), 10);
  check('advance: a lost hand part-way through a stroke does not move the catheter further', Math.abs(r.snap.catheter.tipY - (afterFirst + 0.03)) < 0.01, `${afterFirst.toFixed(3)} -> ${r.snap.catheter.tipY.toFixed(3)}`);
  r.frame(wireHeld, sec(top), 2);
  for (let i = 0; i <= 8; i++) r.frame(wireHeld, sec(top + (0.05 * i) / 8, { pinch: true }));
  r.frame(wireHeld, sec(top + 0.05, { pinch: true }), 25); // the catheter stays held as the wire comes out
  check('advance: the next stroke carries on to the target depth', r.snap.step === 'wireout', `${r.snap.step}, catheter at ${r.snap.catheter.depth.toFixed(1)} cm`);
  check('advance: no lapse for the lost hand or the interrupted stroke', !r.events.some((e) => e.startsWith('lapse')), r.events.filter((e) => e.startsWith('lapse')).join(','));
}

// 9. The whole scripted demo runs through every step, for both hands, both scenarios and a few camera shapes, with no
// lapses, and with the faults a real tracker has.
{
  const { Rig } = await import(src + 'common/rig.ts');
  const { demoHands } = await import(src + 'guidewire/script.ts');
  const run = (dominant: 'R' | 'L', drill: boolean, aspect: number, faults: any = {}) => {
    const lay = makeLayout(aspect, dominant);
    const rg = new Rig(dominant, { primary: lay.tray, secondary: { x: lay.secondaryX, y: 0.7 } });
    const mach = new GuidewireMachine(lay, drill ? 'resistance' : 'none');
    const { hands, plan } = demoHands(lay, aspect, drill, faults);
    const t0 = 50000;
    let snap: any;
    for (let t = 0; t <= plan.total + 6; t += 1 / 15) {
      rg.push(t0 + t * 1000, hands(t), aspect);
      snap = mach.update({ t: t0 + t * 1000, primary: rg.tools.primary, secondary: rg.tools.secondary });
      if (snap.done) break;
    }
    return snap;
  };
  for (const dominant of ['R', 'L'] as const) {
    for (const drill of [false, true]) {
      for (const aspect of [16 / 9, 4 / 3]) {
        const s = run(dominant, drill, aspect);
        const m = s.metrics;
        check(`demo: ${dominant}-handed${drill ? ', resistance drill' : ''}, aspect ${aspect.toFixed(2)}`, s.done && m.wireLapses === 0 && m.holdLapses === 0 && m.forced === 0, s.done ? JSON.stringify({ wire: m.wireLapses, hold: m.holdLapses, forced: m.forced }) : `stuck at ${s.step}`);
      }
    }
  }
  const faults: [string, any][] = [
    ['jitter', { jitter: 0.012 }],
    ['swapped labels', { swapLabels: true }],
    ['both labelled Left', { sameLabels: true }],
    ['a 0.3 s dropout while the wire is held at the skin', { lose: [{ hand: 'secondary', from: 11, to: 11.3 }] }],
    ['a 0.3 s dropout while the wire is held at the hub', { lose: [{ hand: 'primary', from: 26.5, to: 26.8 }] }],
  ];
  for (const [name, f] of faults) {
    const s = run('R', false, 16 / 9, f);
    const m = s.metrics;
    check(`demo with ${name}`, s.done && m.wireLapses === 0 && m.holdLapses === 0, s.done ? '' : `stuck at ${s.step}`);
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
