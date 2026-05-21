"""Generate icons for Electron builds from public/favicon.svg.

Outputs:
  build/icon.ico              — Windows (multi-size PNG-in-ICO)
  build/icon.png              — generic 1024x1024 PNG
  build/icon.iconset/*.png    — Mac iconset (CI converts to icon.icns via iconutil)

Each rasterization is rendered fresh from the SVG at the target size, which
gives sharper small sizes than letting Pillow downscale a single base raster.

Run from the project root:
    python build/make-icon.py
"""
import io
import shutil
import struct
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "public" / "favicon.svg"
OUT_ICO = ROOT / "build" / "icon.ico"
OUT_PNG = ROOT / "build" / "icon.png"
OUT_ICONSET = ROOT / "build" / "icon.iconset"

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICONSET_FILES = {
    "icon_16x16.png": 16,
    "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32,
    "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128,
    "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256,
    "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512,
    "icon_512x512@2x.png": 1024,
}

svg_bytes = SVG.read_bytes()


def render(size: int) -> Image.Image:
    raw = cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)
    return Image.open(io.BytesIO(raw)).convert("RGBA")


# ── Windows .ico (PNG-in-ICO container, packed by hand) ──────────────────────
pngs = []
for s in ICO_SIZES:
    buf = io.BytesIO()
    render(s).save(buf, format="PNG", optimize=True)
    pngs.append((s, buf.getvalue()))

header = struct.pack("<HHH", 0, 1, len(pngs))  # reserved, type=1, count
entry_size = 16
data_offset = len(header) + entry_size * len(pngs)
entries = b""
data_blob = b""
for size, png in pngs:
    w = 0 if size >= 256 else size  # 0 means 256 in the ICO header
    h = 0 if size >= 256 else size
    entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(png), data_offset)
    data_blob += png
    data_offset += len(png)
OUT_ICO.write_bytes(header + entries + data_blob)

# ── Generic high-res PNG ─────────────────────────────────────────────────────
render(1024).save(OUT_PNG)

# ── Mac iconset (CI runs `iconutil -c icns` against this folder) ─────────────
if OUT_ICONSET.exists():
    shutil.rmtree(OUT_ICONSET)
OUT_ICONSET.mkdir()
for name, size in ICONSET_FILES.items():
    render(size).save(OUT_ICONSET / name, format="PNG", optimize=True)

print(f"Wrote {OUT_ICO}")
print(f"Wrote {OUT_PNG}")
print(f"Wrote {len(ICONSET_FILES)} files into {OUT_ICONSET}/")
print("On macOS: iconutil -c icns build/icon.iconset -o build/icon.icns")
