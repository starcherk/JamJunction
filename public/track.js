// ─── Base path detection ──────────────────────────────────────────────────

const BASE = window.location.pathname.startsWith("/JamJunction")
  ? "/JamJunction"
  : "";

// ─── Extract track key from URL ───────────────────────────────────────────

const trackKey = decodeURIComponent(
  window.location.pathname.replace(new RegExp(`^${BASE}/track/`), "")
);

// ─── Sign out ────────────────────────────────────────────────────────────────

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await fetch(BASE + "/api/auth/logout", { method: "POST" });
  window.location.reload();
});

// ─── DOM refs ────────────────────────────────────────────────────────────────

const trackLoading  = document.getElementById("track-loading");
const trackDetail   = document.getElementById("track-detail");
const trackNameInput = document.getElementById("track-name-input");
const saveNameBtn   = document.getElementById("save-name-btn");
const trackMeta     = document.getElementById("track-meta");
const audioPlayer   = document.getElementById("audio-player");
const downloadLink  = document.getElementById("download-link");
const deleteBtn     = document.getElementById("delete-btn");
const backLink      = document.getElementById("back-link");
const toast         = document.getElementById("toast");

const visualizerCanvas = document.getElementById("visualizer-canvas");
const vizCtx           = visualizerCanvas.getContext("2d");

// ─── State ────────────────────────────────────────────────────────────────────

let track       = null;
let savedName   = "";
let toastTimer  = null;

// ─── Audio visualizer ─────────────────────────────────────────────────────────

let audioCtx   = null;
let analyser   = null;
let sourceNode = null;
let vizAnimId  = null;
let isPlaying  = false;

function ensureAudioContext() {
  if (audioCtx) return;
  audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
  analyser   = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  sourceNode = audioCtx.createMediaElementSource(audioPlayer);
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function resizeCanvas() {
  const rect = visualizerCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  visualizerCanvas.width  = rect.width * window.devicePixelRatio;
  visualizerCanvas.height = rect.height * window.devicePixelRatio;
  vizCtx.setTransform(1, 0, 0, 1, 0, 0);
  vizCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawVisualizer(timestamp) {
  const w = visualizerCanvas.getBoundingClientRect().width;
  const h = visualizerCanvas.getBoundingClientRect().height;

  vizCtx.clearRect(0, 0, w, h);

  const barCount = 64;
  const gap = 3;
  const barWidth = (w - gap * (barCount - 1)) / barCount;

  if (isPlaying && analyser) {
    // ─ Live frequency bars ─
    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(data);

    for (let i = 0; i < barCount; i++) {
      const val = data[i] / 255;
      const barH = Math.max(2, val * h);
      const x = i * (barWidth + gap);
      const y = h - barH;

      const grad = vizCtx.createLinearGradient(x, y, x, h);
      grad.addColorStop(0, "#a78bfa");
      grad.addColorStop(1, "#7c3aed");
      vizCtx.fillStyle = grad;

      vizCtx.beginPath();
      vizCtx.roundRect(x, y, barWidth, barH, 2);
      vizCtx.fill();
    }
  } else {
    // ─ Idle: subtle breathing sine wave bars ─
    const t = (timestamp || 0) / 1000;
    for (let i = 0; i < barCount; i++) {
      const phase = (i / barCount) * Math.PI * 4 + t * 1.2;
      const val = 0.05 + 0.04 * Math.sin(phase) + 0.02 * Math.sin(phase * 0.7 + t);
      const barH = Math.max(2, val * h);
      const x = i * (barWidth + gap);
      const y = h - barH;

      vizCtx.fillStyle = "#7c3aed33";

      vizCtx.beginPath();
      vizCtx.roundRect(x, y, barWidth, barH, 2);
      vizCtx.fill();
    }
  }

  vizAnimId = requestAnimationFrame(drawVisualizer);
}

function startVisualizer() {
  ensureAudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  isPlaying = true;
  resizeCanvas();
  if (!vizAnimId) drawVisualizer();
}

function stopVisualizer() {
  isPlaying = false;
  // keep animation running for idle state
}

function startIdleLoop() {
  resizeCanvas();
  if (!vizAnimId) drawVisualizer();
}

window.addEventListener("resize", resizeCanvas);

audioPlayer.addEventListener("play", () => startVisualizer());
audioPlayer.addEventListener("pause", () => stopVisualizer());
audioPlayer.addEventListener("ended", () => stopVisualizer());

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ─── Set back link ────────────────────────────────────────────────────────────

backLink.href = BASE + "/";

// ─── Load track ───────────────────────────────────────────────────────────────

async function loadTrack() {
  try {
    const apiUrl = `${BASE}/api/files/${encodeURIComponent(trackKey)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    track = await res.json();

    savedName = track.originalName;
    trackNameInput.value = savedName;
    document.title = `${savedName} — JamJunction`;

    trackMeta.innerHTML = `
      <span>${formatBytes(track.size)}</span>
      <span>${escapeHtml(track.contentType)}</span>
      <span>Uploaded ${formatDate(track.uploaded)}</span>
      <span>by ${escapeHtml(track.uploadedBy)}</span>
    `;

    audioPlayer.src = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.href = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.download = savedName;

    trackLoading.classList.add("hidden");
    trackDetail.classList.remove("hidden");
    startIdleLoop();
  } catch (err) {
    trackLoading.innerHTML = `<p style="color:var(--error)">Track not found.</p>`;
  }
}

loadTrack();

// ─── Rename ───────────────────────────────────────────────────────────────────

trackNameInput.addEventListener("input", () => {
  const changed = trackNameInput.value.trim() !== savedName;
  saveNameBtn.classList.toggle("hidden", !changed);
});

saveNameBtn.addEventListener("click", async () => {
  const newName = trackNameInput.value.trim();
  if (!newName || newName === savedName) return;

  saveNameBtn.disabled = true;
  saveNameBtn.textContent = "Saving…";

  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    savedName = newName;
    document.title = `${savedName} — JamJunction`;
    downloadLink.download = savedName;
    saveNameBtn.classList.add("hidden");
    showToast("Track renamed.", "success");
  } catch {
    showToast("Rename failed. Please try again.", "error");
  } finally {
    saveNameBtn.disabled = false;
    saveNameBtn.textContent = "Save";
  }
});

// ─── Delete ───────────────────────────────────────────────────────────────────

deleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete "${savedName}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    window.location.href = BASE + "/";
  } catch {
    showToast("Delete failed. Please try again.", "error");
  }
});
