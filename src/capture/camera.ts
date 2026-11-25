export type CameraProblem = 'denied' | 'none' | 'busy' | 'insecure' | 'other';

/** A camera failure with a message that names the problem and what to do about it. */
export class CameraError extends Error {
  readonly kind: CameraProblem;
  constructor(kind: CameraProblem, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface CameraInfo {
  label: string;
  width: number;
  height: number;
  fps: number | null;
  deviceId: string | null;
}

export async function listCameras(): Promise<{ id: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function closeCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

export async function openCamera(video: HTMLVideoElement, deviceId?: string): Promise<CameraInfo> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('insecure', 'This browser blocks the camera on this address. Open the page from http://localhost, or over https.');
  }
  closeCamera(video);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new CameraError('denied', 'The camera is blocked. Allow camera access for this site in the browser, then press Start camera.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new CameraError('none', 'No camera was found. Plug one in, then press Start camera.');
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      throw new CameraError('busy', 'Another app is using the camera. Close it, then press Start camera.');
    }
    throw new CameraError('other', `The camera could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  video.srcObject = stream;
  try {
    await video.play();
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
    }
  } catch (error) {
    closeCamera(video);
    throw new CameraError('other', `The camera picture could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  return {
    label: track.label,
    width: video.videoWidth,
    height: video.videoHeight,
    fps: settings.frameRate ?? null,
    deviceId: settings.deviceId ?? null,
  };
}
