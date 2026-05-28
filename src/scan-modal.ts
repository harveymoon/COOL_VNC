import type { SavedServer } from "./storage.js";
import { scanNetwork, testVncAuth, type ScanResult } from "./storage.js";

export interface ScanModalResult {
  toAdd: SavedServer[];
}

interface Row {
  result: ScanResult;
  key: string;
  iconEl: HTMLElement;
  noteEl: HTMLElement;
  action: HTMLButtonElement;
  setIncluded: (on: boolean, password?: string) => void;
  /** The password that produced authOk for this row (default OR a Test-supplied retry). */
  workingPassword?: string;
}

export function showScanModal(existing: SavedServer[]): Promise<ScanModalResult> {
  return new Promise((resolve) => {
    const knownKey = new Set(existing.map((s) => `${s.host}:${s.port}`));
    const toAdd = new Map<string, SavedServer>();
    const rows: Row[] = [];

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal scan-modal">
        <h2>Network scan</h2>
        <div class="scan-status">Scanning local subnets for VNC servers — this can take ~30s...</div>
        <div class="scan-retry">
          <input type="password" class="scan-retry-input" placeholder="Try another password..." autocomplete="off" />
          <button type="button" class="btn" data-test disabled>Test</button>
          <span class="scan-retry-status"></span>
        </div>
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
    const retryInput = backdrop.querySelector(".scan-retry-input") as HTMLInputElement;
    const testBtn = backdrop.querySelector("[data-test]") as HTMLButtonElement;
    const retryStatus = backdrop.querySelector(".scan-retry-status") as HTMLElement;

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

    const lockedRows = () => rows.filter((r) => !r.workingPassword && r.result.requiresAuth);

    const updateTestEnabled = () => {
      testBtn.disabled = retryInput.value.length === 0 || lockedRows().length === 0;
    };
    retryInput.addEventListener("input", updateTestEnabled);

    testBtn.addEventListener("click", async () => {
      const pw = retryInput.value;
      if (!pw) return;
      const targets = lockedRows();
      if (targets.length === 0) return;
      testBtn.disabled = true;
      retryStatus.textContent = `Testing on ${targets.length} server(s)...`;

      const outcomes = await Promise.all(
        targets.map(async (row) => {
          try {
            const r = await testVncAuth(row.result.host, row.result.port, pw);
            return { row, ok: !!r.authOk };
          } catch {
            return { row, ok: false };
          }
        }),
      );

      let unlocked = 0;
      for (const { row, ok } of outcomes) {
        if (!ok) continue;
        unlocked++;
        row.workingPassword = pw;
        row.iconEl.textContent = "✓";
        row.iconEl.className = "scan-row-icon ok";
        row.noteEl.textContent = "Password worked — added";
        row.setIncluded(true, pw);
      }

      retryStatus.textContent = unlocked
        ? `${unlocked} server(s) unlocked.`
        : "No matches for that password.";
      updateTestEnabled();
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
          rows.push(renderRow(resultsEl, result, defaultPassword, toAdd));
        }

        // Auto-add authenticated ones immediately
        for (const row of rows) {
          const r = row.result;
          if (r.authOk && r.requiresAuth) {
            row.workingPassword = defaultPassword;
            toAdd.set(`${r.host}:${r.port}`, {
              id: crypto.randomUUID(),
              name: r.name || r.host,
              host: r.host,
              port: r.port,
              password: defaultPassword,
            });
          } else if (r.authOk && !r.requiresAuth) {
            toAdd.set(`${r.host}:${r.port}`, {
              id: crypto.randomUUID(),
              name: r.name || r.host,
              host: r.host,
              port: r.port,
            });
          }
        }
        updateTestEnabled();
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
): Row {
  const key = `${result.host}:${result.port}`;
  const rowEl = document.createElement("div");
  rowEl.className = "scan-row";

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
  const noteEl = document.createElement("div");
  noteEl.className = "scan-row-note";
  noteEl.textContent = note;
  info.appendChild(hostLine);
  info.appendChild(noteEl);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "btn";

  const row: Row = {
    result,
    key,
    iconEl,
    noteEl,
    action,
    setIncluded: () => {},
  };

  row.setIncluded = (on: boolean, password?: string) => {
    if (on) {
      const existing = toAdd.get(key);
      const pw = password ?? row.workingPassword ?? (result.authOk && result.requiresAuth ? defaultPassword : undefined);
      if (!existing) {
        toAdd.set(key, {
          id: crypto.randomUUID(),
          name: result.name || result.host,
          host: result.host,
          port: result.port,
          password: pw,
        });
      } else if (pw && existing.password !== pw) {
        toAdd.set(key, { ...existing, password: pw });
      }
      action.textContent = "Remove";
      action.classList.add("btn-included");
    } else {
      toAdd.delete(key);
      action.textContent = "Add";
      action.classList.remove("btn-included");
    }
  };

  row.setIncluded(included);
  action.addEventListener("click", () => row.setIncluded(!toAdd.has(key)));

  rowEl.appendChild(iconEl);
  rowEl.appendChild(info);
  rowEl.appendChild(action);
  parent.appendChild(rowEl);

  return row;
}
