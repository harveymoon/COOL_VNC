// Connects to the proxy's /api/control WebSocket. Pushes UI state up so
// outside callers can list active sessions, and dispatches commands coming
// back down (connect / disconnect / focus / screen).

export interface ControlState {
  active: string[];
  current: string | null;
  activeRegions: Record<string, string | null>;
}

export interface ControlHandlers {
  onConnect: (serverId: string) => void;
  onDisconnect: (serverId: string) => void;
  onFocus: (serverId: string) => void;
  onScreen: (serverId: string, regionId: string | null) => void;
}

const PROXY_PORT = 6080;
const RECONNECT_MS = 2000;

export class ControlClient {
  private ws: WebSocket | null = null;
  private state: ControlState = { active: [], current: null, activeRegions: {} };
  private closed = false;

  constructor(private handlers: ControlHandlers) {}

  start(): void {
    this.closed = false;
    if (this.ws) return;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  pushState(state: ControlState): void {
    this.state = state;
    this.flush();
  }

  private connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.hostname}:${PROXY_PORT}/api/control`;
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      console.warn("[control] failed to open WS", err);
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener("open", () => {
      console.log("[control] connected");
      this.flush();
    });
    this.ws.addEventListener("message", (e) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      this.handle(msg);
    });
    this.ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });
    this.ws.addEventListener("error", () => {
      // close handler will fire too; only schedule from there
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    window.setTimeout(() => this.connect(), RECONNECT_MS);
  }

  private flush(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "state", ...this.state }));
  }

  private handle(msg: any): void {
    if (!msg || typeof msg.serverId !== "string") return;
    switch (msg.type) {
      case "connect":
        this.handlers.onConnect(msg.serverId);
        break;
      case "disconnect":
        this.handlers.onDisconnect(msg.serverId);
        break;
      case "focus":
        this.handlers.onFocus(msg.serverId);
        break;
      case "screen":
        this.handlers.onScreen(
          msg.serverId,
          typeof msg.regionId === "string" ? msg.regionId : null,
        );
        break;
    }
  }
}
