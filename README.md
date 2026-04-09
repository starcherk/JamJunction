# JamJunction

Music collaboration site — share tracks with your crew.

Live at: **kylestarcher.com/JamJunction**

---

## Stack

| Layer        | Technology                          |
|-------------|--------------------------------------|
| Hosting      | Cloudflare Workers (Workers Assets) |
| File storage | Cloudflare R2                        |
| Auth         | Cloudflare Access                    |
| Frontend     | Plain HTML / CSS / JS                |

---

## First-time Setup

### 1 — Install Wrangler (if not already)

```bash
npm install -g wrangler
wrangler login
```

### 2 — Create the R2 bucket

```bash
# Production
wrangler r2 bucket create jamjunction-files

# Dev preview (used by `wrangler dev`)
wrangler r2 bucket create jamjunction-files-preview
```

### 3 — Install local Wrangler schema (for config autocomplete)

```bash
npm init -y
npm install --save-dev wrangler
```

This puts the `$schema` JSON available at `node_modules/wrangler/config-schema.json`.

### 4 — Deploy the Worker

```bash
wrangler deploy
```

This deploys to `jamjunction.workers.dev`.

---

## Routing to kylestarcher.com/JamJunction

Add a **Worker Route** in the Cloudflare dashboard:

1. Go to **Workers & Pages → jamjunction → Settings → Triggers**
2. Add route: `kylestarcher.com/JamJunction*`
3. Zone: `kylestarcher.com`

The worker normalises the `/JamJunction` path prefix internally, so
`kylestarcher.com/JamJunction/` serves the homepage and
`kylestarcher.com/JamJunction/api/files` returns the file list.

---

## Upload Authentication (Cloudflare Access)

Only protect the **upload** and **delete** endpoints. Public browsing
and streaming require no login.

1. Go to **Zero Trust → Access → Applications → Add an application**
2. Choose **Self-hosted**
3. Configure:
   - **Application name**: JamJunction Upload
   - **Session duration**: 24 hours (or your preference)
   - **Application domain**: `kylestarcher.com`
   - **Path**: `JamJunction/api/upload` (also add `JamJunction/api/files/*` for deletes)
4. Set an identity provider / policy (e.g. allow your own email via GitHub or Google OAuth)
5. Save

When a user tries to upload without being authenticated, the Worker returns
`401` and the UI shows a prompt. Cloudflare Access then handles the login
redirect — no extra code needed.

> **Note:** The Worker trusts the `Cf-Access-Authenticated-User-Email` header
> injected by Access.  Requests that bypass the route (e.g. direct workers.dev
> calls) can still reach the upload endpoint, so keep your workers.dev URL
> private during development or add an additional secret header check if needed.

---

## GitHub Continuous Deployment

1. Push this repo to `github.com/kylestarcher/JamJunction`
2. Go to **Workers & Pages → jamjunction → Settings → Git**  
   (or set up via **Pages → Connect to Git** — use Workers CI via GitHub Actions)

### Option A — Wrangler GitHub Action (recommended)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
```

Add `CF_API_TOKEN` to your GitHub repo secrets (create an API token at
dash.cloudflare.com with **Workers Scripts:Edit** and **R2:Edit** permissions).

### Option B — Cloudflare Pages Git integration

Connect the repo via **Workers & Pages → Create → Pages → Connect to Git**.
Set the build command to *(empty)* and the output directory to `.`
(no build step needed — plain HTML/JS/CSS).

---

## Local Development

```bash
wrangler dev
```

The site runs at `http://localhost:8787`. The R2 preview bucket is used
automatically.  Cloudflare Access auth is bypassed in local dev — upload
works without a login header.

---

## Project Structure

```
JamJunction/
├── index.html     # Single-page UI
├── styles.css     # Dark theme
├── app.js         # Upload / list / stream logic (ES module)
├── worker.js      # Cloudflare Worker (API + asset serving)
├── wrangler.jsonc # Wrangler configuration
└── README.md
```

---

## API

| Method | Path                         | Auth     | Description               |
|--------|------------------------------|----------|---------------------------|
| GET    | `/JamJunction/api/files`     | —        | List all tracks           |
| POST   | `/JamJunction/api/upload`    | Required | Upload an audio file      |
| GET    | `/JamJunction/api/download/:key` | —    | Stream / download a track |
| DELETE | `/JamJunction/api/files/:key` | Required | Delete a track           |

Accepted audio types: `MP3`, `WAV`, `FLAC`, `OGG`, `AAC`, `M4A`  
Max file size: **500 MB**
