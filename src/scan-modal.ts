import type { SavedServer } from "./storage.js";
import { scanNetwork, type ScanResult } from "./storage.js";

export interface ScanModalResult {
  toAdd: SavedServer[];
}

export function showScanModal(existing: SavedServer[]): Promise<ScanModalResult> {
  return new Promise((resolve) => {
    const knownKey = new Set(existing.map((s) => `${s.host}:${s.port}`));
    const toAdd = new Map<string, SavedServer>();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal scan-modal">
        <h2>Network scan</h2>
        <div class="scan-status">Scanning local subnets for VNC servers — this can take ~30s...</div>
        <div class="scan-results"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="button" class="btn btn-primary" data-done disabled>Done</button>
        </div>
      </div>
    `;

    const statusEl = backdrop.querySelector(".scan-status") as HTMLElement;
    const resultsEl = backdrop.querySelector(".scan-results") as HTMLElement;
    const doneBtn = backdrop.querySelector("[data-done]") as HTMLButtonElement;
    const cancelBtn = backdrop.querySelector("[data-cancel]") as HTMLButtonElement;

    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      resolve({ toAdd: [...toAdd.values()] });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    doneBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", () => {
      toAdd.clear();
      close();
    });

    document.body.appendChild(backdrop);

    scanNetwork()
      .then(({ results, defaultPassword }) => {
        doneBtn.disabled = false;
        if (results.length === 0) {
          statusEl.textContent = "No VNC servers found on the local network.";
          return;
        }
        const newHits = results.filter((r) => !knownKey.has(`${r.host}:${r.port}`));
        const skipped = results.length - newHits.length;
        statusEl.textContent =
          `Found ${results.length} VNC host(s)` +
          (skipped ? ` — ${skipped} already saved.` : ".");

        for (const result of newHits) {
          renderRow(resultsEl, result, defaultPassword, toAdd);
        }

        // Auto-add authenticated ones immediately
        for (const result of newHits) {
          if (result.authOk && result.requiresAuth) {
            const id = crypto.randomUUID();
            toAdd.set(`${result.host}:${result.port}`, {
              id,
              name: result.name || result.host,
              host: result.host,
              port: result.port,
              password: defaultPassword,
            });
          } else if (result.authOk && !result.requiresAuth) {
            const id = crypto.randomUUID();
            toAdd.set(`${result.host}:${result.port}`, {
              id,
              name: result.name || result.host,
              host: result.host,
              port: result.port,
            });
          }
        }
      })
      .catch((err) => {
        console.error("[cool-vnc] scan failed", err);
        statusEl.textContent = `Scan failed: ${err.message ?? err}`;
        doneBtn.disabled = false;
      });
  });
}

function renderRow(
  parent: HTMLElement,
  result: ScanResult,
  defaultPassword: string,
  toAdd: Map<string, SavedServer>,
): void {
  const key = `${result.host}:${result.port}`;
  const row = document.createElement("div");
  row.className = "scan-row";

  let icon: string;
  let cls: string;
  let note: string;
  let included: boolean;

  if (result.authOk && result.requiresAuth) {
    icon = "✓";
    cls = "ok";
    note = "Default password worked — added";
    included = true;
  } else if (result.authOk && !result.requiresAuth) {
    icon = "✓";
    cls = "ok";
    note = "No password required — added";
    included = true;
  } else if (result.requiresAuth) {
    icon = "🔒";
    cls = "warn";
    note = "Password required — default didn't work";
    included = false;
  } else if (result.error) {
    icon = "!";
    cls = "err";
    note = `Error: ${result.error}`;
    included = false;
  } else {
    icon = "?";
    cls = "warn";
    note = "Unknown state";
    included = false;
  }

  const iconEl = document.createElement("div");
  iconEl.className = `scan-row-icon ${cls}`;
  iconEl.textContent = icon;

  const info = document.createElement("div");
  info.className = "scan-row-info";
  const hostLine = document.createElement("div");
  hostLine.className = "scan-row-host";
  hostLine.textContent = result.name ? `${result.host} (${result.name})` : result.host;
  const noteLine = document.createElement("div");
  noteLine.className = "scan-row-note";
  noteLine.textContent = note;
  info.appendChild(hostLine);
  info.appendChild(noteLine);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn";

  const setIncluded = (on: boolean) => {
    if (on) {
      const existing = toAdd.get(key);
      if (!existing) {
        toAdd.set(key, {
          id: crypto.randomUUID(),
          name: result.name || result.host,
          host: result.host,
          port: result.port,
          password: result.authOk && result.requiresAuth ? defaultPassword : undefined,
        });
      }
      action.textContent = "Remove";
      action.classList.add("btn-included");
    } else {
      toAdd.delete(key);
      action.textContent = "Add";
      action.classList.remove("btn-included");
    }
  };

  setIncluded(included);
  action.addEventListener("click", () => setIncluded(!toAdd.has(key)));

  row.appendChild(iconEl);
  row.appendChild(info);
  row.appendChild(action);
  parent.appendChild(row);
}
