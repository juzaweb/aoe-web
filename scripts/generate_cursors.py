"""Generate the game cursor set with the local ComfyUI generation API.

Pipeline per cursor: text-to-image (1024x1024, white background) -> keyed to
alpha locally -> cropped -> downscaled to 32x32 -> dark outline -> saved under
apps/client/public/assets/cursors/.

Raw generations are cached in scripts/raw_downloads/cursors/ so a re-run only
re-processes them instead of burning GPU time. Pass --force to regenerate.

Usage:
    python scripts/generate_cursors.py            # all cursors, cached raw
    python scripts/generate_cursors.py --force    # regenerate from scratch
    python scripts/generate_cursors.py --only attack harvest
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import deque
from pathlib import Path
from typing import Any, cast

from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "scripts" / "raw_downloads" / "cursors"
OUT_DIR = ROOT / "apps" / "client" / "public" / "assets" / "cursors"

DEFAULT_API_HOST = "http://192.168.1.14:8090"

CANVAS = 32  # CSS cursor images are placed at their intrinsic pixel size
ICON_BOX = 27  # largest edge the artwork may occupy, leaving room for outline

# Art direction: flat, three-tone, heavy dark outline so the silhouette still
# reads at 32 px over a mid-tone grass texture.
STYLE = (
    "single game UI icon, one object only, flat vector-like illustration, bold readable silhouette, "
    "thick black outline, three flat colors, no gradients, no glow, no shadow, no text, "
    "no frame, no border, centered on a solid pure white background, "
    "isometric medieval strategy game art, gold and dark steel palette"
)

# anchor decides where the actual click point sits inside the canvas.
CURSORS: list[dict] = [
    {
        "name": "default",
        "anchor": "topleft",  # the arrow tip is the hotspot
        "prompt": (
            "a single elegant mouse pointer arrow pointing up-left at 45 degrees, "
            "slim dark steel body with a warm gold rim, short tapered tail"
        ),
    },
    {
        "name": "attack",
        "anchor": "center",
        "prompt": (
            "a single short broadsword pointing up-right at 45 degrees, "
            "polished steel blade, crossed brass crossguard, brown grip"
        ),
    },
    {
        "name": "harvest",
        "anchor": "center",
        "prompt": (
            "a single curved harvest sickle, dark iron crescent blade, "
            "short wooden handle pointing down-right, viewed slightly from the side"
        ),
    },
    {
        "name": "build",
        "anchor": "center",
        "prompt": (
            "a mason's mallet hammer, rectangular wooden head with iron bands, "
            "warm wooden handle pointing down, tilted slightly"
        ),
    },
    {
        "name": "order",
        "anchor": "bottom",
        "prompt": (
            "a small war banner hanging from a short spear pole, gold trim on dark red cloth, "
            "iron spearhead on top, pole standing vertically"
        ),
    },
]


def load_env() -> tuple[str, str]:
    """Read LOCAL_API_URL / LOCAL_API_KEY from .env, falling back to the host the
    older asset scripts already use."""
    url = ""
    key = ""
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("LOCAL_API_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("LOCAL_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    url = url or os.environ.get("LOCAL_API_URL") or DEFAULT_API_HOST
    key = key or os.environ.get("LOCAL_API_KEY", "")
    return url.rstrip("/"), key


API_HOST, API_KEY = load_env()


def api_request(path: str, payload: dict | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if API_KEY:
        headers["X-API-Key"] = API_KEY
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{API_HOST}{path}", data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_job(job_id: str, label: str) -> dict:
    started = time.time()
    while True:
        job = api_request(f"/v1/jobs/{job_id}")
        status = job.get("status")
        if status == "succeeded":
            print(f"    {label}: done in {time.time() - started:.1f}s", flush=True)
            return job
        if status in ("failed", "canceled"):
            raise RuntimeError(f"{label}: job {job_id} {status}: {job.get('error')}")
        time.sleep(2)


def download_file(job_id: str, url: str, dest: Path) -> None:
    path = urllib.parse.urlparse(url).path
    headers = {"X-API-Key": API_KEY} if API_KEY else {}
    req = urllib.request.Request(f"{API_HOST}{path}", headers=headers)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=120) as resp:
        dest.write_bytes(resp.read())


def generate_raw(spec: dict) -> Path:
    raw_path = RAW_DIR / f"{spec['name']}.png"
    if raw_path.exists():
        print(f"  cached raw: {raw_path.name}")
        return raw_path

    print(f"  generating {spec['name']} ...")
    accepted = api_request(
        "/v1/images",
        {
            "prompt": f"{spec['prompt']}, {STYLE}",
            "negative": "text, watermark, letters, multiple objects, mouse pointer, arrow, sparkle, glint, "
            "grid, frame, border, drop shadow, "
            "blurry, gradient background, photo, 3d render",
            "width": 1024,
            "height": 1024,
            "steps": 8,
        },
    )
    job = wait_for_job(accepted["job_id"], spec["name"])
    images = [f for f in job.get("files", []) if f.get("kind") == "image"]
    if not images:
        raise RuntimeError(f"{spec['name']}: job returned no image")
    download_file(job["job_id"], images[0]["url"], raw_path)
    print(f"    saved raw: {raw_path} ({raw_path.stat().st_size // 1024} KB)")
    return raw_path


def key_out_white(img: Image.Image) -> Image.Image:
    """Flood-fill the near-white border into transparency so white highlights
    inside the artwork survive."""
    img = img.convert("RGB")
    w, h = img.size
    px = cast(Any, img.load())

    def is_white(x: int, y: int) -> bool:
        r, g, b = px[x, y]
        return min(r, g, b) >= 224 and max(r, g, b) - min(r, g, b) <= 28

    bg = bytearray(w * h)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_white(x, y) and not bg[y * w + x]:
                bg[y * w + x] = 1
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_white(x, y) and not bg[y * w + x]:
                bg[y * w + x] = 1
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and is_white(nx, ny):
                bg[ny * w + nx] = 1
                queue.append((nx, ny))

    alpha = Image.new("L", (w, h), 255)
    ap = cast(Any, alpha.load())
    for y in range(h):
        row = y * w
        for x in range(w):
            if bg[row + x]:
                ap[x, y] = 0

    # Soften the cut so the downscale does not keep a white fringe.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    out = img.convert("RGBA")
    out.putalpha(alpha)
    return out


def drop_specks(
    img: Image.Image, min_fraction: float = 0.06, min_alpha: int = 12, min_area: int = 48
) -> Image.Image:
    """Erase detached leftovers the model paints next to the icon (sparkles,
    stray highlights). Keeps every island that is at least `min_fraction` of the
    largest one, so a genuinely separate piece of the artwork survives."""
    w, h = img.size
    alpha = cast(Any, img.getchannel("A").load())
    seen = bytearray(w * h)

    components: list[list[tuple[int, int]]] = []
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if seen[idx] or alpha[x, y] <= min_alpha:
                continue
            queue = deque([(x, y)])
            seen[idx] = 1
            members = []
            while queue:
                cx, cy = queue.popleft()
                members.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        nidx = ny * w + nx
                        if not seen[nidx] and alpha[nx, ny] > min_alpha:
                            seen[nidx] = 1
                            queue.append((nx, ny))
            components.append(members)

    if len(components) <= 1:
        return img

    largest = max(len(c) for c in components)
    keep = [c for c in components if len(c) >= max(min_area, largest * min_fraction)]
    dropped = len(components) - len(keep)
    if dropped:
        print(f"    dropped {dropped} speck island(s)")

    mask = Image.new("L", (w, h), 0)
    mp = cast(Any, mask.load())
    for members in keep:
        for x, y in members:
            mp[x, y] = 255
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return out


def trim_and_scale(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    if bbox is None:
        raise RuntimeError("artwork vanished after keying")
    art = img.crop(bbox)
    scale = ICON_BOX / max(art.width, art.height)
    size = (max(1, round(art.width * scale)), max(1, round(art.height * scale)))
    return art.resize(size, Image.Resampling.LANCZOS)


def outline(art: Image.Image) -> Image.Image:
    """Return the artwork with a 1 px dark outline added outside its alpha."""
    w, h = art.size[0] + 2, art.size[1] + 2
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    silhouette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    silhouette.paste((18, 14, 10, 255), (1, 1), art)
    dilated = silhouette.getchannel("A").filter(ImageFilter.MaxFilter(3))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dark.putalpha(dilated)
    dark.paste((18, 14, 10, 255), (0, 0), dark.getchannel("A"))

    canvas.alpha_composite(dark)
    canvas.alpha_composite(art, (1, 1))
    return canvas


def anchor_offset(anchor: str, art: Image.Image) -> tuple[int, int]:
    """Top-left position of `art` inside the CANVAS, chosen so the hotspot under
    `anchor` lands on a fixed, sensible point."""
    alpha = art.getchannel("A")
    if anchor == "topleft":
        # Tip = opaque pixel closest to the artwork's own top-left corner, pinned
        # to (1, 1) so the pointer never clips at the canvas edge.
        w, h = art.size
        best = (0, 0)
        best_score = None
        px = cast(Any, alpha.load())
        for y in range(h):
            for x in range(w):
                if px[x, y] > 140:
                    score = x + y
                    if best_score is None or score < best_score:
                        best_score = score
                        best = (x, y)
        return 1 - best[0], 1 - best[1]
    if anchor == "bottom":
        return (CANVAS - art.width) // 2, CANVAS - 1 - art.height
    return (CANVAS - art.width) // 2, (CANVAS - art.height) // 2


def hotspot_for(anchor: str, art: Image.Image, offset: tuple[int, int]) -> tuple[int, int]:
    alpha = art.getchannel("A")
    if anchor == "topleft":
        w, h = art.size
        px = cast(Any, alpha.load())
        best = (0, 0)
        best_score = None
        for y in range(h):
            for x in range(w):
                if px[x, y] > 140:
                    score = x + y
                    if best_score is None or score < best_score:
                        best_score = score
                        best = (x, y)
        return offset[0] + best[0], offset[1] + best[1]
    if anchor == "bottom":
        return offset[0] + art.width // 2, offset[1] + art.height - 1
    return offset[0] + art.width // 2, offset[1] + art.height // 2


def compose(art: Image.Image, anchor: str) -> tuple[Image.Image, tuple[int, int]]:
    art = outline(art)
    if art.width > CANVAS or art.height > CANVAS:
        raise RuntimeError(f"outlined art {art.size} exceeds {CANVAS}px canvas")
    offset = anchor_offset(anchor, art)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(art, offset)
    return canvas, hotspot_for(anchor, art, offset)


def reanchor(icon: Image.Image, anchor: str) -> tuple[Image.Image, tuple[int, int]]:
    """Crop `icon` to its content and place it back per `anchor`. Used after a
    32 px cleanup pass removed a speck, so the leftover gap does not persist."""
    bbox = icon.getbbox()
    if bbox is None:
        raise RuntimeError("icon empty after cleanup")
    art = icon.crop(bbox)
    offset = anchor_offset(anchor, art)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(art, offset)
    return canvas, hotspot_for(anchor, art, offset)


def add_blocked_overlay(icon: Image.Image) -> Image.Image:
    """Derive build-blocked from build: a red prohibition ring over the mallet,
    drawn locally so it stays crisp instead of asking a diffusion model for a
    legible 32 px symbol."""
    out = icon.copy()
    draw = ImageDraw.Draw(out)
    box = (4, 4, CANVAS - 5, CANVAS - 5)
    draw.ellipse(box, outline=(18, 14, 10, 255), width=4)
    draw.ellipse(box, outline=(214, 58, 42, 255), width=2)
    draw.line([(7, CANVAS - 8), (CANVAS - 8, 7)], fill=(18, 14, 10, 255), width=4)
    draw.line([(7, CANVAS - 8), (CANVAS - 8, 7)], fill=(214, 58, 42, 255), width=2)
    return out


def write_ts_module(manifest: dict) -> None:
    """Emit the hotspot table the client imports, so art and hotspots can never
    drift apart. Fallbacks are the built-in CSS cursors used when an image fails
    to load or the browser rejects it."""
    art_for_mode = {
        "default": "default",
        "attack": "attack",
        "harvest": "harvest",
        "construction": "build",
        "build-ok": "build",
        "build-blocked": "build-blocked",
        "order": "order",
    }
    fallback_for_mode = {
        "default": "default",
        "attack": "crosshair",
        "harvest": "copy",
        "construction": "copy",
        "build-ok": "copy",
        "build-blocked": "not-allowed",
        "order": "crosshair",
    }

    lines = [
        "/**",
        " * AUTO-GENERATED by `scripts/generate_cursors.py` - do not edit by hand.",
        " */",
        "",
        "export interface CursorArt {",
        "  /** Path under `public/`, served as-is by Vite. */",
        "  url: string;",
        "  /** Click point inside the 32x32 image, in image pixels. */",
        "  hotspotX: number;",
        "  hotspotY: number;",
        "  /** Built-in CSS cursor used when the image cannot be loaded. */",
        "  fallback: string;",
        "}",
        "",
        "export const CURSOR_ART = {",
    ]
    for mode, art in art_for_mode.items():
        entry = manifest.get(art)
        if not entry:
            continue
        hx, hy = entry["hotspot"]
        lines.append(
            f"  '{mode}': {{ url: '/assets/cursors/{art}.png', hotspotX: {hx}, hotspotY: {hy}, "
            f"fallback: '{fallback_for_mode[mode]}' }},"
        )
    lines.append("} as const satisfies Record<string, CursorArt>;")
    lines.append("")

    out = ROOT / "apps" / "client" / "src" / "game" / "input" / "cursorArt.generated.ts"
    out.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"ts module: {out.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    print(f"API: {API_HOST}  key: {'set' if API_KEY else 'none'}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    report: dict[str, dict] = {}
    selected = [c for c in CURSORS if not args.only or c["name"] in args.only]

    for spec in selected:
        print(f"[{spec['name']}]")
        raw_path = RAW_DIR / f"{spec['name']}.png"
        if args.force and raw_path.exists():
            raw_path.unlink()
        path = generate_raw(spec)
        with Image.open(path) as img:
            keyed = drop_specks(key_out_white(img))
        art = trim_and_scale(keyed)
        icon, hotspot = compose(art, spec["anchor"])
        # Second pass at final size: the downscale can both detach thin parts and
        # leave the model's stray marks as separate 2-3 px islands.
        cleaned = drop_specks(icon, min_fraction=0.2, min_alpha=90, min_area=12)
        if cleaned.getbbox() != icon.getbbox():
            icon, hotspot = reanchor(cleaned, spec["anchor"])
        out_path = OUT_DIR / f"{spec['name']}.png"
        icon.save(out_path, "PNG", optimize=True)
        report[spec["name"]] = {"hotspot": hotspot, "anchor": spec["anchor"]}
        print(f"    wrote {out_path.relative_to(ROOT)} hotspot={hotspot}")

        if spec["name"] == "build":
            blocked = add_blocked_overlay(icon)
            blocked_path = OUT_DIR / "build-blocked.png"
            blocked.save(blocked_path, "PNG", optimize=True)
            report["build-blocked"] = {"hotspot": hotspot, "anchor": spec["anchor"]}
            print(f"    wrote {blocked_path.relative_to(ROOT)} hotspot={hotspot} (derived)")

    manifest = ROOT / "apps" / "client" / "public" / "assets" / "cursors" / "manifest.json"
    existing = {}
    if manifest.exists():
        existing = json.loads(manifest.read_text(encoding="utf-8"))
    existing.update(report)
    manifest.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nmanifest: {manifest.relative_to(ROOT)}")
    write_ts_module(existing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
