import type { ScreenRegion } from "./storage.js";
import { showInputDialog } from "./prompt-dialog.js";

const SNAP_THRESHOLD = 0.1; // 10% of canvas dimension

export function pickScreenRegion(
  container: HTMLDivElement,
  canvas: HTMLCanvasElement,
  defaultName: string,
): Promise<ScreenRegion | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "screen-picker-overlay";

    const hint = document.createElement("div");
    hint.className = "screen-picker-hint";
    hint.textContent = "Drag to select a region · Esc to cancel";
    overlay.appendChild(hint);

    const marquee = document.createElement("div");
    marquee.className = "screen-picker-marquee";
    marquee.style.display = "none";
    overlay.appendChild(marquee);

    container.appendChild(overlay);

    // Geometry of the rendered canvas inside the overlay's coordinate space.
    // Recomputed on each event in case the canvas resizes mid-drag.
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

    const positionFromEvent = (e: MouseEvent) => {
      const r = canvasRectInOverlay();
      // Mouse position in overlay-local pixels
      let x = e.clientX - r.ox;
      let y = e.clientY - r.oy;

      // Clamp to canvas rect (cannot select outside the rendered image)
      x = Math.max(r.left, Math.min(r.left + r.width, x));
      y = Math.max(r.top, Math.min(r.top + r.height, y));

      // Snap to edges within SNAP_THRESHOLD of canvas dimension
      const relX = (x - r.left) / r.width;
      if (relX < SNAP_THRESHOLD) x = r.left;
      else if (relX > 1 - SNAP_THRESHOLD) x = r.left + r.width;
      const relY = (y - r.top) / r.height;
      if (relY < SNAP_THRESHOLD) y = r.top;
      else if (relY > 1 - SNAP_THRESHOLD) y = r.top + r.height;

      return { x, y, r };
    };

    let startX = 0;
    let startY = 0;
    let dragging = false;
    let pending = false;

    const cleanup = (result: ScreenRegion | null) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) cleanup(null);
    };

    const drawMarquee = (curX: number, curY: number) => {
      const left = Math.min(curX, startX);
      const top = Math.min(curY, startY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${w}px`;
      marquee.style.height = `${h}px`;
    };

    const onDown = (e: MouseEvent) => {
      if (pending) return;
      const p = positionFromEvent(e);
      startX = p.x;
      startY = p.y;
      dragging = true;
      marquee.style.display = "block";
      drawMarquee(startX, startY);
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const p = positionFromEvent(e);
      drawMarquee(p.x, p.y);
    };

    const onUp = (e: MouseEvent) => {
      if (!dragging) return;
      dragging = false;
      const p = positionFromEvent(e);
      const r = p.r;

      const left = Math.min(p.x, startX);
      const top = Math.min(p.y, startY);
      const w = Math.abs(p.x - startX);
      const h = Math.abs(p.y - startY);

      if (w < 20 || h < 20) {
        marquee.style.display = "none";
        return;
      }

      // Convert overlay-local coords to framebuffer (canvas pixel) space
      const scale = canvas.width / r.width;
      const fbX = Math.max(0, Math.round((left - r.left) * scale));
      const fbY = Math.max(0, Math.round((top - r.top) * scale));
      const fbW = Math.max(1, Math.min(canvas.width - fbX, Math.round(w * scale)));
      const fbH = Math.max(1, Math.min(canvas.height - fbY, Math.round(h * scale)));

      pending = true;
      showInputDialog({
        title: "Name this region",
        defaultValue: defaultName,
        okLabel: "Save",
      }).then((name) => {
        pending = false;
        if (!name) {
          marquee.style.display = "none";
          return;
        }
        cleanup({
          id: crypto.randomUUID(),
          name,
          x: fbX,
          y: fbY,
          width: fbW,
          height: fbH,
        });
      });
    };

    overlay.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
  });
}
