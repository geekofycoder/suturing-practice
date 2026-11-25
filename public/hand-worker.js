// Classic worker, because MediaPipe's WASM loader uses importScripts.
// It loads only the runtime that forVisionTasks() picks for a SIMD-capable browser: vision_wasm_internal.{js,wasm}.
// Every file is found relative to this worker, so the site works at the root of a domain or under a sub-path.
const BASE = new URL('./', self.location.href).href;
importScripts(BASE + 'vendor/mediapipe/vision_bundle.js');

let detector = null;
let files = null;
let delegate = 'CPU';
let epoch = 0;

const round = (v) => Math.round(v * 10000) / 10000;

// 21 points -> [x0, y0, z0, x1, y1, z1, ...], four decimals.
function flat(points) {
  const out = new Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    out[i * 3] = round(points[i].x);
    out[i * 3 + 1] = round(points[i].y);
    out[i * 3 + 2] = round(points[i].z);
  }
  return out;
}

async function create(settings, useGPU) {
  const c = settings.confidence;
  const options = {
    baseOptions: { modelAssetPath: BASE + 'models/hand_landmarker.task', delegate: useGPU ? 'GPU' : 'CPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: c,
    minHandPresenceConfidence: c,
    minTrackingConfidence: c,
  };
  if (useGPU) options.canvas = new OffscreenCanvas(1, 1);
  const made = await Vision.HandLandmarker.createFromOptions(files, options);
  delegate = useGPU ? 'GPU' : 'CPU';
  return made;
}

async function configure(settings) {
  const mine = ++epoch;
  const previous = detector;
  detector = null;
  try { if (previous) previous.close(); } catch (e) { /* already closed */ }
  if (!files) files = await Vision.FilesetResolver.forVisionTasks(BASE + 'vendor/mediapipe/wasm');
  const wantGPU = settings.delegate === 'GPU' && typeof OffscreenCanvas !== 'undefined';
  let note = '';
  let next;
  try {
    next = await create(settings, wantGPU);
  } catch (error) {
    if (!wantGPU) throw error;
    note = 'The GPU was not available, so the CPU is being used.';
    next = await create(settings, false);
  }
  if (mine !== epoch) { // a newer configure() superseded this one while it was loading
    try { next.close(); } catch (e) { /* ignore */ }
    return;
  }
  detector = next;
  self.postMessage({ type: 'ready', delegate, confidence: settings.confidence, note });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'configure') {
      await configure(data.settings);
    } else if (data.type === 'frame') {
      const bitmap = data.bitmap;
      try {
        if (!detector) { self.postMessage({ type: 'skipped', id: data.id }); return; }
        const start = performance.now();
        const result = detector.detectForVideo(bitmap, data.timestamp);
        const ms = Math.round((performance.now() - start) * 10) / 10;
        const handed = result.handedness || result.handednesses || [];
        const hands = [];
        (result.landmarks || []).forEach((lm, i) => {
          const top = handed[i] && handed[i][0];
          const label = top && (top.categoryName === 'Left' || top.categoryName === 'Right') ? top.categoryName : null;
          if (!label) return; // the tracker always names a hand; skip the rare unnamed one rather than guess
          hands.push({ label, score: round(top.score), lm: flat(lm), w: flat((result.worldLandmarks || [])[i] || []) });
        });
        self.postMessage({ type: 'result', id: data.id, ms, width: bitmap.width, height: bitmap.height, hands });
      } finally {
        bitmap.close();
      }
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data && data.id, message: String((error && error.message) || error) });
  }
};
