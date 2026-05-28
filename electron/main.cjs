const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !app.isPackaged;

// Single instance — second launch focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Register as the OS handler for vnc:// URLs. The packaged path is automatic;
// in dev (electron .) we need to tell Windows how to relaunch us.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("vnc", process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient("vnc");
}

let mainWindow = null;
let pendingVncUrl = null;

function extractVncUrl(args) {
  if (!Array.isArray(args)) return null;
  return args.find((a) => typeof a === "string" && /^vnc:\/\//i.test(a)) || null;
}

function deliverVncUrl(url) {
  if (!url) return;
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("vnc-url", url);
  } else {
    pendingVncUrl = url;
  }
}

// Choose a writable data dir for the proxy. In dev, project-local; in prod,
// the user's appdata so we never try to write inside the asar archive.
const dataDir = isDev
  ? path.join(__dirname, "..", "data")
  : path.join(app.getPath("userData"), "data");
process.env.COOL_VNC_DATA_DIR = dataDir;

// In production the proxy also serves the built UI at /.
const distDir = path.join(__dirname, "..", "dist");
if (!isDev && fs.existsSync(distDir)) {
  process.env.COOL_VNC_DIST_DIR = distDir;
}

async function startProxy() {
  // Import the ESM proxy from this CJS file. Sharing the main process means
  // the proxy dies with the window — no child to babysit.
  const proxyPath = path.join(__dirname, "..", "server", "proxy.mjs");
  const proxyUrl = "file://" + proxyPath.replace(/\\/g, "/");
  await import(proxyUrl);
}

function createWindow() {
  // In dev the icon sits in the repo; in the packaged app it's bundled in the asar.
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#0d0f12",
    title: "cool-vnc",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const startUrl = isDev ? "http://localhost:5174" : "http://localhost:6080";
  mainWindow.loadURL(startUrl);

  mainWindow.webContents.once("did-finish-load", () => {
    const initial = pendingVncUrl || extractVncUrl(process.argv);
    pendingVncUrl = null;
    if (initial) mainWindow.webContents.send("vnc-url", initial);
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", (_event, argv) => {
  const url = extractVncUrl(argv);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (url) deliverVncUrl(url);
});

// macOS protocol handler entry point.
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow) mainWindow.focus();
  deliverVncUrl(url);
});

app.whenReady().then(async () => {
  try {
    await startProxy();
  } catch (err) {
    console.error("[cool-vnc] proxy failed to start:", err);
  }
  // Give the proxy a moment to bind its listener
  await new Promise((r) => setTimeout(r, 250));
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
