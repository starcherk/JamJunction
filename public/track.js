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

const descInput       = document.getElementById("description-input");
const saveDescBtn     = document.getElementById("save-desc-btn");
const tagsList        = document.getElementById("tags-list");
const tagInput        = document.getElementById("tag-input");

const reactionsBar    = document.getElementById("reactions-bar");

const commentInput    = document.getElementById("comment-input");
const commentSubmit   = document.getElementById("comment-submit");
const commentsList    = document.getElementById("comments-list");
const commentsEmpty   = document.getElementById("comments-empty");
const commentTimeBadge = document.getElementById("comment-time-badge");
const commentTimeLabel = document.getElementById("comment-time-label");
const commentTimeClear = document.getElementById("comment-time-clear");
const playerTimeline  = document.getElementById("player-timeline");
const timelineMarkers = document.getElementById("timeline-markers");

const replaceInput    = document.getElementById("replace-input");

const activityList    = document.getElementById("activity-list");
const activityEmpty   = document.getElementById("activity-empty");

const visualizerCanvas = document.getElementById("visualizer-canvas");
const vizCtx           = visualizerCanvas.getContext("2d");

// ─── State ────────────────────────────────────────────────────────────────────

let track       = null;
let savedName   = "";
let savedDesc   = "";
let currentTags = [];
let toastTimer  = null;
let commentAudioTime = null;
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

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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

async function loadTrack() {
  try {
    await fetchMe();

    const apiUrl = `${BASE}/api/files/${encodeURIComponent(trackKey)}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

    // Description
    savedDesc = track.description || "";
    descInput.value = savedDesc;

    // Tags
    currentTags = track.tags || [];
    renderTags();

    // Audio
    audioPlayer.src = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.href = `${BASE}/api/download/${encodeURIComponent(track.key)}`;
    downloadLink.download = savedName;

    // Reactions
    renderReactions(track.reactions || {});

    // Comments
    renderComments(track.comments || []);

    // Activity
    renderActivity(track.activity || []);

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
    showToast("Rename failed.", "error");
  } finally {
    saveNameBtn.disabled = false;
    saveNameBtn.textContent = "Save";
  }
});

// ─── Description ──────────────────────────────────────────────────────────────

descInput.addEventListener("input", () => {
  const changed = descInput.value !== savedDesc;
  saveDescBtn.classList.toggle("hidden", !changed);
});

saveDescBtn.addEventListener("click", async () => {
  saveDescBtn.disabled = true;
  saveDescBtn.textContent = "Saving…";

  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: descInput.value }),
    });
    if (!res.ok) throw new Error();

    savedDesc = descInput.value;
    saveDescBtn.classList.add("hidden");
    showToast("Notes saved.", "success");
  } catch {
    showToast("Failed to save notes.", "error");
  } finally {
    saveDescBtn.disabled = false;
    saveDescBtn.textContent = "Save Notes";
  }
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

function renderTags() {
  tagsList.innerHTML = "";
  for (const tag of currentTags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(tag)} <button class="tag-remove" aria-label="Remove tag ${escapeHtml(tag)}">&times;</button>`;
    chip.querySelector(".tag-remove").addEventListener("click", () => removeTag(tag));
    tagsList.appendChild(chip);
  }
}

tagInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== ",") return;
  e.preventDefault();
  const val = tagInput.value.replace(/,/g, "").trim();
  if (!val || currentTags.includes(val) || currentTags.length >= 10) return;
  tagInput.value = "";
  currentTags.push(val);
  renderTags();
  saveTags();
});

async function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderTags();
  saveTags();
}

async function saveTags() {
  try {
    await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: currentTags }),
    });
  } catch {
    showToast("Failed to save tags.", "error");
  }
}

// ─── Reactions ────────────────────────────────────────────────────────────────

const REACTION_EMOJIS = ["🔥", "👍", "🎵", "💜", "🎧", "🔧"];

function renderReactions(reactions) {
  reactionsBar.innerHTML = "";
  for (const emoji of REACTION_EMOJIS) {
    const users = reactions[emoji] || [];
    const myReaction = currentUser && users.some(u => u.email === currentUser.email);
    const btn = document.createElement("button");
    btn.className = `reaction-btn${myReaction ? " active" : ""}`;
    btn.innerHTML = `<span class="reaction-emoji">${emoji}</span>${users.length ? `<span class="reaction-count">${users.length}</span>` : ""}`;
    btn.title = users.map(u => u.name).join(", ") || "No reactions yet";
    btn.addEventListener("click", () => toggleReaction(emoji));
    reactionsBar.appendChild(btn);
  }
}

async function toggleReaction(emoji) {
  try {
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderReactions(data.reactions);
  } catch {
    showToast("Reaction failed.", "error");
  }
}

// ─── Timestamped Comments ─────────────────────────────────────────────────────

// Click timeline to set comment timestamp
playerTimeline.addEventListener("click", (e) => {
  if (!audioPlayer.duration) return;
  const rect = playerTimeline.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  commentAudioTime = Math.max(0, pct * audioPlayer.duration);
  commentTimeLabel.textContent = formatTime(commentAudioTime);
  commentTimeBadge.classList.remove("hidden");
});

commentTimeClear.addEventListener("click", () => {
  commentAudioTime = null;
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
      body: JSON.stringify({ text, audioTime: commentAudioTime }),
    });
    if (!res.ok) throw new Error();
    const comment = await res.json();

    track.comments = track.comments || [];
    track.comments.push(comment);
    renderComments(track.comments);
    commentInput.value = "";
    commentAudioTime = null;
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

    const timeTag = c.audioTime != null
      ? `<button class="comment-timestamp" data-time="${c.audioTime}">${formatTime(c.audioTime)}</button>`
      : "";

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

// ─── Replace file ─────────────────────────────────────────────────────────────

replaceInput.addEventListener("change", async () => {
  const file = replaceInput.files[0];
  if (!file) return;

  if (!confirm(`Replace the audio with "${file.name}"?`)) {
    replaceInput.value = "";
    return;
  }

  const form = new FormData();
  form.append("file", file);

  try {
    showToast("Uploading replacement…", "info");
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}/replace`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Replace failed");
    }
    showToast("File replaced! Reloading…", "success");
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    showToast(err.message || "Replace failed.", "error");
  } finally {
    replaceInput.value = "";
  }
});

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

// ─── Mic Recording (Record Replace) ──────────────────────────────────────────

const recordReplaceBtn   = document.getElementById("record-replace-btn");
const recordPanel        = document.getElementById("record-panel");
const recordCancelBtn    = document.getElementById("record-cancel-btn");
const recordStartBtn     = document.getElementById("record-start-btn");
const recordStopBtn      = document.getElementById("record-stop-btn");
const recordTimerEl      = document.getElementById("record-timer");
const recordCanvas       = document.getElementById("record-level-canvas");
const recordPreview      = document.getElementById("record-preview");
const recordPreviewAudio = document.getElementById("record-preview-audio");
const recordUploadBtn    = document.getElementById("record-upload-btn");
const recordDiscardBtn   = document.getElementById("record-discard-btn");
const recCtx             = recordCanvas.getContext("2d");

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
  recCtx.setTransform(1, 0, 0, 1, 0, 0);
  recCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawRecLevel() {
  const w = recordCanvas.getBoundingClientRect().width;
  const h = recordCanvas.getBoundingClientRect().height;
  recCtx.clearRect(0, 0, w, h);

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
    const grad = recCtx.createLinearGradient(x, y, x, h);
    grad.addColorStop(0, "#ef4444");
    grad.addColorStop(1, "#dc2626");
    recCtx.fillStyle = grad;
    recCtx.beginPath();
    recCtx.roundRect(x, y, barW, barH, 2);
    recCtx.fill();
  }

  recAnimId = requestAnimationFrame(drawRecLevel);
}

function resetRecordUI() {
  recordStartBtn.classList.remove("hidden");
  recordStopBtn.classList.add("hidden");
  recordPreview.classList.add("hidden");
  recordTimerEl.textContent = "0:00";
  recordedBlob = null;
  recCtx.clearRect(0, 0, recordCanvas.getBoundingClientRect().width, recordCanvas.getBoundingClientRect().height);
}

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

function onRecordingDone() {
  stopRecording(false);
  if (!recChunks.length) return;
  recordedBlob = new Blob(recChunks, { type: recChunks[0].type || "audio/webm" });
  recordPreviewAudio.src = URL.createObjectURL(recordedBlob);
  recordPreview.classList.remove("hidden");
  recordStopBtn.classList.add("hidden");
}

recordReplaceBtn.addEventListener("click", () => {
  recordPanel.classList.remove("hidden");
  resetRecordUI();
  recordPanel.scrollIntoView({ behavior: "smooth" });
});

recordCancelBtn.addEventListener("click", () => {
  stopRecording(true);
  recordPanel.classList.add("hidden");
});

recordStartBtn.addEventListener("click", async () => {
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showToast("Microphone access denied.", "error");
    return;
  }

  recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = recAudioCtx.createMediaStreamSource(recStream);
  recAnalyser = recAudioCtx.createAnalyser();
  recAnalyser.fftSize = 256;
  source.connect(recAnalyser);

  recChunks = [];
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus" : "audio/webm";
  recorder = new MediaRecorder(recStream, { mimeType });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
  recorder.onstop = () => onRecordingDone();

  recorder.start(100);
  recStartTime = Date.now();
  recTimerInterval = setInterval(() => {
    recordTimerEl.textContent = formatRecTime(Date.now() - recStartTime);
  }, 250);

  recordStartBtn.classList.add("hidden");
  recordStopBtn.classList.remove("hidden");
  resizeRecCanvas();
  recAnimId = requestAnimationFrame(drawRecLevel);
});

recordStopBtn.addEventListener("click", () => {
  if (recorder?.state === "recording") recorder.stop();
});

recordUploadBtn.addEventListener("click", async () => {
  if (!recordedBlob) return;
  if (!confirm("Replace the current audio with this recording?")) return;

  const file = new File([recordedBlob], "recording.webm", { type: recordedBlob.type });
  const form = new FormData();
  form.append("file", file);

  recordUploadBtn.disabled = true;
  recordUploadBtn.textContent = "Uploading…";

  try {
    showToast("Uploading recorded replacement…", "info");
    const res = await fetch(`${BASE}/api/files/${encodeURIComponent(trackKey)}/replace`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Replace failed");
    }
    showToast("Replaced! Reloading…", "success");
    setTimeout(() => location.reload(), 1000);
  } catch (err) {
    showToast(err.message || "Replace failed.", "error");
  } finally {
    recordUploadBtn.disabled = false;
    recordUploadBtn.textContent = "Upload as Replacement";
  }
});

recordDiscardBtn.addEventListener("click", () => {
  if (recordPreviewAudio.src) URL.revokeObjectURL(recordPreviewAudio.src);
  recordPreviewAudio.src = "";
  recordedBlob = null;
  resetRecordUI();
});
