import type { ScreenRegion } from "./storage.js";

const SNAP_THRESHOLD = 0.1; // 10% of canvas dimension
const MIN_REGION_PX = 20;
const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Dir = (typeof HANDLE_DIRS)[number];

type Rect = { left: number; top: number; width: number; height: number };

export function pickScreenRegion(
  container: HTMLDivElement,
  canvas: HTMLCanvasElement,
  sidebar: HTMLElement,
  defaultName: string,
): Promise<ScreenRegion | null> {
  return new Promise((resolve) => {
    // ── Overlay over the canvas ────────────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.className = "screen-picker-overlay";

    const hint = document.createElement("div");
    hint.className = "screen-picker-hint";
    hint.textContent = "Drag on the canvas to draw a region";
    overlay.appendChild(hint);

    const marquee = document.createElement("div");
    marquee.className = "screen-picker-marquee";
    marquee.style.display = "none";
    overlay.appendChild(marquee);

    for (const dir of HANDLE_DIRS) {
      const h = document.createElement("div");
      h.className = `screen-picker-handle screen-picker-handle-${dir}`;
      h.dataset.dir = dir;
      marquee.appendChild(h);
    }

    container.appendChild(overlay);

    // ── Sidebar takeover ───────────────────────────────────────────────────
    // Hide existing sidebar children rather than detaching them, so their
    // listeners and internal state survive the picker session untouched.
    const prevDisplay = new Map<HTMLElement, string>();
    for (const child of Array.from(sidebar.children) as HTMLElement[]) {
      prevDisplay.set(child, child.style.display);
      child.style.display = "none";
    }

    const panel = document.createElement("div");
    panel.className = "screen-picker-panel";
    panel.innerHTML = `
      <header>
        <h2>Define screen region</h2>
        <p>Drag on the canvas to draw a rectangle, then drag its edges or corners to adjust. Esc cancels.</p>
      </header>
      <label class="screen-picker-name-field">
        <span>Name</span>
        <input type="text" autocomplete="off" />
      </label>
      <div class="screen-picker-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button type="button" class="btn btn-primary" data-save disabled>Save</button>
      </div>
    `;
    sidebar.appendChild(panel);

    const nameInput = panel.querySelector("input") as HTMLInputElement;
    const saveBtn = panel.querySelector("[data-save]") as HTMLButtonElement;
    const cancelBtn = panel.querySelector("[data-cancel]") as HTMLButtonElement;
    nameInput.value = defaultName;
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);

    // ── State ──────────────────────────────────────────────────────────────
    let rect: Rect | null = null;
    type Mode =
      | { kind: "idle" }
      | { kind: "draw"; startX: number; startY: number }
      | { kind: "move"; dx: number; dy: number; orig: Rect }
      | { kind: "resize"; dir: Dir; orig: Rect };
    let mode: Mode = { kind: "idle" };

    const canvasRectInOverlay = () => {
      const o = overlay.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      return {
        left: c.left - o.left,
        top: c.top - o.top,
        width: c.width,
        height: c.height,
        ox: o.left,
        oy: o.top,
      };
    };

    const snap = (val: number, lo: number, hi: number) => {
      const rel = (val - lo) / (hi - lo);
      if (rel < SNAP_THRESHOLD) return lo;
      if (rel > 1 - SNAP_THRESHOLD) return hi;
      return val;
    };

    const pointInOverlay = (e: MouseEvent) => {
      const o = overlay.getBoundingClientRect();
      return { x: e.clientX - o.left, y: e.clientY - o.top };
    };

    const clampToCanvas = (r: Rect, c: ReturnType<typeof canvasRectInOverlay>): Rect => {
      const width = Math.max(MIN_REGION_PX, Math.min(c.width, r.width));
      const height = Math.max(MIN_REGION_PX, Math.min(c.height, r.height));
      const left = Math.max(c.left, Math.min(c.left + c.width - width, r.left));
      const top = Math.max(c.top, Math.min(c.top + c.height - height, r.top));
      return { left, top, width, height };
    };

    const setRect = (r: Rect | null) => {
      rect = r;
      if (!r) {
        marquee.style.display = "none";
        saveBtn.disabled = true;
        hint.style.display = "";
        return;
      }
      marquee.style.display = "block";
      marquee.style.left = `${r.left}px`;
      marquee.style.top = `${r.top}px`;
      marquee.style.width = `${r.width}px`;
      marquee.style.height = `${r.height}px`;
      saveBtn.disabled = r.width < MIN_REGION_PX || r.height < MIN_REGION_PX;
      hint.style.display = "none";
    };

    // ── Mouse handling: draw / move / resize ──────────────────────────────
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;

      if (target.classList.contains("screen-picker-handle")) {
        if (!rect) return;
        mode = { kind: "resize", dir: target.dataset.dir as Dir, orig: { ...rect } };
        e.preventDefault();
        return;
      }

      if (target === marquee && rect) {
        const p = pointInOverlay(e);
        mode = { kind: "move", dx: p.x - rect.left, dy: p.y - rect.top, orig: { ...rect } };
        e.preventDefault();
        return;
      }

      const c = canvasRectInOverlay();
      const p = pointInOverlay(e);
      if (p.x < c.left || p.x > c.left + c.width || p.y < c.top || p.y > c.top + c.height) return;
      mode = { kind: "draw", startX: p.x, startY: p.y };
      setRect({ left: p.x, top: p.y, width: 0, height: 0 });
      e.preventDefault();
    };

    const onMove = (e: MouseEvent) => {
      if (mode.kind === "idle") return;
      const c = canvasRectInOverlay();
      const p = pointInOverlay(e);
      p.x = Math.max(c.left, Math.min(c.left + c.width, p.x));
      p.y = Math.max(c.top, Math.min(c.top + c.height, p.y));
      p.x = snap(p.x, c.left, c.left + c.width);
      p.y = snap(p.y, c.top, c.top + c.height);

      if (mode.kind === "draw") {
        const left = Math.min(mode.startX, p.x);
        const top = Math.min(mode.startY, p.y);
        const width = Math.abs(p.x - mode.startX);
        const height = Math.abs(p.y - mode.startY);
        setRect({ left, top, width, height });
        return;
      }

      if (mode.kind === "move") {
        setRect(
          clampToCanvas(
            { left: p.x - mode.dx, top: p.y - mode.dy, width: mode.orig.width, height: mode.orig.height },
            c,
          ),
        );
        return;
      }

      // resize
      const dir = mode.dir;
      const orig = mode.orig;
      let left = orig.left;
      let top = orig.top;
      let right = orig.left + orig.width;
      let bottom = orig.top + orig.height;
      if (dir.includes("w")) left = Math.min(right - MIN_REGION_PX, p.x);
      if (dir.includes("e")) right = Math.max(left + MIN_REGION_PX, p.x);
      if (dir.includes("n")) top = Math.min(bottom - MIN_REGION_PX, p.y);
      if (dir.includes("s")) bottom = Math.max(top + MIN_REGION_PX, p.y);
      setRect(clampToCanvas({ left, top, width: right - left, height: bottom - top }, c));
    };

    const onUp = () => {
      if (mode.kind === "draw" && rect && (rect.width < MIN_REGION_PX || rect.height < MIN_REGION_PX)) {
        setRect(null);
      }
      mode = { kind: "idle" };
    };

    // ── Resolution ─────────────────────────────────────────────────────────
    const cleanup = (result: ScreenRegion | null) => {
      overlay.remove();
      panel.remove();
      for (const [el, disp] of prevDisplay) el.style.display = disp;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resolve(result);
    };

    const commit = () => {
      if (!rect || saveBtn.disabled) return;
      const c = canvasRectInOverlay();
      const scale = canvas.width / c.width;
      const fbX = Math.max(0, Math.round((rect.left - c.left) * scale));
      const fbY = Math.max(0, Math.round((rect.top - c.top) * scale));
      const fbW = Math.max(1, Math.min(canvas.width - fbX, Math.round(rect.width * scale)));
      const fbH = Math.max(1, Math.min(canvas.height - fbY, Math.round(rect.height * scale)));
      const name = nameInput.value.trim() || defaultName;
      cleanup({ id: crypto.randomUUID(), name, x: fbX, y: fbY, width: fbW, height: fbH });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
        return;
      }
      if (e.key === "Enter" && document.activeElement === nameInput) {
        e.preventDefault();
        commit();
      }
    };

    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", () => cleanup(null));

    overlay.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
  });
}
