// Offline checks of the suturing flow, driven by scripted hands: no browser or camera. Run: npm test
import assert from 'node:assert/strict';
const src = new URL('../src/', import.meta.url).href;
const { Pipeline } = await import(src + 'suture/pipeline.ts');
const { demoHands, demoSchedule } = await import(src + 'suture/script.ts');
const { makePad, STITCH_COUNT, STITCH_ORDER } = await import(src + 'suture/pad.ts');
const { Grip } = await import(src + 'common/grip.ts');
const { Identity } = await import(src + 'common/identity.ts');
const { sampleOf } = await import(src + 'common/hand-input.ts');
const { syntheticHand } = await import(src + 'common/synthetic.ts');
const { OneEuro2D } = await import(src + 'common/filter.ts');
const { OVERLAP_PALMS } = await import(src + 'common/hand-math.ts');
let passed = 0; const ok = (name, fn) => { try { fn(); passed++; console.log('  ok  ', name); } catch (e) { console.log('  FAIL', name, '\n       ', e.message.split('\n').slice(0, 3).join('\n        ')); process.exitCode = 1; } };
const ASPECT = 16 / 9;
function run(faults = {}, dominant = 'R', aspect = ASPECT, extra = 3, hz = 15) {
  const p = new Pipeline(aspect, dominant), sched = demoSchedule(p.pad.sites.length), hands = demoHands(p.pad, aspect, faults), events = [], t0 = 123456;
  let snap = p.snapshot, doneAt = null;
  for (let t = 0; t <= sched.total + extra; t += 1 / hz) { snap = p.push(t0 + t * 1000, hands(t), aspect); for (const e of snap.events) { events.push(`${t.toFixed(1)}s ${e}`); if (e === 'done') doneAt = t; } }
  return { snap, events, p, doneAt, sched };
}
const has = (events, name) => events.some((e) => e.endsWith(' ' + name));
const steps = (events) => events.filter((e) => e.includes(' step:')).map((e) => e.split('step:')[1]);
const placed = (events) => events.filter((e) => e.includes('stitch:placed:')).map((e) => Number(e.split(':').pop()));
const clean = run();
ok('five stitches in order, each hold > enter > drive > pull, then done', () => { const want = []; for (let i = 0; i < STITCH_COUNT; i++) want.push('hold', 'enter', 'drive', 'pull'); want.push('done'); assert.deepEqual(steps(clean.events), want); assert.deepEqual(placed(clean.events), [1, 2, 3, 4, 5]); assert.equal(clean.snap.done, true); });
ok('no drops, lane exits, lapses, thread slips or skips', () => { const m = clean.snap.metrics; assert.equal(m.needleDrops, 0); assert.equal(m.leftLane, 0); assert.equal(m.forcepsLapses, 0); assert.equal(m.pullRetries, 0); assert.equal(m.skipped, 0); });
ok('stitches go 3, 2, 4, 1, 5', () => { assert.deepEqual(STITCH_ORDER, [3, 2, 4, 1, 5]); const xs = clean.p.pad.sites.map((s) => s.x), cx = ASPECT / 2; assert.ok(Math.abs(xs[0] - cx) < 1e-9 && xs[1] < xs[0] && xs[2] > xs[0] && xs[3] < xs[1] && xs[4] > xs[2]); });
ok('left-handed and 4:3 both finish', () => { assert.equal(run({}, 'L').snap.done, true); assert.equal(run({}, 'R', 4 / 3).snap.done, true); });
ok('swapped and duplicate labels finish', () => { assert.equal(run({ swapLabels: true }).snap.done, true); assert.equal(run({ sameLabels: true }).snap.done, true); });
ok('wrists stay clear through every phase, both hands', () => { for (const dom of ['R', 'L']) { const p = new Pipeline(ASPECT, dom), hands = demoHands(p.pad, ASPECT), total = demoSchedule(5).total; let min = Infinity; for (let t = 0; t <= total; t += 0.05) { const hs = hands(t); if (hs.length !== 2) continue; const a = sampleOf(hs[0], ASPECT), b = sampleOf(hs[1], ASPECT); min = Math.min(min, Math.hypot(a.wrist.x - b.wrist.x, a.wrist.y - b.wrist.y) / ((a.palm + b.palm) / 2)); } assert.ok(min > OVERLAP_PALMS * 1.15, `${dom}: ${min.toFixed(2)}`); } });
const st2 = clean.sched.stitches[1];
ok('flicker 150 ms and loss 400 ms: not dropped', () => { assert.equal(run({ flicker: [{ hand: 'needle', from: st2.driveFrom + 0.5, to: st2.driveFrom + 0.65 }] }).snap.metrics.needleDrops, 0); const r = run({ lose: [{ hand: 'needle', from: st2.driveFrom + 0.4, to: st2.driveFrom + 0.8 }] }); assert.equal(r.snap.done, true); assert.equal(r.snap.metrics.needleDrops, 0); });
ok('needle lost 1 s: dropped; stray out of lane: noticed', () => { assert.ok(has(run({ lose: [{ hand: 'needle', from: st2.driveFrom + 0.4, to: st2.driveFrom + 1.4 }] }).events, 'drop:needle')); assert.ok(has(run({ detour: [{ from: st2.driveFrom + 0.3, to: st2.driveFrom + 1.3, by: 0.14 }] }).events, 'leave:lane')); });
ok('forceps lost 1.2 s while positioning: lapse, then finishes', () => { const r = run({ lose: [{ hand: 'forceps', from: st2.arrive + 0.2, to: st2.arrive + 1.4 }] }); assert.ok(has(r.events, 'lapse:forceps')); assert.equal(r.snap.done, true); });

// ---- drawing the thread through: stopping, letting go or drifting off the line lets it slip back, and a fresh pull works
function pullRig(label = 'Right') {
  const p = new Pipeline(ASPECT, 'R'), pad = p.pad, site = pad.sites[0], events = [], hints = [];
  let t = 2_000_000, snap = p.snapshot;
  const at = (u, dx = 0, dy = 0) => ({ x: site.exit.x + pad.dir.x * pad.pullLength * u + dx, y: site.exit.y + pad.dir.y * pad.pullLength * u + dy });
  const frame = (pos, pinch = true, tracked = true) => {
    t += 66;
    const hs = [syntheticHand(site.forceps, -Math.PI / 2, false, 'Left', ASPECT)];
    if (tracked) hs.push(syntheticHand(pos, -Math.PI / 2, pinch, label, ASPECT));
    snap = p.push(t, hs, ASPECT);
    for (const e of snap.events) events.push(e);
    if (snap.hint) hints.push(snap.hint);
    return snap;
  };
  const rig = {
    p, pad, site, events, hints, frame, at,
    get snap() { return snap; },
    /** Moves the needle holder along the pull line from u0 to u1 (0 at the exit, 1 at the target) over `sec` seconds. */
    move(u0, u1, sec, opts = {}) { const n = Math.max(1, Math.round(sec / 0.066)); for (let i = 1; i <= n; i++) frame(at(u0 + ((u1 - u0) * i) / n, opts.dx ?? 0, opts.dy ?? 0), opts.pinch ?? true); },
    /** Stays at u for `sec` seconds, with a little tracker shake. */
    still(u, sec, shake = 0.003, opts = {}) { const n = Math.round(sec / 0.066); for (let i = 0; i < n; i++) frame(at(u, opts.dx ?? 0, shake * Math.sin(i * 2.3)), opts.pinch ?? true, opts.tracked ?? true); },
  };
  for (let i = 0; i < 12; i++) frame(site.entry);
  for (let i = 0; i < 6 && snap.step !== 'pull'; i++) { p.skip(); frame(site.entry); frame(site.entry); }
  assert.equal(snap.step, 'pull');
  rig.frame(at(0));
  return rig;
}
const retries = (r) => r.events.filter((e) => e === 'pull:retry').length;
ok('pull: a steady pull completes the stitch with no slip', () => { const r = pullRig(); assert.equal(r.snap.step, 'pull'); r.move(0, 1.05, 2); r.still(1.05, 0.6, 0.001); assert.ok(r.events.includes('stitch:placed:1'), r.events.join(',')); assert.equal(retries(r), 0); });
ok('pull: a slow steady pull (6 s) does not slip', () => { const r = pullRig(); r.move(0, 1.05, 6); r.still(1.05, 0.6, 0.001); assert.ok(r.events.includes('stitch:placed:1')); assert.equal(retries(r), 0); });
ok('pull: stopping half-way warns, then the thread slips back to the start', () => {
  const r = pullRig(); r.move(0, 0.5, 1.2);
  assert.ok(r.snap.pullProgress > 0.4, `pulled ${r.snap.pullProgress}`);
  r.still(0.5, 1.4); assert.ok(r.hints.some((h) => /Keep drawing the thread/.test(h)), 'a warning comes first'); assert.equal(retries(r), 0);
  r.still(0.5, 1.6); assert.equal(retries(r), 1); assert.equal(r.snap.pullProgress, 0); assert.equal(r.snap.sites[0].closed, 0);
  assert.ok(r.hints.some((h) => /slipped back because the pull stopped/.test(h)));
});
ok('pull: a hand that shakes while stopped still slips back (jitter is not progress)', () => { const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 4.5, 0.004); assert.equal(retries(r), 1, r.events.join(',')); assert.equal(r.snap.pullProgress, 0); });
ok('pull: a hand left where it was does not bring the pull back, and the page says where to go', () => { const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 3.5); assert.equal(retries(r), 1); r.still(0.5, 3.5); assert.equal(r.snap.pullProgress, 0); assert.equal(retries(r), 1); assert.ok(r.hints.some((h) => /Bring the needle holder back to the exit ring/.test(h))); r.move(0.5, 0, 0.6); r.move(0, 1.05, 2); r.still(1.05, 0.6, 0.001); assert.ok(r.events.includes('stitch:placed:1')); });
ok('pull: after a slip the page shows the exit ring to go back to, and a hand inside that ring starts the pull again', () => {
  const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 3.5);
  assert.equal(retries(r), 1); assert.equal(r.snap.pullArmed, false, 'the pull waits for the exit ring');
  assert.ok(r.hints.some((h) => /Go back to the exit ring/.test(h)), 'the slip message says where to go');
  r.still(0.5, 1.0); assert.equal(r.snap.pullArmed, false); assert.equal(r.snap.pullProgress, 0);
  const inside = 0.06 / r.pad.pullLength; // 0.06 above the exit, inside the ring (radius 0.08) but well off the exit point
  assert.ok(0.06 < r.pad.exitRadius);
  r.move(0.5, inside, 0.6); r.still(inside, 0.3, 0.001);
  assert.equal(r.snap.pullArmed, true, 'inside the ring starts it again'); assert.ok(r.snap.pullProgress < 0.05, `no jump: ${r.snap.pullProgress}`);
  r.move(inside, 1.05, 2); r.still(1.05, 0.6, 0.001);
  assert.ok(r.events.includes('stitch:placed:1'), r.events.join(',')); assert.equal(retries(r), 1);
});
ok('pull: a hand just outside the exit ring does not start it again', () => { const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 3.5); assert.equal(retries(r), 1); const outside = 0.11 / r.pad.pullLength; r.move(0.5, outside, 0.6); r.still(outside, 0.5, 0.001); assert.equal(r.snap.pullArmed, false); });
ok('pull: letting go half-way slips back, and picking up again says why', () => {
  const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 1.0, 0.002, { pinch: false });
  assert.ok(r.events.includes('drop:needle')); assert.equal(retries(r), 1); assert.equal(r.snap.pullProgress, 0);
  r.still(0.5, 1.0, 0.002, { pinch: true }); assert.ok(r.events.includes('regrip'));
  assert.ok(r.hints.some((h) => /slipped back when you let go/.test(h)));
});
ok('pull: drifting off the line slips back', () => { const r = pullRig(); r.move(0, 0.45, 1); r.move(0.45, 0.5, 0.5, { dx: 0.25 }); r.still(0.5, 0.3, 0.001, { dx: 0.25 }); assert.equal(retries(r), 1, r.events.join(',')); assert.equal(r.snap.pullProgress, 0); assert.ok(r.hints.some((h) => /drifted off the line/.test(h))); });
ok('pull: a hand out of sight for 0.4 s is not a stall, and the pull carries on', () => { const r = pullRig(); r.move(0, 0.4, 1); r.still(0.4, 0.4, 0, { tracked: false }); r.move(0.4, 1.05, 1.2); r.still(1.05, 0.6, 0.001); assert.equal(retries(r), 0, r.events.join(',')); assert.ok(r.events.includes('stitch:placed:1')); });
ok('pull: after a slip a fresh pull completes the stitch, and the count is kept', () => {
  const r = pullRig(); r.move(0, 0.5, 1.2); r.still(0.5, 3.5);
  assert.equal(retries(r), 1); r.move(0, 0, 0.3); r.move(0, 1.05, 2); r.still(1.05, 0.6, 0.001);
  assert.ok(r.events.includes('stitch:placed:1'), r.events.join(',')); assert.equal(retries(r), 1);
  r.p.skip(); for (let i = 0; i < 16; i++) r.p.skip(), r.frame(r.site.entry), r.frame(r.site.entry);
});
ok('pull: the slip count shows in the metrics when the wound is closed', () => { const p = new Pipeline(ASPECT); let t = 5_000_000, snap = p.snapshot; p.skip(); snap = p.push((t += 70), [], ASPECT); for (let i = 0; i < 25 && !snap.done; i++) { p.skip(); snap = p.push((t += 70), [], ASPECT); } assert.equal(snap.done, true); assert.equal(snap.metrics.pullRetries, 0); });

ok('skip walks a stuck trainee through all 21 steps', () => { const p = new Pipeline(ASPECT); let snap = p.snapshot, n = 0, t = 1000; while (!snap.done && n < 60) { p.skip(); snap = p.push((t += 70), [], ASPECT); n++; } assert.equal(snap.done, true); assert.equal(snap.metrics.skipped, 1 + 4 * STITCH_COUNT); });
ok('grip, identity, filter, synthetic hand', () => { const g = new Grip(); let t = 0; for (; t < 400; t += 66) g.update(t, true, true); assert.equal(g.held, true); g.update(t += 66, true, false); g.update(t += 66, true, false); assert.equal(g.held, true); for (let i = 0; i < 3; i++) g.update(t += 66, true, false); assert.equal(g.held, false); const id = new Identity(); const L = (lab) => syntheticHand({ x: 0.5, y: 0.6 }, -Math.PI / 2, false, lab, ASPECT), R = (lab) => syntheticHand({ x: 1.3, y: 0.6 }, -Math.PI / 2, false, lab, ASPECT); for (let i = 0; i < 25; i++) id.update([L('Right'), R('Left')], ASPECT, i * 66); assert.equal(id.mapping, 'swapped'); const h = syntheticHand({ x: 0.9, y: 0.4 }, -Math.PI / 2, true, 'Left', ASPECT), s = sampleOf(h, ASPECT); assert.ok(Math.hypot(s.pos.x - 0.9, s.pos.y - 0.4) < 1e-3 && s.pinchRatio < 0.15); const f = new OneEuro2D(); let still = 0; for (let i = 0; i < 60; i++) { const out = f.filter({ x: 1 + 0.004 * Math.sin(i * 7), y: 0.5 }, i / 15); if (i > 20) still = Math.max(still, Math.abs(out.x - 1)); } assert.ok(still < 0.003); });
console.log(`\n${passed} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
