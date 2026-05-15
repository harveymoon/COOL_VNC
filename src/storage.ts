export interface ScreenRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedServer {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  lastConnectedAt?: number;
  connectCount?: number;
  screens?: ScreenRegion[];
  activeScreenId?: string;
  groupId?: string;
}

export interface ServerGroup {
  id: string;
  name: string;
  expanded: boolean;
}

export interface ScanResult {
  host: string;
  port: number;
  name: string | null;
  authOk: boolean;
  requiresAuth: boolean;
  error: string | null;
}

export type SortMode = "name" | "recent" | "frequent";

export interface UiPrefs {
  sort: SortMode;
  collapsed: boolean;
  quality: number;
  compression: number;
  showStats: boolean;
}

const PREFS_KEY = "cool-vnc.prefs";

export async function loadServers(): Promise<SavedServer[]> {
  try {
    const res = await fetch("/api/servers");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[cool-vnc] loadServers failed", err);
    return [];
  }
}

export async function saveServers(servers: SavedServer[]): Promise<void> {
  try {
    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(servers),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("[cool-vnc] saveServers failed", err);
  }
}

export async function loadGroups(): Promise<ServerGroup[]> {
  try {
    const res = await fetch("/api/groups");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("[cool-vnc] loadGroups failed", err);
    return [];
  }
}

export async function saveGroups(groups: ServerGroup[]): Promise<void> {
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(groups),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error("[cool-vnc] saveGroups failed", err);
  }
}

export async function scanNetwork(): Promise<{ results: ScanResult[]; defaultPassword: string }> {
  const res = await fetch("/api/scan");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

const DEFAULT_PREFS: UiPrefs = {
  sort: "name",
  collapsed: false,
  quality: 6,
  compression: 2,
  showStats: false,
};

export function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UiPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
