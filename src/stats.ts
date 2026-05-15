interface SocketStats {
  url: string;
  bytesIn: number;
  bytesOut: number;
}

const sockets = new Map<WebSocket, SocketStats>();
const canvasPaints = new WeakMap<HTMLCanvasElement, number>();

function dataSize(data: unknown): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return (data as ArrayBufferView).byteLength;
  if (typeof data === "string") return data.length;
  return 0;
}

// ── WebSocket hook ──────────────────────────────────────────────────────────
//
// noVNC's Websock.attach() validates the channel by reading
// Object.getOwnPropertyNames(Object.getPrototypeOf(channel)) — it does NOT walk
// the prototype chain. Subclassing WebSocket would put required props (close,
// binaryType, etc.) on a parent prototype, breaking that check. So we use a
// function-constructor that creates the real WebSocket, attaches listeners,
// shadows .send with an instance-level wrapper, and returns it. Callers see a
// genuine WebSocket whose direct prototype is WebSocket.prototype.

const OriginalWebSocket = window.WebSocket;

const TrackedWebSocket = function (
  this: unknown,
  url: string | URL,
  protocols?: string | string[],
): WebSocket {
  const ws = new OriginalWebSocket(url, protocols);
  const stats: SocketStats = { url: String(url), bytesIn: 0, bytesOut: 0 };
  sockets.set(ws, stats);

  ws.addEventListener("message", (e) => {
    stats.bytesIn += dataSize((e as MessageEvent).data);
  });
  ws.addEventListener("close", () => {
    setTimeout(() => sockets.delete(ws), 5000);
  });

  const originalSend = ws.send.bind(ws);
  (ws as any).send = function (data: any) {
    stats.bytesOut += dataSize(data);
    return originalSend(data);
  };

  return ws;
} as unknown as typeof WebSocket;

TrackedWebSocket.prototype = OriginalWebSocket.prototype;
(TrackedWebSocket as any).CONNECTING = OriginalWebSocket.CONNECTING;
(TrackedWebSocket as any).OPEN = OriginalWebSocket.OPEN;
(TrackedWebSocket as any).CLOSING = OriginalWebSocket.CLOSING;
(TrackedWebSocket as any).CLOSED = OriginalWebSocket.CLOSED;

(window as any).WebSocket = TrackedWebSocket;

// ── Canvas paint hook ───────────────────────────────────────────────────────

const proto = CanvasRenderingContext2D.prototype as any;
const origPutImageData = proto.putImageData;
const origDrawImage = proto.drawImage;

proto.putImageData = function (this: CanvasRenderingContext2D, ...args: any[]) {
  canvasPaints.set(this.canvas, (canvasPaints.get(this.canvas) ?? 0) + 1);
  return origPutImageData.apply(this, args);
};

proto.drawImage = function (this: CanvasRenderingContext2D, ...args: any[]) {
  canvasPaints.set(this.canvas, (canvasPaints.get(this.canvas) ?? 0) + 1);
  return origDrawImage.apply(this, args);
};

// ── Public API ──────────────────────────────────────────────────────────────

export function getSocketStats(matchFn: (url: string) => boolean): { bytesIn: number; bytesOut: number } {
  let bytesIn = 0;
  let bytesOut = 0;
  for (const s of sockets.values()) {
    if (matchFn(s.url)) {
      bytesIn += s.bytesIn;
      bytesOut += s.bytesOut;
    }
  }
  return { bytesIn, bytesOut };
}

export function getCanvasPaints(canvas: HTMLCanvasElement | null): number {
  if (!canvas) return 0;
  return canvasPaints.get(canvas) ?? 0;
}
