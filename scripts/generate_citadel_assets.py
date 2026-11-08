"""Generate the citadel floor and wall stone textures with the local ComfyUI API.

The raw renders land in ``scripts/out/citadel`` (gitignored). They are source
art: ``scripts/process_citadel_assets.py`` turns them into the floor, wall and
gatehouse PNGs under ``apps/client/public/assets/citadel``.

Only the two seamless stone textures are generated. The gatehouse is assembled
from those textures by the processor, because a generated gate sprite cannot hit
the exact 3-tile opening / 6-tile front the server and the layout require (see
the processor's docstring).

Usage:
    python scripts/generate_citadel_assets.py --only floor,wall
    python scripts/generate_citadel_assets.py --all --steps 12

Prompts are English on purpose; the notes in AGENTS.md keep chat Vietnamese
while code, comments and prompts stay English.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "scripts" / "out" / "citadel"


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV = read_env_file()


def env_value(name: str) -> str | None:
    value = os.environ.get(name) or ENV.get(name)
    return value.strip() if value else None


def require_env(name: str) -> str:
    value = env_value(name)
    if not value:
        raise ValueError(f"{name} not found in .env or environment")
    return value


API_HOST = require_env("LOCAL_API_URL").rstrip("/")
API_KEY = require_env("LOCAL_API_KEY")

COMMON_STYLE = (
    "hand-painted 2.5D isometric RTS game asset in the style of Age of Empires II "
    "Definitive Edition, muted desaturated natural palette, painterly texture with fine "
    "brush detail, clean readable silhouette, crisp edges, no photorealistic rendering, "
    "no 3D render look, no text, no watermark, no UI, no frame, no border"
)

COMMON_NEGATIVE = (
    "blurry, low contrast, photorealistic, photograph, 3D render, octane, unreal engine, "
    "cartoon, anime, oversaturated, neon, HDR, lens flare, drop shadow, vignette, "
    "text, letters, watermark, signature, logo, UI, frame, border, human, soldier, animal, "
    "jpeg artifacts, duplicated object, cropped object"
)

SPECS: dict[str, dict] = {
    "floor": {
        "width": 1024,
        "height": 1024,
        "transparent": False,
        "prompt": (
            "Seamless tileable texture of weathered grey limestone flagstone paving, "
            "top-down orthographic view, large irregular cut stone slabs packed tightly "
            "together with narrow dark mortar joints, a few chipped slab edges and fine "
            "hairline cracks, cool mid grey around #7b7f88 with slightly warmer tan patches, "
            "clear value range from pale worn slabs to darker joints, evenly lit flat "
            "overcast light, no shadows, no perspective, no vignette, no border, fills the "
            "frame edge to edge, 1:1 square, sharp detail that survives downscaling to "
            "128x64, " + COMMON_STYLE
        ),
        "negative": (
            COMMON_NEGATIVE + ", grass, moss, plants, leaves, water, puddle, object on the "
            "ground, gravel pile, directional light, specular highlight, strong perspective, "
            "photographic stone, tiling seam, tile grid, monochrome"
        ),
    },
    "wall": {
        "width": 1024,
        "height": 1024,
        "transparent": False,
        "prompt": (
            "Seamless tileable texture of medieval fortress wall stone masonry, straight-on "
            "flat elevation view, neat rectangular ashlar stone blocks of even size in regular "
            "courses, fine recessed mortar joints, lightly chipped weathered edges, clean "
            "light neutral grey stone around #8b8f98 with darker joints around #5b606a, "
            "consistent even brightness across the whole frame, no large dark patches, no "
            "stains, evenly lit flat light, no shadows, no perspective, no vignette, no "
            "border, fills the frame edge to edge, 1:1 square, sharp detail that survives "
            "downscaling, " + COMMON_STYLE
        ),
        "negative": (
            COMMON_NEGATIVE + ", window, door, arch, banner, torch, ivy, moss, lichen, stain, "
            "rain streak, dirt, roof, crenellation, grass, sky, ground, strong perspective, "
            "directional light, specular highlight, dark shadow band, tiling seam, tile grid, "
            "monochrome"
        ),
    },
}


def api_request(path: str, data: dict | None = None) -> dict:
    url = f"{API_HOST}{path}"
    headers = {"X-API-Key": API_KEY}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for_job(job_id: str, label: str) -> dict:
    start = time.time()
    while True:
        job = api_request(f"/v1/jobs/{job_id}")
        status = job.get("status")
        progress = job.get("progress", 0.0)
        elapsed = time.time() - start
        print(f"  [{label}] {status} {progress}% {elapsed:.0f}s", flush=True)
        if status == "succeeded":
            return job
        if status in ("failed", "canceled"):
            raise RuntimeError(f"job {job_id} {status}: {job.get('error')}")
        time.sleep(2)


def download_file(url: str, dest: Path) -> None:
    parsed = urllib.parse.urlparse(url)
    direct = f"{API_HOST}{parsed.path}"
    req = urllib.request.Request(direct, headers={"X-API-Key": API_KEY})
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=300) as resp:
        dest.write_bytes(resp.read())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", metavar="IDS", help="comma-separated ids: floor,wall,gate")
    parser.add_argument("--all", action="store_true", help="generate every spec")
    parser.add_argument("--steps", type=int, default=8, help="sampling steps (default: 8)")
    parser.add_argument("--seed", type=int, default=None, help="optional base seed")
    parser.add_argument("--out-dir", type=Path, default=OUTPUT_DIR, help="raw output directory")
    parser.add_argument("--suffix", default="", help="append a suffix to raw filenames")
    args = parser.parse_args(argv)

    if args.only and args.all:
        raise SystemExit("pass either --only <ids> or --all, not both")
    if not args.only and not args.all:
        raise SystemExit(f"pass --only <ids> or --all; ids: {', '.join(SPECS)}")
    wanted = {part.strip() for part in args.only.split(",")} if args.only else None
    specs = [name for name in SPECS if args.all or name in wanted]
    if not specs:
        raise SystemExit(f"no spec matches --only {args.only!r}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name in specs:
        spec = SPECS[name]
        print(f"\n[{name}] generating {spec['width']}x{spec['height']} steps={args.steps}")
        request = {
            "prompt": spec["prompt"],
            "negative": spec["negative"],
            "width": spec["width"],
            "height": spec["height"],
            "steps": args.steps,
        }
        if spec.get("transparent"):
            request["transparent"] = True
            request["key_color"] = spec.get("key_color", "#ffffff")
            request["tolerance"] = spec.get("tolerance", 24)
            request["trim"] = True
        if args.seed is not None:
            request["seed"] = args.seed
        accepted = api_request("/v1/images", request)
        job_id = accepted["job_id"]
        print(f"  job {job_id}")
        job = wait_for_job(job_id, name)
        files = job.get("files") or []
        if not files:
            raise RuntimeError(f"{name} job returned no files")
        target = args.out_dir / f"{name}{args.suffix}.png"
        download_file(files[0]["url"], target)
        print(f"  saved {target}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
