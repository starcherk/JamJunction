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

const trackLoading    = document.getElementById("track-loading");
const trackDetail     = document.getElementById("track-detail");
const trackNameInput  = document.getElementById("track-name-input");
const saveNameBtn     = document.getElementById("save-name-btn");
const trackMeta       = document.getElementById("track-meta");
const audioPlayer     = document.getElementById("audio-player");
const downloadLink    = document.getElementById("download-link");
const deleteBtn       = document.getElementById("delete-btn");
const backLink        = document.getElementById("back-link");
const toast           = document.getElementById("toast");





const commentInput    = document.getElementById("comment-input");
const commentSubmit   = document.getElementById("comment-submit");
const commentsList    = document.getElementById("comments-list");
const commentsEmpty   = document.getElementById("comments-empty");
const commentTimeBadge = document.getElementById("comment-time-badge");
const commentTimeLabel = document.getElementById("comment-time-label");
const commentTimeClear = document.getElementById("comment-time-clear");
const playerTimeline  = document.getElementById("player-timeline");
const timelineMarkers = document.getElementById("timeline-markers");

const trackLineage    = document.getElementById("track-lineage");

const activityList    = document.getElementById("activity-list");
const activityEmpty   = document.getElementById("activity-empty");

const visualizerCanvas = document.getElementById("visualizer-canvas");
const vizCtx           = visualizerCanvas.getContext("2d");

// ─── State ────────────────────────────────────────────────────────────────────

let track       = null;
let savedName   = "";
let toastTimer  = null;
let commentAudioTime = null;
let commentAudioEndTime = null;
let currentUser = null;

// ─── Fetch current user ───────────────────────────────────────────────────

async function fetchMe() {
  try {
    const res = await fetch(BASE + "/api/auth/me");
    if (res.ok) currentUser = await res.json();
  } catch {}
}

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
}

function startIdleLoop() {
  resizeCanvas();
  if (!vizAnimId) drawVisualizer();
}

window.addEventListener("resize", resizeCanvas);

audioPlayer.addEventListener("play", () => {
  startVisualizer();
  startMainPlayhead();
});
audioPlayer.addEventListener("pause", () => {
  stopVisualizer();
  stopMainPlayhead();
});
audioPlayer.addEventListener("ended", () => {
  stopVisualizer();
  stopMainPlayhead();
});

// Sync editor playhead with main audio player
let mainPlayheadAnim = null;

function startMainPlayhead() {
  if (mainPlayheadAnim) return;
  function tick() {
    if (audioPlayer.duration && !isEditorPreviewing) {
      const pct = audioPlayer.currentTime / audioPlayer.duration;
      editorPlayhead.style.display = "block";
      editorPlayhead.style.left = `${pct * 100}%`;
    }
    mainPlayheadAnim = requestAnimationFrame(tick);
  }
  mainPlayheadAnim = requestAnimationFrame(tick);
}

function stopMainPlayhead() {
  if (mainPlayheadAnim) {
    cancelAnimationFrame(mainPlayheadAnim);
    mainPlayheadAnim = null;
  }
}

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

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "0:00.00";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(new Date(ts).toISOString());
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

async function loadTrack(retries = 2) {
  try {
    await fetchMe();

    const apiUrl = `${BASE}/api/files/${encodeURIComponent(trackKey)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
      if (res.status === 404 && retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return loadTrack(retries - 1);
      }
      throw new Error(`HTTP ${res.status}`);
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

    // Audio
    audioPlayer.src = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.href = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.download = savedName;

    // Lineage
    if (track.parentKey) {
      renderLineage(track.parentKey);
    }

    // Comments
    renderComments(track.comments || []);

    // Activity
    renderActivity(track.activity || []);

    trackLoading.classList.add("hidden");
    trackDetail.classList.remove("hidden");
    startIdleLoop();

    // Auto-load editor
    loadEditor();
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
    showToast("Rename failed.", "error");
  } finally {
    saveNameBtn.disabled = false;
    saveNameBtn.textContent = "Save";
  }
});

// ─── Timestamped Comments ─────────────────────────────────────────────────────

// Click timeline to set comment timestamp
playerTimeline.addEventListener("click", (e) => {
  if (!audioPlayer.duration) return;
  const rect = playerTimeline.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  commentAudioTime = Math.max(0, pct * audioPlayer.duration);
  commentAudioEndTime = null;
  commentTimeLabel.textContent = formatTime(commentAudioTime);
  commentTimeBadge.classList.remove("hidden");
});

commentTimeClear.addEventListener("click", () => {
  commentAudioTime = null;
  commentAudioEndTime = null;
  commentTimeBadge.classList.add("hidden");
});

commentInput.addEventListener("input", () => {
  commentSubmit.disabled = !commentInput.value.trim();
});

commentInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !commentSubmit.disabled) {
    e.preventDefault();
    submitComment();
  }
});

commentSubmit.addEventListener("click", submitComment);

async function submitComment() {
  const text = commentInput.value.trim();
  if (!text) return;

  commentSubmit.disabled = true;

  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, audioTime: commentAudioTime, audioEndTime: commentAudioEndTime }),
    });
    if (!res.ok) throw new Error();
    const comment = await res.json();

    track.comments = track.comments || [];
    track.comments.push(comment);
    renderComments(track.comments);
    commentInput.value = "";
    commentAudioTime = null;
    commentAudioEndTime = null;
    commentTimeBadge.classList.add("hidden");
  } catch {
    showToast("Failed to post comment.", "error");
  } finally {
    commentSubmit.disabled = !commentInput.value.trim();
  }
}

function renderComments(comments) {
  commentsList.innerHTML = "";
  timelineMarkers.innerHTML = "";

  if (!comments.length) {
    commentsEmpty.classList.remove("hidden");
    return;
  }
  commentsEmpty.classList.add("hidden");

  // Sort newest first
  const sorted = [...comments].sort((a, b) => b.createdAt - a.createdAt);

  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "comment-item";

    let timeTag = "";
    if (c.audioTime != null && c.audioEndTime != null) {
      timeTag = `<button class="comment-timestamp comment-timestamp-range" data-time="${c.audioTime}" data-end="${c.audioEndTime}">${formatTime(c.audioTime)} – ${formatTime(c.audioEndTime)}</button>`;
    } else if (c.audioTime != null) {
      timeTag = `<button class="comment-timestamp" data-time="${c.audioTime}">${formatTime(c.audioTime)}</button>`;
    }

    const deleteBtn = currentUser && c.email === currentUser.email
      ? `<button class="comment-delete" data-id="${c.id}" aria-label="Delete comment">&times;</button>`
      : "";

    li.innerHTML = `
      <div class="comment-header">
        <strong class="comment-author">${escapeHtml(c.name)}</strong>
        ${timeTag}
        <span class="comment-date">${timeAgo(c.createdAt)}</span>
        ${deleteBtn}
      </div>
      <p class="comment-text">${escapeHtml(c.text)}</p>
    `;

    // Seek on timestamp click
    const tsBtn = li.querySelector(".comment-timestamp");
    if (tsBtn) {
      tsBtn.addEventListener("click", () => {
        audioPlayer.currentTime = parseFloat(tsBtn.dataset.time);
        if (audioPlayer.paused) audioPlayer.play().catch(() => {});
      });
    }

    // Delete own comment
    const delBtn = li.querySelector(".comment-delete");
    if (delBtn) {
      delBtn.addEventListener("click", () => deleteComment(c.id));
    }

    commentsList.appendChild(li);

    // Timeline marker
    if (c.audioTime != null && audioPlayer.duration) {
      addTimelineMarker(c);
    }
  }
}

function addTimelineMarker(comment) {
  // We'll re-add markers once duration is known
  if (!audioPlayer.duration) return;

  if (comment.audioEndTime != null) {
    // Region marker
    const startPct = (comment.audioTime / audioPlayer.duration) * 100;
    const endPct = (comment.audioEndTime / audioPlayer.duration) * 100;
    const marker = document.createElement("div");
    marker.className = "timeline-marker-region";
    marker.style.left = `${startPct}%`;
    marker.style.width = `${endPct - startPct}%`;
    marker.title = `${comment.name}: ${comment.text.slice(0, 50)}`;
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      audioPlayer.currentTime = comment.audioTime;
      if (audioPlayer.paused) audioPlayer.play().catch(() => {});
    });
    timelineMarkers.appendChild(marker);
  } else {
    // Point marker
    const pct = (comment.audioTime / audioPlayer.duration) * 100;
    const marker = document.createElement("div");
    marker.className = "timeline-marker";
    marker.style.left = `${pct}%`;
    marker.title = `${comment.name}: ${comment.text.slice(0, 50)}`;
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      audioPlayer.currentTime = comment.audioTime;
      if (audioPlayer.paused) audioPlayer.play().catch(() => {});
    });
    timelineMarkers.appendChild(marker);
  }
}

// Re-render markers once we know the duration
audioPlayer.addEventListener("loadedmetadata", () => {
  if (track?.comments) {
    timelineMarkers.innerHTML = "";
    for (const c of track.comments) {
      if (c.audioTime != null) addTimelineMarker(c);
    }
  }
});

async function deleteComment(id) {
  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}/comments/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error();
    track.comments = track.comments.filter(c => c.id !== id);
    renderComments(track.comments);
    showToast("Comment deleted.", "success");
  } catch {
    showToast("Failed to delete comment.", "error");
  }
}

// ─── Activity feed ────────────────────────────────────────────────────────────

function renderActivity(activity) {
  activityList.innerHTML = "";

  if (!activity.length) {
    activityEmpty.classList.remove("hidden");
    return;
  }
  activityEmpty.classList.add("hidden");

  for (const a of activity.slice(0, 50)) {
    const li = document.createElement("li");
    li.className = "activity-item";

    let desc = "";
    switch (a.type) {
      case "rename":
        desc = `renamed track from "${escapeHtml(a.from)}" to "${escapeHtml(a.to)}"`;
        break;
      case "description":
        desc = "updated the description";
        break;
      case "tags":
        desc = "updated tags";
        break;
      case "comment":
        desc = `commented: "${escapeHtml(a.preview || "")}"`;
        break;
      case "replace":
        desc = `replaced the audio file (${formatBytes(a.newSize)})`;
        break;
      default:
        desc = a.type;
    }

    li.innerHTML = `
      <span class="activity-user">${escapeHtml(a.user)}</span>
      <span class="activity-desc">${desc}</span>
      <span class="activity-time">${timeAgo(a.timestamp)}</span>
    `;
    activityList.appendChild(li);
  }
}

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
    showToast("Delete failed.", "error");
  }
});

// ─── Audio Editor ─────────────────────────────────────────────────────────────

const editorPanel       = document.getElementById("editor-panel");
const editorWaveformWrap = document.getElementById("editor-waveform-wrap");
const editorWaveform    = document.getElementById("editor-waveform");
const editorCtx         = editorWaveform.getContext("2d");
const handleLeft        = document.getElementById("editor-handle-left");
const handleRight       = document.getElementById("editor-handle-right");
const trimLeftOverlay   = document.getElementById("editor-trim-left");
const trimRightOverlay  = document.getElementById("editor-trim-right");
const fadeInOverlay     = document.getElementById("editor-fade-in-overlay");
const fadeOutOverlay    = document.getElementById("editor-fade-out-overlay");
const editorPlayhead    = document.getElementById("editor-playhead");
const trimStartLabel    = document.getElementById("editor-trim-start-label");
const trimEndLabel      = document.getElementById("editor-trim-end-label");
const durationLabel     = document.getElementById("editor-duration-label");
const fadeInSlider      = document.getElementById("editor-fade-in");
const fadeOutSlider     = document.getElementById("editor-fade-out");
const volumeSlider      = document.getElementById("editor-volume");
const fadeInVal         = document.getElementById("editor-fade-in-val");
const fadeOutVal        = document.getElementById("editor-fade-out-val");
const volumeVal         = document.getElementById("editor-volume-val");
const previewBtn        = document.getElementById("editor-preview-btn");
const resetBtn          = document.getElementById("editor-reset-btn");
const branchBtn         = document.getElementById("editor-branch-btn");
const branchInput       = document.getElementById("editor-branch-input");
const stampBtn          = document.getElementById("editor-stamp-btn");

let editorBuffer   = null;  // decoded AudioBuffer
let editorPeaks    = null;  // pre-computed peaks for waveform drawing
let trimStart      = 0;     // 0..1 fraction
let trimEnd        = 1;     // 0..1 fraction
let editorPreviewCtx  = null; // AudioContext for preview
let editorPreviewSrc  = null; // AudioBufferSourceNode
let editorPreviewAnim = null;
let editorPreviewStartTime = 0;
let isEditorPreviewing = false;

// Load editor audio
async function loadEditor() {
  try {
    const res = await fetch(`${BASE}/api/download/${encodeURIComponent(trackKey)}`);
    if (!res.ok) throw new Error();
    const arrayBuf = await res.arrayBuffer();

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    editorBuffer = await ctx.decodeAudioData(arrayBuf);
    ctx.close();

    editorPeaks = computePeaks(editorBuffer, 2000);

    trimStart = 0;
    trimEnd   = 1;
    fadeInSlider.value  = 0;
    fadeOutSlider.value = 0;
    volumeSlider.value  = 100;
    updateEditorUI();
    resizeEditorCanvas();
    drawEditorWaveform();
  } catch {
    showToast("Failed to load audio for editing.", "error");
  }
}

// Compute peaks from AudioBuffer
function computePeaks(buffer, numPeaks) {
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / numPeaks));
  const peaks = new Float32Array(numPeaks);
  for (let i = 0; i < numPeaks; i++) {
    let max = 0;
    const start = i * step;
    const end = Math.min(start + step, ch.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(ch[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }
  return peaks;
}

// Resize canvas to match container
function resizeEditorCanvas() {
  const rect = editorWaveformWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  editorWaveform.width  = rect.width * window.devicePixelRatio;
  editorWaveform.height = rect.height * window.devicePixelRatio;
  editorCtx.setTransform(1, 0, 0, 1, 0, 0);
  editorCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

// Draw the waveform
function drawEditorWaveform() {
  if (!editorPeaks) return;

  const w = editorWaveformWrap.getBoundingClientRect().width;
  const h = editorWaveformWrap.getBoundingClientRect().height;
  editorCtx.clearRect(0, 0, w, h);

  const barCount = Math.min(editorPeaks.length, Math.floor(w / 3));
  const gap = 1.5;
  const barW = (w - gap * (barCount - 1)) / barCount;
  const step = editorPeaks.length / barCount;

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor(i * step);
    const val = editorPeaks[idx] || 0;
    const barH = Math.max(1, val * h * 0.9);
    const x = i * (barW + gap);
    const y = (h - barH) / 2;

    // Dim bars outside trim range
    const pct = i / barCount;
    if (pct < trimStart || pct > trimEnd) {
      editorCtx.fillStyle = "#7c3aed22";
    } else {
      const grad = editorCtx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, "#a78bfa");
      grad.addColorStop(1, "#7c3aed");
      editorCtx.fillStyle = grad;
    }

    editorCtx.beginPath();
    editorCtx.roundRect(x, y, barW, barH, 1);
    editorCtx.fill();
  }
}

// Update all editor UI: overlays, labels, fade indicators
function updateEditorUI() {
  if (!editorBuffer) return;

  const dur = editorBuffer.duration;
  const selDur = (trimEnd - trimStart) * dur;

  trimStartLabel.textContent = formatTime(trimStart * dur);
  trimEndLabel.textContent   = formatTime(trimEnd * dur);
  durationLabel.textContent  = `${formatTime(selDur)} selected`;

  // Trim overlays
  trimLeftOverlay.style.width  = `${trimStart * 100}%`;
  trimRightOverlay.style.width = `${(1 - trimEnd) * 100}%`;

  // Keep handles aligned with trim positions
  handleLeft.style.left   = `${trimStart * 100}%`;
  handleRight.style.right = `${(1 - trimEnd) * 100}%`;

  // Fade overlays (relative to visible region)
  const fadeIn = parseFloat(fadeInSlider.value);
  const fadeOut = parseFloat(fadeOutSlider.value);
  const fadeInPct = selDur > 0 ? Math.min(fadeIn / selDur, 1) : 0;
  const fadeOutPct = selDur > 0 ? Math.min(fadeOut / selDur, 1) : 0;
  const regionWidth = (trimEnd - trimStart) * 100;

  fadeInOverlay.style.left  = `${trimStart * 100}%`;
  fadeInOverlay.style.width = `${fadeInPct * regionWidth}%`;
  fadeOutOverlay.style.right = `${(1 - trimEnd) * 100}%`;
  fadeOutOverlay.style.width = `${fadeOutPct * regionWidth}%`;

  // Slider labels
  fadeInVal.textContent  = `${parseFloat(fadeInSlider.value).toFixed(1)}s`;
  fadeOutVal.textContent = `${parseFloat(fadeOutSlider.value).toFixed(1)}s`;
  volumeVal.textContent  = `${volumeSlider.value}%`;
}

// Slider change events
fadeInSlider.addEventListener("input",  () => { updateEditorUI(); drawEditorWaveform(); });
fadeOutSlider.addEventListener("input", () => { updateEditorUI(); drawEditorWaveform(); });
volumeSlider.addEventListener("input",  () => updateEditorUI());

// Handle dragging for trim handles
function setupHandleDrag(handle, side) {
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = editorWaveformWrap.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));

    if (side === "left") {
      trimStart = Math.min(pct, trimEnd - 0.01);
    } else {
      trimEnd = Math.max(pct, trimStart + 0.01);
    }

    updateEditorUI();
    drawEditorWaveform();
  };

  const onUp = () => {
    dragging = false;
    handle.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  handle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.addEventListener("touchmove", onMove);
    document.addEventListener("touchend", onUp);
  });
}

setupHandleDrag(handleLeft, "left");
setupHandleDrag(handleRight, "right");

// Click waveform to seek preview playhead
let editorClickPct = null;
editorWaveformWrap.addEventListener("click", (e) => {
  if (e.target.closest(".editor-handle")) return;
  const rect = editorWaveformWrap.getBoundingClientRect();
  let pct = (e.clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  editorClickPct = pct;

  // Show a static playhead marker
  editorPlayhead.style.display = "block";
  editorPlayhead.style.left = `${pct * 100}%`;

  // Seek main audio
  if (audioPlayer.duration) {
    audioPlayer.currentTime = pct * audioPlayer.duration;
  }
});

window.addEventListener("resize", () => {
  resizeEditorCanvas();
  drawEditorWaveform();
});

// Reset editor
resetBtn.addEventListener("click", () => {
  trimStart = 0;
  trimEnd = 1;
  fadeInSlider.value = 0;
  fadeOutSlider.value = 0;
  volumeSlider.value = 100;
  handleLeft.style.left = "0";
  handleRight.style.right = "0";
  editorPlayhead.style.display = "none";
  branchInput.value = "";
  editorClickPct = null;
  updateEditorUI();
  drawEditorWaveform();
});

// Stamp editor selection to comment timestamp
stampBtn.addEventListener("click", () => {
  if (!editorBuffer) return;
  const dur = editorBuffer.duration;

  // If trim handles are moved from defaults → stamp as region
  const hasTrim = trimStart > 0.001 || trimEnd < 0.999;
  // If user clicked a point inside the waveform → stamp that point
  const hasPoint = editorClickPct !== null;

  if (hasTrim) {
    commentAudioTime = trimStart * dur;
    commentAudioEndTime = trimEnd * dur;
    commentTimeLabel.textContent = `${formatTime(commentAudioTime)} – ${formatTime(commentAudioEndTime)}`;
  } else if (hasPoint) {
    commentAudioTime = editorClickPct * dur;
    commentAudioEndTime = null;
    commentTimeLabel.textContent = formatTime(commentAudioTime);
  } else {
    showToast("Click the waveform or move trim handles first.", "error");
    return;
  }

  commentTimeBadge.classList.remove("hidden");
  commentInput.focus();
  showToast("Timestamp stamped to comment.", "success");
});

// Process audio: trim, fade, volume → new AudioBuffer
function processAudio() {
  if (!editorBuffer) return null;

  const sr = editorBuffer.sampleRate;
  const numCh = editorBuffer.numberOfChannels;
  const totalSamples = editorBuffer.length;

  const startSample = Math.floor(trimStart * totalSamples);
  const endSample   = Math.floor(trimEnd * totalSamples);
  const length      = endSample - startSample;

  if (length <= 0) return null;

  const offCtx = new OfflineAudioContext(numCh, length, sr);
  const newBuf = offCtx.createBuffer(numCh, length, sr);

  const fadeInSamples  = Math.floor(parseFloat(fadeInSlider.value) * sr);
  const fadeOutSamples = Math.floor(parseFloat(fadeOutSlider.value) * sr);
  const vol = parseInt(volumeSlider.value) / 100;

  for (let ch = 0; ch < numCh; ch++) {
    const src = editorBuffer.getChannelData(ch);
    const dst = newBuf.getChannelData(ch);

    for (let i = 0; i < length; i++) {
      let sample = src[startSample + i] * vol;

      // Fade in
      if (i < fadeInSamples) {
        sample *= i / fadeInSamples;
      }

      // Fade out
      const fromEnd = length - 1 - i;
      if (fromEnd < fadeOutSamples) {
        sample *= fromEnd / fadeOutSamples;
      }

      dst[i] = sample;
    }
  }

  return newBuf;
}

// Encode AudioBuffer to WAV
function encodeWAV(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numCh * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;

  const wav = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(wav);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = buffer.getChannelData(ch)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([wav], { type: "audio/wav" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Preview: play the processed audio
previewBtn.addEventListener("click", () => {
  if (isEditorPreviewing) {
    stopEditorPreview();
    return;
  }

  const processed = processAudio();
  if (!processed) return;

  editorPreviewCtx = new (window.AudioContext || window.webkitAudioContext)();
  editorPreviewSrc = editorPreviewCtx.createBufferSource();
  editorPreviewSrc.buffer = processed;
  editorPreviewSrc.connect(editorPreviewCtx.destination);
  editorPreviewSrc.start();
  isEditorPreviewing = true;
  editorPreviewStartTime = editorPreviewCtx.currentTime;

  previewBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M5.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 7.25 3h-1.5ZM12.75 3a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75V3.75a.75.75 0 0 0-.75-.75h-1.5Z"/></svg> Stop`;

  // Animate playhead
  function animPlayhead() {
    if (!isEditorPreviewing || !editorPreviewCtx) return;
    const elapsed = editorPreviewCtx.currentTime - editorPreviewStartTime;
    const dur = processed.duration;
    if (elapsed >= dur) {
      stopEditorPreview();
      return;
    }
    const pct = trimStart + (elapsed / editorBuffer.duration);
    editorPlayhead.style.display = "block";
    editorPlayhead.style.left = `${Math.min(pct * 100, trimEnd * 100)}%`;
    editorPreviewAnim = requestAnimationFrame(animPlayhead);
  }
  editorPreviewAnim = requestAnimationFrame(animPlayhead);

  editorPreviewSrc.onended = () => stopEditorPreview();
});

function stopEditorPreview() {
  isEditorPreviewing = false;
  if (editorPreviewSrc) {
    try { editorPreviewSrc.stop(); } catch {}
    editorPreviewSrc = null;
  }
  if (editorPreviewCtx) {
    editorPreviewCtx.close().catch(() => {});
    editorPreviewCtx = null;
  }
  if (editorPreviewAnim) {
    cancelAnimationFrame(editorPreviewAnim);
    editorPreviewAnim = null;
  }
  previewBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z"/></svg> Preview`;
  editorPlayhead.style.display = "none";
}

// Branch: encode to WAV, upload as a new track linked to parent
branchBtn.addEventListener("click", async () => {
  const processed = processAudio();
  if (!processed) { showToast("Nothing to branch.", "error"); return; }

  const branchName = branchInput.value.trim();
  if (!branchName) {
    branchInput.focus();
    showToast("Give your branch a name.", "error");
    return;
  }

  branchBtn.disabled = true;
  branchBtn.textContent = "Processing…";

  try {
    const wavBlob = encodeWAV(processed);
    const fileName = `${branchName}.wav`;
    const file = new File([wavBlob], fileName, { type: "audio/wav" });
    const form = new FormData();
    form.append("file", file);
    form.append("parentKey", trackKey);

    branchBtn.textContent = "Uploading…";

    const res = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Upload failed");
    }

    const { key } = await res.json();
    showToast("Branch created!", "success");
    setTimeout(() => { window.location.href = `${BASE}/track/${encodeURIComponent(key)}`; }, 1000);
  } catch (err) {
    showToast(err.message || "Failed to create branch.", "error");
  } finally {
    branchBtn.disabled = false;
    branchBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/></svg> Branch`;
  }
});

// ─── Lineage ──────────────────────────────────────────────────────────────────

async function renderLineage(parentKey) {
  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(parentKey)}`);
    if (!res.ok) {
      // Parent deleted — still show lineage but as "(deleted)"
      trackLineage.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" class="lineage-icon" aria-hidden="true">
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
        </svg>
        Branched from <span class="lineage-deleted">(deleted track)</span>
      `;
      trackLineage.classList.remove("hidden");
      return;
    }

    const parent = await res.json();
    const parentName = parent.originalName || parentKey;
    trackLineage.innerHTML = `
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" class="lineage-icon" aria-hidden="true">
        <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z"/>
      </svg>
      Branched from <a href="${BASE}/track/${encodeURIComponent(parentKey)}" class="lineage-link">${escapeHtml(parentName)}</a>
    `;
    trackLineage.classList.remove("hidden");
  } catch {
    // Silently fail — lineage is non-critical
  }
}

// ─── Lineage ──────────────────────────────────────────────────────────────────

