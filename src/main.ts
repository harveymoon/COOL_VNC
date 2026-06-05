import "./stats.js";
import {
  loadServers,
  saveServers,
  loadGroups,
  saveGroups,
  loadPrefs,
  savePrefs,
  type SavedServer,
  type ServerGroup,
  type UiPrefs,
  type SortMode,
  type ScreenRegion,
} from "./storage.js";
import { SessionManager, type DesktopInfo } from "./sessions.js";
import { Sidebar } from "./sidebar.js";
import { showServerModal } from "./modal.js";
import { showScanModal } from "./scan-modal.js";
import { pickScreenRegion } from "./screen-picker.js";
import { getSocketStats, getCanvasPaints } from "./stats.js";
import { showGridView } from "./grid-view.js";
import { showInputDialog } from "./prompt-dialog.js";
import { ControlClient } from "./control-client.js";
import { checkForUpdate, dismissUpdate } from "./updater.js";

const sidebarEl = document.getElementById("sidebar")!;
const stageEl = document.getElementById("stage")!;

let servers: SavedServer[] = await loadServers();
let groups: ServerGroup[] = await loadGroups();
let selectedId: string | null = null;
const prefs: UiPrefs = loadPrefs();

// One-time migration: pull any legacy localStorage entries into the JSON file
try {
  const legacy = localStorage.getItem("cool-vnc.servers");
  if (legacy) {
    const parsed = JSON.parse(legacy) as SavedServer[];
    if (Array.isArray(parsed) && parsed.length > 0 && servers.length === 0) {
      console.log("[cool-vnc] migrating", parsed.length, "server(s) from localStorage");
      servers = parsed;
      await saveServers(servers);
    }
    localStorage.removeItem("cool-vnc.servers");
  }
} catch {
  // ignore
}

const sessions = new SessionManager(stageEl);
sessions.setQuality(prefs.quality);
sessions.setCompression(prefs.compression);

// ── Stage overlays ──────────────────────────────────────────────────────────

const emptyState = document.createElement("div");
emptyState.className = "empty-state";
stageEl.appendChild(emptyState);

const connectPrompt = document.createElement("div");
connectPrompt.className = "connect-prompt";
connectPrompt.style.display = "none";
connectPrompt.innerHTML = `
  <div class="connect-card">
    <div class="connect-name"></div>
    <div class="connect-target"></div>
    <button type="button" class="btn btn-primary" data-connect>Connect</button>
  </div>
`;
stageEl.appendChild(connectPrompt);
const connectNameEl = connectPrompt.querySelector(".connect-name") as HTMLElement;
const connectTargetEl = connectPrompt.querySelector(".connect-target") as HTMLElement;

const errorOverlay = document.createElement("div");
errorOverlay.className = "error-overlay";
errorOverlay.style.display = "none";
errorOverlay.innerHTML = `
  <div class="error-card">
    <div class="error-icon">!</div>
    <div class="error-title"></div>
    <div class="error-message"></div>
    <button type="button" class="btn btn-primary" data-retry>Retry</button>
  </div>
`;
stageEl.appendChild(errorOverlay);
const errorTitleEl = errorOverlay.querySelector(".error-title") as HTMLElement;
const errorMessageEl = errorOverlay.querySelector(".error-message") as HTMLElement;

// ── Settings panel ──────────────────────────────────────────────────────────

const settingsPanel = document.createElement("div");
settingsPanel.className = "settings-panel";
settingsPanel.style.display = "none";
settingsPanel.innerHTML = `
  <button type="button" class="settings-gear" title="Settings">⚙</button>
  <div class="settings-popover">
    <div class="settings-header">Connection</div>
    <div class="settings-row">
      <span class="settings-label">Desktop</span>
      <span class="settings-value" data-desktop-name>—</span>
    </div>
    <div class="settings-row">
      <span class="settings-label">Resolution</span>
      <span class="settings-value" data-desktop-size>—</span>
    </div>
    <div class="settings-section">
      <div class="settings-section-label">Display</div>
      <div class="settings-display-row">
        <select class="sort-select" data-screen-select></select>
        <button type="button" class="icon-btn" data-screen-delete title="Delete region">🗑</button>
      </div>
      <button type="button" class="btn" data-pick-region>Pick region from screen</button>
    </div>
    <div class="settings-slider-row">
      <div class="settings-slider-label">
        <span>Quality</span>
        <span data-quality-value></span>
      </div>
      <input type="range" min="0" max="9" data-quality />
      <div class="settings-hint">Higher = sharper, more bandwidth</div>
    </div>
    <div class="settings-slider-row">
      <div class="settings-slider-label">
        <span>Compression</span>
        <span data-compression-value></span>
      </div>
      <input type="range" min="0" max="9" data-compression />
      <div class="settings-hint">Higher = less bandwidth, more CPU</div>
    </div>
    <label class="settings-toggle">
      <input type="checkbox" data-show-stats />
      <span>Show stats overlay</span>
    </label>
    <label class="settings-toggle">
      <input type="checkbox" data-remote-api />
      <span>Expose remote-control API</span>
    </label>
  </div>
`;
stageEl.appendChild(settingsPanel);

const gearBtn = settingsPanel.querySelector(".settings-gear") as HTMLButtonElement;
const desktopNameEl = settingsPanel.querySelector("[data-desktop-name]") as HTMLElement;
const desktopSizeEl = settingsPanel.querySelector("[data-desktop-size]") as HTMLElement;
const qualitySlider = settingsPanel.querySelector("[data-quality]") as HTMLInputElement;
const qualityValueEl = settingsPanel.querySelector("[data-quality-value]") as HTMLElement;
const compressionSlider = settingsPanel.querySelector("[data-compression]") as HTMLInputElement;
const compressionValueEl = settingsPanel.querySelector("[data-compression-value]") as HTMLElement;
const screenSelect = settingsPanel.querySelector("[data-screen-select]") as HTMLSelectElement;
const screenDeleteBtn = settingsPanel.querySelector("[data-screen-delete]") as HTMLButtonElement;
const pickRegionBtn = settingsPanel.querySelector("[data-pick-region]") as HTMLButtonElement;
const showStatsToggle = settingsPanel.querySelector("[data-show-stats]") as HTMLInputElement;
showStatsToggle.checked = prefs.showStats;
const remoteApiToggle = settingsPanel.querySelector("[data-remote-api]") as HTMLInputElement;
remoteApiToggle.checked = prefs.remoteApiEnabled;

const statsWidget = document.createElement("div");
statsWidget.className = "stats-widget";
statsWidget.style.display = "none";
statsWidget.innerHTML = `
  <div><span class="stats-label">↓</span><span data-stat-down>—</span></div>
  <div><span class="stats-label">↑</span><span data-stat-up>—</span></div>
  <div><span class="stats-label">fps</span><span data-stat-fps>—</span></div>
`;
stageEl.appendChild(statsWidget);
const statDownEl = statsWidget.querySelector("[data-stat-down]") as HTMLElement;
const statUpEl = statsWidget.querySelector("[data-stat-up]") as HTMLElement;
const statFpsEl = statsWidget.querySelector("[data-stat-fps]") as HTMLElement;

let statsBaseline: { sessionId: string; bytesIn: number; bytesOut: number; paints: number } | null = null;

const updateStatsVisibility = () => {
  const server = selectedServer();
  const live =
    prefs.showStats &&
    !!server &&
    (sessions.getStatus(server.id) === "connected" || sessions.getStatus(server.id) === "connecting");
  statsWidget.style.display = live ? "flex" : "none";
  if (!live) {
    statsBaseline = null;
    statDownEl.textContent = "—";
    statUpEl.textContent = "—";
    statFpsEl.textContent = "—";
  }
};

const fmtRate = (b: number): string => {
  if (b < 1024) return `${b} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1024 / 1024).toFixed(2)} MB/s`;
};

setInterval(() => {
  if (!prefs.showStats) return;
  const server = selectedServer();
  if (!server) return;
  const status = sessions.getStatus(server.id);
  if (status !== "connected" && status !== "connecting") return;

  const urlNeedle = `/${encodeURIComponent(server.host)}/${server.port}`;
  const sock = getSocketStats((url) => url.includes(urlNeedle));
  const paints = getCanvasPaints(sessions.getCanvas(server.id));

  if (!statsBaseline || statsBaseline.sessionId !== server.id) {
    statsBaseline = { sessionId: server.id, bytesIn: sock.bytesIn, bytesOut: sock.bytesOut, paints };
    return;
  }

  const dIn = sock.bytesIn - statsBaseline.bytesIn;
  const dOut = sock.bytesOut - statsBaseline.bytesOut;
  const dPaints = paints - statsBaseline.paints;
  statsBaseline = { sessionId: server.id, bytesIn: sock.bytesIn, bytesOut: sock.bytesOut, paints };

  statDownEl.textContent = fmtRate(dIn);
  statUpEl.textContent = fmtRate(dOut);
  statFpsEl.textContent = String(dPaints);
}, 1000);

showStatsToggle.addEventListener("change", () => {
  prefs.showStats = showStatsToggle.checked;
  savePrefs(prefs);
  updateStatsVisibility();
});

qualitySlider.value = String(prefs.quality);
qualityValueEl.textContent = String(prefs.quality);
compressionSlider.value = String(prefs.compression);
compressionValueEl.textContent = String(prefs.compression);

gearBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (!settingsPanel.contains(e.target as Node)) settingsPanel.classList.remove("open");
});

qualitySlider.addEventListener("input", () => {
  const v = Number(qualitySlider.value);
  qualityValueEl.textContent = String(v);
  prefs.quality = v;
  sessions.setQuality(v);
  savePrefs(prefs);
});
compressionSlider.addEventListener("input", () => {
  const v = Number(compressionSlider.value);
  compressionValueEl.textContent = String(v);
  prefs.compression = v;
  sessions.setCompression(v);
  savePrefs(prefs);
});

const updateDesktopInfo = (info: DesktopInfo | undefined) => {
  desktopNameEl.textContent = info?.name || "—";
  desktopSizeEl.textContent =
    info?.width && info?.height ? `${info.width} × ${info.height}` : "—";
};

sessions.onDesktopInfo((id, info) => {
  if (id === selectedId) updateDesktopInfo(info);
});

const renderScreenOptions = (server: SavedServer | undefined) => {
  screenSelect.innerHTML = "";
  const fullOpt = document.createElement("option");
  fullOpt.value = "";
  fullOpt.textContent = "Full screen";
  screenSelect.appendChild(fullOpt);
  for (const region of server?.screens ?? []) {
    const opt = document.createElement("option");
    opt.value = region.id;
    opt.textContent = region.name;
    screenSelect.appendChild(opt);
  }
  screenSelect.value = server?.activeScreenId ?? "";
  screenDeleteBtn.style.visibility = screenSelect.value ? "visible" : "hidden";
};

const applyActiveRegion = (server: SavedServer) => {
  const region = server.screens?.find((r) => r.id === server.activeScreenId) ?? null;
  sessions.setRegion(server.id, region);
};

screenSelect.addEventListener("change", async () => {
  const server = selectedServer();
  if (!server) return;
  const newActive = screenSelect.value || undefined;
  servers = servers.map((s) => (s.id === server.id ? { ...s, activeScreenId: newActive } : s));
  await saveServers(servers);
  const updated = servers.find((s) => s.id === server.id)!;
  applyActiveRegion(updated);
  screenDeleteBtn.style.visibility = newActive ? "visible" : "hidden";
});

screenDeleteBtn.addEventListener("click", async () => {
  const server = selectedServer();
  if (!server) return;
  const id = screenSelect.value;
  if (!id) return;
  if (!confirm("Delete this screen region?")) return;
  const screens = (server.screens ?? []).filter((r) => r.id !== id);
  const activeScreenId = server.activeScreenId === id ? undefined : server.activeScreenId;
  servers = servers.map((s) => (s.id === server.id ? { ...s, screens, activeScreenId } : s));
  await saveServers(servers);
  const updated = servers.find((s) => s.id === server.id)!;
  renderScreenOptions(updated);
  applyActiveRegion(updated);
});

pickRegionBtn.addEventListener("click", async () => {
  const server = selectedServer();
  if (!server) return;
  const container = sessions.getContainer(server.id);
  const canvas = sessions.getCanvas(server.id);
  if (!container || !canvas) return;
  settingsPanel.classList.remove("open");
  sessions.setRegion(server.id, null);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const defaultName = `Screen ${(server.screens?.length ?? 0) + 1}`;
  const region = await pickScreenRegion(container, canvas, sidebarEl, defaultName);
  if (!region) {
    applyActiveRegion(server);
    return;
  }
  const screens: ScreenRegion[] = [...(server.screens ?? []), region];
  servers = servers.map((s) =>
    s.id === server.id ? { ...s, screens, activeScreenId: region.id } : s,
  );
  await saveServers(servers);
  const updated = servers.find((s) => s.id === server.id)!;
  renderScreenOptions(updated);
  applyActiveRegion(updated);
});

// ── Stage state machine ────────────────────────────────────────────────────

const selectedServer = (): SavedServer | undefined =>
  selectedId ? servers.find((s) => s.id === selectedId) : undefined;

// Re-assigned once the ControlClient is constructed below.
let pushControl: () => void = () => {};

const refreshMainArea = () => {
  pushControl();
  const server = selectedServer();

  if (!server) {
    sessions.unfocus();
    emptyState.style.display = "flex";
    emptyState.textContent = servers.length
      ? "Select a server from the sidebar."
      : "Add a server to get started.";
    connectPrompt.style.display = "none";
    errorOverlay.style.display = "none";
    settingsPanel.style.display = "none";
    settingsPanel.classList.remove("open");
    updateStatsVisibility();
    return;
  }

  emptyState.style.display = "none";
  const status = sessions.getStatus(server.id);

  if (status === "connected" || status === "connecting") {
    sessions.focus(server.id);
    connectPrompt.style.display = "none";
    errorOverlay.style.display = "none";
    settingsPanel.style.display = "block";
    updateDesktopInfo(sessions.getDesktopInfo(server.id));
    renderScreenOptions(server);
    if (status === "connected") applyActiveRegion(server);
    updateStatsVisibility();
    return;
  }

  sessions.unfocus();
  settingsPanel.style.display = "none";
  settingsPanel.classList.remove("open");
  updateStatsVisibility();

  if (status === "error") {
    connectPrompt.style.display = "none";
    errorTitleEl.textContent = `Couldn't connect to ${server.name}`;
    errorMessageEl.textContent = sessions.getError(server.id) ?? "Unknown error";
    errorOverlay.style.display = "flex";
  } else {
    errorOverlay.style.display = "none";
    connectNameEl.textContent = server.name;
    connectTargetEl.textContent = `${server.host}:${server.port}`;
    connectPrompt.style.display = "flex";
  }
};

connectPrompt.querySelector("[data-connect]")!.addEventListener("click", () => {
  const server = selectedServer();
  if (!server) return;
  sessions.open(server);
});

errorOverlay.querySelector("[data-retry]")!.addEventListener("click", () => {
  const server = selectedServer();
  if (!server) return;
  sessions.open(server);
});

// Auth-failure recovery: when a connect attempt fails on credentials, pop a
// password prompt. We don't persist the typed password until the next
// connection actually succeeds — saving on failure would overwrite the saved
// password with a known-bad value.
const authPromptOpen = new Set<string>();
const pendingPasswords = new Map<string, string>();

sessions.onStatusChange(async (id, status, detail) => {
  if (id === selectedId) refreshMainArea();
  if (status !== "error" || detail?.kind !== "auth") return;
  if (authPromptOpen.has(id)) return;

  const server = servers.find((s) => s.id === id);
  if (!server) return;

  authPromptOpen.add(id);
  try {
    const newPassword = await showInputDialog({
      title: server.password ? `Wrong password for ${server.name}` : `Password for ${server.name}`,
      placeholder: "VNC password",
      okLabel: "Connect",
      type: "password",
    });
    if (newPassword === null) return;

    pendingPasswords.set(id, newPassword);
    sessions.open({ ...server, password: newPassword });
  } finally {
    authPromptOpen.delete(id);
  }
});

sessions.onConnected((id) => {
  const idx = servers.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const s = servers[idx];
  const pending = pendingPasswords.get(id);
  pendingPasswords.delete(id);
  servers[idx] = {
    ...s,
    password: pending ?? s.password,
    lastConnectedAt: Date.now(),
    connectCount: (s.connectCount ?? 0) + 1,
  };
  saveServers(servers);
  sidebar.setServers(servers);
});

// ── Sidebar ────────────────────────────────────────────────────────────────

const sidebar = new Sidebar(
  sidebarEl,
  servers,
  sessions,
  {
    onSelect: (server) => {
      selectedId = server.id;
      sidebar.setActive(server.id);
      refreshMainArea();
    },
    onActivate: (server) => {
      selectedId = server.id;
      sidebar.setActive(server.id);
      sessions.open(server);
      refreshMainArea();
    },
    onAdd: async () => {
      const result = await showServerModal();
      if (result.action !== "save") return;
      servers = [...servers, result.server];
      await saveServers(servers);
      sidebar.setServers(servers);
      refreshMainArea();
    },
    onEdit: async (server) => {
      const result = await showServerModal(server);
      if (result.action === "cancel") return;

      sessions.close(server.id);

      if (result.action === "delete") {
        servers = servers.filter((s) => s.id !== server.id);
        if (selectedId === server.id) selectedId = null;
      } else {
        servers = servers.map((s) => (s.id === server.id ? { ...s, ...result.server } : s));
      }

      await saveServers(servers);
      sidebar.setServers(servers);
      if (!selectedId) sidebar.setActive(null);
      refreshMainArea();
    },
    onClose: (server) => {
      sessions.close(server.id);
      refreshMainArea();
    },
    onSortChange: (mode: SortMode) => {
      prefs.sort = mode;
      savePrefs(prefs);
    },
    onCollapseChange: (collapsed) => {
      prefs.collapsed = collapsed;
      savePrefs(prefs);
    },
    onScan: async () => {
      const result = await showScanModal(servers);
      if (result.toAdd.length === 0) return;
      servers = [...servers, ...result.toAdd];
      await saveServers(servers);
      sidebar.setServers(servers);
      refreshMainArea();
    },
    onGrid: () => {
      showGridView(servers, groups, {
        onSelect: (server) => {
          selectedId = server.id;
          sidebar.setActive(server.id);
          sessions.open(server);
          refreshMainArea();
        },
        onClose: () => {
          // nothing
        },
        isActive: (id) => {
          const s = sessions.getStatus(id);
          return s === "connected" || s === "connecting";
        },
      });
    },
    onAddGroup: async () => {
      const name = await showInputDialog({
        title: "New group",
        placeholder: "Group name",
        okLabel: "Create",
      });
      if (!name) return;
      const newGroup: ServerGroup = {
        id: crypto.randomUUID(),
        name,
        expanded: true,
      };
      groups = [...groups, newGroup];
      await saveGroups(groups);
      sidebar.setGroups(groups);
    },
    onRenameGroup: async (group) => {
      const name = await showInputDialog({
        title: "Rename group",
        defaultValue: group.name,
        okLabel: "Rename",
      });
      if (!name || name === group.name) return;
      groups = groups.map((g) => (g.id === group.id ? { ...g, name } : g));
      await saveGroups(groups);
      sidebar.setGroups(groups);
    },
    onDeleteGroup: async (group) => {
      const inGroup = servers.filter((s) => s.groupId === group.id).length;
      const msg = inGroup
        ? `Delete group "${group.name}"? ${inGroup} server(s) will move to ungrouped.`
        : `Delete empty group "${group.name}"?`;
      if (!confirm(msg)) return;
      groups = groups.filter((g) => g.id !== group.id);
      servers = servers.map((s) => (s.groupId === group.id ? { ...s, groupId: undefined } : s));
      await Promise.all([saveGroups(groups), saveServers(servers)]);
      sidebar.setGroups(groups);
      sidebar.setServers(servers);
    },
    onToggleGroup: async (group) => {
      groups = groups.map((g) => (g.id === group.id ? { ...g, expanded: !g.expanded } : g));
      await saveGroups(groups);
      sidebar.setGroups(groups);
    },
    onMoveServerToGroup: async (serverId, groupId) => {
      const target = servers.find((s) => s.id === serverId);
      if (!target) return;
      if ((target.groupId ?? null) === groupId) return;
      servers = servers.map((s) =>
        s.id === serverId ? { ...s, groupId: groupId ?? undefined } : s,
      );
      await saveServers(servers);
      sidebar.setServers(servers);
    },
    onReorderServer: async (serverId, beforeId, targetGroupId) => {
      const dragged = servers.find((s) => s.id === serverId);
      if (!dragged) return;
      const updated: SavedServer = { ...dragged, groupId: targetGroupId ?? undefined };
      const rest = servers.filter((s) => s.id !== serverId);
      const insertAt = beforeId ? rest.findIndex((s) => s.id === beforeId) : -1;
      if (insertAt < 0) rest.push(updated);
      else rest.splice(insertAt, 0, updated);
      servers = rest;
      await saveServers(servers);
      sidebar.setServers(servers);
    },
    onReorderGroup: async (groupId, beforeGroupId) => {
      const dragged = groups.find((g) => g.id === groupId);
      if (!dragged) return;
      const rest = groups.filter((g) => g.id !== groupId);
      const insertAt = beforeGroupId ? rest.findIndex((g) => g.id === beforeGroupId) : -1;
      if (insertAt < 0) rest.push(dragged);
      else rest.splice(insertAt, 0, dragged);
      groups = rest;
      await saveGroups(groups);
      sidebar.setGroups(groups);
    },
  },
  { sort: prefs.sort, collapsed: prefs.collapsed },
);

sidebar.setGroups(groups);

refreshMainArea();

// ── Remote-control channel (exposes GET /api/sessions + POST commands) ─────

const setActiveRegion = async (serverId: string, regionId: string | null) => {
  const server = servers.find((s) => s.id === serverId);
  if (!server) return;
  const screens = server.screens ?? [];
  if (regionId !== null && !screens.some((r) => r.id === regionId)) return;
  servers = servers.map((s) =>
    s.id === serverId ? { ...s, activeScreenId: regionId ?? undefined } : s,
  );
  await saveServers(servers);
  const updated = servers.find((s) => s.id === serverId)!;
  if (selectedId === serverId) {
    renderScreenOptions(updated);
    applyActiveRegion(updated);
  } else {
    // Apply to the live session even if it's not the focused tab.
    const region = updated.screens?.find((r) => r.id === updated.activeScreenId) ?? null;
    sessions.setRegion(serverId, region);
  }
  control.pushState(buildControlState());
};

const buildControlState = () => {
  const active: string[] = [];
  for (const s of servers) {
    const st = sessions.getStatus(s.id);
    if (st === "connected" || st === "connecting") active.push(s.id);
  }
  const activeRegions: Record<string, string | null> = {};
  for (const s of servers) activeRegions[s.id] = s.activeScreenId ?? null;
  return { active, current: selectedId, activeRegions };
};

const control = new ControlClient({
  onConnect: (id) => {
    const server = servers.find((s) => s.id === id);
    if (!server) return;
    selectedId = id;
    sidebar.setActive(id);
    sessions.open(server);
    refreshMainArea();
  },
  onDisconnect: (id) => {
    sessions.close(id);
    refreshMainArea();
  },
  onFocus: (id) => {
    if (!servers.some((s) => s.id === id)) return;
    selectedId = id;
    sidebar.setActive(id);
    if (sessions.hasSession(id)) sessions.focus(id);
    refreshMainArea();
  },
  onScreen: (id, regionId) => {
    void setActiveRegion(id, regionId);
  },
});
if (prefs.remoteApiEnabled) control.start();

pushControl = () => control.pushState(buildControlState());
sessions.onStatusChange(pushControl);
sessions.onConnected(pushControl);
pushControl();

remoteApiToggle.addEventListener("change", () => {
  prefs.remoteApiEnabled = remoteApiToggle.checked;
  savePrefs(prefs);
  if (prefs.remoteApiEnabled) control.start();
  else control.stop();
});

// vnc:// deep links from the OS protocol handler. Match an existing server
// by host:port, otherwise create a new entry; either way, connect.
declare global {
  interface Window {
    coolVnc?: { onVncUrl: (cb: (url: string) => void) => void };
  }
}

// ── Update check ───────────────────────────────────────────────────────────
// Fire-and-forget on startup. If GitHub has a newer release, drop a pill into
// the sidebar header that opens the release page.
void (async () => {
  const update = await checkForUpdate();
  if (!update) return;
  const header = sidebarEl.querySelector(".sidebar-header");
  if (!header) return;

  const pill = document.createElement("a");
  pill.className = "update-pill";
  pill.href = update.url;
  pill.target = "_blank";
  pill.rel = "noreferrer noopener";
  pill.title = `You're on v${update.current} — click to view the ${update.latest} release on GitHub`;
  pill.textContent = `${update.latest} ↗`;

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "update-pill-dismiss";
  dismiss.title = "Dismiss";
  dismiss.textContent = "×";
  dismiss.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissUpdate(update.latest);
    pill.remove();
  });
  pill.appendChild(dismiss);
  header.appendChild(pill);
})();

// ── Clipboard sync ─────────────────────────────────────────────────────────
// On Ctrl/Cmd+V while a session is connected, push the local clipboard text
// into the remote via RFB ClientCutText. We don't preventDefault, so the same
// keystroke still reaches noVNC and gets forwarded to the remote — the remote
// then pastes from its local clipboard, which is now ours. Remote → local
// sync is handled by the rfb "clipboard" listener in SessionManager.
document.addEventListener(
  "keydown",
  async (e) => {
    const isPaste = (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V");
    if (!isPaste) return;
    const server = selectedServer();
    if (!server) return;
    if (sessions.getStatus(server.id) !== "connected") return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) sessions.sendClipboard(server.id, text);
    } catch (err) {
      console.warn("[cool-vnc] clipboard.readText failed", err);
    }
  },
  true,
);

// ── Mac: Option key → Windows / Super_L ────────────────────────────────────
// noVNC's default keymap turns Mac Cmd into Alt on the remote and drops
// Option entirely. Since Option is otherwise dead, we repurpose it as the
// Super (Windows) key: hold Option+R for Win+R, Option+E for Win+E, or tap
// Option alone to open the Start menu.
if (/Mac/i.test(navigator.platform)) {
  const SUPER_L = 0xffeb;
  let supersDown = false;

  const releaseSuper = () => {
    if (!supersDown) return;
    supersDown = false;
    const server = selectedServer();
    if (!server) return;
    sessions.sendKey(server.id, SUPER_L, "MetaLeft", false);
  };

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "AltLeft" && e.code !== "AltRight") return;
      const server = selectedServer();
      if (!server || sessions.getStatus(server.id) !== "connected") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || supersDown) return;
      supersDown = true;
      sessions.sendKey(server.id, SUPER_L, "MetaLeft", true);
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (e) => {
      if (e.code !== "AltLeft" && e.code !== "AltRight") return;
      e.preventDefault();
      e.stopPropagation();
      releaseSuper();
    },
    true,
  );

  // If focus leaves while Option is held (e.g. Cmd+Tab away), make sure the
  // remote doesn't think Super is still down.
  window.addEventListener("blur", releaseSuper);
}

window.coolVnc?.onVncUrl(async (raw) => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return;
  }
  if (parsed.protocol !== "vnc:") return;
  const host = parsed.hostname;
  if (!host) return;
  const port = parsed.port ? Number(parsed.port) : 5900;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  let server = servers.find((s) => s.host === host && s.port === port);
  if (!server) {
    server = {
      id: crypto.randomUUID(),
      name: `${host}:${port}`,
      host,
      port,
      password,
    };
    servers = [...servers, server];
    await saveServers(servers);
    sidebar.setServers(servers);
  } else if (password && server.password !== password) {
    const updated: SavedServer = { ...server, password };
    servers = servers.map((s) => (s.id === server!.id ? updated : s));
    await saveServers(servers);
    sidebar.setServers(servers);
    server = updated;
  }

  selectedId = server.id;
  sidebar.setActive(server.id);
  sessions.open(server);
  refreshMainArea();
});
