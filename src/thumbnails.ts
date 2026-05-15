export async function downscaleToBlob(
  src: HTMLCanvasElement,
  maxWidth = 480,
  quality = 0.7,
): Promise<Blob | null> {
  if (!src.width || !src.height) return null;
  const scale = Math.min(1, maxWidth / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve) => tmp.toBlob((b) => resolve(b), "image/jpeg", quality));
}

export async function saveThumbnail(serverId: string, canvas: HTMLCanvasElement): Promise<boolean> {
  const blob = await downscaleToBlob(canvas);
  if (!blob) return false;
  try {
    const res = await fetch(`/api/thumbnails/${encodeURIComponent(serverId)}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    return res.ok;
  } catch (err) {
    console.warn("[cool-vnc] saveThumbnail failed", err);
    return false;
  }
}

export function thumbnailUrl(serverId: string, bust = false): string {
  const t = bust ? `?t=${Date.now()}` : "";
  return `/api/thumbnails/${encodeURIComponent(serverId)}${t}`;
}
