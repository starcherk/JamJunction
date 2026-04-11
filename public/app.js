// ─── Base path detection ──────────────────────────────────────────────────
// Works on both:
//   kylestarcher.com/JamJunction/   (production route)
//   jamjunction.workers.dev/        (workers_dev)

const BASE = window.location.pathname.startsWith("/JamJunction")
  ? "/JamJunction"
  : "";

// ─── Sign out ────────────────────────────────────────────────────────────────

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  await fetch(BASE + "/api/auth/logout", { method: "POST" });
  window.location.reload();
});

// ─── DOM refs ────────────────────────────────────────────────────────────────

const dropZone       = document.getElementById("drop-zone");
const fileInput      = document.getElementById("file-input");
const uploadProgress = document.getElementById("upload-progress");
const progressBar    = document.getElementById("progress-bar");
const progressPct    = document.getElementById("progress-pct");
const progressName   = document.getElementById("progress-filename");
const uploadStatus   = document.getElementById("upload-status");

const libraryLoading = document.getElementById("library-loading");
const libraryEmpty   = document.getElementById("library-empty");
const fileList       = document.getElementById("file-list");
const searchInput    = document.getElementById("search-input");

const playerBar       = document.getElementById("player-bar");
const audioPlayer     = document.getElementById("audio-player");
const playerName      = document.getElementById("player-track-name");
const playerClose     = document.getElementById("player-close");
const playerEqualizer = document.getElementById("player-equalizer");

const toast          = document.getElementById("toast");

// ─── State ────────────────────────────────────────────────────────────────────

let allFiles       = [];   // full file list from API
let currentKey     = null; // key of the track being played
let toastTimer     = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

function showToast(message, type = "info") {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ─── File Library ─────────────────────────────────────────────────────────────

async function loadFiles() {
  libraryLoading.classList.remove("hidden");
  libraryEmpty.classList.add("hidden");
  fileList.classList.add("hidden");

  try {
    const res  = await fetch(`${BASE}/api/files`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allFiles   = data.files ?? [];
    renderFiles(allFiles);
  } catch (err) {
    libraryLoading.classList.add("hidden");
    showToast("Could not load library. Please refresh.", "error");
  }
}

function renderFiles(files) {
  libraryLoading.classList.add("hidden");

  if (files.length === 0) {
    libraryEmpty.classList.remove("hidden");
    fileList.classList.add("hidden");
    return;
  }

  libraryEmpty.classList.add("hidden");
  fileList.innerHTML = "";

  for (const f of files) {
    fileList.appendChild(buildFileItem(f));
  }

  fileList.classList.remove("hidden");
}

function buildFileItem(file) {
  const li = document.createElement("li");
  li.className    = "file-item";
  li.dataset.key  = file.key;
  if (file.key === currentKey) li.classList.add("is-playing");

  // Play icon SVG
  const playSvg = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/>
  </svg>`;
  const stopSvg = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" clip-rule="evenodd"/>
  </svg>`;

  // Download icon SVG
  const dlSvg = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"/>
    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z"/>
  </svg>`;

  // Delete icon SVG
  const delSvg = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd"/>
  </svg>`;

  const isPlaying = file.key === currentKey;

  li.innerHTML = `
    <button class="file-play-btn" aria-label="${isPlaying ? "Stop" : "Play"} ${file.originalName}">
      ${isPlaying ? stopSvg : playSvg}
    </button>
    <div class="file-info">
      <div class="file-name" title="${escapeHtml(file.originalName)}">${escapeHtml(file.originalName)}</div>
      <div class="file-meta">
        <span>${formatBytes(file.size)}</span>
        <span>${formatDate(file.uploaded)}</span>
        <span>${escapeHtml(file.uploadedBy)}</span>
      </div>
    </div>
    <div class="file-actions">
      <a
        class="btn-icon"
        href="${BASE}/api/download/${encodeURIComponent(file.key)}"
        download="${escapeHtml(file.originalName)}"
        aria-label="Download ${escapeHtml(file.originalName)}"
      >${dlSvg}</a>
      <button class="btn-icon delete-btn" aria-label="Delete ${escapeHtml(file.originalName)}">
        ${delSvg}
      </button>
    </div>
  `;

  li.querySelector(".file-play-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay(file);
  });

  li.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteFile(file);
  });

  li.querySelector(".btn-icon[download]")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  li.addEventListener("click", () => {
    window.location.href = `${BASE}/track/${encodeURIComponent(file.key)}`;
  });
  li.style.cursor = "pointer";

  return li;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Playback ─────────────────────────────────────────────────────────────────

function togglePlay(file) {
  if (currentKey === file.key) {
    // Stop
    audioPlayer.pause();
    currentKey = null;
    updatePlayingState();
    playerBar.classList.add("hidden");
    return;
  }

  currentKey = file.key;
  playerName.textContent = file.originalName;
  audioPlayer.src = `${BASE}/api/download/${encodeURIComponent(file.key)}`;
  audioPlayer.play().catch(() => {});
  playerBar.classList.remove("hidden");
  playerEqualizer.classList.remove("paused");
  updatePlayingState();
}

function updatePlayingState() {
  document.querySelectorAll(".file-item").forEach((item) => {
    const isPlaying = item.dataset.key === currentKey;
    item.classList.toggle("is-playing", isPlaying);
    const btn = item.querySelector(".file-play-btn");
    if (!btn) return;
    const playSvg = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/></svg>`;
    const eqBars = `<div class="equalizer-sm"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></div>`;
    btn.innerHTML  = isPlaying ? eqBars : playSvg;
    btn.ariaLabel  = `${isPlaying ? "Stop" : "Play"} ${item.querySelector(".file-name")?.textContent ?? ""}`;
  });
}

audioPlayer.addEventListener("ended", () => {
  currentKey = null;
  updatePlayingState();
  playerBar.classList.add("hidden");
});

audioPlayer.addEventListener("pause", () => {
  playerEqualizer.classList.add("paused");
});

audioPlayer.addEventListener("play", () => {
  playerEqualizer.classList.remove("paused");
});

playerClose.addEventListener("click", () => {
  audioPlayer.pause();
  currentKey = null;
  updatePlayingState();
  playerBar.classList.add("hidden");
});

// ─── Search / filter ──────────────────────────────────────────────────────────

searchInput.addEventListener("input", () => {
  const q = searchInput.value.toLowerCase().trim();
  renderFiles(q ? allFiles.filter((f) => f.originalName.toLowerCase().includes(q)) : allFiles);
});

// ─── Delete ───────────────────────────────────────────────────────────────────

async function deleteFile(file) {
  if (!confirm(`Delete "${file.originalName}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(
      `${BASE}/api/files/${encodeURIComponent(file.key)}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (currentKey === file.key) {
      audioPlayer.pause();
      currentKey = null;
      playerBar.classList.add("hidden");
    }

    allFiles = allFiles.filter((f) => f.key !== file.key);
    renderFiles(allFiles);
    showToast("Track deleted.", "info");
  } catch {
    showToast("Delete failed. Please try again.", "error");
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

function setProgressVisible(visible) {
  uploadProgress.classList.toggle("hidden", !visible);
}

function setProgress(pct, filename) {
  progressBar.style.width  = `${pct}%`;
  progressBar.setAttribute("aria-valuenow", String(pct));
  progressPct.textContent  = `${pct}%`;
  if (filename) progressName.textContent = filename;
}

function setUploadStatus(message, type = "") {
  uploadStatus.textContent = message;
  uploadStatus.className   = `upload-status ${type}`.trim();
}

async function uploadFile(file) {
  setProgressVisible(true);
  setProgress(0, file.name);
  setUploadStatus("Uploading…");

  const formData = new FormData();
  formData.append("file", file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/upload`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 95), null);
      }
    });

    xhr.addEventListener("load", async () => {
      setProgress(100, null);

      let body;
      try { body = JSON.parse(xhr.responseText); } catch { body = {}; }

      if (xhr.status === 200 || xhr.status === 201) {
        setUploadStatus("Upload complete!", "success");
        showToast(`"${file.name}" uploaded!`, "success");
        await loadFiles(); // refresh list
        setTimeout(() => setProgressVisible(false), 2000);
        resolve(true);
      } else {
        const msg = body.error ?? `Upload failed (${xhr.status})`;
        setUploadStatus(msg, "error");
        showToast(msg, "error");
        resolve(false);
      }
    });

    xhr.addEventListener("error", () => {
      setUploadStatus("Network error. Please try again.", "error");
      showToast("Upload failed: network error.", "error");
      resolve(false);
    });

    xhr.send(formData);
  });
}

// ─── Drop zone interactions ───────────────────────────────────────────────────

dropZone.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) uploadFile(fileInput.files[0]);
  fileInput.value = ""; // reset so same file can be re-selected
});

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", (e) => { if (!dropZone.contains(/** @type {Element} */ (e.relatedTarget))) dropZone.classList.remove("drag-over"); });
dropZone.addEventListener("dragend",   () => dropZone.classList.remove("drag-over"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadFiles();

// ─── Mic Recording ────────────────────────────────────────────────────────────

const recordTriggerBtn = document.getElementById("record-trigger-btn");
const recordPanel      = document.getElementById("record-panel");
const recordCancelBtn  = document.getElementById("record-cancel-btn");
const recordStartBtn   = document.getElementById("record-start-btn");
const recordStopBtn    = document.getElementById("record-stop-btn");
const recordTimer      = document.getElementById("record-timer");
const recordCanvas     = document.getElementById("record-level-canvas");
const recordPreview    = document.getElementById("record-preview");
const recordPreviewAudio = document.getElementById("record-preview-audio");
const recordNameInput  = document.getElementById("record-name-input");
const recordUploadBtn  = document.getElementById("record-upload-btn");
const recordDiscardBtn = document.getElementById("record-discard-btn");
const recordCanvasCtx  = recordCanvas.getContext("2d");

let recStream      = null;
let recorder       = null;
let recChunks      = [];
let recStartTime   = 0;
let recTimerInterval = null;
let recAnimId      = null;
let recAnalyser    = null;
let recAudioCtx    = null;
let recordedBlob   = null;

function formatRecTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function resizeRecCanvas() {
  const rect = recordCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  recordCanvas.width  = rect.width * window.devicePixelRatio;
  recordCanvas.height = rect.height * window.devicePixelRatio;
  recordCanvasCtx.setTransform(1, 0, 0, 1, 0, 0);
  recordCanvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawRecLevel() {
  const w = recordCanvas.getBoundingClientRect().width;
  const h = recordCanvas.getBoundingClientRect().height;
  recordCanvasCtx.clearRect(0, 0, w, h);

  if (!recAnalyser) { recAnimId = requestAnimationFrame(drawRecLevel); return; }

  const data = new Uint8Array(recAnalyser.frequencyBinCount);
  recAnalyser.getByteFrequencyData(data);

  const barCount = 48;
  const gap = 3;
  const barW = (w - gap * (barCount - 1)) / barCount;

  for (let i = 0; i < barCount; i++) {
    const val = (data[i] || 0) / 255;
    const barH = Math.max(2, val * h);
    const x = i * (barW + gap);
    const y = h - barH;

    const grad = recordCanvasCtx.createLinearGradient(x, y, x, h);
    grad.addColorStop(0, "#ef4444");
    grad.addColorStop(1, "#dc2626");
    recordCanvasCtx.fillStyle = grad;
    recordCanvasCtx.beginPath();
    recordCanvasCtx.roundRect(x, y, barW, barH, 2);
    recordCanvasCtx.fill();
  }

  recAnimId = requestAnimationFrame(drawRecLevel);
}

recordTriggerBtn.addEventListener("click", async () => {
  recordPanel.classList.remove("hidden");
  recordTriggerBtn.classList.add("hidden");
  resetRecordUI();
});

recordCancelBtn.addEventListener("click", () => {
  stopRecording(true);
  recordPanel.classList.add("hidden");
  recordTriggerBtn.classList.remove("hidden");
});

recordStartBtn.addEventListener("click", async () => {
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showToast("Microphone access denied.", "error");
    return;
  }

  // Set up analyser for live levels
  recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = recAudioCtx.createMediaStreamSource(recStream);
  recAnalyser = recAudioCtx.createAnalyser();
  recAnalyser.fftSize = 256;
  source.connect(recAnalyser);

  recChunks = [];
  const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
    ? "audio/mp4"
    : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
  recorder = new MediaRecorder(recStream, { mimeType });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
  recorder.onstop = () => onRecordingDone();

  recorder.start(100);
  recStartTime = Date.now();
  recTimerInterval = setInterval(() => {
    recordTimer.textContent = formatRecTime(Date.now() - recStartTime);
  }, 250);

  recordStartBtn.classList.add("hidden");
  recordStopBtn.classList.remove("hidden");
  resizeRecCanvas();
  recAnimId = requestAnimationFrame(drawRecLevel);
});

recordStopBtn.addEventListener("click", () => {
  if (recorder?.state === "recording") recorder.stop();
});

function stopRecording(discard) {
  if (recorder?.state === "recording") recorder.stop();
  clearInterval(recTimerInterval);
  cancelAnimationFrame(recAnimId);
  recAnimId = null;
  if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
  if (recAudioCtx) { recAudioCtx.close().catch(() => {}); recAudioCtx = null; recAnalyser = null; }
  if (discard) {
    recordedBlob = null;
    recordPreview.classList.add("hidden");
    if (recordPreviewAudio.src) { URL.revokeObjectURL(recordPreviewAudio.src); recordPreviewAudio.src = ""; }
  }
}

function resetRecordUI() {
  recordStartBtn.classList.remove("hidden");
  recordStopBtn.classList.add("hidden");
  recordPreview.classList.add("hidden");
  recordTimer.textContent = "0:00";
  recordNameInput.value = "";
  recordedBlob = null;
  const ctx = recordCanvasCtx;
  const rect = recordCanvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function onRecordingDone() {
  stopRecording(false);
  if (!recChunks.length) return;

  recordedBlob = new Blob(recChunks, { type: recChunks[0].type || "audio/webm" });
  const url = URL.createObjectURL(recordedBlob);
  recordPreviewAudio.src = url;
  recordPreview.classList.remove("hidden");
  recordStopBtn.classList.add("hidden");

  const now = new Date();
  const defaultName = `Recording ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  recordNameInput.value = defaultName;
}

recordUploadBtn.addEventListener("click", async () => {
  if (!recordedBlob) return;

  const ext = recordedBlob.type.includes("mp4") ? ".m4a" : ".webm";
  const name = (recordNameInput.value.trim() || "Recording") + ext;
  const file = new File([recordedBlob], name, { type: recordedBlob.type });

  recordUploadBtn.disabled = true;
  recordUploadBtn.textContent = "Uploading…";

  const ok = await uploadFile(file);

  recordUploadBtn.disabled = false;
  recordUploadBtn.textContent = "Upload";

  if (ok) {
    recordPanel.classList.add("hidden");
    recordTriggerBtn.classList.remove("hidden");
    resetRecordUI();
  }
});

recordDiscardBtn.addEventListener("click", () => {
  if (recordPreviewAudio.src) URL.revokeObjectURL(recordPreviewAudio.src);
  recordPreviewAudio.src = "";
  recordedBlob = null;
  resetRecordUI();
});
