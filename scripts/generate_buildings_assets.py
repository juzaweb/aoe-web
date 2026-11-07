"""Script to generate building assets for Chien Quoc RTS using Local ComfyUI API."""

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CLIENT_PUBLIC = ROOT / "apps" / "client" / "public"
OUTPUT_DIR = CLIENT_PUBLIC / "assets" / "buildings"


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
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

BUILDING_SPECS = [
    {
        "id": "town_center",
        "target_w": 288,
        "target_h": 220,
        "gen_w": 1024,
        "gen_h": 1024,
        "prompt": (
            "A 2D game asset of an ancient East Asian imperial town center palace hall, 2.5D isometric top-down view. "
            "Magnificent wooden pavilion with curved red clay tiled roofs, carved pillars, banners, stone foundation dais, "
            "historical Warring States imperial architecture, detailed RTS building asset. "
            "Solid pure white background, clean sharp silhouette, game asset ready --ar 1:1 --v 6.0 --style raw"
        ),
    },
    {
        "id": "barracks",
        "target_w": 200,
        "target_h": 160,
        "gen_w": 1024,
        "gen_h": 1024,
        "prompt": (
            "A 2D game asset of an ancient East Asian military barracks garrison outpost, 2.5D isometric top-down view. "
            "Fortified timber and stone military lodge, weapon racks with spears and shields outside, banners and war drums, "
            "training yard. Warring States era martial building asset. "
            "Solid pure white background, clean sharp silhouette, game asset ready --ar 1:1 --v 6.0 --style raw"
        ),
    },
    {
        "id": "house",
        "target_w": 128,
        "target_h": 110,
        "gen_w": 1024,
        "gen_h": 1024,
        "prompt": (
            "A 2D game asset of an ancient rustic East Asian peasant cottage house, 2.5D isometric top-down view. "
            "Small thatched-roof wooden hut, earthen timber walls, firewood stack, wicker basket near the door, "
            "rural village house asset. "
            "Solid pure white background, clean sharp silhouette, game asset ready --ar 1:1 --v 6.0 --style raw"
        ),
    },
    {
        "id": "farm",
        "target_w": 192,
        "target_h": 96,
        "gen_w": 1024,
        "gen_h": 512,
        "prompt": (
            "A 2D game asset of an ancient Asian irrigated rice paddy farmland, 2.5D isometric top-down view. "
            "Flooded mud plots with lush green rice crop shoots, wooden water irrigation ditch, neat agricultural field tile. "
            "Solid pure white background, clean sharp silhouette, game asset ready --ar 2:1 --v 6.0 --style raw"
        ),
    },
    {
        "id": "tower",
        "target_w": 80,
        "target_h": 180,
        "gen_w": 512,
        "gen_h": 1024,
        "prompt": (
            "A 2D game asset of an ancient tall wooden and stone watchtower defense tower, 2.5D isometric top-down view. "
            "Slender multi-tiered timber outpost with lookout parapet, arrow slits, signal fire brazier at the peak, stone base. "
            "Solid pure white background, clean sharp silhouette, game asset ready --ar 1:2 --v 6.0 --style raw"
        ),
    },
    # MIL-01: the two new military branches. Both are drawn on the barracks'
    # 400x320 canvas so `buildingArt.ts` can reuse its lift and health-bar height
    # instead of growing two more hand-measured entries.
    {
        "id": "stable",
        "target_w": 400,
        "target_h": 320,
        "gen_w": 1280,
        "gen_h": 1024,
        "prompt": (
            "A 2D RTS game building asset, ancient East Asian cavalry stable and horse paddock, "
            "strict 2.5D isometric projection viewed from the south-east, 45 degree camera angle, "
            "three-quarter aerial top-down view. Timber and stone horse barn with a wide open stall door, "
            "hay bales, a wooden hitching rail, tethering posts with saddles and tack hanging, "
            "a small dirt exercise yard, a war banner on the roof, Warring States era military horse breeding stable. "
            "Hand-painted game art, crisp details, strong readable silhouette, warm daylight from the upper left. "
            "Isolated on a solid pure white background, no cast shadow, no ground plane, no text, no border, "
            "game asset ready --style raw"
        ),
    },
    {
        "id": "archery_range",
        "target_w": 400,
        "target_h": 320,
        "gen_w": 1280,
        "gen_h": 1024,
        "prompt": (
            "A 2D RTS game building asset, ancient East Asian archery range training ground, "
            "strict 2.5D isometric projection viewed from the south-east, 45 degree camera angle, "
            "three-quarter aerial top-down view. Low timber shooting pavilion with a thatched awning, "
            "straw target butts with arrows stuck in them, a rack of bows and quivers leaning by a wooden fence, "
            "a dirt firing lane with a low backstop wall, Warring States era military archery training camp. "
            "Hand-painted game art, crisp details, strong readable silhouette, warm daylight from the upper left. "
            "Isolated on a solid pure white background, no cast shadow, no ground plane, no text, no border, "
            "game asset ready --style raw"
        ),
    },
]


def api_request(path: str, data: dict = None) -> dict:
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
        print(f"  [{label}] status: {status}, progress: {progress}%, elapsed: {elapsed:.1f}s", flush=True)

        if status == "succeeded":
            return job
        elif status in ("failed", "canceled"):
            raise RuntimeError(f"Job {job_id} {status}: {job.get('error')}")
        time.sleep(2)


def download_file(url: str, dest_path: Path):
    parsed = urllib.parse.urlparse(url)
    direct_url = f"{API_HOST}{parsed.path}"
    req = urllib.request.Request(direct_url, headers={"X-API-Key": API_KEY})
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest_path, "wb") as f:
        f.write(r.read())


def process_building(raw_path: Path, output_path: Path, target_w: int, target_h: int):
    with Image.open(raw_path) as img:
        img = img.convert("RGBA")
        # Crop on the alpha channel, not `img.getbbox()`: fully transparent
        # pixels may still carry white RGB bytes after the key-out, which would
        # make the plain RGB bbox the whole frame.
        bbox = img.getchannel("A").getbbox()
        if bbox:
            img = img.crop(bbox)

        # Scale to fit target dimensions preserving aspect ratio
        scale = min(target_w / img.width, target_h / img.height)
        nw = max(1, int(img.width * scale))
        nh = max(1, int(img.height * scale))
        scaled = img.resize((nw, nh), Image.Resampling.LANCZOS)

        # Center horizontally, anchor to bottom
        canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
        ox = (target_w - nw) // 2
        oy = target_h - nh
        canvas.paste(scaled, (ox, oy), scaled)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output_path, "PNG", optimize=True)
        alpha = canvas.getchannel("A")
        art_box = alpha.getbbox()
        top_inset = art_box[1] if art_box else target_h
        bottom_inset = target_h - art_box[3] if art_box else target_h
        print(
            f"  Processed {output_path.name}: {target_w}x{target_h} "
            f"art={nw}x{nh} topInset={top_inset} bottomInset={bottom_inset}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only",
        metavar="IDS",
        help="comma-separated building ids, e.g. stable,archery_range",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="regenerate every spec, including the five older buildings whose PNGs were replaced by the OpenGameArt pipeline",
    )
    parser.add_argument("--steps", type=int, default=8, help="sampling steps (default: 8)")
    parser.add_argument("--seed", type=int, default=None, help="optional seed for a reproducible render")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="output directory (default: apps/client/public/assets/buildings)",
    )
    parser.add_argument(
        "--suffix",
        default="",
        help="append a suffix to output filenames, useful for comparing candidates",
    )
    parser.add_argument("--keep-raw", action="store_true", help="keep the cut-out PNG before processing")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.only and args.all:
        raise SystemExit("pass either --only <ids> or --all, not both")
    if not args.only and not args.all:
        # Five of the specs predate the OpenGameArt replacement and target half
        # the shipped resolution. Running them by accident would overwrite the
        # licensed art, so regenerating everything is an explicit choice.
        ids = ", ".join(spec["id"] for spec in BUILDING_SPECS)
        raise SystemExit(f"pass --only <ids> or --all; ids: {ids}")
    wanted = {part.strip() for part in args.only.split(",")} if args.only else None
    specs = [spec for spec in BUILDING_SPECS if args.all or spec["id"] in wanted]
    if not specs:
        raise SystemExit(f"no building spec matches --only {args.only!r}")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for idx, spec in enumerate(specs):
        b_id = spec["id"]
        print(f"\n==========================================")
        print(f"[{idx+1}/{len(specs)}] Generating: {b_id.upper()}")
        print(f"==========================================")

        # 1. Text to Image
        image_request = {
            "prompt": spec["prompt"],
            "width": spec["gen_w"],
            "height": spec["gen_h"],
            "steps": args.steps,
        }
        if args.seed is not None:
            image_request["seed"] = args.seed
        img_resp = api_request("/v1/images", image_request)
        img_job_id = img_resp["job_id"]
        print(f"Submitted image job: {img_job_id}")
        wait_for_job(img_job_id, f"{b_id}-img")

        # 2. Key out white background via /v1/sprites
        sprite_resp = api_request("/v1/sprites", {
            "from_job": img_job_id,
            "background": "color",
            "key_color": "#ffffff",
            "tolerance": 28,
            "trim": True
        })
        sprite_job_id = sprite_resp["job_id"]
        print(f"Submitted cutout job: {sprite_job_id}")
        sprite_job = wait_for_job(sprite_job_id, f"{b_id}-cutout")

        # 3. Download and process
        target_file = None
        for f in sprite_job.get("files", []):
            if f.get("filename") in ("spritesheet.png", "frame_000.png"):
                target_file = f
                break
        if not target_file and sprite_job.get("files"):
            target_file = sprite_job["files"][0]
        if not target_file:
            raise RuntimeError(f"No output files returned by sprite cutout job for {b_id}")

        temp_path = args.out_dir / f"{b_id}{args.suffix}_raw.png"
        download_file(target_file["url"], temp_path)

        final_path = args.out_dir / f"{b_id}{args.suffix}.png"
        process_building(temp_path, final_path, spec["target_w"], spec["target_h"])
        if not args.keep_raw:
            temp_path.unlink(missing_ok=True)

    print(f"\nAll {len(specs)} buildings generated successfully!")


if __name__ == "__main__":
    main()

