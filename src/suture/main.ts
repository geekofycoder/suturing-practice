import '../common/style.css';
import { CameraError, closeCamera, openCamera } from '../capture/camera.ts';
import { Tracker } from '../capture/tracker.ts';
import type { RawResult, TrackerEvent, TrackerSettings } from '../capture/tracker.ts';
import { clamp, norm, smoothstep } from '../common/geometry.ts';
import type { Vec2 } from '../common/geometry.ts';
import type { RawHandLike } from '../common/hand-input.ts';
import type { Hand } from './pad.ts';
import { STITCH_COUNT } from './pad.ts';
import { Pipeline } from './pipeline.ts';
import { drawGhost } from '../common/draw.ts';
import { ThreadView, ToolView, drawScene, needleAttach } from './render.ts';
import { demoHands, demoSchedule } from './script.ts';
import { STEP_TITLES } from './steps.ts';
import type { Snapshot, StepId } from './steps.ts';

const TEMPLATE = `
<div class="shell">
  <nav class="tabs" aria-label="Practice activities">
    <a href="./" aria-current="page">Suturing</a>
    <a href="guidewire.html">Guidewire insertion</a>
  </nav>
  <header class="top">
    <h1>Suturing practice</h1>
    <p>Close a wound with five interrupted stitches on a virtual pad. Your pinch points hold the instruments, and each step tells you what to do next. This is practice on a pad, not training for a real patient.</p>
  </header>
  <div class="layout">
    <section class="stage-col" aria-label="Practice pad">
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
            <p>Sit or stand so both hands are in the picture, with light on them. You will close a wound with five stitches, working from the middle outward.</p>
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
        <p class="muted" id="mode-note"></p>
      </section>

      <section class="block">
        <h2 id="proc-title">Get ready</h2>
        <ol class="steps" id="phases"></ol>
        <div class="dots" id="dots" aria-label="Stitches, in the order they are placed"></div>
        <div class="row">
          <button type="button" class="btn small" id="skip">Skip step</button>
          <button type="button" class="btn small" id="restart">Start over</button>
        </div>
      </section>

      <section class="block" id="result" hidden>
        <h2>Wound closed</h2>
        <dl class="stats" id="stats"></dl>
        <p class="muted">Pulling the thread through draws the edges together, and each knot is drawn for you: tying knots is not practised in this version. These numbers are for practice, and the steps, marks and tolerances are placeholders until a clinician reviews them.</p>
      </section>

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
const modeNote = el<HTMLParagraphElement>('mode-note');
const procTitle = el<HTMLHeadingElement>('proc-title');
const phasesList = el<HTMLOListElement>('phases');
const dotsRow = el<HTMLDivElement>('dots');
const skipButton = el<HTMLButtonElement>('skip');
const restartButton = el<HTMLButtonElement>('restart');
const resultBlock = el<HTMLElement>('result');
const statsList = el<HTMLDListElement>('stats');
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
let pipeline = new Pipeline(aspect, prefs.dominant);
let needleView = new ToolView(pipeline.pad.tray.needle);
let forcepsView = new ToolView(pipeline.pad.tray.forceps);
let threadView = new ThreadView();
let healed = 0;
/** What is drawn for each stitch: how tight the wound is drawn at it, and how far its knot has settled in. */
let closureView: number[] = pipeline.pad.sites.map(() => 0);
let tieView: number[] = pipeline.pad.sites.map(() => 0);
/** Seconds since the last stitch, which times the healing over. */
let healClock = 0;
let ghostKey = '';
let lastText = '';
let lastPhaseKey = '';
let lastDotsKey = '';
let lastButtonKey = '';

/** The wound goes back to open, with no knots and no healing. */
function resetView(): void {
  healed = 0;
  healClock = 0;
  closureView = pipeline.pad.sites.map(() => 0);
  tieView = pipeline.pad.sites.map(() => 0);
}

function rebuild(nextAspect: number): void {
  aspect = nextAspect;
  pipeline = new Pipeline(aspect, prefs.dominant);
  pipeline.identity.swap = prefs.swap;
  needleView = new ToolView(pipeline.pad.tray.needle);
  forcepsView = new ToolView(pipeline.pad.tray.forceps);
  threadView = new ThreadView();
  resetView();
  stage.style.aspectRatio = `${aspect}`;
  ghostKey = '';
  lastText = '';
  lastPhaseKey = '';
  lastDotsKey = '';
  statsList.replaceChildren();
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
  const script = demoHands(pipeline.pad, aspect);
  const total = demoSchedule(pipeline.pad.sites.length).total;
  const t0 = performance.now();
  demoTimer = window.setInterval(() => {
    const now = performance.now();
    const s = (now - t0) / 1000;
    pipeline.push(now, script(s), aspect);
    if (s > total + 2) stopDemo();
  }, 66);
  setStatus('Watching a scripted run through all five stitches. Press Use my camera to try it with your own hands.');
  updateButtons();
}

// ---------------------------------------------------------------- camera

let tracker: Tracker | null = null;
let trackerReady = false;
let cameraOn = false;
let loopGeneration = 0;

const trackerSettings = (): TrackerSettings => ({ confidence: 0.6, frameWidth: 640, delegate: prefs.delegate });

function onResult(result: RawResult): void {
  if (mode !== 'live') return;
  const hands: RawHandLike[] = result.hands.map((h) => ({ label: h.label, score: h.score, lm: h.lm }));
  pipeline.push(performance.now(), hands, pipeline.pad.aspect);
}

function onTrackerEvent(event: TrackerEvent): void {
  if (event.type === 'ready') {
    trackerReady = true;
    setStatus(mode === 'live' ? 'Camera on. Pinch with your needle-holder hand to begin.' : 'Hand model ready.');
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
      setStatus(trackerReady ? 'Camera on. Pinch with your needle-holder hand to begin.' : 'Camera on. The hand model is still loading…');
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

/** The hint hand for the current step, with its caption placed beside it, toward the pad. */
function ghostFor(snap: Snapshot): { pos: Vec2; angle: number; caption: string; captionPos: Vec2 } | null {
  if (!prefs.hintHands) return null;
  const pad = pipeline.pad;
  const beside = (pos: Vec2): Vec2 => ({ x: pos.x + (pos.x < pad.aspect / 2 ? 0.2 : -0.2), y: pos.y });
  if (snap.step === 'grip-needle') return { pos: pad.tray.needle, angle: -Math.PI / 2, caption: 'Pinch like this', captionPos: beside(pad.tray.needle) };
  if (snap.step === 'hold' && snap.stitch === 1) {
    const at = pad.sites[0].forceps;
    return { pos: at, angle: -Math.PI / 2, caption: 'Pinch here', captionPos: beside(at) };
  }
  return null;
}

function setHud(snap: Snapshot): void {
  const text = `${snap.step}|${snap.stitch}|${snap.instruction}|${snap.hint ?? ''}`;
  if (text === lastText) return;
  lastText = text;
  hudStep.textContent = snap.done ? 'Done' : snap.step === 'grip-needle' ? 'Get ready' : `Stitch ${snap.stitch} of ${snap.stitchCount} · ${snap.title}`;
  hudInstruction.textContent = snap.instruction;
  hudHint.textContent = snap.hint ?? '';
  hudHint.hidden = !snap.hint;
}

const PHASES: StepId[] = ['grip-needle', 'hold', 'enter', 'drive', 'pull'];

function buildProcedure(): void {
  phasesList.replaceChildren(
    ...PHASES.map((id, i) => {
      const li = document.createElement('li');
      li.dataset.id = id;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = STEP_TITLES[id];
      li.append(num, what);
      return li;
    }),
  );
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Stitches';
  dotsRow.replaceChildren(
    label,
    ...Array.from({ length: STITCH_COUNT }, (_, i) => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = String(i + 1);
      dot.title = i === 0 ? 'Stitch 1, in the middle' : `Stitch ${i + 1}`;
      return dot;
    }),
  );
}

function markProcedure(snap: Snapshot): void {
  procTitle.textContent = snap.done ? 'Wound closed' : snap.step === 'grip-needle' ? 'Get ready' : `Stitch ${snap.stitch} of ${snap.stitchCount}`;
  const phaseKey = `${snap.step}|${snap.instruction}`;
  if (phaseKey !== lastPhaseKey) {
    lastPhaseKey = phaseKey;
    const current = snap.done ? PHASES.length : PHASES.indexOf(snap.step);
    for (const li of Array.from(phasesList.children) as HTMLElement[]) {
      const i = PHASES.indexOf(li.dataset.id as StepId);
      li.dataset.state = i < current ? 'done' : i === current ? 'now' : 'todo';
      const more = li.querySelector('.more');
      if (i === current && !snap.done) {
        if (!more) {
          const note = document.createElement('span');
          note.className = 'more';
          li.querySelector('.what')?.append(note);
        }
        const target = li.querySelector('.more');
        if (target) target.textContent = snap.instruction;
      } else {
        more?.remove();
      }
    }
  }
  const dotsKey = snap.sites.map((s) => s.state).join(',');
  if (dotsKey !== lastDotsKey) {
    lastDotsKey = dotsKey;
    const dots = Array.from(dotsRow.querySelectorAll<HTMLElement>('.dot'));
    snap.sites.forEach((site, i) => {
      if (dots[i]) dots[i].dataset.state = site.state;
    });
  }
}

function showResult(snap: Snapshot): void {
  const m = snap.metrics;
  resultBlock.hidden = !snap.done || !m;
  if (!snap.done || !m) return;
  if (statsList.childElementCount) return;
  const devs = m.stitches.map((s) => s.meanDeviation).filter((d): d is number => d !== null);
  const meanDev = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null;
  const rows: [string, string][] = [
    ['Total time', `${m.seconds.toFixed(1)} s`],
    ...m.stitches.map((s, i): [string, string] => [`Stitch ${i + 1}`, `${s.seconds.toFixed(1)} s`]),
    ['Needle dropped', String(m.needleDrops)],
    ['Left the lane', String(m.leftLane)],
    ['Forceps slipped', String(m.forcepsLapses)],
    ['Thread slipped back', String(m.pullRetries)],
    ['Steps skipped', String(m.skipped)],
    ['Distance from the line', meanDev === null ? 'n/a' : `${Math.round(meanDev * 100)}% of the lane`],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    statsList.append(dt, dd);
  }
  setStatus(mode === 'demo' ? 'Demo finished. Press Use my camera to try it with your own hands.' : 'Wound closed. Press Start over to practise again.');
}

function frame(nowMs: number): void {
  const dt = Math.min(0.1, Math.max(0.001, (nowMs - lastFrame) / 1000));
  lastFrame = nowMs;
  const snap = pipeline.tick(nowMs);
  needleView.update(pipeline.tools.needle, dt);
  forcepsView.update(pipeline.tools.forceps, dt);
  const pad = pipeline.pad;
  const siteIndex = Math.max(0, snap.sites.findIndex((s) => s.state === 'now'));
  const site = snap.sites.find((s) => s.state === 'now') ?? snap.sites[snap.sites.length - 1];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The wound follows the pull almost directly. If the thread slips back it springs open quickly, and a knot settles in.
  snap.sites.forEach((st, i) => {
    const tau = st.closed > closureView[i] ? 0.05 : reduceMotion ? 0.03 : 0.09;
    closureView[i] += (st.closed - closureView[i]) * (1 - Math.exp(-dt / tau));
    tieView[i] = st.state === 'done' ? tieView[i] + (1 - tieView[i]) * (1 - Math.exp(-dt / (reduceMotion ? 0.02 : 0.09))) : 0;
  });
  const tailDir = norm({ x: pad.dominant === 'R' ? -0.7 : 0.7, y: 0.7 });
  const tailLen = 0.5 + (0.07 - 0.5) * clamp(closureView[siteIndex] ?? 0, 0, 1);
  threadView.update(needleAttach(needleView.pos, needleView.angle), { x: site.entry.x + tailDir.x * tailLen, y: site.entry.y + tailDir.y * tailLen }, dt);
  // Healing starts a moment after the last knot and spreads out from the middle; with reduced motion it is a short fade.
  healClock = snap.done ? healClock + dt : 0;
  healed = smoothstep(clamp((healClock - (reduceMotion ? 0.1 : 0.5)) / (reduceMotion ? 0.6 : 3.4), 0, 1));

  const ghost = ghostFor(snap);
  drawScene(sceneCanvas, {
    pad,
    snap,
    needle: needleView,
    forceps: forcepsView,
    needleTool: pipeline.tools.needle,
    forcepsTool: pipeline.tools.forceps,
    thread: threadView,
    healed,
    closure: closureView,
    tie: tieView,
    hands: pipeline.seen,
    aspect,
    showSkeleton: prefs.skeleton && mode !== 'idle',
    backdrop: mode !== 'live',
    padAlpha: mode === 'live' ? 0.4 : 0.93,
    hintCaption: ghost ? { pos: ghost.captionPos, text: ghost.caption } : null,
  });
  const key = `${snap.step}|${snap.stitch}|${prefs.hintHands}|${ghostCanvas.clientWidth}x${ghostCanvas.clientHeight}`;
  if (key !== ghostKey) {
    ghostKey = key;
    drawGhost(ghostCanvas, ghost ? { pos: ghost.pos, angle: ghost.angle } : null);
  }
  stage.dataset.step = snap.step;
  stage.dataset.stitch = String(snap.stitch);
  stage.dataset.mode = mode;
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
  swapNote.textContent = `Left and right are worked out from where your hands are on the screen. The tracker's own labels are being read ${pipeline.identity.mapping === 'asIs' ? 'as given' : 'swapped'}.`;
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
  pipeline.reset();
  needleView.reset();
  forcepsView.reset();
  threadView.reset();
  resetView();
  lastText = '';
  lastPhaseKey = '';
  lastDotsKey = '';
  ghostKey = '';
  statsList.replaceChildren();
  setStatus(mode === 'live' ? 'Started over. Pinch with your needle-holder hand to begin.' : '');
}

startDemoButton.addEventListener('click', startDemo);
demoButton.addEventListener('click', startDemo);
startCameraButton.addEventListener('click', () => void startCamera());
cameraButton.addEventListener('click', () => {
  if (cameraOn) stopCamera();
  else void startCamera();
});
restartButton.addEventListener('click', restart);
skipButton.addEventListener('click', () => pipeline.skip());
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
  pipeline.identity.swap = prefs.swap;
  savePrefs();
  updateButtons();
});

// ---------------------------------------------------------------- start

dominantSelect.value = prefs.dominant;
delegateSelect.value = prefs.delegate;
hintBox.checked = prefs.hintHands;
skeletonBox.checked = prefs.skeleton;
pipeline.identity.swap = prefs.swap;
buildProcedure();
stage.classList.add('is-replay');
updateButtons();
setStatus('');
requestAnimationFrame(frame);
