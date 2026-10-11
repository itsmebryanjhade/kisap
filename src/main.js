import "./styles.css";
import {
  attachCamera,
  cameraIsActive,
  captureMoment,
  getAvailableCameras,
  startCamera,
  stopCamera,
} from "./camera.js";
import {
  createCompatibleVideoRecorder,
  recorderFileExtension,
  startVideoRecorder,
} from "./media-recorder.js";
import {
  clearSessionRecovery,
  loadSessionRecovery,
  saveSessionRecovery,
} from "./session-store.js";

const SCREEN_ORDER = ["home", "capture", "review", "edit", "finish"];
const SCREEN_TITLES = {
  home: "Kisap — Free Online Photo Booth & Photo Strip Maker",
  capture: "Capture Your Moments — Kisap",
  review: "Review Your Photos — Kisap",
  edit: "Personalize Your Photo Strip — Kisap",
  finish: "Download and Share — Kisap",
};
let deferredInstallPrompt = null;
let installDialogOpen = false;

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function installPlatform() {
  const ua = window.navigator.userAgent;
  const isIPadOS = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isIPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function isIOSSafari() {
  if (installPlatform() !== "ios") return false;
  return /Safari/i.test(window.navigator.userAgent)
    && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i.test(window.navigator.userAgent);
}

function installIcon(type) {
  if (type === "ios") return "⌑";
  if (type === "android") return "▯";
  return "▱";
}

function installDialogMarkup() {
  if (!installDialogOpen || isStandaloneApp()) return "";
  const platform = installPlatform();
  const canPrompt = Boolean(deferredInstallPrompt);
  let title = "Install Kisap";
  let eyebrow = "Keep the booth close";
  let body = "Add Kisap to this device for quick access and a focused, full-screen photo booth.";
  let instructions = "";

  if (platform === "ios") {
    title = "Install on iPhone or iPad";
    body = isIOSSafari()
      ? "Safari can add Kisap to your Home Screen as a standalone web app."
      : "Apple requires Safari to install Kisap. Open this page in Safari first, then follow these steps.";
    instructions = `
      <ol class="install-steps">
        ${!isIOSSafari() ? `<li><span>1</span><p>Open this page in <strong>Safari</strong>.</p></li>` : ""}
        <li><span>${isIOSSafari() ? "1" : "2"}</span><p>Tap Safari’s <strong>Share</strong> button.</p></li>
        <li><span>${isIOSSafari() ? "2" : "3"}</span><p>Choose <strong>Add to Home Screen</strong>.</p></li>
        <li><span>${isIOSSafari() ? "3" : "4"}</span><p>Turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</p></li>
      </ol>
    `;
  } else if (canPrompt) {
    instructions = `
      <div class="install-ready-card">
        <span class="install-device-icon" aria-hidden="true">${installIcon(platform)}</span>
        <div><strong>This device is ready</strong><p>Your browser will confirm before Kisap is installed.</p></div>
      </div>
    `;
  } else if (platform === "android") {
    title = "Install on Android";
    body = "Your browser has not offered the automatic installer yet. You can still add Kisap manually.";
    instructions = `
      <ol class="install-steps">
        <li><span>1</span><p>Open Kisap in <strong>Chrome</strong>.</p></li>
        <li><span>2</span><p>Tap the browser menu <strong>⋮</strong>.</p></li>
        <li><span>3</span><p>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p></li>
      </ol>
    `;
  } else {
    title = "Install on this computer";
    body = "Kisap can run in its own window when your browser supports web app installation.";
    instructions = `
      <ol class="install-steps">
        <li><span>1</span><p>Open Kisap in <strong>Chrome</strong> or <strong>Edge</strong>.</p></li>
        <li><span>2</span><p>Select the install icon in the address bar, or open the browser menu.</p></li>
        <li><span>3</span><p>Choose <strong>Install Kisap</strong>.</p></li>
      </ol>
    `;
  }

  return `
    <div class="install-dialog-backdrop" data-install-dialog>
      <section class="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" aria-describedby="install-dialog-copy">
        <button class="install-dialog-close" data-install-close aria-label="Close install instructions">×</button>
        <p class="eyebrow">${eyebrow}</p>
        <h2 id="install-dialog-title">${title}</h2>
        <p id="install-dialog-copy" class="install-dialog-copy">${body}</p>
        ${instructions}
        <div class="install-dialog-actions">
          ${canPrompt ? `<button class="button button--light" data-install-native>Install on this device <span aria-hidden="true">↓</span></button>` : ""}
          <button class="button button--ghost" data-install-close>${canPrompt ? "Not now" : "Got it"}</button>
        </div>
        <p class="install-privacy-note">No account or download from an app store. Your photos still stay on this device.</p>
      </section>
    </div>
  `;
}
const STICKER_CATALOG = [
  { id: "spark", glyph: "✦", label: "Spark" },
  { id: "heart", glyph: "♥", label: "Heart" },
  { id: "smile", glyph: "☺", label: "Smile" },
  { id: "star", glyph: "★", label: "Star" },
  { id: "sun", glyph: "☀", label: "Sun" },
  { id: "flash", glyph: "↯", label: "Flash" },
];

const screenMeta = {
  home: { step: "00", label: "Welcome" },
  capture: { step: "01", label: "Capture" },
  review: { step: "02", label: "Review" },
  edit: { step: "03", label: "Edit" },
  finish: { step: "04", label: "Finish" },
};

const appState = {
  screen: "home",
  background: "black",
  filter: "mono",
  moments: [null, null, null, null],
  activeMoment: 0,
  previewingMoment: null,
  retaking: false,
  cameraError: "",
  notice: "",
  stickers: [],
  selectedStickerId: null,
  cameras: [],
  selectedCameraId: null,
  busy: false,
  soundEnabled: true,
  flashEnabled: true,
  recoveryAvailable: false,
  recoveryUpdatedAt: 0,
};

let captureController = null;
let feedbackAudioContext = null;
let recoveryWriteQueue = Promise.resolve();

function getFeedbackAudioContext() {
  if (!appState.soundEnabled) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    feedbackAudioContext ||= new AudioContextClass();
  } catch {
    return null;
  }
  if (feedbackAudioContext.state === "suspended") feedbackAudioContext.resume().catch(() => {});
  return feedbackAudioContext;
}

function playTone(frequency, duration, { gain = 0.035, delay = 0, type = "sine" } = {}) {
  const audio = getFeedbackAudioContext();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const volume = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  volume.gain.setValueAtTime(0.0001, start);
  volume.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(volume).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playCountdownTick(seconds) {
  if (seconds < 1 || seconds > 3) return;
  playTone(seconds === 1 ? 1040 : 820, 0.07, { gain: 0.025, type: "triangle" });
}

function playShutterSound() {
  const audio = getFeedbackAudioContext();
  if (!audio) return;
  const sampleCount = Math.max(1, Math.round(audio.sampleRate * 0.11));
  const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.exp(-index / (sampleCount * 0.16));
    samples[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const volume = audio.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 1450;
  filter.Q.value = 0.75;
  volume.gain.value = 0.055;
  source.buffer = buffer;
  source.connect(filter).connect(volume).connect(audio.destination);
  source.start();
  playTone(190, 0.055, { gain: 0.025, type: "square" });
}

function playReadyChime() {
  playTone(660, 0.18, { gain: 0.026, type: "sine" });
  playTone(880, 0.26, { gain: 0.022, delay: 0.11, type: "sine" });
}

function vibrate(pattern) {
  if (typeof navigator.vibrate === "function") navigator.vibrate(pattern);
}

function getInitialScreen() {
  const requested = window.location.hash.replace("#", "");
  if (requested === "review" && !appState.moments.some(Boolean)) return "home";
  if (["edit", "finish"].includes(requested) && !appState.moments.every(Boolean)) return "home";
  return SCREEN_ORDER.includes(requested) ? requested : "home";
}

function recoverySnapshot() {
  return {
    screen: appState.screen,
    activeMoment: appState.activeMoment,
    background: appState.background,
    filter: appState.filter,
    stickers: appState.stickers.map((sticker) => ({ ...sticker })),
    moments: appState.moments.map((moment) => moment ? {
      stillBlob: moment.stillBlob,
      videoBlob: moment.videoBlob,
      mirrored: moment.mirrored,
    } : null),
  };
}

function queueRecoverySave() {
  if (!appState.moments.some(Boolean)) return recoveryWriteQueue;
  const snapshot = recoverySnapshot();
  recoveryWriteQueue = recoveryWriteQueue
    .catch(() => {})
    .then(() => saveSessionRecovery(snapshot))
    .catch(() => {});
  return recoveryWriteQueue;
}

function queueRecoveryClear() {
  recoveryWriteQueue = recoveryWriteQueue
    .catch(() => {})
    .then(() => clearSessionRecovery());
  return recoveryWriteQueue;
}

function restoreRecoverySnapshot(stored) {
  if (!stored?.moments?.some(Boolean)) return false;
  appState.moments.forEach(releaseMoment);
  appState.moments = Array.from({ length: 4 }, (_, index) => {
    const moment = stored.moments[index];
    if (!moment?.stillBlob || !moment?.videoBlob) return null;
    return {
      stillBlob: moment.stillBlob,
      videoBlob: moment.videoBlob,
      stillUrl: URL.createObjectURL(moment.stillBlob),
      videoUrl: URL.createObjectURL(moment.videoBlob),
      mirrored: moment.mirrored !== false,
    };
  });
  appState.activeMoment = Number.isInteger(stored.activeMoment) ? stored.activeMoment : 0;
  appState.background = stored.background || "black";
  appState.filter = stored.filter || "mono";
  appState.stickers = Array.isArray(stored.stickers) ? stored.stickers : [];
  appState.recoveryAvailable = true;
  appState.recoveryUpdatedAt = stored.updatedAt || Date.now();
  return true;
}

function recoveryResumeTarget() {
  if (appState.moments.every(Boolean)) return "edit";
  return "review";
}

function navigate(screen) {
  if (!SCREEN_ORDER.includes(screen)) return;
  if (appState.screen === "capture" && screen !== "capture") {
    captureController?.abort();
    captureController = null;
    stopCamera();
  }
  appState.screen = screen;
  window.location.hash = screen;
  render();
  if (screen !== "home" && appState.moments.some(Boolean)) queueRecoverySave();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function brandMark(size = "default") {
  return `
    <span class="wordmark wordmark--${size}" aria-label="kisap">
      kisap<span class="signal-dot" aria-hidden="true">.</span>
    </span>
  `;
}

function stripDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}.${values.month}.${values.day}`;
}

function appHeader() {
  const current = screenMeta[appState.screen];
  const cameraLive = appState.screen === "capture" && cameraIsActive();
  return `
    <header class="app-header">
      <button class="brand-button" data-nav="home" aria-label="Return home">
        ${brandMark("small")}
      </button>
      <div class="header-meta" aria-label="Current step">
        <span>${current.step}</span>
        <span>${current.label}</span>
      </div>
      <div class="privacy-mark"><span class="privacy-light ${cameraLive ? "privacy-light--live" : ""}"></span> ${cameraLive ? "camera active · local only" : "stays on your device"}</div>
    </header>
  `;
}

function progressRail() {
  if (appState.screen === "home") return "";
  const currentIndex = SCREEN_ORDER.indexOf(appState.screen);
  return `
    <nav class="progress-rail" aria-label="Photo booth progress">
      ${SCREEN_ORDER.slice(1).map((screen, index) => {
        const status = index + 1 < currentIndex ? "complete" : index + 1 === currentIndex ? "current" : "upcoming";
        return `<span class="progress-step progress-step--${status}">${String(index + 1).padStart(2, "0")} ${screenMeta[screen].label}</span>`;
      }).join("")}
    </nav>
  `;
}

function diagramFrame(index, usePhotos) {
  const moment = usePhotos ? appState.moments[index] : null;
  return `
    <div class="diagram-frame ${moment ? "diagram-frame--filled" : ""}">
      ${moment ? `<img src="${moment.stillUrl}" alt="Captured moment ${index + 1}">` : ""}
      <span>${String(index + 1).padStart(2, "0")}</span>
      <small>${moment ? "captured" : "moment"}</small>
    </div>
  `;
}

function stickerLayer(interactive = false) {
  return `
    <div class="strip-stickers" aria-label="Placed stickers">
      ${appState.stickers.map((sticker) => `
        <button
          class="placed-sticker ${interactive && sticker.id === appState.selectedStickerId ? "is-selected" : ""}"
          style="--sticker-x:${sticker.x}%;--sticker-y:${sticker.y}%;--sticker-scale:${sticker.scale}"
          ${interactive ? `data-sticker-id="${sticker.id}" aria-label="Move ${sticker.label} sticker"` : `data-mirror-sticker-id="${sticker.id}" tabindex="-1" aria-hidden="true"`}
        >${sticker.glyph}</button>
      `).join("")}
    </div>
  `;
}

function stripDiagram({ duplicate = true, usePhotos = true, editable = false } = {}) {
  const frames = Array.from({ length: 4 }, (_, index) => diagramFrame(index, usePhotos)).join("");
  
  const buildStrip = (isHidden, isInteractive) => `
    <div class="strip-diagram strip-diagram--kisap" ${isHidden ? 'aria-hidden="true"' : ''}>
      <div class="strip-deco-top">kisap. // ARCHIVE 01</div>
      <div class="strip-deco-vertical">KISAP / FOUR MOMENTS / 10S EACH</div>
      <div class="diagram-column">
        ${frames}
        ${stickerLayer(isInteractive)}
        <footer>${brandMark("strip")}<time>${stripDate()}</time></footer>
      </div>
    </div>
  `;

  return `
    <div class="strip-group ${duplicate ? 'strip-group--double' : 'strip-group--single'}" aria-label="${duplicate ? "Two photo strips" : "One photo strip"}">
      ${buildStrip(false, editable)}
      ${duplicate ? buildStrip(true, false) : ''}
    </div>
  `;
}

function homeScreen() {
  const recoveredCount = appState.moments.filter(Boolean).length;
  const showInstall = !isStandaloneApp();
  return `
    <div class="landing-page">
      <a class="skip-link" href="#main-content">Skip to content</a>
      <nav class="landing-nav" aria-label="Primary navigation">
        <a class="landing-logo" href="#home" aria-label="Kisap home">kisap<span class="signal-dot">.</span></a>
        <div class="landing-nav-links">
          <a href="#how-it-works">How it Works</a>
          <a href="#privacy">Privacy</a>
        </div>
        <div class="landing-nav-actions">
          ${showInstall ? `<button class="landing-install-link" data-install-open><span aria-hidden="true">↓</span> Install Kisap</button>` : ""}
          <button class="button button--ghost landing-nav-cta" data-start-session>Start Booth</button>
        </div>
      </nav>

      <main id="main-content">
      <header class="landing-hero">
        <div class="hero-bg-glow"></div>
        <div class="landing-hero-content">
          <div class="hero-badge">Private Online Photo Booth</div>
          <h1 class="hero-title">A moment,<br><em>still moving.</em></h1>
          <p class="hero-subtitle">
            Take four photos in your browser, keep the ten seconds around each one, and download a strip that feels like you.
          </p>
          
          <ul class="hero-highlights">
            <li>
              <span class="highlight-icon">✓</span>
              <span><strong>100% Private:</strong> Everything stays on your device.</span>
            </li>
            <li>
              <span class="highlight-icon">✓</span>
              <span><strong>Live Previews:</strong> Instantly see your GIF and photo.</span>
            </li>
            <li>
              <span class="highlight-icon">✓</span>
              <span><strong>No Apps Needed:</strong> Works right in your browser.</span>
            </li>
          </ul>

          ${appState.recoveryAvailable ? `
            <div class="recovery-card" role="status">
              <div>
                <strong>Continue your private session?</strong>
                <span>${recoveredCount} of 4 moments recovered on this device.</span>
              </div>
              <div class="recovery-actions">
                <button class="button button--light" data-resume-session>Resume strip</button>
                <button class="text-button" data-discard-recovery>Start over</button>
              </div>
            </div>
          ` : ""}

          <div class="hero-cta-group">
            <button class="button button--light hero-cta" data-start-session>Enter Photo Booth <span aria-hidden="true">→</span></button>
            <span class="hero-note">4 moments · about 1 minute</span>
          </div>
        </div>
        <div class="hero-visual">
           ${stripDiagram({ duplicate: true, usePhotos: false })}
        </div>
      </header>

      <section id="how-it-works" class="landing-section reveal">
        <div class="section-content">
          <p class="eyebrow">The Experience</p>
          <h2 class="section-title">Four chances to feel right.</h2>
          <div class="features-grid">
            <div class="feature-card reveal">
              <div class="feature-icon">01</div>
              <h3>Capture</h3>
              <p>You have 10 seconds per moment. The countdown is your motion capture. The final frame becomes your still photo.</p>
            </div>
            <div class="feature-card reveal" style="transition-delay: 0.1s">
              <div class="feature-icon">02</div>
              <h3>Review</h3>
              <p>Don't like a shot? Retake it instantly. Old files are replaced immediately so there's no clutter.</p>
            </div>
            <div class="feature-card reveal" style="transition-delay: 0.2s">
              <div class="feature-icon">03</div>
              <h3>Personalize</h3>
              <p>Add stickers, change backgrounds, and apply filters. Your complete Kisap strip is repeated exactly for the photo download.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="privacy" class="landing-section landing-section--dark reveal">
        <div class="section-content split-section">
          <div class="split-text">
             <p class="eyebrow">Local Only</p>
             <h2 class="section-title">Stays on your device.</h2>
             <p class="section-desc">Kisap does not need an account, gallery, or upload. Everything is processed directly in your browser. An unfinished strip can be recovered privately for up to six hours, then it expires automatically.</p>
          </div>
          <div class="split-visual">
             <div class="privacy-shield">
               <span class="privacy-light privacy-light--live" style="width:16px;height:16px;display:inline-block;margin-bottom:1rem;"></span>
               <h3>100% Private</h3>
               <p>No servers. No data collection. No uploads.</p>
             </div>
          </div>
        </div>
      </section>
      </main>

      <footer class="landing-footer">
        <div class="landing-footer-content footer-bottom">
          <div class="footer-product">
            <img src="/favicon.svg" alt="" width="42" height="42">
            <div>
              <strong>kisap<span class="signal-dot">.</span></strong>
              <span>A private web photo booth.</span>
            </div>
          </div>
          <p class="footer-credit">Built and designed by <strong>BRYAN JHADE EBUAN</strong></p>
          <div class="footer-right">
            <div class="footer-meta">
              <span>© ${new Date().getFullYear()} Kisap</span>
              <span aria-hidden="true">·</span>
              <a href="https://github.com/codebyjhade/kisap" target="_blank" rel="noreferrer">Source on GitHub</a>
            </div>
            <div class="footer-actions">
              ${showInstall ? `<button class="text-button footer-install" data-install-open>Install Kisap</button>` : ""}
              <a class="text-button" href="/privacy.html">Privacy</a>
              <button class="button button--ghost footer-start" data-start-session>Start now</button>
            </div>
          </div>
        </div>
      </footer>
      ${installDialogMarkup()}
    </div>
  `;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function cameraPickerMarkup(active) {
  if (!active || !appState.cameras.length) return "";
  return `
    <label class="camera-picker">
      <span>Camera</span>
      <select data-camera-select aria-label="Choose camera" ${appState.busy ? "disabled" : ""}>
        ${appState.cameras.map((camera, index) => `
          <option value="${escapeHtml(camera.deviceId)}" ${camera.deviceId === appState.selectedCameraId ? "selected" : ""}>
            ${escapeHtml(camera.label || `Camera ${index + 1}`)}
          </option>
        `).join("")}
      </select>
    </label>
  `;
}

function captureScreen() {
  const number = appState.activeMoment + 1;
  const active = cameraIsActive();
  const capturedCount = appState.moments.filter(Boolean).length;
  const actionLabel = active ? (appState.retaking ? `Retake moment ${number}` : `Capture moment ${number}`) : "Turn on camera";

  return `
    <main class="workflow-page page-shell">
      <section class="workflow-heading">
        <p class="eyebrow">Moment ${String(number).padStart(2, "0")} of 04</p>
        <h1>${appState.retaking ? "Make it feel" : "Ready when"}<br>${appState.retaking ? "right." : "you are."}</h1>
        <p>The ten-second countdown is also your motion capture. Move, pose, laugh—the final frame becomes your photo.</p>
        ${appState.notice ? `<p class="capture-notice" role="status">${appState.notice}</p>` : ""}
        ${appState.cameraError ? `<p class="capture-error" role="alert">${appState.cameraError}</p>` : ""}
      </section>
      <section class="camera-stage ${active ? "camera-stage--live" : "camera-stage--inactive"}" aria-label="Camera preview">
        <video id="camera-feed" class="camera-feed" autoplay muted playsinline></video>
        <div class="capture-flash" aria-hidden="true"></div>
        <div class="capture-progress" aria-hidden="true"><span id="capture-progress-bar"></span></div>
        <div class="camera-message ${active ? "camera-message--ready" : ""}">
          <span id="capture-kicker">${active ? "Camera ready" : "Camera is off"}</span>
          <strong id="capture-countdown">${active ? "10" : "—"}</strong>
          <p id="capture-status">${active ? "Recording begins when you press capture." : "Turn it on when you are ready. No audio is requested."}</p>
        </div>
        <div class="camera-meta">
          <span id="recording-state">${active ? "READY · 10 SEC" : "LOCAL CAMERA"}</span>
          <div style="display:flex; gap:10px; align-items:center;">
            <span>NO AUDIO</span>
          </div>
        </div>
      </section>
      <div class="workflow-actions capture-controls" data-capture-controls>
        <button class="button button--ghost" data-nav="${capturedCount ? "review" : "home"}">${capturedCount ? "Back to review" : "Back"}</button>
        <div class="capture-control-bar">
          <div data-camera-picker>${cameraPickerMarkup(active)}</div>
          <button class="capture-option" data-toggle-sound aria-pressed="${appState.soundEnabled}" title="Toggle countdown sounds">Sound ${appState.soundEnabled ? "on" : "off"}</button>
          <button class="capture-option" data-toggle-flash aria-pressed="${appState.flashEnabled}" title="Toggle screen flash">Flash ${appState.flashEnabled ? "on" : "off"}</button>
          <button class="button button--light" ${appState.busy ? "disabled" : ""} ${active ? "data-capture-moment" : "data-enable-camera"}>${actionLabel} <span aria-hidden="true">→</span></button>
        </div>
        <p class="capture-shortcut">Press Space or Enter to capture · compatible remotes supported</p>
      </div>
    </main>
  `;
}

function momentCard(index) {
  const moment = appState.moments[index - 1];

  if (!moment) {
    return `
      <article class="moment-card moment-card--empty">
        <div class="moment-number">${String(index).padStart(2, "0")}</div>
        <div><h2>Moment ${index}</h2><p>Waiting for capture</p></div>
        <span class="moment-duration">10 sec</span>
      </article>
    `;
  }

  return `
    <article class="moment-card moment-card--captured">
      <div class="moment-media" style="position: relative;">
        <img src="${moment.stillUrl}" alt="Photo for moment ${index}">
        <span style="position: relative; z-index: 2;">final frame</span>
      </div>
      <div class="moment-card-copy">
        <div><span class="moment-number">${String(index).padStart(2, "0")}</span><h2>Moment ${index}</h2></div>
        <div class="moment-card-actions">
          <button class="mini-button" data-retake="${index - 1}">Retake</button>
        </div>
      </div>
    </article>
  `;
}

function reviewScreen() {
  const complete = appState.moments.every(Boolean);
  return `
    <main class="workflow-page workflow-page--wide page-shell">
      <section class="workflow-heading workflow-heading--compact">
        <p class="eyebrow">Review</p>
        <h1>Four chances<br>to feel right.</h1>
        <p>Every retake replaces both the photo and its GIF immediately, so unused media never piles up.</p>
      </section>
      <section class="moments-grid" aria-label="Captured moments">
        ${[1, 2, 3, 4].map(momentCard).join("")}
      </section>
      <div class="workflow-actions workflow-actions--full">
        <button class="button button--ghost" data-capture-next>${complete ? "Capture again" : "Capture remaining"}</button>
        <button class="button ${complete ? "button--light" : "button--disabled"}" ${complete ? "data-nav=\"edit\"" : "disabled"}>Continue to editor <span aria-hidden="true">→</span></button>
      </div>
    </main>
  `;
}

function editorScreen() {
  return `
    <main class="editor-page page-shell">
      <section class="editor-preview">
        <div class="preview-label"><span>Live preview</span><span>1200 × 1800</span></div>
        ${stripDiagram({ editable: true })}
        <p class="preview-help">Edit the first strip. The second is an exact copy of the complete Kisap design.</p>
      </section>
      <aside class="editor-panel">
        <div>
          <p class="eyebrow">Make it yours</p>
          <h1>Keep it simple.</h1>
          <p>Edits are applied once and repeated perfectly on both complete strips.</p>
        </div>
        <fieldset>
          <legend>Filter</legend>
          <div class="choice-row" data-choice-group="filter">
            ${["original", "mono", "warm", "cool", "vintage"].map(value => `<button class="choice ${appState.filter === value ? "is-selected" : ""}" data-filter="${value}" aria-pressed="${appState.filter === value}">${value}</button>`).join("")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Background</legend>
          <div class="swatch-row" data-choice-group="background">
            ${[
              ["black", "#0b0b0b"],
              ["paper", "#f4f1ea"],
              ["red", "#9e312b"],
              ["blue", "#26364a"],
              ["sage", "#66705f"],
            ].map(([name, color]) => `<button class="swatch ${appState.background === name ? "is-selected" : ""}" style="--swatch:${color}" data-background="${name}" aria-label="${name} background" aria-pressed="${appState.background === name}"></button>`).join("")}
          </div>
        </fieldset>
        <fieldset>
          <legend>Stickers</legend>
          <div class="sticker-tray" aria-label="Add a sticker">
            ${STICKER_CATALOG.map((sticker) => `<button class="sticker-choice" data-add-sticker="${sticker.id}" aria-label="Add ${sticker.label} sticker" ${appState.stickers.length >= 6 ? "disabled" : ""}><span>${sticker.glyph}</span><small>${sticker.label}</small></button>`).join("")}
          </div>
          <div data-sticker-controls>${stickerControls()}</div>
        </fieldset>
        <div class="editor-actions">
          <button class="button button--ghost" data-nav="review">Back</button>
          <button class="button button--light" data-nav="finish">Preview finish <span aria-hidden="true">→</span></button>
        </div>
      </aside>
    </main>
  `;
}

function finishScreen() {
  const shareLabel = browserMayShareFiles() ? "Share photo" : "Save photo";
  return `
    <main class="finish-page page-shell">
      <section class="finish-card">
        <p class="eyebrow">Your kisap</p>
        <h1>Made here.<br><em>Kept by you.</em></h1>
        <p>Your four moments are ready. Keep one strip, download a seamless double, or save the animated version—everything stays on this device.</p>
        <div class="finish-actions">
          <button class="button button--light" id="btn-download-double">Download double strip</button>
          <button class="button button--ghost" id="btn-download-single">Download single strip</button>
          <button class="button button--light" id="btn-download-motion">Download motion</button>
          <button class="button button--ghost" id="btn-share-photo">${shareLabel}</button>
        </div>
        <p class="finish-status" id="finish-status" role="status" aria-live="polite"></p>
        <div class="finish-links">
          <button class="text-button" data-nav="edit">← Back to editor</button>
          <button class="text-button" data-start-session>Start another strip</button>
        </div>
      </section>
      <aside class="privacy-panel">
        <span class="privacy-index">LOCAL / 002</span>
        <h2>Your moments stay on this device.</h2>
        <p>Kisap does not need an account, gallery, or upload. Unfinished moments stay only in this browser for recovery and expire after six hours. Starting another strip or exporting clears that recovery copy.</p>
      </aside>
    </main>
  `;
}

function browserMayShareFiles() {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array([0])], "kisap-share-check.jpg", { type: "image/jpeg" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function setFinishStatus(message, tone = "neutral") {
  const status = document.querySelector("#finish-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

const screens = { home: homeScreen, capture: captureScreen, review: reviewScreen, edit: editorScreen, finish: finishScreen };

function bindInteractions() {
  document.querySelectorAll("[data-nav]").forEach((element) => {
    element.addEventListener("click", () => navigate(element.dataset.nav));
  });

  document.querySelectorAll("[data-start-session]").forEach((element) => {
    element.addEventListener("click", () => {
      resetSession();
      navigate("capture");
    });
  });

  document.querySelectorAll("[data-install-open]").forEach((element) => {
    element.addEventListener("click", () => {
      installDialogOpen = true;
      render();
      window.requestAnimationFrame(() => document.querySelector("[data-install-native], [data-install-close]")?.focus());
    });
  });

  document.querySelectorAll("[data-install-close]").forEach((element) => {
    element.addEventListener("click", closeInstallDialog);
  });
  document.querySelector("[data-install-dialog]")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeInstallDialog();
  });
  document.querySelector("[data-install-native]")?.addEventListener("click", promptInstall);

  document.querySelector("[data-resume-session]")?.addEventListener("click", () => {
    appState.recoveryAvailable = false;
    appState.notice = "Your private session was restored on this device.";
    navigate(recoveryResumeTarget());
  });

  document.querySelector("[data-discard-recovery]")?.addEventListener("click", () => {
    resetSession();
    render();
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-visible');
      }
    });
  }, { threshold: 0.15 });
  
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

  document.querySelector("[data-enable-camera]")?.addEventListener("click", enableCamera);
  document.querySelector("[data-camera-select]")?.addEventListener("change", selectCamera);
  document.querySelector("[data-capture-moment]")?.addEventListener("click", runCapture);
  document.querySelector("[data-toggle-sound]")?.addEventListener("click", toggleCaptureSound);
  document.querySelector("[data-toggle-flash]")?.addEventListener("click", toggleCaptureFlash);

  document.querySelector("#btn-download-double")?.addEventListener("click", () => exportStrip("photo-double"));
  document.querySelector("#btn-download-single")?.addEventListener("click", () => exportStrip("photo-single"));
  document.querySelector("#btn-download-motion")?.addEventListener("click", () => exportStrip("motion"));
  document.querySelector("#btn-share-photo")?.addEventListener("click", () => exportStrip("share"));

  document.querySelectorAll("[data-retake]").forEach((element) => {
    element.addEventListener("click", () => {
      appState.activeMoment = Number(element.dataset.retake);
      appState.retaking = true;
      appState.notice = "The old files will be replaced as soon as this retake is saved.";
      navigate("capture");
    });
  });

  document.querySelector("[data-capture-next]")?.addEventListener("click", () => {
    const emptyIndex = appState.moments.findIndex((moment) => !moment);
    appState.activeMoment = emptyIndex === -1 ? 0 : emptyIndex;
    appState.retaking = emptyIndex === -1;
    appState.notice = "";
    navigate("capture");
  });

  document.querySelectorAll("[data-filter]").forEach((element) => {
    element.addEventListener("click", () => updateEditorChoice("filter", element.dataset.filter));
  });

  document.querySelectorAll("[data-background]").forEach((element) => {
    element.addEventListener("click", () => updateEditorChoice("background", element.dataset.background));
  });

  document.querySelectorAll("[data-add-sticker]").forEach((element) => {
    element.addEventListener("click", () => addSticker(element.dataset.addSticker));
  });

  bindStickerInteractions();
}

function closeInstallDialog() {
  installDialogOpen = false;
  render();
  window.requestAnimationFrame(() => document.querySelector("[data-install-open]")?.focus());
}

async function promptInstall() {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  try {
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
  } finally {
    deferredInstallPrompt = null;
    installDialogOpen = false;
    render();
  }
}

function stickerControls() {
  const sticker = selectedSticker();
  if (!sticker) return `<p class="control-note">Add up to six. Placement and size are mirrored automatically.</p>`;
  return `
    <div class="sticker-tools">
      <span data-selected-sticker-label>${sticker.label} selected</span>
      <button data-resize-sticker="smaller" aria-label="Make sticker smaller">−</button>
      <button data-resize-sticker="larger" aria-label="Make sticker larger">+</button>
      <button data-remove-sticker>Remove</button>
    </div>
    <p class="control-note">Drag it directly on the left strip to place it.</p>
  `;
}

function bindStickerInteractions() {
  document.querySelectorAll("[data-sticker-id]").forEach((element) => {
    element.addEventListener("pointerdown", beginStickerDrag);
    element.addEventListener("click", () => selectSticker(Number(element.dataset.stickerId)));
  });
  document.querySelectorAll("[data-resize-sticker]").forEach((element) => {
    element.addEventListener("click", () => resizeSelectedSticker(element.dataset.resizeSticker === "larger" ? 0.15 : -0.15));
  });
  document.querySelector("[data-remove-sticker]")?.addEventListener("click", removeSelectedSticker);
}

function updateStickerEditor() {
  document.querySelectorAll(".strip-stickers").forEach((layer, index) => {
    layer.innerHTML = appState.stickers.map((sticker) => `
      <button
        class="placed-sticker ${index === 0 && sticker.id === appState.selectedStickerId ? "is-selected" : ""}"
        style="--sticker-x:${sticker.x}%;--sticker-y:${sticker.y}%;--sticker-scale:${sticker.scale}"
        ${index === 0
          ? `data-sticker-id="${sticker.id}" aria-label="Move ${sticker.label} sticker"`
          : `data-mirror-sticker-id="${sticker.id}" tabindex="-1" aria-hidden="true"`}
      >${sticker.glyph}</button>
    `).join("");
  });
  document.querySelectorAll("[data-add-sticker]").forEach((button) => {
    button.disabled = appState.stickers.length >= 6;
  });
  const controls = document.querySelector("[data-sticker-controls]");
  if (controls) controls.innerHTML = stickerControls();
  bindStickerInteractions();
}

function updateEditorChoice(kind, value) {
  if (appState[kind] === value) return;
  appState[kind] = value;
  const app = document.querySelector("#app");
  if (app) app.dataset[kind] = value;
  document.querySelectorAll(`[data-${kind}]`).forEach((element) => {
    const selected = element.dataset[kind] === value;
    element.classList.toggle("is-selected", selected);
    element.setAttribute("aria-pressed", String(selected));
  });
  queueRecoverySave();
}



function addSticker(catalogId) {
  if (appState.stickers.length >= 6) {
    appState.notice = "Six stickers is the limit for a clean strip.";
    return;
  }
  const catalogSticker = STICKER_CATALOG.find((sticker) => sticker.id === catalogId);
  if (!catalogSticker) return;
  const id = Date.now();
  const offset = appState.stickers.length * 4;
  appState.stickers.push({ ...catalogSticker, id, x: 50 + offset, y: 42 + offset, scale: 1 });
  appState.selectedStickerId = id;
  updateStickerEditor();
  queueRecoverySave();
}

function selectedSticker() {
  return appState.stickers.find((sticker) => sticker.id === appState.selectedStickerId);
}

function resizeSelectedSticker(change) {
  const sticker = selectedSticker();
  if (!sticker) return;
  sticker.scale = Math.min(2, Math.max(0.65, Number((sticker.scale + change).toFixed(2))));
  document.querySelectorAll(`[data-sticker-id="${sticker.id}"], [data-mirror-sticker-id="${sticker.id}"]`).forEach((element) => {
    element.style.setProperty("--sticker-scale", sticker.scale);
  });
  queueRecoverySave();
}

function removeSelectedSticker() {
  appState.stickers = appState.stickers.filter((sticker) => sticker.id !== appState.selectedStickerId);
  appState.selectedStickerId = null;
  updateStickerEditor();
  queueRecoverySave();
}

function beginStickerDrag(event) {
  event.preventDefault();
  const id = Number(event.currentTarget.dataset.stickerId);
  selectSticker(id);
  const column = event.currentTarget.closest(".diagram-column");
  if (!column) return;
  const bounds = column.getBoundingClientRect();
  const targets = document.querySelectorAll(`[data-sticker-id="${id}"], [data-mirror-sticker-id="${id}"]`);
  let nextPosition = null;
  let frame = 0;

  const move = (moveEvent) => {
    nextPosition = {
      x: Math.min(92, Math.max(8, ((moveEvent.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(86, Math.max(5, ((moveEvent.clientY - bounds.top) / bounds.height) * 100)),
    };
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const sticker = appState.stickers.find((item) => item.id === id);
      if (!sticker || !nextPosition) return;
      sticker.x = nextPosition.x;
      sticker.y = nextPosition.y;
      targets.forEach((placed) => {
        placed.style.setProperty("--sticker-x", `${sticker.x}%`);
        placed.style.setProperty("--sticker-y", `${sticker.y}%`);
      });
    });
  };
  const end = (upEvent) => {
    if (upEvent) move(upEvent);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.requestAnimationFrame(() => queueRecoverySave());
  };
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", end, { once: true });
  window.addEventListener("pointercancel", end, { once: true });
}

function selectSticker(id) {
  if (appState.selectedStickerId === id) return;
  appState.selectedStickerId = id;
  document.querySelectorAll("[data-sticker-id]").forEach((element) => {
    element.classList.toggle("is-selected", Number(element.dataset.stickerId) === id);
  });
  
  const sticker = selectedSticker();
  const label = document.querySelector("[data-selected-sticker-label]");
  if (label && sticker) {
    label.textContent = `${sticker.label} selected`;
  } else if (sticker) {
    const controls = document.querySelector("[data-sticker-controls]");
    if (controls) {
      controls.innerHTML = stickerControls();
      document.querySelectorAll("[data-resize-sticker]").forEach((element) => {
        element.addEventListener("click", () => resizeSelectedSticker(element.dataset.resizeSticker === "larger" ? 0.15 : -0.15));
      });
      document.querySelector("[data-remove-sticker]")?.addEventListener("click", removeSelectedSticker);
    }
  }
}

async function enableCamera() {
  const button = document.querySelector("[data-enable-camera]");
  const status = document.querySelector("#capture-status");
  const stage = document.querySelector(".camera-stage");
  const kicker = document.querySelector("#capture-kicker");
  if (button) button.disabled = true;
  stage?.classList.remove("camera-stage--inactive");
  stage?.classList.add("camera-stage--connecting");
  if (kicker) kicker.textContent = "Connecting camera";
  if (status) status.textContent = "Waiting for the first video frame…";
  appState.cameraError = "";
  appState.notice = "";

  try {
    await startCamera(document.querySelector("#camera-feed"), appState.selectedCameraId);
    
    // Refresh after permission so labels and newly connected cameras are available.
    appState.cameras = await getAvailableCameras();
    const track = document.querySelector("#camera-feed")?.srcObject?.getVideoTracks()[0];
    const activeDeviceId = track?.getSettings?.().deviceId;
    const activeCamera = appState.cameras.find((camera) => (
      camera.deviceId === activeDeviceId || camera.label === track?.label
    ));
    if (activeCamera) appState.selectedCameraId = activeCamera.deviceId;
    else if (!appState.selectedCameraId && appState.cameras.length) appState.selectedCameraId = appState.cameras[0].deviceId;
    
    appState.notice = "Camera ready. Your ten seconds begin when you press capture.";
    showCameraReady();
    return;
  } catch (error) {
    appState.cameraError = cameraErrorMessage(error);
  }

  render();
}

async function selectCamera(event) {
  if (appState.busy) return;
  const nextDeviceId = event.currentTarget.value;
  if (!nextDeviceId || nextDeviceId === appState.selectedCameraId) return;
  appState.selectedCameraId = nextDeviceId;
  event.currentTarget.disabled = true;
  const status = document.querySelector("#capture-status");
  if (status) status.textContent = "Switching to the selected camera…";
  
  try {
    await startCamera(document.querySelector("#camera-feed"), appState.selectedCameraId);
    showCameraReady();
  } catch (error) {
    appState.cameraError = cameraErrorMessage(error);
    render();
  }
}

function updateCameraPicker() {
  const host = document.querySelector("[data-camera-picker]");
  if (!host) return;
  host.innerHTML = cameraPickerMarkup(cameraIsActive());
  host.querySelector("[data-camera-select]")?.addEventListener("change", selectCamera);
}

function toggleCaptureSound(event) {
  appState.soundEnabled = !appState.soundEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(appState.soundEnabled));
  event.currentTarget.textContent = `Sound ${appState.soundEnabled ? "on" : "off"}`;
  if (appState.soundEnabled) {
    getFeedbackAudioContext();
    playTone(720, 0.08, { gain: 0.02, type: "triangle" });
  }
}

function toggleCaptureFlash(event) {
  appState.flashEnabled = !appState.flashEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(appState.flashEnabled));
  event.currentTarget.textContent = `Flash ${appState.flashEnabled ? "on" : "off"}`;
}

function showCameraReady() {
  const stage = document.querySelector(".camera-stage");
  const message = document.querySelector(".camera-message");
  const kicker = document.querySelector("#capture-kicker");
  const countdown = document.querySelector("#capture-countdown");
  const status = document.querySelector("#capture-status");
  const recordingState = document.querySelector("#recording-state");
  const privacy = document.querySelector(".privacy-mark");
  const button = document.querySelector("[data-enable-camera]");

  stage?.classList.remove("camera-stage--inactive");
  stage?.classList.remove("camera-stage--connecting");
  stage?.classList.add("camera-stage--live");
  message?.classList.add("camera-message--ready");
  if (kicker) kicker.textContent = "Camera ready";
  if (countdown) countdown.textContent = "10";
  if (status) status.textContent = "Recording begins when you press capture.";
  if (recordingState) recordingState.textContent = "READY · 10 SEC";
  if (privacy) privacy.innerHTML = '<span class="privacy-light privacy-light--live"></span> camera active · local only';
  updateCameraPicker();

  if (button) {
    button.disabled = false;
    button.removeAttribute("data-enable-camera");
    button.setAttribute("data-capture-moment", "");
    button.removeEventListener("click", enableCamera);
    button.innerHTML = `${appState.retaking ? `Retake moment ${appState.activeMoment + 1}` : `Capture moment ${appState.activeMoment + 1}`} <span aria-hidden="true">→</span>`;
    button.addEventListener("click", runCapture);
  }
}

async function triggerFinalStillFeedback() {
  setCaptureUi("still", 0);
  playShutterSound();
  vibrate([45, 30, 70]);
  const flash = document.querySelector(".capture-flash");
  if (!appState.flashEnabled || !flash) return;
  flash.classList.add("is-visible");
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  window.setTimeout(() => flash.classList.remove("is-visible"), 180);
}

async function runCapture() {
  if (appState.busy) return;
  getFeedbackAudioContext();
  appState.busy = true;
  appState.cameraError = "";
  captureController = new AbortController();
  document.querySelector("#app")?.classList.add("is-capturing");
  document.querySelector("[data-capture-controls]")?.classList.add("capture-controls--hidden");
  vibrate(35);
  setCaptureUi("recording", 10);

  try {
    const result = await captureMoment(document.querySelector("#camera-feed"), {
      onTick: (seconds) => setCaptureUi("recording", seconds),
      onFinalStill: triggerFinalStillFeedback,
      onEncoding: () => setCaptureUi("encoding"),
      signal: captureController.signal,
    });

    captureController = null;

    replaceMoment(appState.activeMoment, result);
    const capturedNumber = appState.activeMoment + 1;

    if (appState.retaking || appState.moments.every(Boolean)) {
      appState.previewingMoment = appState.activeMoment;
      appState.retaking = false;
      appState.notice = `Moment ${capturedNumber} saved.`;
      appState.busy = false;
      queueRecoverySave();
      navigate("review");
      return;
    }

    appState.activeMoment = appState.moments.findIndex((moment) => !moment);
    appState.notice = `Moment ${capturedNumber} saved. Ready for the next one.`;
    appState.busy = false;
    queueRecoverySave();
    render();
  } catch (error) {
    captureController = null;
    appState.busy = false;
    if (error?.name === "AbortError") return;
    appState.cameraError = error instanceof Error ? error.message : "Capture failed. Please try again.";
    if (!cameraIsActive()) {
      appState.notice = "";
      stopCamera();
    }
    render();
  }
}

function setCaptureUi(mode, seconds = 10) {
  const countdown = document.querySelector("#capture-countdown");
  const status = document.querySelector("#capture-status");
  const kicker = document.querySelector("#capture-kicker");
  const recordingState = document.querySelector("#recording-state");
  const stage = document.querySelector(".camera-stage");
  const progress = document.querySelector("#capture-progress-bar");

  if (mode === "recording") {
    stage?.classList.add("is-recording");
    stage?.classList.remove("is-capturing-still", "is-encoding");
    stage?.classList.toggle("is-final-countdown", seconds > 0 && seconds <= 3);
    if (countdown) countdown.textContent = String(seconds);
    if (kicker) kicker.textContent = seconds <= 3 ? "Final photo" : "Recording motion";
    if (status) status.textContent = seconds > 3
      ? "Keep moving—your ten-second motion is recording."
      : seconds > 0 ? `Final still in ${seconds}. Hold your pose.` : "Capturing your final still.";
    if (recordingState) recordingState.textContent = seconds <= 3 ? `STILL IN ${seconds}` : "REC · MOTION";
    if (progress) progress.style.width = `${(10 - seconds) * 10}%`;
    playCountdownTick(seconds);
  } else if (mode === "still") {
    stage?.classList.remove("is-recording", "is-final-countdown", "is-encoding");
    stage?.classList.add("is-capturing-still");
    if (countdown) countdown.textContent = "●";
    if (kicker) kicker.textContent = "Photo captured";
    if (status) status.textContent = "That final frame is your still photo.";
    if (recordingState) recordingState.textContent = "STILL · CAPTURED";
    if (progress) progress.style.width = "100%";
  } else {
    stage?.classList.remove("is-recording", "is-final-countdown", "is-capturing-still");
    stage?.classList.add("is-encoding");
    if (countdown) countdown.textContent = "···";
    if (kicker) kicker.textContent = "Saving your moment";
    if (status) status.textContent = "Saving the photo and motion locally.";
    if (recordingState) recordingState.textContent = "ENCODING · LOCAL";
    if (progress) progress.style.width = "100%";
  }
}

function replaceMoment(index, { stillBlob, videoBlob, mirrored = true }) {
  releaseMoment(appState.moments[index]);
  appState.moments[index] = {
    stillBlob,
    videoBlob,
    mirrored,
    stillUrl: URL.createObjectURL(stillBlob),
    videoUrl: URL.createObjectURL(videoBlob),
  };
}

function releaseMoment(moment) {
  if (!moment) return;
  URL.revokeObjectURL(moment.stillUrl);
  URL.revokeObjectURL(moment.videoUrl);
}

function resetSession() {
  captureController?.abort();
  captureController = null;
  stopCamera();
  appState.moments.forEach(releaseMoment);
  appState.moments = [null, null, null, null];
  appState.activeMoment = 0;
  appState.previewingMoment = null;
  appState.retaking = false;
  appState.cameraError = "";
  appState.notice = "";
  appState.busy = false;
  appState.background = "black";
  appState.filter = "mono";
  appState.stickers = [];
  appState.selectedStickerId = null;
  appState.recoveryAvailable = false;
  appState.recoveryUpdatedAt = 0;
  queueRecoveryClear();
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "Camera access was not allowed. Use your browser controls to allow it, then try again.";
  if (error?.name === "NotFoundError") return "No camera was found on this device.";
  if (error?.name === "NotReadableError") return "The camera is already being used by another app.";
  return error instanceof Error ? error.message : "The camera could not be started.";
}

function render() {
  const app = document.querySelector("#app");
  document.body.classList.toggle("install-dialog-open", installDialogOpen);
  app.classList.remove("is-capturing");
  app.dataset.screen = appState.screen;
  app.dataset.filter = appState.filter;
  app.dataset.background = appState.background;
  document.title = SCREEN_TITLES[appState.screen] || SCREEN_TITLES.home;

  if (appState.screen === "home") {
    app.innerHTML = screens.home();
  } else {
    app.innerHTML = `
      ${appHeader()}
      ${progressRail()}
      ${screens[appState.screen]()}
      <footer class="site-footer">
        <span>kisap. / private web photo booth</span>
        <span>phase 03 · capture experience</span>
      </footer>
    `;
  }
  bindInteractions();

  if (appState.screen === "capture" && cameraIsActive()) {
    attachCamera(document.querySelector("#camera-feed")).catch((error) => {
      appState.cameraError = cameraErrorMessage(error);
      stopCamera();
      render();
    });
  }
}

window.addEventListener("hashchange", () => {
  const nextScreen = getInitialScreen();
  if (nextScreen !== appState.screen) {
    if (appState.screen === "capture" && nextScreen !== "capture") {
      captureController?.abort();
      captureController = null;
      stopCamera();
    }
    appState.screen = nextScreen;
    render();
  }
});

window.addEventListener("beforeunload", () => {
  stopCamera();
  appState.moments.forEach(releaseMoment);
});

const EXPORT_LAYOUT = Object.freeze({
  height: 1800,
  doubleWidth: 1200,
  singleWidth: 600,
  stripWidth: 600,
  stripHeight: 1800,
  stripY: 0,
  doubleStripX: [0, 600],
  singleStripX: [0],
  photoInset: 36,
  photoStartY: 49,
  photoWidth: 528,
  photoHeight: 353,
  photoGap: 24,
  footerGap: 24,
});
const MOTION_EXPORT_FPS = 24;
const MOTION_EXPORT_BITRATE = 12_000_000;

function getMotionExportProfile() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 0;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  const isLowPower = cores <= 4 || (memory > 0 && memory <= 4);

  if (isLowPower) {
    return { fps: 15, bitrate: 5_000_000, filterScale: 0.55, label: "efficient" };
  }
  if (isMobile) {
    return { fps: 18, bitrate: 7_000_000, filterScale: 0.7, label: "mobile" };
  }
  return { fps: MOTION_EXPORT_FPS, bitrate: MOTION_EXPORT_BITRATE, filterScale: 1, label: "full" };
}

const EXPORT_COLORS = Object.freeze({
  black: "#0b0b0b",
  paper: "#f4f1ea",
  red: "#9e312b",
  blue: "#26364a",
  sage: "#66705f",
});

const EXPORT_FRAME_COLORS = Object.freeze({
  original: "#050505",
  mono: "#2b2b29",
  warm: "#554940",
  cool: "#3c4650",
  vintage: "#4b4839",
});

const EXPORT_FILTERS = Object.freeze({
  original: "none",
  mono: "grayscale(100%) contrast(105%)",
  warm: "sepia(30%) saturate(118%) contrast(102%)",
  cool: "saturate(82%) hue-rotate(174deg) contrast(104%)",
  vintage: "sepia(58%) saturate(82%) contrast(92%)",
});

function clampColor(value) {
  return Math.max(0, Math.min(255, value));
}

function applyPortableFilter(imageData, filterName) {
  if (!filterName || filterName === "original") return imageData;
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index];
    let green = pixels[index + 1];
    let blue = pixels[index + 2];

    if (filterName === "mono") {
      const gray = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red = green = blue = gray;
      red = (red - 128) * 1.05 + 128;
      green = (green - 128) * 1.05 + 128;
      blue = (blue - 128) * 1.05 + 128;
    } else if (filterName === "warm" || filterName === "vintage") {
      const amount = filterName === "warm" ? 0.3 : 0.58;
      const sepiaRed = red * 0.393 + green * 0.769 + blue * 0.189;
      const sepiaGreen = red * 0.349 + green * 0.686 + blue * 0.168;
      const sepiaBlue = red * 0.272 + green * 0.534 + blue * 0.131;
      red += (sepiaRed - red) * amount;
      green += (sepiaGreen - green) * amount;
      blue += (sepiaBlue - blue) * amount;
      const saturation = filterName === "warm" ? 1.18 : 0.82;
      const contrast = filterName === "warm" ? 1.02 : 0.92;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red = (luminance + (red - luminance) * saturation - 128) * contrast + 128;
      green = (luminance + (green - luminance) * saturation - 128) * contrast + 128;
      blue = (luminance + (blue - luminance) * saturation - 128) * contrast + 128;
    } else if (filterName === "cool") {
      // A portable cool grade that visually matches the CSS preview without
      // depending on CanvasRenderingContext2D.filter (unreliable on Safari).
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red = luminance + (red - luminance) * 0.82;
      green = luminance + (green - luminance) * 0.82;
      blue = luminance + (blue - luminance) * 0.82;
      red = (red * 0.9 - 128) * 1.04 + 128;
      green = (green * 1.01 - 128) * 1.04 + 128;
      blue = (blue * 1.13 - 128) * 1.04 + 128;
    }

    pixels[index] = clampColor(red);
    pixels[index + 1] = clampColor(green);
    pixels[index + 2] = clampColor(blue);
  }
  return imageData;
}

let exportFontsReady;

function waitForExportFonts() {
  exportFontsReady ||= document.fonts?.ready || Promise.resolve();
  return exportFontsReady;
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A captured photo could not be loaded for export."));
    image.src = src;
  });
}

async function resolveExportMedia(mediaElements) {
  if (mediaElements) return mediaElements;
  return Promise.all(appState.moments.map((moment) => (
    moment?.stillUrl ? loadCanvasImage(moment.stillUrl) : Promise.resolve(null)
  )));
}

function drawMediaCover(ctx, media, x, y, width, height) {
  const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
  const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
  if (!sourceWidth || !sourceHeight) return;

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  if (media.tagName === "VIDEO") {
    if (media.dataset.mirror !== "false") {
      ctx.save();
      ctx.translate(x + width, y);
      ctx.scale(-1, 1);
      ctx.drawImage(media, sx, sy, sw, sh, 0, 0, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(media, sx, sy, sw, sh, x, y, width, height);
    }
    return;
  }
  ctx.drawImage(media, sx, sy, sw, sh, x, y, width, height);
}

function drawSpacedText(ctx, text, x, y, spacing) {
  let cursor = x;
  for (const character of text) {
    ctx.fillText(character, cursor, y);
    cursor += ctx.measureText(character).width + spacing;
  }
}

function measureSpacedText(ctx, text, spacing) {
  return Array.from(text).reduce((width, character, index) => (
    width + ctx.measureText(character).width + (index ? spacing : 0)
  ), 0);
}

function drawPaperTexture(ctx, stripX, isPaper) {
  const { stripWidth, stripHeight, stripY } = EXPORT_LAYOUT;
  const sheen = ctx.createLinearGradient(stripX, stripY, stripX + stripWidth, stripY + stripHeight * 0.25);
  sheen.addColorStop(0, isPaper ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.035)");
  sheen.addColorStop(0.28, "rgba(255,255,255,0.008)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0)");
  sheen.addColorStop(1, isPaper ? "rgba(0,0,0,0.025)" : "rgba(0,0,0,0.11)");
  ctx.fillStyle = sheen;
  ctx.fillRect(stripX, stripY, stripWidth, stripHeight);

  let seed = 19;
  ctx.save();
  ctx.fillStyle = isPaper ? "rgba(11,11,11,0.035)" : "rgba(255,255,255,0.025)";
  for (let index = 0; index < 72; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = stripX + (seed / 2147483647) * stripWidth;
    seed = (seed * 16807) % 2147483647;
    const y = stripY + (seed / 2147483647) * stripHeight;
    const size = index % 5 === 0 ? 1.2 : 0.7;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();

}

function createFilteredFrame(media, width, height, cache, renderToken, filterScale = 1) {
  const scaledWidth = Math.max(1, Math.round(width * filterScale));
  const scaledHeight = Math.max(1, Math.round(height * filterScale));
  let cached = cache.get(media);
  const cacheMatches = cached
    && cached.width === scaledWidth
    && cached.height === scaledHeight
    && cached.filter === appState.filter;

  if (!cacheMatches) {
    const frame = document.createElement("canvas");
    frame.width = scaledWidth;
    frame.height = scaledHeight;
    cached = {
      frame,
      width: scaledWidth,
      height: scaledHeight,
      filter: appState.filter,
      renderToken: null,
      ready: false,
    };
    cache.set(media, cached);
  }

  const isVideo = media.tagName === "VIDEO";
  if (cached.ready && !isVideo) return cached.frame;
  if (cached.ready && isVideo && cached.renderToken === renderToken) return cached.frame;

  const { frame } = cached;
  const frameContext = frame.getContext("2d", { willReadFrequently: true });
  frameContext.clearRect(0, 0, scaledWidth, scaledHeight);
  drawMediaCover(frameContext, media, 0, 0, scaledWidth, scaledHeight);
  if (appState.filter !== "original") {
    const pixels = frameContext.getImageData(0, 0, scaledWidth, scaledHeight);
    frameContext.putImageData(applyPortableFilter(pixels, appState.filter), 0, 0);
  }
  cached.ready = true;
  cached.renderToken = renderToken;
  return frame;
}

function drawExportFrame(ctx, media, index, x, y, filteredFrames, renderToken, filterScale) {
  const { photoWidth, photoHeight } = EXPORT_LAYOUT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, photoWidth, photoHeight);
  ctx.clip();
  ctx.fillStyle = EXPORT_FRAME_COLORS[appState.filter] || EXPORT_FRAME_COLORS.original;
  ctx.fillRect(x, y, photoWidth, photoHeight);

  if (media) {
    if (appState.filter === "original") {
      drawMediaCover(ctx, media, x, y, photoWidth, photoHeight);
    } else {
      const frame = createFilteredFrame(
        media,
        photoWidth,
        photoHeight,
        filteredFrames,
        renderToken,
        filterScale,
      );
      ctx.drawImage(frame, x, y, photoWidth, photoHeight);
    }
  }

  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;
  ctx.font = '500 17px "DM Mono", Consolas, monospace';
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(244,241,234,0.9)";
  ctx.fillText(String(index + 1).padStart(2, "0"), x + 29, y + photoHeight - 29);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(244,241,234,0.7)";
  ctx.fillText(media ? "captured" : "moment", x + photoWidth - 29, y + photoHeight - 29);
  ctx.restore();
}

function drawExportStrip(ctx, stripX, mediaElements, filteredFrames, renderToken, filterScale) {
  const layout = EXPORT_LAYOUT;
  const stripBottom = layout.stripY + layout.stripHeight;
  const photoX = stripX + layout.photoInset;
  const photoY = layout.stripY + layout.photoStartY;
  const photoStackHeight = layout.photoHeight * 4 + layout.photoGap * 3;
  const footerY = photoY + photoStackHeight + layout.footerGap;
  const footerHeight = stripBottom - footerY;
  const isPaper = appState.background === "paper";

  if (!appState.background || appState.background === "black") {
    const background = ctx.createLinearGradient(0, layout.stripY, 0, stripBottom);
    background.addColorStop(0, "#121212");
    background.addColorStop(1, "#040404");
    ctx.fillStyle = background;
  } else {
    ctx.fillStyle = EXPORT_COLORS[appState.background] || EXPORT_COLORS.black;
  }
  ctx.fillRect(stripX, layout.stripY, layout.stripWidth, layout.stripHeight);
  drawPaperTexture(ctx, stripX, isPaper);

  Array.from({ length: 4 }, (_, index) => mediaElements[index] || null).forEach((media, index) => {
    const frameY = photoY + index * (layout.photoHeight + layout.photoGap);
    drawExportFrame(ctx, media, index, photoX, frameY, filteredFrames, renderToken, filterScale);
  });

  ctx.save();
  ctx.fillStyle = isPaper ? "rgba(0,0,0,0.62)" : "rgba(255,255,255,0.58)";
  ctx.font = '500 15px "DM Mono", Consolas, monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const sideText = "KISAP / FOUR MOMENTS / 10S EACH";
  const sideTextWidth = measureSpacedText(ctx, sideText, 1.95);
  ctx.translate(stripX + 18, photoY + (photoStackHeight + sideTextWidth) / 2);
  ctx.rotate(-Math.PI / 2);
  drawSpacedText(ctx, sideText, 0, 0, 1.95);
  ctx.restore();

  ctx.save();
  ctx.textBaseline = "middle";
  ctx.font = '600 22px "Manrope", Arial, sans-serif';
  const baseText = "kisap";
  const dotText = ".";
  const baseWidth = ctx.measureText(baseText).width;
  const dotWidth = ctx.measureText(dotText).width;
  const stripCenter = stripX + layout.stripWidth / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = isPaper ? "#0b0b0b" : "#f4f1ea";
  const centeredBrandX = stripCenter - (baseWidth + dotWidth) / 2;
  ctx.fillText(baseText, centeredBrandX, footerY + footerHeight / 2 - 24);
  ctx.fillStyle = "#ff4d3d";
  ctx.fillText(dotText, centeredBrandX + baseWidth, footerY + footerHeight / 2 - 24);
  ctx.textAlign = "center";
  ctx.font = '400 15px "DM Mono", Consolas, monospace';
  ctx.fillStyle = isPaper ? "rgba(11,11,11,0.82)" : "rgba(244,241,234,0.74)";
  ctx.fillText(stripDate(), stripCenter, footerY + footerHeight / 2 + 31);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(photoX, photoY, layout.photoWidth, photoStackHeight);
  ctx.clip();
  for (const sticker of appState.stickers) {
    const stickerX = photoX + (sticker.x / 100) * layout.photoWidth;
    const stickerY = photoY + (sticker.y / 100) * photoStackHeight;
    const radius = 24 * sticker.scale;
    ctx.beginPath();
    ctx.arc(stickerX, stickerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(11,11,11,0.7)";
    ctx.fill();
    ctx.font = `${Math.round(28 * sticker.scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f1ea";
    ctx.fillText(sticker.glyph, stickerX, stickerY + 1);
  }
  ctx.restore();

}

function drawCombinedCenterBlend(ctx) {
  const center = EXPORT_LAYOUT.doubleWidth / 2;
  const blendWidth = 40;
  const baseColor = EXPORT_COLORS[appState.background] || EXPORT_COLORS.black;
  const blend = ctx.createLinearGradient(center - blendWidth / 2, 0, center + blendWidth / 2, 0);
  blend.addColorStop(0, "rgba(0,0,0,0)");
  blend.addColorStop(0.5, baseColor);
  blend.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalAlpha = appState.background === "paper" ? 0.12 : 0.2;
  ctx.fillStyle = blend;
  ctx.fillRect(center - blendWidth / 2, 0, blendWidth, EXPORT_LAYOUT.height);
  ctx.restore();
}

async function generateCanvas(ctxOut = null, videoElements = null, singleStrip = true, options = {}) {
  await waitForExportFonts();
  const mediaElements = await resolveExportMedia(videoElements);
  const width = singleStrip ? EXPORT_LAYOUT.singleWidth : EXPORT_LAYOUT.doubleWidth;
  const canvas = ctxOut ? null : document.createElement("canvas");
  if (canvas) {
    canvas.width = width;
    canvas.height = EXPORT_LAYOUT.height;
  }
  const ctx = ctxOut || canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, width, EXPORT_LAYOUT.height);
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, width, EXPORT_LAYOUT.height);

  const stripPositions = singleStrip ? EXPORT_LAYOUT.singleStripX : EXPORT_LAYOUT.doubleStripX;
  const filteredFrames = options.frameCache || new Map();
  const renderToken = options.renderToken || Symbol("export-frame");
  const filterScale = options.filterScale || 1;
  stripPositions.forEach((stripX) => drawExportStrip(
    ctx,
    stripX,
    mediaElements,
    filteredFrames,
    renderToken,
    filterScale,
  ));
  if (!singleStrip) drawCombinedCenterBlend(ctx);
  const isPaper = appState.background === "paper";
  ctx.strokeStyle = isPaper ? "rgba(11,11,11,0.14)" : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, EXPORT_LAYOUT.height - 1);
  return canvas;
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function loadPlaybackVideo(src, mirrored = true) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.dataset.mirror = String(mirrored);
    video.oncanplay = () => resolve(video);
    video.onerror = () => reject(new Error("A motion clip could not be loaded for export."));
    video.src = src;
    video.load();
  });
}

function downloadExportBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // iOS may keep reading the object URL after the download sheet appears.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function requestExportWakeLock() {
  if (!navigator.wakeLock?.request) return null;
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

async function exportStrip(type) {
  getFeedbackAudioContext();
  const btnDouble = document.querySelector("#btn-download-double");
  const btnSingle = document.querySelector("#btn-download-single");
  const btnMotion = document.querySelector("#btn-download-motion");
  const btnShare = document.querySelector("#btn-share-photo");

  const setBusy = (isBusy, label = "Downloading...") => {
    if (btnDouble) {
      btnDouble.disabled = isBusy;
      btnDouble.textContent = "Download double strip";
    }
    if (btnSingle) {
      btnSingle.disabled = isBusy;
      btnSingle.textContent = "Download single strip";
    }
    if (btnMotion) {
      btnMotion.disabled = isBusy;
      if (type === "motion" && isBusy) btnMotion.textContent = label;
      else if (type === "motion") btnMotion.textContent = "Download motion";
    }
    if (btnShare) {
      btnShare.disabled = isBusy;
      if (type === "share" && isBusy) btnShare.textContent = label;
      else if (type === "share") btnShare.textContent = browserMayShareFiles() ? "Share photo" : "Save photo";
    }
  };

  try {
    setFinishStatus("");
    setBusy(true, type === "share" ? "Preparing photo…" : "Downloading...");

    if (type === "photo-double" || type === "photo-single" || type === "share") {
      const singleStrip = type === "photo-single";
      const canvas = await generateCanvas(null, null, singleStrip);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("The photo could not be encoded.")),
        "image/jpeg",
        0.94,
      ));
      canvas.width = 1;
      canvas.height = 1;

      if (type === "share") {
        const file = new File([blob], `kisap-strip-${Date.now()}.jpg`, { type: "image/jpeg" });
        const canShareFile = typeof navigator.share === "function"
          && typeof navigator.canShare === "function"
          && navigator.canShare({ files: [file] });

        if (canShareFile) {
          try {
            await navigator.share({
              title: "My Kisap Photo Strip",
              text: "A moment, still moving.",
              files: [file],
            });
            setFinishStatus("Your Kisap is ready to share.", "success");
          } catch (error) {
            if (error?.name === "AbortError") {
              setFinishStatus("Sharing cancelled. Your Kisap is still here.");
              return;
            }
            downloadExportBlob(blob, file.name);
            setFinishStatus("Sharing was unavailable, so Kisap saved the photo instead.", "success");
          }
        } else {
          downloadExportBlob(blob, file.name);
          setFinishStatus("File sharing is unavailable in this browser, so Kisap saved the photo instead.", "success");
        }
      } else {
        const sizeLabel = singleStrip ? "single" : "double";
        downloadExportBlob(blob, `kisap-${sizeLabel}-strip-${Date.now()}.jpg`);
        setFinishStatus(`${singleStrip ? "Single" : "Double"} strip saved to your device.`, "success");
      }
      appState.recoveryAvailable = false;
      queueRecoveryClear();
      playReadyChime();
      vibrate([20, 35, 20]);
    } else if (type === "motion") {
      if (!window.MediaRecorder) throw new Error("Video export is not supported in this browser.");

      const profile = getMotionExportProfile();
      let wakeLock = null;
      const frameCache = new Map();

      const targetCanvas = document.createElement("canvas");
      targetCanvas.width = EXPORT_LAYOUT.singleWidth;
      targetCanvas.height = EXPORT_LAYOUT.height;
      const ctx = targetCanvas.getContext("2d", { alpha: false });
      if (typeof targetCanvas.captureStream !== "function") {
        throw new Error("Motion export is not supported in this browser.");
      }
      const stream = targetCanvas.captureStream(profile.fps);
      const canvasTrack = stream.getVideoTracks()[0];
      if (canvasTrack?.applyConstraints) {
        try {
          await canvasTrack.applyConstraints({ frameRate: profile.fps });
        } catch {
          // Canvas tracks already use the requested rate in browsers without constraints support.
        }
      }
      let recorder;
      try {
        recorder = createCompatibleVideoRecorder(stream, profile.bitrate);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };

      const recordingPromise = new Promise((resolve, reject) => {
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || chunks[0]?.type || "video/webm";
          resolve(new Blob(chunks, { type: mimeType }));
        };
        recorder.onerror = (event) => reject(event.error || new Error("Video encoding failed."));
      });
      recordingPromise.catch(() => {});

      wakeLock = await requestExportWakeLock();
      setBusy(true, "Encoding video...");
      let videos = [];
      try {
        videos = await Promise.all(appState.moments.map((moment) => {
          if (!moment?.videoUrl) throw new Error("All four moments must be captured before motion export.");
          return loadPlaybackVideo(moment.videoUrl, moment.mirrored);
        }));
        const photos = await Promise.all(appState.moments.map((moment) => {
          if (!moment?.stillUrl) throw new Error("All four moments must be captured before motion export.");
          return loadCanvasImage(moment.stillUrl);
        }));

        videos.forEach((video) => { video.currentTime = 0; });
        await Promise.all(videos.map((video) => video.play()));
        await generateCanvas(ctx, videos, true, {
          frameCache,
          filterScale: profile.filterScale,
          renderToken: 0,
        });
        await startVideoRecorder(recorder);

        const startedAt = performance.now();
        const frameInterval = 1_000 / profile.fps;
        let lastFrameAt = startedAt - frameInterval;
        let lastProgress = -1;
        let renderToken = 1;
        await new Promise((resolve, reject) => {
          const drawFrame = async (now) => {
            try {
              const elapsed = now - startedAt;
              if (elapsed >= 10_000) {
                resolve();
                return;
              }
              if (now - lastFrameAt >= frameInterval) {
                lastFrameAt = now;
                const progress = Math.min(99, Math.floor(elapsed / 100));
                if (progress >= lastProgress + 2) {
                  lastProgress = progress;
                  setBusy(true, `Encoding ${progress}%`);
                  setFinishStatus(`Preparing motion… ${progress}%`);
                }
                await generateCanvas(ctx, elapsed < 9_000 ? videos : photos, true, {
                  frameCache,
                  filterScale: profile.filterScale,
                  renderToken,
                });
                renderToken += 1;
              }
              window.requestAnimationFrame(drawFrame);
            } catch (error) {
              reject(error);
            }
          };
          window.requestAnimationFrame(drawFrame);
        });

        setBusy(true, "Finishing video…");
        setFinishStatus("Preparing motion… 100%");
        await generateCanvas(ctx, photos, true, {
          frameCache,
          filterScale: 1,
          renderToken,
        });
        await nextAnimationFrame();
        await nextAnimationFrame();
        recorder.stop();
        const blob = await recordingPromise;
        const mimeType = blob.type || recorder.mimeType;
        const extension = recorderFileExtension(mimeType);
        downloadExportBlob(blob, `kisap-motion-${Date.now()}.${extension}`);
        setFinishStatus("Motion strip saved to your device.", "success");
        appState.recoveryAvailable = false;
        queueRecoveryClear();
        playReadyChime();
        vibrate([20, 35, 20]);
      } finally {
        if (recorder.state !== "inactive") recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
        videos.forEach((video) => {
          video.pause();
          video.removeAttribute("src");
          video.load();
        });
        frameCache.forEach((cached) => {
          cached.frame.width = 1;
          cached.frame.height = 1;
        });
        frameCache.clear();
        targetCanvas.width = 1;
        targetCanvas.height = 1;
        wakeLock?.release?.().catch(() => {});
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
      setFinishStatus(`Kisap could not finish the export: ${err.message}`, "error");
    }
  } finally {
    setBusy(false);
  }
}

function handleCaptureShortcut(event) {
  if (appState.screen !== "capture" || appState.busy || event.repeat) return;
  if (event.key !== " " && event.key !== "Enter") return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, select, textarea, button, a")) return;
  if (!cameraIsActive() || !document.querySelector("[data-capture-moment]")) return;
  event.preventDefault();
  runCapture();
}

document.addEventListener("keydown", handleCaptureShortcut);

document.addEventListener("keydown", (event) => {
  if (!installDialogOpen) return;
  if (event.key === "Escape") {
    closeInstallDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...document.querySelectorAll("[data-install-dialog] button:not([disabled]), [data-install-dialog] a[href]")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installDialogOpen && appState.screen === "home") render();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installDialogOpen = false;
  if (appState.screen === "home") render();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        const checkForUpdate = () => registration.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
      })
      .catch(() => {});
  }, { once: true });
}

async function bootstrap() {
  const stored = await loadSessionRecovery();
  const restored = restoreRecoverySnapshot(stored);
  appState.screen = getInitialScreen();

  // Never reactivate a camera automatically after a refresh. Return recovered
  // captures to review so the user remains in control of camera permission.
  if (restored && appState.screen === "capture") {
    appState.screen = recoveryResumeTarget();
    window.history.replaceState(null, "", `#${appState.screen}`);
    appState.notice = "Your private session was restored on this device.";
  }
  render();
}

bootstrap().catch(() => {
  appState.screen = getInitialScreen();
  render();
});
