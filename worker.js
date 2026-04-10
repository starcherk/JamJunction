import { EmailMessage } from "cloudflare:email";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;  // 30 days in seconds
const SENDER_EMAIL = "noreply@kylestarcher.com";
const ADMIN_EMAIL = "kylestarcher@rogers.com";
const REQUEST_COOLDOWN = 5 * 60 * 1000; // 5 minutes between access requests

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/x-flac",
  "audio/aac",
  "audio/x-m4a",
  "audio/mp4",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function htmlRes(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function normalizePath(pathname) {
  if (pathname.startsWith("/JamJunction")) {
    return pathname.slice("/JamJunction".length) || "/";
  }
  return pathname;
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacVerify(message, signature, secret) {
  const expected = await hmacSign(message, secret);
  return expected === signature;
}

async function getSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/jj_session=([a-f0-9-]+)/);
  if (!match) return null;
  const token = match[1];
  const session = await env.JAMJUNCTION_AUTH.get(`session:${token}`, "json");
  if (!session) return null;
  if (Date.now() > session.expires) {
    await env.JAMJUNCTION_AUTH.delete(`session:${token}`);
    return null;
  }
  return session;
}

function sessionCookie(token, basePath) {
  return `jj_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=${basePath || "/"}; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookie(basePath) {
  return `jj_session=; HttpOnly; Secure; SameSite=Lax; Path=${basePath || "/"}; Max-Age=0`;
}

async function sendNotificationEmail(env, toEmail, subject, body) {
  const raw = [
    `From: JamJunction <${SENDER_EMAIL}>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\r\n");
  const msg = new EmailMessage(SENDER_EMAIL, toEmail, raw);
  await env.SEND_EMAIL.send(msg);
}

// ─── Portal HTML ─────────────────────────────────────────────────────────────

function portalHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JamJunction &mdash; Access - test2</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0c0c12; --surface: #13131e; --surface-2: #1c1c2a;
      --border: #2a2a3e; --accent: #7c3aed; --accent-glow: #7c3aed44;
      --accent-light: #a78bfa; --text: #e2e0f0; --text-muted: #6e6a8e;
      --error: #ef4444; --success: #10b981; --radius: 12px; --radius-sm: 8px;
    }
    html { font-size: 16px; color-scheme: dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    }
    .portal { max-width: 420px; width: 100%; padding: 2rem; text-align: center; }
    .portal-logo {
      display: flex; align-items: center; justify-content: center;
      gap: 0.6rem; color: var(--accent-light); margin-bottom: 2rem;
    }
    .portal-logo svg { width: 40px; height: 40px; }
    .portal-logo h1 { font-size: 1.5rem; font-weight: 700; }
    .portal-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 2rem; box-shadow: 0 4px 24px #00000055;
    }
    .portal-card p { color: var(--text-muted); margin-bottom: 1.25rem; font-size: 0.95rem; }
    .input-field {
      width: 100%; padding: 0.75rem 1rem; background: var(--surface-2);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      color: var(--text); font-size: 1rem; outline: none; transition: border-color 180ms;
    }
    .input-field:focus { border-color: var(--accent); }
    .input-field::placeholder { color: var(--text-muted); }
    .input-field + .input-field { margin-top: 0.75rem; }
    .btn {
      width: 100%; padding: 0.75rem; margin-top: 1rem;
      background: var(--accent); color: #fff; border: none;
      border-radius: var(--radius-sm); font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity 180ms;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 1rem; font-size: 0.875rem; min-height: 1.25rem; }
    .status.error { color: var(--error); }
    .status.ok { color: var(--accent-light); }
    .status.success { color: var(--success); }
    .hidden { display: none; }
    .back-link {
      display: inline-block; margin-top: 1rem; color: var(--text-muted);
      font-size: 0.85rem; cursor: pointer; text-decoration: underline;
      text-underline-offset: 3px;
    }
    .back-link:hover { color: var(--accent-light); }
    .queue-box {
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: var(--radius-sm); padding: 1.25rem; margin-bottom: 1rem;
    }
    .queue-status {
      display: flex; align-items: center; gap: 0.5rem;
      justify-content: center; margin-bottom: 0.75rem;
    }
    .queue-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #f59e0b; animation: pulse 1.5s ease-in-out infinite;
    }
    .queue-dot.approved { background: var(--success); animation: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; } 50% { opacity: 0.4; }
    }
    .queue-label { font-size: 0.85rem; font-weight: 600; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em; }
    .queue-label.approved { color: var(--success); }
    .queue-email { font-size: 0.95rem; color: var(--text); word-break: break-all; }
    .queue-detail { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem; }
    .btn-secondary {
      width: 100%; padding: 0.65rem; margin-top: 0.75rem;
      background: transparent; color: var(--accent-light);
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: border-color 180ms;
    }
    .btn-secondary:hover { border-color: var(--accent); }
    .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="portal">
    <div class="portal-logo">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2"/>
        <circle cx="20" cy="20" r="6" fill="currentColor"/>
        <path d="M20 2 A18 18 0 0 1 38 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M20 2 A18 18 0 0 0 2 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4"/>
      </svg>
      <h1>JamJunction</h1>
    </div>
    <div class="portal-card">

      <!-- Step 1: Enter email -->
      <div id="step-email">
        <p>Enter your email to request access</p>
        <form id="email-form">
          <input class="input-field" type="email" id="email" placeholder="you@example.com" required autocomplete="email">
          <button class="btn" type="submit" id="email-btn">Continue</button>
        </form>
      </div>

      <!-- Step 2: Pending approval -->
      <div id="step-pending" class="hidden">
        <div class="queue-box">
          <div class="queue-status">
            <div class="queue-dot" id="queue-dot"></div>
            <span class="queue-label" id="queue-label">Pending Approval</span>
          </div>
          <div class="queue-email" id="queue-email"></div>
          <div class="queue-detail">Your request has been submitted. You'll be able to set a password once approved.</div>
        </div>
        <button class="btn-secondary" type="button" id="check-btn">Check Status</button>
        <span class="back-link" id="back-pending">Use a different email</span>
      </div>

      <!-- Step 3: Set password (approved, no password yet) -->
      <div id="step-setpw" class="hidden">
        <p>You've been approved! Set a password to continue.</p>
        <form id="setpw-form">
          <input class="input-field" type="password" id="new-password" placeholder="Choose a password" required minlength="6" autocomplete="new-password">
          <input class="input-field" type="password" id="confirm-password" placeholder="Confirm password" required minlength="6" autocomplete="new-password">
          <button class="btn" type="submit" id="setpw-btn">Set Password &amp; Enter</button>
        </form>
      </div>

      <!-- Step 4: Login (has password) -->
      <div id="step-login" class="hidden">
        <p>Enter your password to continue</p>
        <form id="login-form">
          <input class="input-field" type="password" id="login-password" placeholder="Password" required autocomplete="current-password">
          <button class="btn" type="submit" id="login-btn">Log In</button>
        </form>
        <span class="back-link" id="back-login">Use a different email</span>
      </div>

      <div id="status" class="status"></div>
    </div>
  </div>
  <script>
    const BASE = window.location.pathname.replace(/\\/$/, "");
    const statusEl = document.getElementById("status");
    let userEmail = "";

    function showStatus(msg, cls) {
      statusEl.textContent = msg;
      statusEl.className = "status " + (cls || "");
    }

    function showStep(id) {
      for (const el of document.querySelectorAll(".portal-card > div[id^=step-]")) {
        el.classList.add("hidden");
      }
      document.getElementById(id).classList.remove("hidden");
      statusEl.textContent = "";
    }

    document.getElementById("back-pending").addEventListener("click", () => showStep("step-email"));
    document.getElementById("back-login").addEventListener("click", () => showStep("step-email"));

    // Check status button on pending screen
    document.getElementById("check-btn").addEventListener("click", async () => {
      const btn = document.getElementById("check-btn");
      btn.disabled = true;
      btn.textContent = "Checking\u2026";
      try {
        const res = await fetch(BASE + "/api/auth/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail }),
        });
        const data = await res.json();
        if (data.status === "approved") {
          document.getElementById("queue-dot").classList.add("approved");
          document.getElementById("queue-label").classList.add("approved");
          document.getElementById("queue-label").textContent = "Approved";
          setTimeout(() => showStep("step-setpw"), 800);
        } else if (data.status === "active") {
          showStep("step-login");
        } else {
          showStatus("Still waiting for approval", "ok");
        }
      } catch {
        showStatus("Network error", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Check Status";
      }
    });

    // Step 1: Check email status
    document.getElementById("email-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("email-btn");
      userEmail = document.getElementById("email").value.trim();
      btn.disabled = true;
      btn.textContent = "Checking\u2026";
      showStatus("", "");
      try {
        const res = await fetch(BASE + "/api/auth/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail }),
        });
        const data = await res.json();
        if (data.status === "unknown" || data.status === "pending") {
          if (data.status === "unknown") {
            await fetch(BASE + "/api/auth/request-access", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: userEmail }),
            });
          }
          document.getElementById("queue-email").textContent = userEmail;
          showStep("step-pending");
        } else if (data.status === "approved") {
          showStep("step-setpw");
        } else if (data.status === "active") {
          showStep("step-login");
        } else if (data.status === "revoked") {
          showStatus("Your access has been revoked.", "error");
        }
      } catch {
        showStatus("Network error \u2014 please try again", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Continue";
      }
    });

    // Step 3: Set password
    document.getElementById("setpw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("setpw-btn");
      const pw = document.getElementById("new-password").value;
      const confirmPw = document.getElementById("confirm-password").value;
      if (pw !== confirmPw) { showStatus("Passwords don't match", "error"); return; }
      btn.disabled = true;
      btn.textContent = "Setting up\u2026";
      showStatus("", "");
      try {
        const res = await fetch(BASE + "/api/auth/set-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, password: pw }),
        });
        if (res.ok) {
          showStatus("Welcome! Loading\u2026", "success");
          window.location.reload();
        } else {
          const data = await res.json();
          showStatus(data.error || "Failed to set password", "error");
        }
      } catch {
        showStatus("Network error \u2014 please try again", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Set Password & Enter";
      }
    });

    // Step 4: Login
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("login-btn");
      const pw = document.getElementById("login-password").value;
      btn.disabled = true;
      btn.textContent = "Logging in\u2026";
      showStatus("", "");
      try {
        const res = await fetch(BASE + "/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, password: pw }),
        });
        if (res.ok) {
          showStatus("Welcome back! Loading\u2026", "success");
          window.location.reload();
        } else {
          const data = await res.json();
          showStatus(data.error || "Login failed", "error");
        }
      } catch {
        showStatus("Network error \u2014 please try again", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Log In";
      }
    });
  </script>
</body>
</html>`;
}

// ─── Admin approval page ─────────────────────────────────────────────────────

function approvalResultHTML(success, message) {
  const color = success ? "#10b981" : "#ef4444";
  const icon = success ? "\u2713 Approved" : "\u2717 Error";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JamJunction — Admin</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: #0c0c12; color: #e2e0f0; display: flex; align-items: center;
      justify-content: center; min-height: 100dvh; margin: 0;
    }
    .card {
      background: #13131e; border: 1px solid #2a2a3e; border-radius: 12px;
      padding: 2rem; max-width: 400px; text-align: center;
      box-shadow: 0 4px 24px #00000055;
    }
    .card h2 { color: ${color}; margin-bottom: 1rem; }
    .card p { color: #9895b8; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${icon}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Redirect /JamJunction to /JamJunction/ so relative asset paths resolve correctly
    if (url.pathname === "/JamJunction") {
      return Response.redirect(url.origin + "/JamJunction/" + url.search, 301);
    }

    const path = normalizePath(url.pathname);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const basePath = url.pathname.startsWith("/JamJunction") ? "/JamJunction/" : "/";
    const baseUrl = url.origin + (url.pathname.startsWith("/JamJunction") ? "/JamJunction" : "");

    // ── Auth routes (no session required) ────────────────────────────────────

    // Check user status by email
    if (path === "/api/auth/check" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.email) return jsonRes({ error: "Email required" }, 400);
      const email = body.email.toLowerCase().trim();
      const user = await env.JAMJUNCTION_AUTH.get(`user:${email}`, "json");
      if (!user) return jsonRes({ status: "unknown" });
      return jsonRes({ status: user.status });
    }

    // Request access (new user)
    if (path === "/api/auth/request-access" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.email) return jsonRes({ error: "Email required" }, 400);
      const email = body.email.toLowerCase().trim();

      const existing = await env.JAMJUNCTION_AUTH.get(`user:${email}`, "json");
      if (existing) return jsonRes({ ok: true }); // already known

      // Rate-limit by IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateKey = `ratelimit:request:${ip}`;
      const lastRequest = await env.JAMJUNCTION_AUTH.get(rateKey);
      if (lastRequest) return jsonRes({ ok: true }); // silently rate-limit
      await env.JAMJUNCTION_AUTH.put(rateKey, "1", { expirationTtl: 300 });

      // Store as pending
      await env.JAMJUNCTION_AUTH.put(`user:${email}`, JSON.stringify({
        status: "pending",
        requested: Date.now(),
      }));

      // Build approval link with HMAC signature
      const sig = await hmacSign(email, env.HMAC_SECRET);
      const approveUrl = `${baseUrl}/api/admin/approve?email=${encodeURIComponent(email)}&sig=${sig}`;

      try {
        await sendNotificationEmail(
          env, ADMIN_EMAIL,
          `JamJunction: ${email} wants access`,
          `${email} is requesting access to JamJunction.\n\nTo approve, click:\n${approveUrl}\n\nTo ignore, do nothing.`
        );
      } catch (err) {
        console.error("Failed to send admin notification:", err.message);
      }

      return jsonRes({ ok: true });
    }

    // Admin approve link (GET from email)
    if (path === "/api/admin/approve" && request.method === "GET") {
      const email = url.searchParams.get("email")?.toLowerCase().trim();
      const sig = url.searchParams.get("sig");
      if (!email || !sig) {
        return htmlRes(approvalResultHTML(false, "Missing parameters."), 400);
      }

      const valid = await hmacVerify(email, sig, env.HMAC_SECRET);
      if (!valid) {
        return htmlRes(approvalResultHTML(false, "Invalid or expired approval link."), 403);
      }

      const user = await env.JAMJUNCTION_AUTH.get(`user:${email}`, "json");
      if (!user) {
        return htmlRes(approvalResultHTML(false, "User not found."), 404);
      }
      if (user.status === "active") {
        return htmlRes(approvalResultHTML(true, `${email} already has access.`));
      }

      user.status = "approved";
      user.approvedAt = Date.now();
      await env.JAMJUNCTION_AUTH.put(`user:${email}`, JSON.stringify(user));

      return htmlRes(approvalResultHTML(true, `${email} has been approved. They can now set their password.`));
    }

    // Set password (approved user, first time)
    if (path === "/api/auth/set-password" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.email || !body?.password) return jsonRes({ error: "Email and password required" }, 400);
      if (body.password.length < 6) return jsonRes({ error: "Password must be at least 6 characters" }, 400);

      const email = body.email.toLowerCase().trim();
      const user = await env.JAMJUNCTION_AUTH.get(`user:${email}`, "json");
      if (!user || user.status !== "approved") {
        return jsonRes({ error: "Not authorized to set a password" }, 403);
      }

      const salt = crypto.randomUUID();
      const hash = await hashPassword(body.password, salt);

      user.status = "active";
      user.salt = salt;
      user.passwordHash = hash;
      user.activatedAt = Date.now();
      await env.JAMJUNCTION_AUTH.put(`user:${email}`, JSON.stringify(user));

      // Create session
      const token = crypto.randomUUID();
      await env.JAMJUNCTION_AUTH.put(`session:${token}`, JSON.stringify({
        email,
        created: Date.now(),
        expires: Date.now() + SESSION_MAX_AGE * 1000,
      }), { expirationTtl: SESSION_MAX_AGE });

      const res = jsonRes({ ok: true });
      res.headers.set("Set-Cookie", sessionCookie(token, basePath));
      return res;
    }

    // Login (active user with password)
    if (path === "/api/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.email || !body?.password) return jsonRes({ error: "Email and password required" }, 400);

      const email = body.email.toLowerCase().trim();

      // Rate-limit login attempts by IP
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const attemptsKey = `ratelimit:login:${ip}`;
      const attempts = parseInt(await env.JAMJUNCTION_AUTH.get(attemptsKey) || "0");
      if (attempts >= 10) return jsonRes({ error: "Too many attempts — try again later" }, 429);

      const user = await env.JAMJUNCTION_AUTH.get(`user:${email}`, "json");
      if (!user || user.status !== "active" || !user.passwordHash) {
        await env.JAMJUNCTION_AUTH.put(attemptsKey, String(attempts + 1), { expirationTtl: 900 });
        return jsonRes({ error: "Invalid email or password" }, 401);
      }

      const hash = await hashPassword(body.password, user.salt);
      if (hash !== user.passwordHash) {
        await env.JAMJUNCTION_AUTH.put(attemptsKey, String(attempts + 1), { expirationTtl: 900 });
        return jsonRes({ error: "Invalid email or password" }, 401);
      }

      // Clear rate-limit on success
      await env.JAMJUNCTION_AUTH.delete(attemptsKey);

      const token = crypto.randomUUID();
      await env.JAMJUNCTION_AUTH.put(`session:${token}`, JSON.stringify({
        email,
        created: Date.now(),
        expires: Date.now() + SESSION_MAX_AGE * 1000,
      }), { expirationTtl: SESSION_MAX_AGE });

      const res = jsonRes({ ok: true });
      res.headers.set("Set-Cookie", sessionCookie(token, basePath));
      return res;
    }

    // Logout
    if (path === "/api/auth/logout" && request.method === "POST") {
      const cookie = request.headers.get("Cookie") || "";
      const match = cookie.match(/jj_session=([a-f0-9-]+)/);
      if (match) await env.JAMJUNCTION_AUTH.delete(`session:${match[1]}`);

      const res = jsonRes({ ok: true });
      res.headers.set("Set-Cookie", clearSessionCookie(basePath));
      return res;
    }

    // ── Session gate ─────────────────────────────────────────────────────────
    const session = await getSession(request, env);
    if (!session) {
      if (path.startsWith("/api/")) {
        return jsonRes({ error: "Authentication required" }, 401);
      }
      return htmlRes(portalHTML());
    }

    // ── GET /api/files  ──────────────────────────────────────────────────────
    if (path === "/api/files" && request.method === "GET") {
      try {
        const listed = await env.JAMJUNCTION_BUCKET.list();

        const files = await Promise.all(
          listed.objects.map(async (obj) => {
            const head = await env.JAMJUNCTION_BUCKET.head(obj.key);
            return {
              key: obj.key,
              originalName:
                head?.customMetadata?.originalName ?? obj.key,
              size: obj.size,
              uploaded: obj.uploaded,
              contentType:
                head?.httpMetadata?.contentType ?? "audio/mpeg",
              uploadedBy: head?.customMetadata?.uploadedBy ?? "unknown",
            };
          })
        );

        files.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

        return jsonRes({ files });
      } catch {
        return jsonRes({ error: "Failed to list files" }, 500);
      }
    }

    // ── POST /api/upload  ────────────────────────────────────────────────────
    if (path === "/api/upload" && request.method === "POST") {
      let formData;
      try {
        formData = await request.formData();
      } catch {
        return jsonRes({ error: "Invalid multipart form data" }, 400);
      }

      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return jsonRes({ error: "No file provided" }, 400);
      }

      if (!ALLOWED_AUDIO_TYPES.has(file.type)) {
        return jsonRes(
          { error: "Only audio files are allowed (MP3, WAV, FLAC, OGG, AAC, M4A)" },
          415
        );
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return jsonRes({ error: "File exceeds the 500 MB limit" }, 413);
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._\- ]/g, "_");
      const key = `${Date.now()}-${safeName}`;

      try {
        await env.JAMJUNCTION_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: {
            originalName: file.name,
          },
        });
        return jsonRes({ ok: true, key });
      } catch {
        return jsonRes({ error: "Upload failed — please try again" }, 500);
      }
    }

    // ── GET /api/download/:key  ──────────────────────────────────────────────
    if (path.startsWith("/api/download/") && request.method === "GET") {
      const key = decodeURIComponent(path.slice("/api/download/".length));
      if (!key) return new Response("Not found", { status: 404 });

      try {
        const range = request.headers.get("Range");
        let object;
        if (range) {
          object = await env.JAMJUNCTION_BUCKET.get(key, {
            range: request.headers,
          });
        } else {
          object = await env.JAMJUNCTION_BUCKET.get(key);
        }

        if (!object) return new Response("File not found", { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("ETag", object.httpEtag);
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "private, max-age=3600");

        const status = object.range ? 206 : 200;
        return new Response(object.body, { status, headers });
      } catch {
        return new Response("Error retrieving file", { status: 500 });
      }
    }

    // ── DELETE /api/files/:key  ──────────────────────────────────────────────
    if (path.startsWith("/api/files/") && request.method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/files/".length));
      if (!key) return jsonRes({ error: "No key provided" }, 400);

      try {
        await env.JAMJUNCTION_BUCKET.delete(key);
        return jsonRes({ ok: true });
      } catch {
        return jsonRes({ error: "Delete failed" }, 500);
      }
    }

    // ── Static Assets ────────────────────────────────────────────────────────
    const assetUrl = new URL(request.url);
    assetUrl.pathname = path;
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },
};
