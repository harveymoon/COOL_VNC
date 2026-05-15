# cool-vnc

A hackable, dark-themed VNC client for the browser, packaged as a single-file desktop app.

Built on [noVNC](https://github.com/novnc/noVNC). Adds a sidebar of saved servers, drag-drop groups, network scan with auto-auth, a settings overlay with quality and screen-region picking, periodic thumbnails, a full-screen grid view, and an Electron shell so you can ship it as a `.exe`.

---

## Download

Grab the latest portable build from the [Releases page](https://github.com/harveymoon/COOL_VNC/releases). Unzip and run `cool-vnc.exe` — no install, no Node, no Python.

Your saved servers, groups, and thumbnails live in `%APPDATA%\cool-vnc\data\` on Windows.

---

## What's in it

**Sidebar**
- Saved servers with status dots (grey / yellow pulse / green / red)
- Hover a connected dot → it turns into an `×` to disconnect inline
- Hover a row → `⋯` edit / delete
- Fuzzy search across name + host
- Sort by Name / Recent / Frequent
- Collapse button (`«`) shrinks the sidebar to a slim handle
- Group folders with drag-drop, expand/collapse, rename, delete; drop hint only shows during a drag

**Main area**
- Click a server → shows a Connect card with name + host:port
- Click **Connect** (or double-click the sidebar row) to open the session
- Errors render as a full-canvas card with the actual disconnect reason plus a retry button
- Gear (top-right) opens a settings panel: remote desktop name + resolution, quality slider (0-9), compression slider (0-9), and a stats overlay toggle that shows live `↓` / `↑` bytes-per-second and paint rate
- Screen-region picker: drag a rectangle over the live canvas, save it per-server, switch between regions from a dropdown. Snaps to canvas edges within 10%.

**Network scan**
- "Scan" button TCP-probes the local /24 subnets on port 5900 in parallel
- For every hit, runs an RFB handshake with a configurable default password and reports who let us in
- Successful auths auto-save with `groupId: undefined` so you can sort them yourself
- Reverse-DNS hostnames stripped of `.local` / `.localdomain` suffixes

**Grid view**
- `▦` button opens a full-screen overlay with a thumbnail per saved server
- Thumbnails are captured every 30 s while connected, plus on disconnect, and downscaled to ≤480 px JPEG
- **Refresh** button pings each server (1.2 s timeout via the proxy) and for live ones briefly opens a hidden noVNC connection, waits 1.8 s for frames, captures, and saves
- Zoom slider scales cards from `0.4×` to `2.5×` the auto-fit default
- Group sidebar on the left filters the visible cards; "All" by default

**Built-in proxy** (`server/proxy.mjs`)
- WebSocket → raw TCP bridge per saved server, so the browser doesn't need raw TCP
- HTTP API: `/api/servers`, `/api/groups`, `/api/thumbnails/{id}`, `/api/scan`, `/api/ping`
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

```bash
npm run pack:portable      # creates release/cool-vnc-win32-x64/
```

The output folder contains `cool-vnc.exe` plus Electron's runtime — about 350 MB unpacked, ~140 MB zipped. Send the zip to a friend; they extract and double-click.

For a one-click NSIS installer instead, run `npm run pack:win`. On Windows this requires **Developer Mode enabled** (Settings → For developers) or an admin shell, because `electron-builder` extracts a macOS code-signing toolset whose `.dylib` symlinks fail under standard user privileges.

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
| Optional | `electron-builder` for NSIS installer |

No React, no framework, no state library — small enough to read end-to-end.

---

## Project layout

```
cool-vnc/
├── electron/
│   └── main.cjs          # Electron main: spawns window, imports the proxy
├── server/
│   └── proxy.mjs         # HTTP + WS proxy + scan + auth + static serving
├── src/
│   ├── main.ts           # UI entry point + state orchestration
│   ├── sidebar.ts        # Server list, groups, drag-drop
│   ├── sessions.ts       # SessionManager: RFB lifecycle, thumbnails, region transform
│   ├── modal.ts          # Add/edit server dialog
│   ├── scan-modal.ts     # Network scan results UI
│   ├── grid-view.ts      # Full-screen thumbnail grid + refresh
│   ├── screen-picker.ts  # Drag-rect region picker (snap + clamp)
│   ├── thumbnails.ts     # Canvas → JPEG → POST /api/thumbnails
│   ├── stats.ts          # WebSocket + canvas paint hooks for stats
│   ├── storage.ts        # Typed API client for servers, groups, prefs
│   └── styles.css        # Dark theme + everything
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
