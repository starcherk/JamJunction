// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

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

/**
 * Normalize the request path so routes work on both:
 *   kylestarcher.com/JamJunction/...  (production)
 *   jamjunction.workers.dev/...       (dev / workers_dev)
 */
function normalizePath(pathname) {
  if (pathname.startsWith("/JamJunction")) {
    return pathname.slice("/JamJunction".length) || "/";
  }
  return pathname;
}

/**
 * Cloudflare Access injects CF-Access-Authenticated-User-Email after
 * a successful login.  Absence means the request bypassed Access (or
 * you are testing on workers.dev where Access is not configured).
 */
function getAuthUser(request) {
  return request.headers.get("Cf-Access-Authenticated-User-Email");
}

// ─── Worker ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
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

        // Newest first
        files.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

        return jsonRes({ files });
      } catch {
        return jsonRes({ error: "Failed to list files" }, 500);
      }
    }

    // ── POST /api/upload  ────────────────────────────────────────────────────
    if (path === "/api/upload" && request.method === "POST") {
      const userEmail = getAuthUser(request);
      if (!userEmail) {
        return jsonRes({ error: "Authentication required", authRequired: true }, 401);
      }

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

      // Sanitize filename — keep alphanumeric, dots, hyphens, underscores, spaces
      const safeName = file.name.replace(/[^a-zA-Z0-9._\- ]/g, "_");
      const key = `${Date.now()}-${safeName}`;

      try {
        await env.JAMJUNCTION_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
          customMetadata: {
            originalName: file.name,
            uploadedBy: userEmail,
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
        // Support Range requests for audio streaming
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
      const userEmail = getAuthUser(request);
      if (!userEmail) {
        return jsonRes({ error: "Authentication required", authRequired: true }, 401);
      }

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
    // Rewrite to the base-stripped path so index.html / styles.css / app.js
    // are found correctly in the assets directory.
    const assetUrl = new URL(request.url);
    assetUrl.pathname = path;
    return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  },
};
