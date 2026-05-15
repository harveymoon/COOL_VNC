import RFB from "@novnc/novnc";
import type { SavedServer, ServerGroup } from "./storage.js";
import { saveThumbnail, thumbnailUrl } from "./thumbnails.js";

const PROXY_PORT = 6080;
const CAPTURE_CONCURRENCY = 4;
const CAPTURE_FRAME_WAIT_MS = 1800;
const CAPTURE_OVERALL_TIMEOUT_MS = 10_000;

export interface GridHandlers {
  onSelect: (server: SavedServer) => void;
  onClose: () => void;
}

type CardState = "idle" | "refreshing" | "offline" | "failed" | "ok";

interface Card {
  server: SavedServer;
  el: HTMLDivElement;
  imgEl: HTMLImageElement;
  statusEl: HTMLDivElement;
  setState: (state: CardState, note?: string) => void;
}

export function showGridView(
  servers: SavedServer[],
  groups: ServerGroup[],
  handlers: GridHandlers,
): void {
  const overlay = document.createElement("div");
  overlay.className = "grid-overlay";

  const header = document.createElement("div");
  header.className = "grid-header";
  header.innerHTML = `
    <div class="grid-title">All servers</div>
    <div class="grid-zoom">
      <span class="grid-zoom-label">Size</span>
      <input type="range" min="0.4" max="2.5" step="0.05" value="1" data-zoom />
    </div>
    <button type="button" class="btn" data-refresh>Refresh</button>
    <button type="button" class="icon-btn" data-close title="Close">×</button>
  `;
  overlay.appendChild(header);

  const side = document.createElement("div");
  side.className = "grid-side";
  if (groups.length === 0) side.classList.add("hidden");
  overlay.appendChild(side);

  const body = document.createElement("div");
  body.className = "grid-body";
  overlay.appendChild(body);

  const cards: Card[] = [];
  for (const server of servers) {
    cards.push(createCard(server, handlers, body));
  }

  if (servers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "grid-empty";
    empty.textContent = "No saved servers.";
    body.appendChild(empty);
  }

  document.body.appendChild(overlay);

  // ── Group filter sidebar ──
  let activeGroupId: string | null = null; // null = All
  const groupButtons = new Map<string | null, HTMLButtonElement>();

  const makeGroupBtn = (id: string | null, label: string, count: number) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "grid-side-item";
    btn.innerHTML = `<span class="grid-side-label"></span><span class="grid-side-count"></span>`;
    (btn.querySelector(".grid-side-label") as HTMLElement).textContent = label;
    (btn.querySelector(".grid-side-count") as HTMLElement).textContent = String(count);
    btn.addEventListener("click", () => {
      activeGroupId = id;
      applyFilter();
    });
    side.appendChild(btn);
    groupButtons.set(id, btn);
  };

  if (groups.length > 0) {
    makeGroupBtn(null, "All", servers.length);
    for (const g of groups) {
      const c = servers.filter((s) => s.groupId === g.id).length;
      makeGroupBtn(g.id, g.name, c);
    }
    const ungroupedCount = servers.filter(
      (s) => !s.groupId || !groups.some((g) => g.id === s.groupId),
    ).length;
    if (ungroupedCount > 0) {
      makeGroupBtn("__ungrouped__", "Ungrouped", ungroupedCount);
    }
  }

  // ── Layout: compute default cell width and wire the slider ──
  const zoom = header.querySelector("[data-zoom]") as HTMLInputElement;
  let baseCellWidth = computeOptimalCellWidth(visibleCount(), body);
  let zoomValue = Number(zoom.value);

  function visibleCount(): number {
    return cards.filter((c) => c.el.style.display !== "none").length || servers.length;
  }

  const applyLayout = () => {
    const w = Math.round(baseCellWidth * zoomValue);
    overlay.style.setProperty("--grid-cell-width", `${w}px`);
  };

  const applyFilter = () => {
    let visible = 0;
    for (const card of cards) {
      let inFilter: boolean;
      if (activeGroupId === null) inFilter = true;
      else if (activeGroupId === "__ungrouped__") {
        inFilter = !card.server.groupId || !groups.some((g) => g.id === card.server.groupId);
      } else inFilter = card.server.groupId === activeGroupId;
      card.el.style.display = inFilter ? "" : "none";
      if (inFilter) visible++;
    }
    for (const [id, btn] of groupButtons) {
      btn.classList.toggle("active", id === activeGroupId);
    }
    if (visible > 0) {
      baseCellWidth = computeOptimalCellWidth(visible, body);
      applyLayout();
    }
  };

  applyFilter();
  applyLayout();

  zoom.addEventListener("input", () => {
    zoomValue = Number(zoom.value);
    applyLayout();
  });

  const onResize = () => {
    baseCellWidth = computeOptimalCellWidth(visibleCount(), body);
    applyLayout();
  };
  window.addEventListener("resize", onResize);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    handlers.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  (header.querySelector("[data-close]") as HTMLButtonElement).addEventListener("click", close);

  for (const card of cards) {
    card.el.addEventListener("click", () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      handlers.onSelect(card.server);
    });
  }

  const refreshBtn = header.querySelector("[data-refresh]") as HTMLButtonElement;
  refreshBtn.addEventListener("click", () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
    refreshAll(cards).finally(() => {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Refresh";
    });
  });
}

function createCard(server: SavedServer, handlers: GridHandlers, parent: HTMLElement): Card {
  const el = document.createElement("div");
  el.className = "grid-card";

  const thumb = document.createElement("div");
  thumb.className = "grid-thumb";
  const img = document.createElement("img");
  img.alt = "";
  img.src = thumbnailUrl(server.id, true);
  img.addEventListener("error", () => {
    img.style.display = "none";
    const ph = document.createElement("div");
    ph.className = "grid-placeholder";
    ph.textContent = "No preview";
    thumb.appendChild(ph);
  });
  thumb.appendChild(img);

  const name = document.createElement("div");
  name.className = "grid-card-name";
  name.textContent = server.name;

  const target = document.createElement("div");
  target.className = "grid-card-target";
  target.textContent = `${server.host}:${server.port}`;

  const status = document.createElement("div");
  status.className = "grid-card-status";

  el.appendChild(thumb);
  el.appendChild(name);
  el.appendChild(target);
  el.appendChild(status);
  parent.appendChild(el);

  // click wiring lives in showGridView so it can close the overlay first

  const setState = (state: CardState, note?: string) => {
    el.classList.remove("state-idle", "state-refreshing", "state-offline", "state-failed", "state-ok");
    el.classList.add(`state-${state}`);
    if (state === "refreshing") status.textContent = note ?? "Capturing...";
    else if (state === "offline") status.textContent = note ?? "Offline";
    else if (state === "failed") status.textContent = note ?? "Capture failed";
    else status.textContent = "";
  };
  setState("idle");

  return { server, el, imgEl: img, statusEl: status, setState };
}

async function refreshAll(cards: Card[]): Promise<void> {
  // Concurrency-limited
  const queue = [...cards];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < CAPTURE_CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length) {
          const card = queue.shift();
          if (!card) return;
          await refreshOne(card);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

async function refreshOne(card: Card): Promise<void> {
  card.setState("refreshing", "Pinging...");

  let alive = false;
  try {
    const res = await fetch(
      `/api/ping?host=${encodeURIComponent(card.server.host)}&port=${card.server.port}`,
    );
    const data = await res.json();
    alive = !!data.alive;
  } catch {
    alive = false;
  }

  if (!alive) {
    card.setState("offline");
    return;
  }

  card.setState("refreshing", "Capturing...");
  const result = await captureThumbnail(card.server);
  if (result === "ok") {
    // refresh image src with cache buster
    card.imgEl.style.display = "";
    card.imgEl.src = thumbnailUrl(card.server.id, true);
    // remove any prior placeholder
    const ph = card.el.querySelector(".grid-placeholder");
    if (ph) ph.remove();
    card.setState("ok");
  } else {
    card.setState("failed");
  }
}

// Card chrome (name + target + status) below the 16:10 thumb. Approximate.
const CARD_CHROME_PX = 70;
const CARD_GAP_PX = 16;
const CARD_ASPECT_H_OVER_W = 10 / 16;
const MIN_CELL_PX = 120;
const MAX_CELL_PX = 1400;

function computeOptimalCellWidth(count: number, gridBody: HTMLElement): number {
  if (count <= 0) return 280;
  const rect = gridBody.getBoundingClientRect();
  const availW = Math.max(MIN_CELL_PX, rect.width || window.innerWidth - 40);
  const availH = Math.max(MIN_CELL_PX, rect.height || window.innerHeight - 100);

  let best = 0;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (availW - (cols - 1) * CARD_GAP_PX) / cols;
    if (cellW < MIN_CELL_PX) break; // more columns will only make it smaller
    const cardH = cellW * CARD_ASPECT_H_OVER_W + CARD_CHROME_PX;
    const totalH = rows * cardH + Math.max(0, rows - 1) * CARD_GAP_PX;
    if (totalH <= availH && cellW > best) best = cellW;
  }

  if (best === 0) {
    // Cannot fit all rows; pick cell width such that one row fits the height
    const rows = Math.max(1, Math.floor((availH + CARD_GAP_PX) / (availH * 0.5 + CARD_CHROME_PX + CARD_GAP_PX)));
    const cols = Math.max(1, Math.ceil(count / rows));
    best = (availW - (cols - 1) * CARD_GAP_PX) / cols;
  }

  return Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.floor(best)));
}

function captureThumbnail(server: SavedServer): Promise<"ok" | "failed"> {
  return new Promise((resolve) => {
    const hidden = document.createElement("div");
    hidden.style.position = "fixed";
    hidden.style.left = "-10000px";
    hidden.style.top = "-10000px";
    hidden.style.width = "1024px";
    hidden.style.height = "768px";
    document.body.appendChild(hidden);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.hostname}:${PROXY_PORT}/${encodeURIComponent(server.host)}/${server.port}`;

    let rfb: any;
    try {
      rfb = new RFB(hidden, url, {
        credentials: server.password ? { password: server.password } : undefined,
      });
      rfb.scaleViewport = true;
      rfb.viewOnly = true;
    } catch (err) {
      console.warn("[grid] RFB construct failed", server.name, err);
      hidden.remove();
      resolve("failed");
      return;
    }

    let done = false;
    const finish = (result: "ok" | "failed") => {
      if (done) return;
      done = true;
      try {
        rfb.disconnect();
      } catch {
        // ignore
      }
      window.setTimeout(() => hidden.remove(), 200);
      resolve(result);
    };

    rfb.addEventListener("connect", () => {
      window.setTimeout(async () => {
        const canvas = hidden.querySelector("canvas") as HTMLCanvasElement | null;
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          const ok = await saveThumbnail(server.id, canvas);
          finish(ok ? "ok" : "failed");
        } else {
          finish("failed");
        }
      }, CAPTURE_FRAME_WAIT_MS);
    });

    rfb.addEventListener("disconnect", () => finish("failed"));
    rfb.addEventListener("securityfailure", () => finish("failed"));
    rfb.addEventListener("credentialsrequired", () => finish("failed"));

    window.setTimeout(() => finish("failed"), CAPTURE_OVERALL_TIMEOUT_MS);
  });
}
