import '../common/style.css';
import './style.css';
import { CameraError, closeCamera, openCamera } from '../capture/camera.ts';
import { Tracker } from '../capture/tracker.ts';
import type { RawResult, TrackerEvent, TrackerSettings } from '../capture/tracker.ts';
import { drawGhost } from '../common/draw.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { RawHandLike } from '../common/hand-input.ts';
import { Rig } from '../common/rig.ts';
import type { Hand } from '../common/rig.ts';
import { PHASES, RULES, SOURCES, STEPS, STEP_ORDER } from './content.ts';
import type { StepId } from './content.ts';
import { makeLayout } from './layout.ts';
import type { Layout } from './layout.ts';
import { GuidewireMachine, handNames } from './machine.ts';
import type { Drill, Snapshot } from './machine.ts';
import { EcgTrace, Motion, drawScene } from './render.ts';
import { demoHands } from './script.ts';

const TEMPLATE = `
<div class="shell">
  <nav class="tabs" aria-label="Practice activities">
    <a href="./">Suturing</a>
    <a href="guidewire.html" aria-current="page">Guidewire insertion</a>
  </nav>
  <header class="top">
    <h1>Guidewire insertion practice</h1>
    <p>Practise the guidewire steps of the Seldinger technique for a central venous catheter, on a simple drawing of the vein. The needle is already in the vein. Your pinch points hold the instruments, and each step tells you what to do next. This is practice on a screen, not training for a real patient.</p>
  </header>
  <div class="layout">
    <section class="stage-col" aria-label="Practice view">
      <div class="stage" id="stage" data-step="" data-mode="idle">
        <video id="video" playsinline muted></video>
        <canvas id="scene" aria-hidden="true"></canvas>
        <canvas id="ghost" aria-hidden="true"></canvas>
        <div class="hud">
          <p class="hud-hint" id="hud-hint" hidden></p>
          <div class="hud-card">
            <p class="hud-step" id="hud-step"></p>
            <p class="hud-instruction" id="hud-instruction"></p>
          </div>
        </div>
        <div class="landing" id="landing">
          <div class="landing-card">
            <h2>Ready when you are</h2>
            <p>Sit or stand so both hands are in the picture, with light on them, and keep them apart. Each hand works in its own column. You will pass a wire through the needle, swap the needle for a catheter, and take the wire out again.</p>
            <div class="row">
              <button type="button" class="btn primary" id="start-camera">Start with my camera</button>
              <button type="button" class="btn" id="start-demo">Watch a demo</button>
            </div>
          </div>
        </div>
      </div>
      <p class="status" id="status" role="status" aria-live="polite"></p>
      <p class="error" id="error" role="alert" hidden></p>
    </section>

    <aside class="panel" aria-label="Controls">
      <section class="block">
        <h2>Practice</h2>
        <div class="row">
          <button type="button" class="btn" id="camera">Use my camera</button>
          <button type="button" class="btn" id="demo">Watch demo</button>
        </div>
        <label class="field"><span>Scenario</span>
          <select id="drill">
            <option value="none">Standard run</option>
            <option value="resistance">The wire meets resistance</option>
          </select>
        </label>
        <p class="muted" id="mode-note"></p>
      </section>

      <section class="block">
        <h2 id="proc-title">Steps</h2>
        <ol class="steps" id="phases"></ol>
        <div class="row">
          <button type="button" class="btn small" id="skip">Skip step</button>
          <button type="button" class="btn small" id="restart">Start over</button>
        </div>
      </section>

      <section class="block" id="result" hidden>
        <h2>Catheter in place</h2>
        <dl class="stats" id="stats"></dl>
        <p class="muted" id="not-simulated"></p>
      </section>

      <details class="block sources">
        <summary>Where the steps come from</summary>
        <p class="muted">Every step and number is listed here with its source. Anything no source states is a placeholder. A clinician has not reviewed any of this yet.</p>
        <h3>Sources</h3>
        <ul id="source-list"></ul>
        <h3>Placeholders until a clinician reviews them</h3>
        <ul id="placeholder-list"></ul>
        <h3>In the sources, but not simulated here</h3>
        <ul id="skipped-list"></ul>
      </details>

      <details class="block settings">
        <summary>Settings</summary>
        <label class="field"><span>Needle holder in</span>
          <select id="dominant">
            <option value="R">My right hand</option>
            <option value="L">My left hand</option>
          </select>
        </label>
        <label class="field"><span>Processor (camera only)</span>
          <select id="delegate">
            <option value="CPU">CPU (default)</option>
            <option value="GPU">GPU (faster if available)</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" id="hint-hands"><span>Show hint hands</span></label>
        <label class="check"><input type="checkbox" id="skeleton"><span>Show outlines of my hands</span></label>
        <div class="row">
          <button type="button" class="btn small" id="swap">Swap left and right</button>
        </div>
        <p class="muted" id="swap-note"></p>
      </details>
    </aside>
  </div>
</div>`;

const root = document.getElementById('app');
if (!root) throw new Error('The page has no #app element.');
root.innerHTML = TEMPLATE;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}
const stage = el<HTMLDivElement>('stage');
const video = el<HTMLVideoElement>('video');
const sceneCanvas = el<HTMLCanvasElement>('scene');
const ghostCanvas = el<HTMLCanvasElement>('ghost');
const hudStep = el<HTMLParagraphElement>('hud-step');
const hudHint = el<HTMLParagraphElement>('hud-hint');
const hudInstruction = el<HTMLParagraphElement>('hud-instruction');
const landing = el<HTMLDivElement>('landing');
const startCameraButton = el<HTMLButtonElement>('start-camera');
const startDemoButton = el<HTMLButtonElement>('start-demo');
const statusLine = el<HTMLParagraphElement>('status');
const errorLine = el<HTMLParagraphElement>('error');
const cameraButton = el<HTMLButtonElement>('camera');
const demoButton = el<HTMLButtonElement>('demo');
const drillSelect = el<HTMLSelectElement>('drill');
const modeNote = el<HTMLParagraphElement>('mode-note');
const procTitle = el<HTMLHeadingElement>('proc-title');
const phasesList = el<HTMLOListElement>('phases');
const skipButton = el<HTMLButtonElement>('skip');
const restartButton = el<HTMLButtonElement>('restart');
const resultBlock = el<HTMLElement>('result');
const statsList = el<HTMLDListElement>('stats');
const notSimulated = el<HTMLParagraphElement>('not-simulated');
const sourceList = el<HTMLUListElement>('source-list');
const placeholderList = el<HTMLUListElement>('placeholder-list');
const skippedList = el<HTMLUListElement>('skipped-list');
const dominantSelect = el<HTMLSelectElement>('dominant');
const delegateSelect = el<HTMLSelectElement>('delegate');
const hintBox = el<HTMLInputElement>('hint-hands');
const skeletonBox = el<HTMLInputElement>('skeleton');
const swapButton = el<HTMLButtonElement>('swap');
const swapNote = el<HTMLParagraphElement>('swap-note');

// ---------------------------------------------------------------- preferences

interface Prefs {
  dominant: Hand;
  delegate: 'CPU' | 'GPU';
  hintHands: boolean;
  skeleton: boolean;
  swap: boolean;
}
// The same key and shape as the suturing page, so the left/right choice carries across both.
const PREF_KEY = 'suture-settings-1';
const prefs: Prefs = { dominant: 'R', delegate: 'CPU', hintHands: true, skeleton: true, swap: false };
try {
  const saved: unknown = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null');
  if (typeof saved === 'object' && saved !== null) {
    const s = saved as Partial<Prefs>;
    if (s.dominant === 'R' || s.dominant === 'L') prefs.dominant = s.dominant;
    if (s.delegate === 'CPU' || s.delegate === 'GPU') prefs.delegate = s.delegate;
    if (typeof s.hintHands === 'boolean') prefs.hintHands = s.hintHands;
    if (typeof s.skeleton === 'boolean') prefs.skeleton = s.skeleton;
    if (typeof s.swap === 'boolean') prefs.swap = s.swap;
  }
} catch {
  /* storage unavailable: defaults */
}
const savePrefs = (): void => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
};

const setStatus = (text: string): void => {
  statusLine.textContent = text;
};
const showError = (text: string): void => {
  errorLine.textContent = text;
  errorLine.hidden = false;
};
const hideError = (): void => {
  errorLine.hidden = true;
  errorLine.textContent = '';
};

// ---------------------------------------------------------------- state

type Mode = 'idle' | 'demo' | 'live';
let mode: Mode = 'idle';
let aspect = 16 / 9;
let drill: Drill = 'none';
let L: Layout = makeLayout(aspect, prefs.dominant);
const restOf = (layout: Layout): Record<'primary' | 'secondary', Vec2> => ({ primary: layout.tray, secondary: { x: layout.secondaryX, y: 0.7 } });
let rig = new Rig(prefs.dominant, restOf(L));
let machine = new GuidewireMachine(L, drill);
let motion = new Motion();
let ecg = new EcgTrace();
// A first picture to hold the type; a throwaway machine, so the real run's clock starts with the first drawn frame.
let snap: Snapshot = new GuidewireMachine(L, drill).update({ t: 0, primary: rig.tools.primary, secondary: rig.tools.secondary });
let ghostKey = '';
let lastText = '';
let lastProcKey = '';
let lastButtonKey = '';
let statsShown = false;

function clearCaches(): void {
  ghostKey = '';
  lastText = '';
  lastProcKey = '';
  lastButtonKey = '';
  statsShown = false;
  statsList.replaceChildren();
}

function rebuild(nextAspect: number): void {
  aspect = nextAspect;
  L = makeLayout(aspect, prefs.dominant);
  rig = new Rig(prefs.dominant, restOf(L));
  rig.identity.swap = prefs.swap;
  machine = new GuidewireMachine(L, drill);
  motion = new Motion();
  ecg = new EcgTrace();
  stage.style.aspectRatio = `${aspect}`;
  clearCaches();
}

/** Starts the run again, on the same camera and the same learned left/right. */
function resetRun(): void {
  machine = new GuidewireMachine(L, drill);
  rig.reset(restOf(L));
  motion = new Motion();
  ecg = new EcgTrace();
  clearCaches();
}

// ---------------------------------------------------------------- demo (no camera)

let demoTimer = 0;
function stopDemo(): void {
  window.clearInterval(demoTimer);
  demoTimer = 0;
}

function startDemo(): void {
  stopLive();
  stopDemo();
  mode = 'demo';
  hideError();
  rebuild(16 / 9);
  stage.classList.add('is-replay');
  const { hands, plan } = demoHands(L, aspect, drill === 'resistance');
  const t0 = performance.now();
  demoTimer = window.setInterval(() => {
    const now = performance.now();
    const s = (now - t0) / 1000;
    rig.push(now, hands(s), aspect);
    if (s > plan.total + 2) stopDemo();
  }, 66);
  setStatus('Watching a scripted run through every step. Press Use my camera to try it with your own hands.');
  updateButtons();
}

// ---------------------------------------------------------------- camera

let tracker: Tracker | null = null;
let trackerReady = false;
let cameraOn = false;
let loopGeneration = 0;

const trackerSettings = (): TrackerSettings => ({ confidence: 0.6, frameWidth: 640, delegate: prefs.delegate });
const beginText = (): string => `Pinch with your ${handNames(L).secondary} hand on the ring at the needle hub to begin.`;

function onResult(result: RawResult): void {
  if (mode !== 'live') return;
  const hands: RawHandLike[] = result.hands.map((h) => ({ label: h.label, score: h.score, lm: h.lm }));
  rig.push(performance.now(), hands, L.aspect);
}

function onTrackerEvent(event: TrackerEvent): void {
  if (event.type === 'ready') {
    trackerReady = true;
    setStatus(mode === 'live' ? `Camera on. ${beginText()}` : 'Hand model ready.');
  } else {
    trackerReady = false;
    showError(event.message);
  }
  updateButtons();
}

function startLoop(): void {
  const generation = ++loopGeneration;
  const schedule = (): void => {
    if (generation !== loopGeneration) return;
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };
  const tick = (): void => {
    if (generation !== loopGeneration || !tracker) return;
    void tracker.submit(video, trackerSettings());
    schedule();
  };
  schedule();
}

function stopLive(): void {
  loopGeneration++;
  if (cameraOn) closeCamera(video);
  cameraOn = false;
}

async function startCamera(): Promise<void> {
  hideError();
  cameraButton.disabled = true;
  startCameraButton.disabled = true;
  stopDemo();
  setStatus('Starting the camera…');
  try {
    const info = await openCamera(video);
    cameraOn = true;
    mode = 'live';
    rebuild(info.width / info.height);
    stage.classList.remove('is-replay');
    if (!tracker) {
      tracker = new Tracker(onResult, onTrackerEvent);
      tracker.configure(trackerSettings());
      setStatus('Camera on. Loading the hand model (about 22 MB the first time)…');
    } else {
      setStatus(trackerReady ? `Camera on. ${beginText()}` : 'Camera on. The hand model is still loading…');
    }
    startLoop();
  } catch (error) {
    cameraOn = false;
    mode = 'idle';
    showError(error instanceof CameraError ? error.message : `The camera could not start: ${String(error)}`);
    setStatus('');
  } finally {
    cameraButton.disabled = false;
    startCameraButton.disabled = false;
    updateButtons();
  }
}

function stopCamera(): void {
  stopLive();
  mode = 'idle';
  stage.classList.add('is-replay');
  rebuild(16 / 9);
  setStatus('Camera off.');
  updateButtons();
}

// ---------------------------------------------------------------- drawing and text

let lastFrame = performance.now();

/** The hint hand for the current step, with its caption beside it. */
function ghostFor(s: Snapshot): { pos: Vec2; angle: number; caption: string; captionPos: Vec2 } | null {
  if (!prefs.hintHands) return null;
  if (s.step === 'steady') {
    const at = L.anchors.hub;
    const away = at.x < L.axis ? -0.2 : 0.2;
    return { pos: at, angle: -Math.PI / 2, caption: 'Pinch like this', captionPos: { x: Math.min(Math.max(at.x + away, 0.14), aspect - 0.14), y: at.y } };
  }
  return null;
}

function setHud(s: Snapshot): void {
  const text = `${s.step}|${s.instruction}|${s.hint ?? ''}`;
  if (text === lastText) return;
  lastText = text;
  hudStep.textContent = s.done ? 'Done' : `Step ${s.stepIndex + 1} of ${s.stepCount} · ${s.title}`;
  hudInstruction.textContent = s.instruction;
  hudHint.textContent = s.hint ?? '';
  hudHint.hidden = !s.hint;
}

function buildProcedure(): void {
  const rows: HTMLElement[] = [];
  let number = 0;
  for (const phase of PHASES) {
    const group = document.createElement('li');
    group.className = 'group';
    group.textContent = phase.title;
    rows.push(group);
    for (const id of STEP_ORDER) {
      if (id === 'done' || STEPS[id].phase !== phase.id) continue;
      number++;
      const li = document.createElement('li');
      li.dataset.id = id;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(number);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = STEPS[id].title;
      li.append(num, what);
      rows.push(li);
    }
  }
  phasesList.replaceChildren(...rows);
}

function markProcedure(s: Snapshot): void {
  procTitle.textContent = s.done ? 'All steps done' : `Step ${s.stepIndex + 1} of ${s.stepCount}`;
  const key = `${s.step}|${s.instruction}`;
  if (key === lastProcKey) return;
  lastProcKey = key;
  const current = s.stepIndex;
  for (const li of Array.from(phasesList.querySelectorAll<HTMLElement>('li[data-id]'))) {
    const i = STEP_ORDER.indexOf(li.dataset.id as StepId);
    li.dataset.state = i < current ? 'done' : i === current ? 'now' : 'todo';
    li.querySelector('.more')?.remove();
    if (i === current && !s.done) {
      const more = document.createElement('span');
      more.className = 'more';
      more.textContent = s.instruction;
      const content = STEPS[li.dataset.id as StepId];
      if (content.why) {
        const why = document.createElement('span');
        why.className = 'why';
        why.textContent = `Why: ${content.why}`;
        more.append(why);
      }
      if (content.placeholder) {
        const flag = document.createElement('span');
        flag.className = 'flag';
        flag.textContent = `Placeholder: ${content.placeholder}`;
        more.append(flag);
      }
      if (content.notSimulated) {
        const flag = document.createElement('span');
        flag.className = 'flag';
        flag.textContent = `Not simulated: ${content.notSimulated}`;
        more.append(flag);
      }
      li.querySelector('.what')?.append(more);
    }
  }
}

const RULE_TEXT: Record<keyof typeof RULES, (value: number) => string> = {
  wireDepthMin: (v) => `Wire depth, lower limit: ${v} cm`,
  wireDepthMax: (v) => `Wire depth, upper limit: ${v} cm`,
  ectopyAbove: (v) => `The ECG starts to show extra beats at wire depth ${v} cm`,
  runAbove: (v) => `The ECG shows a fast run at wire depth ${v} cm`,
  resistAt: (v) => `Drill: the wire meets resistance at ${v} cm`,
  forceAfter: (v) => `Pushing on against resistance counts as forcing after about ${Math.round(v / L.k)} cm more`,
  catheterDepthMin: (v) => `Catheter depth, lower limit: ${v} cm`,
  catheterDepthMax: (v) => `Catheter depth, upper limit: ${v} cm`,
  catheterShortOfWire: (v) => `The catheter tip stays at least ${v} cm short of the wire tip`,
  dilatorZone: () => 'How far the dilator goes in',
};

function buildSources(): void {
  sourceList.replaceChildren(
    ...Object.values(SOURCES).map((source) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = source.url;
      a.textContent = source.label;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
      return li;
    }),
  );
  const items: HTMLLIElement[] = [];
  for (const key of Object.keys(RULES) as (keyof typeof RULES)[]) {
    const rule = RULES[key];
    if (!rule.placeholder) continue;
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = RULE_TEXT[key](rule.value);
    li.append(b, document.createTextNode(`. ${rule.note}`));
    items.push(li);
  }
  for (const id of STEP_ORDER) {
    const content = STEPS[id];
    if (!content.placeholder) continue;
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = `Step: ${content.title}`;
    li.append(b, document.createTextNode(`. ${content.placeholder}`));
    items.push(li);
  }
  placeholderList.replaceChildren(...items);
  const skipped: HTMLLIElement[] = [];
  for (const id of STEP_ORDER) {
    const content = STEPS[id];
    if (!content.notSimulated) continue;
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = `Step: ${content.title}`;
    li.append(b, document.createTextNode(`. ${content.notSimulated}`));
    skipped.push(li);
  }
  const after = document.createElement('li');
  const afterB = document.createElement('b');
  afterB.textContent = 'After the catheter is in';
  after.append(afterB, document.createTextNode(`. ${STEPS.done.instruction(handNames(L))}`));
  skipped.push(after);
  skippedList.replaceChildren(...skipped);
  notSimulated.textContent = STEPS.done.instruction(handNames(L));
}

function showResult(s: Snapshot): void {
  const m = s.metrics;
  resultBlock.hidden = !s.done || !m;
  if (!s.done || !m || statsShown) return;
  statsShown = true;
  const rows: [string, string][] = [
    ['Total time', `${m.seconds.toFixed(1)} s`],
    ['Wire left unheld', String(m.wireLapses)],
    ['Hub or catheter left unheld', String(m.holdLapses)],
    ['Forced against resistance', String(m.forced)],
    ['Time with extra heartbeats', `${m.ectopySeconds.toFixed(1)} s`],
    ['Deepest wire', `${m.maxWireDepth.toFixed(1)} cm`],
    ['Catheter depth', m.catheterDepth === null ? 'n/a' : `${m.catheterDepth.toFixed(1)} cm`],
    ['Back to the blood check', String(m.attempts - 1)],
    ['Steps skipped', String(m.skipped)],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    statsList.append(dt, dd);
  }
  setStatus(mode === 'demo' ? 'Demo finished. Press Use my camera to try it with your own hands.' : 'Catheter in place. Press Start over to practise again.');
}

function frame(nowMs: number): void {
  const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  rig.tick(nowMs);
  snap = machine.update({ t: nowMs, primary: rig.tools.primary, secondary: rig.tools.secondary });
  motion.update(snap, rig.tools, dt);
  ecg.update(dt, snap.rhythm);

  const ghost = ghostFor(snap);
  drawScene(sceneCanvas, {
    L,
    snap,
    motion,
    tools: rig.tools,
    ecg,
    names: handNames(L),
    hands: rig.seen,
    aspect,
    showSkeleton: prefs.skeleton && mode !== 'idle',
    backdrop: mode !== 'live',
    tissueAlpha: mode === 'live' ? 0.3 : 0.88,
    hintCaption: ghost ? { pos: ghost.captionPos, text: ghost.caption } : null,
    time: nowMs / 1000,
  });
  const key = `${snap.step}|${prefs.hintHands}|${ghostCanvas.clientWidth}x${ghostCanvas.clientHeight}`;
  if (key !== ghostKey) {
    ghostKey = key;
    drawGhost(ghostCanvas, ghost ? { pos: ghost.pos, angle: ghost.angle } : null);
  }
  stage.dataset.step = snap.step;
  stage.dataset.mode = mode;
  stage.dataset.rhythm = snap.rhythm;
  setHud(snap);
  markProcedure(snap);
  showResult(snap);
  const buttonKey = `${mode}|${snap.done}`;
  if (buttonKey !== lastButtonKey) {
    lastButtonKey = buttonKey;
    skipButton.disabled = mode === 'idle' || snap.done;
    restartButton.disabled = mode === 'idle';
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- controls

function updateButtons(): void {
  cameraButton.textContent = cameraOn ? 'Stop camera' : 'Use my camera';
  cameraButton.classList.toggle('primary', !cameraOn && mode === 'demo');
  demoButton.classList.toggle('primary', mode === 'live');
  landing.hidden = mode !== 'idle';
  swapNote.textContent = `Left and right are worked out from where your hands are on the screen. The tracker's own labels are being read ${rig.identity.mapping === 'asIs' ? 'as given' : 'swapped'}.`;
  modeNote.textContent =
    mode === 'live'
      ? trackerReady
        ? 'Live: your hands are being tracked.'
        : 'Live: waiting for the hand model to load.'
      : mode === 'demo'
        ? 'Watching a scripted run.'
        : 'Pick one to begin.';
  lastButtonKey = '';
}

function restart(): void {
  if (mode === 'demo') {
    startDemo();
    return;
  }
  resetRun();
  setStatus(mode === 'live' ? `Started over. ${beginText()}` : '');
}

startDemoButton.addEventListener('click', startDemo);
demoButton.addEventListener('click', startDemo);
startCameraButton.addEventListener('click', () => void startCamera());
cameraButton.addEventListener('click', () => {
  if (cameraOn) stopCamera();
  else void startCamera();
});
restartButton.addEventListener('click', restart);
skipButton.addEventListener('click', () => machine.skip());
drillSelect.addEventListener('change', () => {
  drill = drillSelect.value === 'resistance' ? 'resistance' : 'none';
  restart();
});
dominantSelect.addEventListener('change', () => {
  prefs.dominant = dominantSelect.value === 'L' ? 'L' : 'R';
  savePrefs();
  rebuild(aspect);
  if (mode === 'demo') startDemo();
});
delegateSelect.addEventListener('change', () => {
  prefs.delegate = delegateSelect.value === 'GPU' ? 'GPU' : 'CPU';
  savePrefs();
  if (tracker) {
    trackerReady = false;
    tracker.configure(trackerSettings());
    setStatus('Restarting the hand model…');
    updateButtons();
  }
});
hintBox.addEventListener('change', () => {
  prefs.hintHands = hintBox.checked;
  savePrefs();
  ghostKey = '';
});
skeletonBox.addEventListener('change', () => {
  prefs.skeleton = skeletonBox.checked;
  savePrefs();
});
swapButton.addEventListener('click', () => {
  prefs.swap = !prefs.swap;
  rig.identity.swap = prefs.swap;
  savePrefs();
  updateButtons();
});

// ---------------------------------------------------------------- start

dominantSelect.value = prefs.dominant;
delegateSelect.value = prefs.delegate;
hintBox.checked = prefs.hintHands;
skeletonBox.checked = prefs.skeleton;
rig.identity.swap = prefs.swap;
buildProcedure();
buildSources();
stage.classList.add('is-replay');
updateButtons();
setStatus('');
requestAnimationFrame(frame);
