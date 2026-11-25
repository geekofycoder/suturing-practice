/** What the tracker calls a hand. */
export type HandLabel = 'Left' | 'Right';

export interface TrackerSettings {
  /** Detection and tracking confidence, 0 to 1. */
  confidence: number;
  /** Width of the picture sent to the model. */
  frameWidth: number;
  delegate: 'CPU' | 'GPU';
}

export interface RawHand {
  label: HandLabel;
  score: number;
  lm: number[];
  w: number[];
}

export interface RawResult {
  /** How long the model took, in the worker. */
  ms: number;
  /** Size of the picture the model saw. */
  width: number;
  height: number;
  hands: RawHand[];
  /** performance.now() when the frame was taken from the video. */
  capturedAt: number;
  /** From taking the frame to having its result. */
  roundTripMs: number;
}

export type TrackerEvent =
  | { type: 'ready'; delegate: string; confidence: number; note: string }
  | { type: 'error'; message: string };

type WorkerMessage =
  | { type: 'ready'; delegate: string; confidence: number; note: string }
  | { type: 'result'; id: number; ms: number; width: number; height: number; hands: RawHand[] }
  | { type: 'skipped'; id: number }
  | { type: 'error'; id?: number; message: string };

const START_TIMEOUT_MS = 30000;

/**
 * Talks to the hand-tracking worker. One frame is in flight at a time: while the model is busy, new
 * camera frames are dropped rather than queued, so the picture and the hands never drift apart.
 */
export class Tracker {
  private readonly worker: Worker;
  private ready = false;
  private inFlight = false;
  private pending: { id: number; capturedAt: number } | null = null;
  private nextId = 1;
  private lastTimestamp = 0;
  private startTimer: number | undefined;
  private readonly onResult: (result: RawResult) => void;
  private readonly onEvent: (event: TrackerEvent) => void;
  /** Camera frames dropped because the model was still busy. */
  skipped = 0;

  constructor(onResult: (result: RawResult) => void, onEvent: (event: TrackerEvent) => void) {
    this.onResult = onResult;
    this.onEvent = onEvent;
    this.worker = new Worker(new URL('hand-worker.js', document.baseURI));
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      this.inFlight = false;
      this.onEvent({ type: 'error', message: `The hand tracker stopped: ${event.message || 'unknown error'}` });
    };
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** (Re)starts the model with these settings. Frames are ignored until it reports ready. */
  configure(settings: TrackerSettings): void {
    this.ready = false;
    window.clearTimeout(this.startTimer);
    this.startTimer = window.setTimeout(() => {
      if (!this.ready) {
        this.onEvent({ type: 'error', message: 'The hand model did not start within 30 seconds. Reload the page. If it keeps happening, check that the files in public/ are all there.' });
      }
    }, START_TIMEOUT_MS);
    this.worker.postMessage({ type: 'configure', settings });
  }

  private handle(message: WorkerMessage): void {
    if (message.type === 'ready') {
      this.ready = true;
      window.clearTimeout(this.startTimer);
      this.onEvent({ type: 'ready', delegate: message.delegate, confidence: message.confidence, note: message.note });
    } else if (message.type === 'result') {
      const pending = this.pending;
      this.pending = null;
      this.inFlight = false;
      if (pending && pending.id === message.id) {
        this.onResult({
          ms: message.ms,
          width: message.width,
          height: message.height,
          hands: message.hands,
          capturedAt: pending.capturedAt,
          roundTripMs: performance.now() - pending.capturedAt,
        });
      }
    } else if (message.type === 'skipped') {
      this.pending = null;
      this.inFlight = false;
    } else {
      this.pending = null;
      this.inFlight = false;
      this.onEvent({ type: 'error', message: message.message });
    }
  }

  /** Sends the current video frame to the model, unless it is still busy or not ready. */
  async submit(video: HTMLVideoElement, settings: TrackerSettings): Promise<void> {
    if (!this.ready || video.readyState < 2 || !video.videoWidth) return;
    if (this.inFlight) {
      this.skipped++;
      return;
    }
    this.inFlight = true;
    const capturedAt = performance.now();
    let bitmap: ImageBitmap;
    try {
      const width = Math.min(settings.frameWidth, video.videoWidth);
      const height = Math.round((width * video.videoHeight) / video.videoWidth);
      bitmap = await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
    } catch {
      this.inFlight = false;
      return;
    }
    // detectForVideo needs strictly increasing whole-millisecond timestamps.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(capturedAt));
    this.lastTimestamp = timestamp;
    const id = this.nextId++;
    this.pending = { id, capturedAt };
    this.worker.postMessage({ type: 'frame', id, timestamp, bitmap }, [bitmap]);
  }

  dispose(): void {
    window.clearTimeout(this.startTimer);
    this.worker.terminate();
  }
}
