import { createCompatibleVideoRecorder, startVideoRecorder } from "./media-recorder.js";

const GIF_WIDTH = 360;
const GIF_HEIGHT = 240;
const GIF_INTERVAL = 250;
const CAPTURE_DURATION = 10_000;
const PHOTO_WIDTH = 1200;
const PHOTO_HEIGHT = 800;
const PHOTO_ASPECT_RATIO = PHOTO_WIDTH / PHOTO_HEIGHT;

let cameraStream = null;
let isCapturing = false;

function trackShouldMirror(track) {
  const settings = track?.getSettings?.() || {};
  if (settings.facingMode === "environment") return false;
  if (settings.facingMode === "user") return true;
  return !/(back|rear|environment|world)/i.test(track?.label || "");
}

export function cameraIsActive() {
  return Boolean(cameraStream?.getVideoTracks().some((track) => track.readyState === "live"));
}

export async function getAvailableCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === "videoinput");
}

export async function startCamera(video, deviceId = null) {
  if (!navigator.mediaDevices?.getUserMedia) {
    if (!window.isSecureContext) {
      throw new Error("Camera access requires a secure HTTPS connection.");
    }
    throw new Error("This browser does not support camera capture.");
  }

  stopCamera();
  
  // Ask for the same 3:2 shape used by the strip. Safari may choose a nearby
  // native size, so captureStill() still uses a fit-safe draw as a fallback.
  const preferredSize = {
    width: { ideal: PHOTO_WIDTH },
    height: { ideal: PHOTO_HEIGHT },
    aspectRatio: { ideal: PHOTO_ASPECT_RATIO },
  };
  const videoConstraints = deviceId
    ? { deviceId: { exact: deviceId }, ...preferredSize }
    : { facingMode: { ideal: "user" }, ...preferredSize };

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });

  try {
    await attachCamera(video);
    return cameraStream;
  } catch (error) {
    stopCamera();
    throw error;
  }
}

export async function attachCamera(video) {
  if (!video) {
    throw new Error("The camera preview could not be created.");
  }

  const attachedStream = video.srcObject;
  const attachedStreamIsLive = Boolean(
    attachedStream?.getVideoTracks?.().some((track) => track.readyState === "live"),
  );
  const stream = attachedStreamIsLive ? attachedStream : cameraStream;

  if (!stream?.getVideoTracks?.().some((track) => track.readyState === "live")) {
    throw new Error("The camera stream stopped. Turn the camera on again.");
  }

  video.muted = true;
  video.playsInline = true;
  if (video.srcObject !== stream) video.srcObject = stream;
  video.dataset.mirror = String(trackShouldMirror(stream.getVideoTracks()[0]));
  await video.play();
  await waitForVideoFrame(video);
}

export function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  isCapturing = false;
}

export async function captureMoment(video, { onTick, onFinalStill, onEncoding, signal } = {}) {
  if (!video || isCapturing) {
    throw new Error("The camera is not ready yet.");
  }

  const attachedStream = video.srcObject;
  const attachedTrackIsLive = Boolean(
    attachedStream?.getVideoTracks?.().some((track) => track.readyState === "live"),
  );

  if (!attachedTrackIsLive) {
    if (!cameraIsActive()) {
      throw new Error("The camera stream stopped. Turn the camera on again.");
    }
    await attachCamera(video);
  }

  await video.play();
  await waitForVideoFrame(video, 5_000);
  isCapturing = true;

  const stream = video.srcObject;
  const recorder = createCompatibleVideoRecorder(stream, 6_000_000);
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  const recordingPromise = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, {
      type: recorder.mimeType || chunks[0]?.type || "video/webm",
    }));
    recorder.onerror = (event) => reject(event.error || new Error("Camera recording failed."));
  });
  recordingPromise.catch(() => {});
  await startVideoRecorder(recorder);

  let secondsLeft = 10;
  onTick?.(secondsLeft);

  const countdownTimer = window.setInterval(() => {
    secondsLeft = Math.max(0, secondsLeft - 1);
    onTick?.(secondsLeft);
  }, 1000);

  try {
    await waitForCapture(signal);
    window.clearInterval(countdownTimer);
    recorder.stop();
    
    if (signal?.aborted) throw new DOMException("Capture cancelled.", "AbortError");
    await onFinalStill?.();
    if (signal?.aborted) throw new DOMException("Capture cancelled.", "AbortError");
    const stillBlob = await captureStill(video);
    onEncoding?.();
    const videoBlob = await recordingPromise;
    return {
      stillBlob,
      videoBlob,
      mirrored: video.dataset.mirror !== "false",
    };
  } finally {
    window.clearInterval(countdownTimer);
    if (recorder.state !== "inactive") recorder.stop();
    isCapturing = false;
  }
}

function waitForVideoFrame(video, timeout = 12_000) {
  const frameIsReady = () => (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.videoWidth > 0
    && video.videoHeight > 0
  );

  if (frameIsReady()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let animationFrame = 0;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("The camera connected, but no video frame arrived. Close other camera apps and try again."));
    }, timeout);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(animationFrame);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("playing", check);
      video.removeEventListener("resize", check);
    };

    const check = () => {
      if (frameIsReady()) {
        cleanup();
        resolve();
        return;
      }
      animationFrame = window.requestAnimationFrame(check);
    };

    video.addEventListener("loadedmetadata", check);
    video.addEventListener("loadeddata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("playing", check);
    video.addEventListener("resize", check);
    check();
  });
}

function waitForCapture(signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, CAPTURE_DURATION);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Capture cancelled.", "AbortError"));
    }, { once: true });
  });
}

function drawVideoCover(context, video, outputWidth, outputHeight) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) {
    throw new Error("The camera image is not ready yet.");
  }

  const outputRatio = outputWidth / outputHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > outputRatio) {
    sw = sourceHeight * outputRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / outputRatio;
    sy = (sourceHeight - sh) / 2;
  }

  context.save();
  context.fillStyle = "#050505";
  context.fillRect(0, 0, outputWidth, outputHeight);
  if (video.dataset.mirror !== "false") {
    context.translate(outputWidth, 0);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  } else {
    context.drawImage(video, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  }
  context.restore();
}

async function captureStill(video) {
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const context = canvas.getContext("2d");
  drawVideoCover(context, video, PHOTO_WIDTH, PHOTO_HEIGHT);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("The final photo could not be created.");
  return blob;
}

