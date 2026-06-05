# cool-vnc

A hackable, dark-themed VNC client for the browser, packaged as a single-file desktop app.

Built on [noVNC](https://github.com/novnc/noVNC). Adds a sidebar of saved servers, drag-drop groups, manual reorder, network scan with auto-auth + in-modal password retry, a settings overlay with quality and screen-region picking, periodic thumbnails, a full-screen grid view that highlights active sessions, automatic password prompting on auth failure, two-way clipboard sync, a `vnc://` URL handler for OS-level deep links, a small remote-control HTTP API, and an Electron shell so you can ship it as a `.exe` or `.app`.

---

## Download

Grab the latest portable build from the [Releases page](https://github.com/harveymoon/COOL_VNC/releases). No install, no Node, no Python.

| Platform | File |
|---|---|
| Windows x64 | `cool-vnc-win32-x64.zip` → unzip, run `cool-vnc.exe` |
| macOS Apple Silicon | `cool-vnc-darwin-arm64.zip` → unzip, run `cool-vnc.app` |

Mac builds are not code-signed — first launch needs **right-click → Open** to bypass Gatekeeper.

Your saved servers, groups, and thumbnails live in `%APPDATA%\cool-vnc\data\` (Windows) or `~/Library/Application Support/cool-vnc/data/` (macOS).

---

## What's in it

**Sidebar**
- Saved servers with status dots (grey / yellow pulse / green / red)
- Hover a connected dot → it turns into an `×` to disconnect inline
- Hover a row → `⋯` edit / delete
- Fuzzy search across name + host
- Sort by **Manual** / Name / Recent / Frequent
- In **Manual** mode, drag a row to reorder; a blue line shows the drop position. Drag a group header to reorder groups.
- Group folders with drag-drop, expand/collapse, rename, delete; rows inside a group are indented under the parent
- Collapse button (`«`) shrinks the sidebar to a slim handle

**Main area**
- Click a server → shows a Connect card with name + host:port
- Click **Connect** (or double-click the sidebar row) to open the session
- Errors render as a full-canvas card with the actual disconnect reason plus a retry button
- **Auth-failure recovery**: if a connection is rejected for a wrong/missing password, an in-app prompt appears. Enter a new password; if the next attempt succeeds, the password is persisted to disk automatically (saved only after a confirmed-good connection — never on failure)
- Gear (top-right) opens a settings panel: remote desktop name + resolution, quality slider (0-9), compression slider (0-9), and a stats overlay toggle that shows live `↓` / `↑` bytes-per-second and paint rate
- Screen-region picker: drag a rectangle over the live canvas, then drag its edges/corners to adjust before saving; save per-server, switch between regions from a dropdown. Snaps to canvas edges within 10%.
- **Clipboard sync**: when a session is connected, Ctrl/Cmd+V pushes your local clipboard text to the remote via RFB ClientCutText (the same Ctrl+V keystroke also reaches the remote, so the paste lands in whatever app has focus there). Copy on the remote → the text flows back into your local clipboard automatically. Text only — files and rich content aren't transferred.
- **Mac → Windows key**: noVNC drops the Option key on Mac, so cool-vnc repurposes it as the Windows / Super key. Tap Option to open the Start menu, or hold Option+R / Option+E / Option+D for Win+R, Win+E, Win+D, etc. (Cmd still maps to Alt, Control to Control.)

**Network scan**
- "Scan" button TCP-probes the local /24 subnets on port 5900 in parallel
- For every hit, runs an RFB handshake with a configurable default password and reports who let us in
- Successful auths auto-save with `groupId: undefined` so you can sort them yourself
- For locked rows, type a new password into the **retry input** at the top of the modal and hit **Test** — every locked server is re-auth'd in parallel; matches flip to ✓ and are added to the "to save" list with that working password
- Reverse-DNS hostnames stripped of `.local` / `.localdomain` suffixes

**Grid view**
- `▦` button opens a full-screen overlay with a thumbnail per saved server
- Cards whose session is currently `connected` / `connecting` get a green outline and a small **LIVE** badge
- Thumbnails are captured every 30 s while connected, plus on disconnect, and downscaled to ≤480 px JPEG
- **Refresh** button pings each server (1.2 s timeout via the proxy) and for live ones briefly opens a hidden noVNC connection, waits 1.8 s for frames, captures, and saves
- Zoom slider scales cards from `0.4×` to `2.5×` the auto-fit default
- Group sidebar on the left filters the visible cards; "All" by default

**Update check**
- On startup, the app polls `api.github.com/repos/harveymoon/COOL_VNC/releases/latest`. If the tag is newer than the bundled version, a green pill appears in the sidebar header
- Click the pill → opens the release page in your default browser (no in-app download)
- `×` on the pill dismisses that specific version; it'll reappear when a newer one ships

**`vnc://` deep links**
- Registers cool-vnc as the OS handler for `vnc://` URLs (Electron `setAsDefaultProtocolClient`)
- Clicking `vnc://host[:port]` or `vnc://password@host[:port]` in any app focuses cool-vnc and either connects to a matching saved server or creates a new one on the fly
- If the URL carries a password and the matched server has a different one, the new password replaces it

**Built-in proxy** (`server/proxy.mjs`)
- WebSocket → raw TCP bridge per saved server, so the browser doesn't need raw TCP
- HTTP API: `/api/servers`, `/api/groups`, `/api/thumbnails/{id}`, `/api/scan`, `/api/ping`, `/api/test-auth`, `/api/sessions`, `/api/sessions/{id}/{connect,disconnect,focus,screen}`
- Control WebSocket on `/api/control` that the UI uses to push runtime state and receive commands from the remote-control API
- RFB v3.8 auth implemented for the scan (pure-JS DES, no OpenSSL legacy required)
- Stores everything as JSON files + JPEG thumbnails in a data dir

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Electron main process                       │
│  (electron/main.cjs)                         │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Proxy server (imported in-process)    │  │
│  │  - HTTP API on :6080                   │  │
│  │  - WS proxy /<host>/<port>             │  │
│  │  - Static UI serving (from dist/)      │  │
│  └─────────────┬──────────────────────────┘  │
│                │                             │
└────────────────┼─────────────────────────────┘
                 │
                 ▼ http://localhost:6080
┌──────────────────────────────────────────────┐
│  BrowserWindow (Chromium)                    │
│  - Vite-built UI (vanilla TypeScript)        │
│  - noVNC connects to ws://localhost:6080/... │
└──────────────────────────────────────────────┘

                 │
                 │ TCP (RFB protocol)
                 ▼
       VNC server on the LAN
```

In development, Vite serves the UI on `:5174` and proxies `/api` to the standalone Node proxy on `:6080`. In the packaged build, the proxy runs inside Electron's main process and serves both `/api` and the static UI from `:6080`, so everything is same-origin.

---

## Remote control API

The proxy exposes a small REST surface on `http://localhost:6080` for listing and driving sessions from outside the app. The action endpoints work by routing commands over a control WebSocket (`/api/control`) that the renderer opens; if the UI isn't running (or you turned the API off — see below) the action endpoints return `503`. The `GET` endpoint always works.

Toggle the renderer's control connection from the **gear menu → "Expose remote-control API"** checkbox (on by default). When off, the WS stays closed, `controlConnected` reads `false`, and the action endpoints return `503`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/sessions` | — | `{ servers, active, current, activeRegions, controlConnected }` |
| `POST` | `/api/sessions/{id}/connect` | — | `{ ok: true }` |
| `POST` | `/api/sessions/{id}/disconnect` | — | `{ ok: true }` |
| `POST` | `/api/sessions/{id}/focus` | — | `{ ok: true }` — switch focused tab without (re)connecting |
| `POST` | `/api/sessions/{id}/screen` | `{ regionId: string \| null }` | `{ ok: true }` — `null` = full screen |
| `GET` | `/api/thumbnails/{id}` | — | JPEG bytes |

Each entry in `servers` includes the saved id/name/host/port/groupId, a list of `screens` (`{id, name}`), and a `thumbnail` URL path you can fetch directly.

```bash
curl http://localhost:6080/api/sessions | jq .
curl -X POST http://localhost:6080/api/sessions/<id>/connect
curl -X POST http://localhost:6080/api/sessions/<id>/screen \
  -H content-type:application/json -d '{"regionId":"<region-id>"}'
curl http://localhost:6080/api/thumbnails/<id> > preview.jpg
```

---

## Run from source

Requirements: Node 18+, npm.

```bash
git clone https://github.com/harveymoon/COOL_VNC.git
cd COOL_VNC
npm install
npm run dev          # Vite + standalone proxy in a terminal
# or
npm run electron:dev # Vite + Electron window
```

`npm run dev` opens `http://localhost:5174` in your browser. `npm run electron:dev` opens it in a native window.

The default password used by the network scan is `Spectr@2023!!`. Override with the `DEFAULT_VNC_PASSWORD` env var:

```bash
DEFAULT_VNC_PASSWORD="hunter2" npm run dev
```

---

## Build a redistributable

**Recommended: push a tag, let CI build for all platforms.**

```bash
npm version patch         # bumps package.json + creates a git tag
git push && git push --tags
```

`.github/workflows/release.yml` builds Windows x64 + macOS Intel + macOS Apple Silicon in parallel and publishes them to a GitHub Release.

**Local Windows build (no Mac):**

```bash
npm run icon               # regenerate build/icon.ico from public/favicon.svg
npm run pack:portable      # creates release/cool-vnc-win32-x64/
```

About 350 MB unpacked, ~140 MB zipped.

---

## Data files

| File | Purpose |
|---|---|
| `data/servers.json` | Saved server list — name, host, port, optional password (plaintext), stats, screen regions |
| `data/groups.json` | Group folders |
| `data/thumbnails/{serverId}.jpg` | Last-captured screenshot per server |

In packaged builds, `data/` lives at `%APPDATA%\cool-vnc\data\` (Windows), `~/Library/Application Support/cool-vnc/data/` (macOS), or `~/.config/cool-vnc/data/` (Linux).

**Passwords are stored in plaintext.** Don't sync this folder to anywhere public. The repo's `.gitignore` excludes `data/` for exactly this reason.

---

## Stack

| Layer | What |
|---|---|
| UI | Vanilla TypeScript, [noVNC 1.7](https://github.com/novnc/noVNC), Vite 5 |
| Backend | Node `http` + `ws`, [`des.js`](https://github.com/indutny/des.js) for VNC auth, ESM only |
| Shell | Electron 42, [`@electron/packager`](https://github.com/electron/packager) for the portable build |

No React, no framework, no state library — small enough to read end-to-end.

---

## Project layout

```
cool-vnc/
├── .github/workflows/
│   └── release.yml         # CI: builds win32-x64 + darwin-arm64 on tag push
├── build/
│   ├── make-icon.py        # SVG → icon.ico + iconset PNGs
│   └── icon.ico            # Committed Windows icon
├── electron/
│   ├── main.cjs            # Electron main: window, proxy import, vnc:// handler
│   └── preload.cjs         # contextBridge for the vnc-url IPC channel
├── server/
│   └── proxy.mjs           # HTTP + WS proxy + scan + auth + remote-control + static
├── src/
│   ├── main.ts             # UI entry point + state orchestration
│   ├── sidebar.ts          # Server list, groups, drag-drop + manual reorder
│   ├── sessions.ts         # SessionManager: RFB lifecycle, thumbnails, region transform
│   ├── modal.ts            # Add/edit server dialog
│   ├── scan-modal.ts       # Network scan UI + per-row password retry
│   ├── grid-view.ts        # Full-screen thumbnail grid + LIVE outlines
│   ├── screen-picker.ts    # Drag-rect region picker (sidebar takeover + handles)
│   ├── prompt-dialog.ts    # Generic in-app text/password input dialog
│   ├── control-client.ts   # WS to /api/control: push state, dispatch commands
│   ├── updater.ts          # Polls GitHub releases for newer tags
│   ├── thumbnails.ts       # Canvas → JPEG → POST /api/thumbnails
│   ├── stats.ts            # WebSocket + canvas paint hooks for stats
│   ├── storage.ts          # Typed API client for servers, groups, prefs
│   └── styles.css          # Dark theme + everything
├── public/
│   └── favicon.svg
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## License

MIT. noVNC is MPL-2.0; see `node_modules/@novnc/novnc/LICENSE.txt` after install.

Generated with [Claude Code](https://claude.com/claude-code).
