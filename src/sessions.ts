import RFB from "@novnc/novnc";
import type { SavedServer, ScreenRegion } from "./storage.js";
import { saveThumbnail } from "./thumbnails.js";

const THUMBNAIL_INTERVAL_MS = 30_000;
const THUMBNAIL_INITIAL_DELAY_MS = 2_000;

export type SessionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface StatusDetail {
  reason?: string;
  kind?: "auth" | "other";
}

export interface DesktopInfo {
  name?: string;
  width?: number;
  height?: number;
}

interface Session {
  server: SavedServer;
  container: HTMLDivElement;
  rfb: any;
  status: SessionStatus;
  error?: string;
  desktop: DesktopInfo;
  region?: ScreenRegion;
  resizeObserver?: ResizeObserver;
  thumbnailTimer?: number;
  origUpdateScale?: () => void;
}

type StatusListener = (id: string, status: SessionStatus, detail?: StatusDetail) => void;
type ConnectedListener = (id: string) => void;
type DesktopListener = (id: string, info: DesktopInfo) => void;

const PROXY_PORT = 6080;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeId: string | null = null;
  private statusListeners: StatusListener[] = [];
  private connectedListeners: ConnectedListener[] = [];
  private desktopListeners: DesktopListener[] = [];
  private quality = 6;
  private compression = 2;

  constructor(private stage: HTMLElement) {}

  onStatusChange(fn: StatusListener): void {
    this.statusListeners.push(fn);
  }

  onConnected(fn: ConnectedListener): void {
    this.connectedListeners.push(fn);
  }

  onDesktopInfo(fn: DesktopListener): void {
    this.desktopListeners.push(fn);
  }

  private emitStatus(id: string, status: SessionStatus, detail?: StatusDetail): void {
    for (const fn of this.statusListeners) fn(id, status, detail);
  }

  private emitConnected(id: string): void {
    for (const fn of this.connectedListeners) fn(id);
  }

  private emitDesktop(id: string, info: DesktopInfo): void {
    for (const fn of this.desktopListeners) fn(id, info);
  }

  getActiveId(): string | null {
    return this.activeId;
  }

  getError(id: string): string | undefined {
    return this.sessions.get(id)?.error;
  }

  getStatus(id: string): SessionStatus | "none" {
    return this.sessions.get(id)?.status ?? "none";
  }

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  getDesktopInfo(id: string): DesktopInfo | undefined {
    return this.sessions.get(id)?.desktop;
  }

  getCanvas(id: string): HTMLCanvasElement | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    return s.container.querySelector("canvas");
  }

  getContainer(id: string): HTMLDivElement | null {
    return this.sessions.get(id)?.container ?? null;
  }

  setRegion(id: string, region: ScreenRegion | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.region = region ?? undefined;
    this.applyRegion(session);
  }

  private applyRegion(session: Session): void {
    if (session.resizeObserver) {
      session.resizeObserver.disconnect();
      session.resizeObserver = undefined;
    }
    const canvas = session.container.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || !session.rfb) return;
    const display = session.rfb._display;

    // Restore noVNC's resize handler if it was patched for a previous region.
    if (session.origUpdateScale && session.rfb._updateScale !== session.origUpdateScale) {
      session.rfb._updateScale = session.origUpdateScale;
    }
    session.origUpdateScale = undefined;

    if (!session.region) {
      session.rfb.scaleViewport = true;
      canvas.style.position = "";
      canvas.style.top = "";
      canvas.style.left = "";
      canvas.style.transform = "";
      canvas.style.transformOrigin = "";
      return;
    }

    session.rfb.scaleViewport = false;

    // noVNC translates click coords via display.absX(x) = x / display._scale + viewportLoc.x.
    // We render the cropped region by CSS-transforming the canvas, but display._scale stays
    // at 1, so clicks land on the wrong framebuffer pixel. Patch _updateScale so noVNC's
    // resize handler stops resetting _scale, then set _scale ourselves on every apply().
    if (display) {
      session.origUpdateScale = session.rfb._updateScale;
      session.rfb._updateScale = () => {
        // No-op while a region is active.
      };
    }

    const apply = () => {
      const r = session.region;
      if (!r) return;
      const W = session.container.clientWidth;
      const H = session.container.clientHeight;
      if (W === 0 || H === 0) return;
      const scale = Math.min(W / r.width, H / r.height);
      const offsetX = (W - r.width * scale) / 2;
      const offsetY = (H - r.height * scale) / 2;
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.transformOrigin = "0 0";
      canvas.style.transform = `translate(${offsetX - r.x * scale}px, ${offsetY - r.y * scale}px) scale(${scale})`;
      // Direct field write — avoids _rescale's side effect of rewriting canvas.style.width/height.
      if (display) display._scale = scale;
    };
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(session.container);
    session.resizeObserver = observer;
  }

  setQuality(level: number): void {
    this.quality = clamp(level, 0, 9);
    for (const s of this.sessions.values()) {
      if (s.rfb) s.rfb.qualityLevel = this.quality;
    }
  }

  setCompression(level: number): void {
    this.compression = clamp(level, 0, 9);
    for (const s of this.sessions.values()) {
      if (s.rfb) s.rfb.compressionLevel = this.compression;
    }
  }

  getQuality(): number {
    return this.quality;
  }

  getCompression(): number {
    return this.compression;
  }

  // Push local clipboard text to the remote machine. The remote will use this
  // as the source for any paste action that follows (e.g. when the user's
  // Ctrl+V keystroke reaches the remote).
  sendClipboard(id: string, text: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== "connected" || !session.rfb) return false;
    try {
      session.rfb.clipboardPasteFrom(text);
      return true;
    } catch (err) {
      console.warn("[cool-vnc] clipboardPasteFrom failed", err);
      return false;
    }
  }

  // Inject a raw X11 keysym into the remote (down=true for press, false for
  // release). Used for keys the browser/OS won't pass through normally —
  // e.g. Mac's Option key, which we repurpose as Super_L (Windows key).
  sendKey(id: string, keysym: number, code: string, down: boolean): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== "connected" || !session.rfb) return false;
    try {
      session.rfb.sendKey(keysym, code, down);
      return true;
    } catch (err) {
      console.warn("[cool-vnc] sendKey failed", err);
      return false;
    }
  }

  unfocus(): void {
    for (const s of this.sessions.values()) s.container.classList.remove("active");
    this.activeId = null;
  }

  open(server: SavedServer): void {
    const existing = this.sessions.get(server.id);
    if (existing && (existing.status === "error" || existing.status === "disconnected")) {
      this.close(server.id);
    }
    if (!this.sessions.has(server.id)) {
      this.create(server);
    }
    this.focus(server.id);
  }

  focus(id: string): void {
    if (!this.sessions.has(id)) return;
    for (const [sid, s] of this.sessions) {
      s.container.classList.toggle("active", sid === id);
    }
    this.activeId = id;
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.captureFinalThumbnail(session);
    this.stopThumbnailCapture(session);
    session.resizeObserver?.disconnect();
    if (session.origUpdateScale && session.rfb) {
      session.rfb._updateScale = session.origUpdateScale;
    }
    try {
      session.rfb?.disconnect();
    } catch {
      // ignore
    }
    session.container.remove();
    this.sessions.delete(id);
    if (this.activeId === id) this.activeId = null;
    this.emitStatus(id, "disconnected");
  }

  private startThumbnailCapture(session: Session): void {
    this.stopThumbnailCapture(session);
    window.setTimeout(() => this.captureNow(session), THUMBNAIL_INITIAL_DELAY_MS);
    session.thumbnailTimer = window.setInterval(() => {
      this.captureNow(session);
    }, THUMBNAIL_INTERVAL_MS);
  }

  private stopThumbnailCapture(session: Session): void {
    if (session.thumbnailTimer !== undefined) {
      clearInterval(session.thumbnailTimer);
      session.thumbnailTimer = undefined;
    }
  }

  private captureNow(session: Session): void {
    if (session.status !== "connected") return;
    const canvas = session.container.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    void saveThumbnail(session.server.id, canvas);
  }

  private captureFinalThumbnail(session: Session): void {
    const canvas = session.container.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    void saveThumbnail(session.server.id, canvas);
  }

  private create(server: SavedServer): Session {
    const container = document.createElement("div");
    container.className = "session-canvas";
    this.stage.appendChild(container);

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.hostname}:${PROXY_PORT}/${encodeURIComponent(server.host)}/${server.port}`;

    console.log("[cool-vnc] connecting", server.name, url);

    let rfb: any;
    try {
      rfb = new RFB(container, url, {
        credentials: server.password ? { password: server.password } : undefined,
      });
    } catch (err: any) {
      console.error("[cool-vnc] RFB constructor failed", err);
      const reason = err?.message ?? String(err);
      const session: Session = {
        server,
        container,
        rfb: null,
        status: "error",
        error: reason,
        desktop: {},
      };
      this.sessions.set(server.id, session);
      queueMicrotask(() => this.emitStatus(server.id, "error", { reason }));
      return session;
    }

    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.showDotCursor = true;
    rfb.qualityLevel = this.quality;
    rfb.compressionLevel = this.compression;

    const session: Session = {
      server,
      container,
      rfb,
      status: "connecting",
      desktop: {},
    };
    this.sessions.set(server.id, session);
    this.emitStatus(server.id, "connecting");

    rfb.addEventListener("connect", () => {
      console.log("[cool-vnc] connected", server.name);
      session.status = "connected";
      session.error = undefined;
      const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
      if (canvas) {
        session.desktop.width = canvas.width;
        session.desktop.height = canvas.height;
        this.emitDesktop(server.id, session.desktop);
      }
      if (session.region) this.applyRegion(session);
      this.emitStatus(server.id, "connected");
      this.emitConnected(server.id);
      this.startThumbnailCapture(session);
    });

    rfb.addEventListener("desktopname", (e: any) => {
      const name = e?.detail?.name as string | undefined;
      if (name) {
        session.desktop.name = name;
        this.emitDesktop(server.id, session.desktop);
      }
    });

    rfb.addEventListener("disconnect", (e: any) => {
      const clean = !!e?.detail?.clean;
      const rawReason = e?.detail?.reason as string | undefined;
      console.log("[cool-vnc] disconnect", server.name, { clean, reason: rawReason });
      this.captureFinalThumbnail(session);
      this.stopThumbnailCapture(session);
      session.status = clean ? "disconnected" : "error";
      if (!clean) {
        session.error = rawReason || explainDisconnect(url);
      } else {
        session.error = undefined;
      }
      this.emitStatus(server.id, session.status, { reason: session.error });
    });

    rfb.addEventListener("securityfailure", (e: any) => {
      const status = e?.detail?.status;
      const rawReason = e?.detail?.reason as string | undefined;
      console.warn("[cool-vnc] security failure", server.name, { status, reason: rawReason });
      const reason = rawReason || `Authentication failed (status ${status ?? "?"})`;
      session.status = "error";
      session.error = reason;
      this.emitStatus(server.id, "error", { reason, kind: "auth" });
    });

    // Remote → local clipboard. Whenever the remote machine copies, push the
    // text into our local clipboard so the user can paste it elsewhere.
    rfb.addEventListener("clipboard", (e: any) => {
      const text = e?.detail?.text;
      if (typeof text !== "string" || text.length === 0) return;
      navigator.clipboard.writeText(text).catch((err) => {
        console.warn("[cool-vnc] clipboard.writeText failed", err);
      });
    });

    rfb.addEventListener("credentialsrequired", () => {
      console.warn("[cool-vnc] credentials required", server.name);
      const reason = server.password
        ? "Server rejected the saved password."
        : "Server requires a password.";
      session.status = "error";
      session.error = reason;
      try {
        rfb.disconnect();
      } catch {
        // ignore
      }
      this.emitStatus(server.id, "error", { reason, kind: "auth" });
    });

    return session;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function explainDisconnect(url: string): string {
  return `Connection closed unexpectedly (${url}). Common causes: no VNC server listening on that host/port, server isn't speaking VNC, firewall blocking the port, or the built-in proxy couldn't reach the host. Check the browser console and the proxy log in your terminal for details.`;
}
