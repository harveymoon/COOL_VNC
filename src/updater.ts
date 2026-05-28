// Polls the GitHub releases API for a newer tag than the bundled version and
// returns the release info if one exists. No download or install happens — the
// caller decides what to do (typically: show a pill that opens the URL).

const REPO = "harveymoon/COOL_VNC";
const DISMISSED_KEY = "cool-vnc.update-dismissed";

export interface UpdateInfo {
  latest: string;
  current: string;
  url: string;
}

declare const __APP_VERSION__: string;

const parse = (s: string) =>
  s.replace(/^v/, "").split(/[.\-+]/).map((n) => parseInt(n, 10) || 0);

function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = __APP_VERSION__;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tag = String(data.tag_name ?? "");
    if (!tag || !isNewer(tag, current)) return null;
    let dismissed: string | null = null;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY);
    } catch {
      // ignore
    }
    if (dismissed === tag) return null;
    return { latest: tag, current, url: String(data.html_url ?? `https://github.com/${REPO}/releases`) };
  } catch {
    return null;
  }
}

export function dismissUpdate(tag: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, tag);
  } catch {
    // ignore
  }
}
