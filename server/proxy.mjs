import http from "node:http";
import net from "node:net";
import os from "node:os";
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { WebSocketServer } from "ws";
import DES from "des.js";

const PORT = Number(process.env.PROXY_PORT) || 6080;
const DEFAULT_PASSWORD = process.env.DEFAULT_VNC_PASSWORD || "Spectr@2023!!";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.COOL_VNC_DATA_DIR
  ? path.resolve(process.env.COOL_VNC_DATA_DIR)
  : path.join(__dirname, "..", "data");
const DIST_DIR = process.env.COOL_VNC_DIST_DIR
  ? path.resolve(process.env.COOL_VNC_DIST_DIR)
  : null;
const SERVERS_FILE = path.join(DATA_DIR, "servers.json");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const THUMBS_DIR = path.join(DATA_DIR, "thumbnails");

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json",
};

// ── HTTP server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/api/servers") {
      const data = await readServers();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method === "POST" && req.url === "/api/servers") {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!Array.isArray(data)) {
        res.writeHead(400);
        res.end("expected an array");
        return;
      }
      await writeServers(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: data.length }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/groups") {
      const data = await readJsonFile(GROUPS_FILE);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method === "POST" && req.url === "/api/groups") {
      const body = await readBody(req);
      const data = JSON.parse(body);
      if (!Array.isArray(data)) {
        res.writeHead(400);
        res.end("expected an array");
        return;
      }
      await writeJsonFile(GROUPS_FILE, data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: data.length }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/scan") {
      console.log("[scan] start");
      const results = await scanAndAuth();
      console.log(`[scan] done, ${results.length} VNC host(s)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results, defaultPassword: DEFAULT_PASSWORD }));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ping?")) {
      const u = new URL(req.url, "http://localhost");
      const host = u.searchParams.get("host") ?? "";
      const port = Number(u.searchParams.get("port") ?? 0);
      if (!host || !port) {
        res.writeHead(400);
        res.end("host and port required");
        return;
      }
      const alive = await probePort(host, port, 1200);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alive }));
      return;
    }

    if (req.url.startsWith("/api/thumbnails/")) {
      const id = req.url.slice("/api/thumbnails/".length).split("?")[0];
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        res.writeHead(400);
        res.end("bad id");
        return;
      }
      const file = path.join(THUMBS_DIR, id + ".jpg");

      if (req.method === "GET") {
        try {
          const data = await readFile(file);
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Cache-Control": "no-cache",
          });
          res.end(data);
        } catch (err) {
          if (err.code === "ENOENT") {
            res.writeHead(404);
            res.end();
          } else {
            throw err;
          }
        }
        return;
      }

      if (req.method === "POST") {
        await mkdir(THUMBS_DIR, { recursive: true });
        const chunks = [];
        for await (const c of req) chunks.push(c);
        await writeFile(file, Buffer.concat(chunks));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, bytes: Buffer.concat(chunks).length }));
        return;
      }

      if (req.method === "DELETE") {
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(file);
        } catch {
          // ignore
        }
        res.writeHead(200);
        res.end();
        return;
      }
    }

    // Fall through to static files if we have a built UI to serve
    if (req.method === "GET" && DIST_DIR) {
      const served = await tryServeStatic(req, res);
      if (served) return;
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error("[http] error", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err?.message ?? err));
  }
});

async function tryServeStatic(req, res) {
  if (!DIST_DIR) return false;
  let urlPath = (req.url ?? "/").split("?")[0];
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";

  // Reject anything that tries to escape the dist dir
  const filePath = path.normalize(path.join(DIST_DIR, urlPath));
  if (!filePath.startsWith(DIST_DIR)) return false;

  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = STATIC_MIME[ext] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
    });
    res.end(data);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") {
      // SPA fallback: serve index.html for any unknown path that isn't an
      // asset request (asset requests have file extensions).
      if (!path.extname(filePath)) {
        try {
          const data = await readFile(path.join(DIST_DIR, "index.html"));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(data);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    throw err;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Server-list JSON file ────────────────────────────────────────────────────

async function readJsonFile(file) {
  try {
    const data = await readFile(file, "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeJsonFile(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

const readServers = () => readJsonFile(SERVERS_FILE);
const writeServers = (servers) => writeJsonFile(SERVERS_FILE, servers);

// ── WebSocket → TCP proxy ───────────────────────────────────────────────────

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (protocols) => {
    for (const p of protocols) return p;
    return false;
  },
});

server.on("upgrade", (req, sock, head) => {
  wss.handleUpgrade(req, sock, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", (ws, req) => {
  const url = req.url ?? "/";
  const match = url.match(/^\/([^/]+)\/(\d+)\/?$/);
  if (!match) {
    console.warn(`[proxy] rejecting bad path: ${url}`);
    ws.close(1008, "expected /<host>/<port>");
    return;
  }
  const host = decodeURIComponent(match[1]);
  const port = Number(match[2]);
  const tag = `${host}:${port}`;
  console.log(`[proxy] open  -> ${tag}`);

  const tcp = net.createConnection({ host, port });
  let tcpReady = false;
  const pending = [];

  tcp.on("connect", () => {
    tcpReady = true;
    console.log(`[proxy] up    -> ${tag}`);
    for (const buf of pending) tcp.write(buf);
    pending.length = 0;
  });
  tcp.on("data", (chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  tcp.on("error", (err) => {
    console.warn(`[proxy] tcp error ${tag}: ${err.message}`);
    if (ws.readyState === ws.OPEN) ws.close(1011, `upstream error: ${err.message}`);
  });
  tcp.on("close", () => {
    if (ws.readyState === ws.OPEN) ws.close(1000, "upstream closed");
    console.log(`[proxy] close -> ${tag}`);
  });

  ws.on("message", (data) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (tcpReady) tcp.write(buf);
    else pending.push(buf);
  });
  ws.on("close", () => tcp.destroy());
  ws.on("error", (err) => {
    console.warn(`[proxy] ws error: ${err.message}`);
    tcp.destroy();
  });
});

// ── Network scan ────────────────────────────────────────────────────────────

function getLocalSubnets() {
  const ifs = os.networkInterfaces();
  const subnets = new Map();
  for (const list of Object.values(ifs)) {
    for (const addr of list ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const parts = addr.address.split(".");
      const first = Number(parts[0]);
      const second = Number(parts[1]);
      const isPrivate =
        first === 10 ||
        (first === 192 && second === 168) ||
        (first === 172 && second >= 16 && second <= 31);
      if (!isPrivate) continue;
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      subnets.set(prefix, addr.address);
    }
  }
  return [...subnets.entries()].map(([prefix, self]) => ({ prefix, self }));
}

function probePort(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(v);
    };
    const t = setTimeout(() => done(false), timeoutMs);
    sock.on("connect", () => {
      clearTimeout(t);
      done(true);
    });
    sock.on("error", () => {
      clearTimeout(t);
      done(false);
    });
  });
}

async function reverseName(host) {
  try {
    const names = await dns.reverse(host);
    const raw = names[0];
    if (!raw) return null;
    return raw.replace(/\.(local|localdomain)$/i, "");
  } catch {
    return null;
  }
}

async function scanAndAuth() {
  const subnets = getLocalSubnets();
  if (subnets.length === 0) {
    console.warn("[scan] no private subnets found");
    return [];
  }
  console.log("[scan] subnets:", subnets.map((s) => `${s.prefix}.0/24 (self ${s.self})`));

  const candidates = [];
  for (const { prefix, self } of subnets) {
    for (let i = 1; i < 255; i++) {
      const host = `${prefix}.${i}`;
      if (host === self) continue;
      candidates.push(host);
    }
  }

  const found = [];
  const chunkSize = 48;
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const probes = await Promise.all(chunk.map((h) => probePort(h, 5900)));
    for (let j = 0; j < chunk.length; j++) {
      if (probes[j]) found.push({ host: chunk[j], port: 5900 });
    }
  }
  console.log(`[scan] open VNC ports: ${found.length}`);

  const results = [];
  for (const hit of found) {
    const [auth, name] = await Promise.all([
      tryVncAuth(hit.host, hit.port, DEFAULT_PASSWORD),
      reverseName(hit.host),
    ]);
    results.push({
      host: hit.host,
      port: hit.port,
      name,
      authOk: auth.authOk,
      requiresAuth: auth.requiresAuth,
      error: auth.error,
    });
    console.log(
      `[scan] ${hit.host}:${hit.port} authOk=${auth.authOk} requiresAuth=${auth.requiresAuth}${
        auth.error ? " err=" + auth.error : ""
      }`,
    );
  }
  return results;
}

// ── RFB auth ────────────────────────────────────────────────────────────────

function vncDesKey(password) {
  const key = Buffer.alloc(8);
  const pw = Buffer.from(password.substring(0, 8), "latin1");
  for (let i = 0; i < 8; i++) {
    const b = i < pw.length ? pw[i] : 0;
    let r = 0;
    for (let j = 0; j < 8; j++) r |= ((b >> j) & 1) << (7 - j);
    key[i] = r;
  }
  return key;
}

function vncAuthResponse(password, challenge) {
  const key = vncDesKey(password);
  const des = DES.create({ type: "encrypt", key });
  const out = des.update(challenge).concat(des.final());
  return Buffer.from(out);
}

function tryVncAuth(host, port, password, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const result = { authOk: false, requiresAuth: false, error: null };
    const sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let state = "version";
    let done = false;

    const finish = (errMsg) => {
      if (done) return;
      done = true;
      if (errMsg) result.error = errMsg;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    sock.on("error", (err) => {
      clearTimeout(timer);
      finish(err.message);
    });
    sock.on("close", () => {
      clearTimeout(timer);
      finish(null);
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        while (true) {
          if (state === "version") {
            if (buf.length < 12) return;
            buf = buf.subarray(12);
            sock.write(Buffer.from("RFB 003.008\n", "ascii"));
            state = "security";
          } else if (state === "security") {
            if (buf.length < 1) return;
            const count = buf[0];
            if (count === 0) {
              return finish("server rejected handshake");
            }
            if (buf.length < 1 + count) return;
            const types = Array.from(buf.subarray(1, 1 + count));
            buf = buf.subarray(1 + count);
            if (types.includes(2)) {
              result.requiresAuth = true;
              sock.write(Buffer.from([2]));
              state = "challenge";
            } else if (types.includes(1)) {
              result.requiresAuth = false;
              result.authOk = true;
              return finish(null);
            } else {
              return finish("unsupported auth types: " + types.join(","));
            }
          } else if (state === "challenge") {
            if (buf.length < 16) return;
            const challenge = buf.subarray(0, 16);
            buf = buf.subarray(16);
            const response = vncAuthResponse(password, challenge);
            sock.write(response);
            state = "security-result";
          } else if (state === "security-result") {
            if (buf.length < 4) return;
            result.authOk = buf.readUInt32BE(0) === 0;
            return finish(null);
          }
        }
      } catch (e) {
        finish(e.message);
      }
    });
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[cool-vnc proxy] http+ws listening on :${PORT}`);
  console.log(`[cool-vnc proxy] data file: ${SERVERS_FILE}`);
});

const shutdown = () => {
  console.log("[cool-vnc proxy] shutting down");
  wss.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
