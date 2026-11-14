"""Generate 8-direction action sheets for the military units from the local image API.

One image job produces one strip: four poses of the same action, in the same
facing, laid out left to right on a flat white background. Eight strips per
(unit, action) give the eight compass rows. ``build_sheet`` then slices those
strips, mats the background locally, and packs them into

    ``<unit>_<action>.png`` — 8 rows x FRAMES_PER_DIRECTION columns

with row order E, SE, S, SW, W, NW, N, NE (the order ``directionIndex()``
expects), so a Phaser frame index is ``direction * FRAMES_PER_DIRECTION + frame``.

Alignment rules that matter more than the art:

* One scale per unit, derived from the idle/walk reference rows, so switching
  from walk to attack never resizes the character.
* Bottom-anchored at a fixed baseline, so the feet stay on the tile.
* Horizontal anchor is the *median* bbox centre of the row's frames. A raised
  spear or an extended thrust inflates a single frame's bbox; a median keeps the
  body still while the limbs move.

The raw strips are cached under ``scripts/raw_downloads/units_8dir`` with a job
manifest, so a rerun only generates what is missing.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_unit_8dir import FRAMES_PER_DIRECTION, MARGIN_BOTTOM, content, remove_background  # noqa: E402
from unit_sheet_kit import density_runs, even_runs, split_characters  # noqa: E402

RAW_DIR = ROOT / "scripts" / "raw_downloads" / "units_8dir"
ASSET_DIR = ROOT / "apps" / "client" / "public" / "assets" / "units"
ACTION_DIR = ASSET_DIR / "actions"
MANIFEST = RAW_DIR / "manifest.json"

DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]

FACING = {
    "E": "facing to the right edge of the screen (east)",
    "SE": "facing toward the lower right corner of the screen (south-east)",
    "S": "facing toward the viewer (south)",
    "SW": "facing toward the lower left corner of the screen (south-west)",
    "W": "facing to the left edge of the screen (west)",
    "NW": "facing toward the upper left corner of the screen (north-west)",
    "N": "facing away from the viewer (north)",
    "NE": "facing toward the upper right corner of the screen (north-east)",
}

STYLE = (
    "flat 2D cartoon game sprite, thick uniform black outline, flat color fills, minimal cel shading, "
    "simplified proportions, two and a half D isometric camera seen from a high three-quarter angle, "
    "ancient East Asian Warring States period"
)

# per unit: art subject, strip panel size, and the frame size of the packed sheet
UNITS = {
    "spearman": {
        "subject": (
            "an armored spearman infantry soldier wearing crimson and bronze lamellar armor, "
            "a pointed bronze helmet with a red plume, black boots, holding a long wooden spear "
            "with a leaf-shaped bronze head"
        ),
        "panel": 256,
        "strip_height": 384,
        "frame_size": 128,
        "content_height": 112,
        "seed": 20261101,
    },
    "archer": {
        "subject": (
            "an archer soldier wearing a studded leather jerkin, baggy trousers, a cloth headband, "
            "a quiver of arrows on his back, holding a composite recurve bow"
        ),
        "panel": 256,
        "strip_height": 384,
        "frame_size": 128,
        "content_height": 112,
        "seed": 77110307,
    },
    "cavalry": {
        "subject": (
            "an armored cavalryman riding a muscular warhorse with a saddle and bridle, "
            "the rider wears crimson and bronze lamellar plate armor and a plumed helmet, "
            "wielding a curved dao saber"
        ),
        "panel": 256,
        "strip_height": 384,
        "frame_size": 160,
        "content_height": 140,
        "seed": 51551123,
    },
}

ACTIONS = {
    "idle": (
        4,
        4,
        "the same standing guard pose breathing: frame 1 relaxed stance, frame 2 chest lifted with a small "
        "breath, frame 3 weight shifted onto the other leg, frame 4 back to the starting stance",
        0.0,
    ),
    "walk": (
        4,
        8,
        "a four-step walk cycle moving in the facing direction: frame 1 left leg stepped far forward and "
        "right leg trailing, frame 2 legs passing with the right knee lifted high, frame 3 right leg stepped "
        "far forward and left leg trailing, frame 4 legs passing with the left knee lifted high",
        0.02,
    ),
    "attack": (
        4,
        10,
        "a four-beat melee strike: frame 1 weapon drawn far back over the shoulder, frame 2 weapon thrust "
        "fully forward at the target, frame 3 weapon swung past the target low, frame 4 recovering to guard",
        0.12,
    ),
    "death": (
        4,
        8,
        "a four-beat death: frame 1 standing but flinching from a hit with the head thrown back, frame 2 "
        "buckling at the knees with the body folded forward, frame 3 falling sideways to the ground, frame 4 "
        "lying flat and motionless on the ground",
        0.12,
    ),
    "build": (
        4,
        7,
        "a four-beat construction loop: frame 1 mallet raised high overhead, frame 2 mallet driven down in "
        "front, frame 3 mallet lifted again while glancing at the work, frame 4 a second downward stroke",
        0.08,
    ),
    "gather": (
        4,
        7,
        "a four-beat harvesting loop: frame 1 tool raised overhead, frame 2 tool struck down at ground "
        "level, frame 3 tool pulled back through the crop, frame 4 crouching low to collect it",
        0.08,
    ),
}

# Actions the text-to-image model cannot draw as a strip: a walk cycle needs four
# genuinely different leg poses, and measured silhouette change between frames
# stays around 2% (the four drawings are near-identical). They are generated by a
# separate pass so a bad walk never blocks the actions that do work.
DEFERRED_ACTIONS = {"walk"}

# Mounted variants read wrong with the on-foot wording.
UNIT_ACTION_OVERRIDE = {
    ("cavalry", "walk"): (
        "a horse walk cycle moving in the facing direction: frame 1 the horse in a collected trot, "
        "frame 2 legs extended with the rider rising in the saddle, frame 3 the opposite diagonal pair "
        "reaching forward, frame 4 the horse gathered again"
    ),
    ("cavalry", "attack"): (
        "a mounted attack sequence: frame 1 the rider raising the saber, "
        "frame 2 slashing the saber downward across the target, frame 3 the blade following through low, "
        "frame 4 the rider returning the saber to guard"
    ),
    ("cavalry", "death"): (
        "a mounted death sequence: frame 1 the rider jolted back in the saddle, "
        "frame 2 slumping forward over the horse's neck, frame 3 falling sideways off the horse, "
        "frame 4 the horse standing over the fallen rider"
    ),
    ("cavalry", "gather"): (
        "a mounted work loop: frame 1 the rider leaning down with a tool, "
        "frame 2 swinging the tool at the ground beside the horse, frame 3 pulling the tool back, "
        "frame 4 the rider straightening up in the saddle"
    ),
    ("cavalry", "build"): (
        "a mounted construction loop: frame 1 the rider raising a mallet above the saddle, "
        "frame 2 driving the mallet down onto a timber beside the horse, "
        "frame 3 lifting the mallet with a glance at the work, frame 4 a second hammer stroke"
    ),
}


def load_env() -> tuple[str, str]:
    values: dict[str, str] = {}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    host = values.get("LOCAL_API_URL") or os.environ.get("LOCAL_API_URL")
    key = values.get("LOCAL_API_KEY") or os.environ.get("LOCAL_API_KEY")
    if not host or not key:
        raise SystemExit("LOCAL_API_URL and LOCAL_API_KEY must be set in .env")
    return host.rstrip("/"), key


API_HOST, API_KEY = load_env()


def api_request(path: str, data: dict | None = None) -> dict:
    headers = {"X-API-Key": API_KEY}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode("utf-8")
    request = urllib.request.Request(f"{API_HOST}{path}", data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_job(job_id: str, label: str) -> dict:
    started = time.time()
    while True:
        job = api_request(f"/v1/jobs/{job_id}")
        status = job.get("status")
        if status == "succeeded":
            print(f"  [{label}] done in {time.time() - started:.1f}s", flush=True)
            return job
        if status in ("failed", "canceled"):
            raise RuntimeError(f"job {job_id} {status}: {job.get('error')}")
        print(f"  [{label}] {status} {job.get('progress', 0)}% {time.time() - started:.0f}s", flush=True)
        time.sleep(2)


def download(url: str, dest: Path) -> None:
    parsed = urllib.parse.urlparse(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(f"{API_HOST}{parsed.path}", headers={"X-API-Key": API_KEY})
    with urllib.request.urlopen(request, timeout=180) as response:
        dest.write_bytes(response.read())


def strip_prompt(unit: str, action: str, direction: str) -> str:
    verb = UNIT_ACTION_OVERRIDE.get((unit, action)) or ACTIONS[action][2]
    return (
        f"Sprite sheet for a 2D strategy game: {UNITS[unit]['subject']}, {STYLE}. "
        f"Four separate drawings of the SAME character in one horizontal row, reading left to right as an "
        f"animation sequence, {FACING[direction]}. {verb}. "
        "Each drawing must be a clearly different pose: a beginner can tell the four frames apart at a "
        "glance, the legs change position in every frame, no pose is repeated. "
        "Each figure completely separate, with a wide empty white gap between figures, no touching, "
        "no overlap. Same character, same costume, same colors, same scale, same camera angle in every "
        "frame; all four standing on the same ground baseline in a single row. "
        "Pure white background, no shadow, no ground line, no scenery, no text, no border, no panel frames."
    )


NEGATIVE = (
    "photo, 3d render, realistic, blurry, gradient background, ground shadow, text, watermark, ui, "
    "frame border, inconsistent costume, duplicate frames, identical poses, repeated sprite, static pose, "
    "frozen frame, standing still, overlapping figures, merged figures, extra characters"
)


def read_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {}


def write_manifest(manifest: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True), encoding="utf-8")


def raw_path(unit: str, action: str, direction: str) -> Path:
    return RAW_DIR / f"{unit}_{action}_{direction}_raw.png"


def _changed_ratio(a: Image.Image, b: Image.Image) -> float:
    size = (max(a.width, b.width), max(a.height, b.height))
    left, right = Image.new("RGBA", size), Image.new("RGBA", size)
    left.paste(a, (0, 0))
    right.paste(b, (0, 0))
    diff = ImageChops.difference(left.convert("L"), right.convert("L"))
    histogram = diff.histogram()
    return sum(histogram[25:]) / (size[0] * size[1])


def strip_defects(path: Path, action: str) -> list[str]:
    """Reasons a strip cannot be packed into a sheet; empty means it is usable.

    The model's two recurring failures are drawing a fifth figure (which shifts
    every pose by one column) and repeating the same pose four times (which packs
    into a sheet that does not animate). Both are measured here so a bad row is
    regenerated instead of silently shipped.
    """
    with Image.open(path) as image:
        matted = remove_background(image)
    runs = row_runs(matted)
    if len(runs) != FRAMES_PER_DIRECTION:
        return [f"{len(runs)} figures instead of {FRAMES_PER_DIRECTION}"]
    frames = [content(matted.crop((start, 0, end, matted.height))) for start, end in runs]
    # Compare the feet band, not the whole silhouette: a raised spear makes one
    # panel much taller without the character being a different size. The feet
    # band is stable across poses and reveals a figure drawn at another scale.
    bands = []
    for frame in frames:
        band = frame.crop((0, int(frame.height * 0.8), frame.width, frame.height))
        box = band.getchannel("A").getbbox()
        bands.append(box[2] - box[0] if box else 0)
    mean_band = sum(bands) / len(bands)
    if mean_band <= 0:
        return ["empty strip"]
    if max(bands) - min(bands) > 0.3 * mean_band:
        return [f"figures differ in scale {bands}"]
    deltas = [_changed_ratio(frames[index], frames[index + 1]) for index in range(len(frames) - 1)]
    floor = ACTIONS[action][3]
    if floor and sum(1 for delta in deltas if delta >= floor) < 2:
        return [f"poses too alike {[round(delta, 3) for delta in deltas]}"]
    return []


def generate_strip(
    unit: str, action: str, direction: str, force: bool, seed_shift: int = 0, attempts: int = 4
) -> Path:
    dest = raw_path(unit, action, direction)
    manifest = read_manifest()
    key = f"{unit}/{action}/{direction}"
    if dest.exists() and not force:
        defects = strip_defects(dest, action)
        if not defects:
            print(f"  cached {key}", flush=True)
            return dest
        print(f"  stale {key}: {', '.join(defects)}", flush=True)

    defects: list[str] = []
    for attempt in range(attempts):
        shift = seed_shift + attempt
        panel = UNITS[unit]["panel"]
        payload = {
            "prompt": strip_prompt(unit, action, direction),
            "negative": NEGATIVE,
            "width": panel * FRAMES_PER_DIRECTION,
            "height": UNITS[unit]["strip_height"],
            "steps": int(os.environ.get("UNIT_STEPS", "8")),
            "seed": (UNITS[unit]["seed"] + shift) if UNITS[unit].get("seed") is not None else manifest.get(key, {}).get("seed"),
        }
        job_id = api_request("/v1/images", payload)["job_id"]
        manifest[key] = {**manifest.get(key, {}), "job": job_id, "prompt": payload["prompt"], "attempt": attempt}
        write_manifest(manifest)

        job = wait_for_job(job_id, key)
        files = job.get("files") or []
        if not files:
            raise RuntimeError(f"job {job_id} returned no files")
        download(files[0]["url"], dest)
        manifest[key].update({"seed": job.get("seed"), "file": dest.name})
        write_manifest(manifest)

        defects = strip_defects(dest, action)
        if not defects:
            with Image.open(dest) as image:
                print(f"  accepted {key} attempt {attempt + 1} ({image.size[0]}x{image.size[1]})", flush=True)
            return dest
        print(f"  reject {key} attempt {attempt + 1}: {', '.join(defects)}", flush=True)

    print(f"  warning {key}: keeping the last strip, {', '.join(defects)}", flush=True)
    manifest[key]["defects"] = defects
    write_manifest(manifest)
    return dest



def row_runs(image: Image.Image) -> list[tuple[int, int]]:
    """The four column ranges of a matted strip, in reading order."""
    mask = image.getchannel("A")
    runs = split_characters(mask)
    if len(runs) == FRAMES_PER_DIRECTION:
        return runs
    fallback = density_runs(mask, FRAMES_PER_DIRECTION)
    if fallback:
        print(f"  note: gap split found {len(runs)} figures, using the density split", flush=True)
        return fallback
    if len(runs) > FRAMES_PER_DIRECTION:
        # The model likes to add a fifth figure. The figures still read as one
        # sequence, so keeping the first four leaves a valid cycle; slicing on an
        # even grid instead would cut limbs at the drifted gaps.
        print(f"  note: {len(runs)} characters detected, keeping the first {FRAMES_PER_DIRECTION}", flush=True)
        return runs[:FRAMES_PER_DIRECTION]
    print(f"  warning: only {len(runs)} characters detected, falling back to an even grid", flush=True)
    return even_runs(image.width, FRAMES_PER_DIRECTION)


def split_strip(image: Image.Image) -> list[Image.Image]:
    """Slice the strip at the empty gutters, not at width / 4."""
    return [image.crop((start, 0, end, image.height)) for start, end in row_runs(image)]



def load_row(unit: str, action: str, direction: str) -> list[Image.Image]:
    path = raw_path(unit, action, direction)
    if not path.exists():
        raise FileNotFoundError(f"missing strip {path.name}; run the generation step first")
    with Image.open(path) as image:
        return [content(frame) for frame in split_strip(remove_background(image))]


def unit_scale(unit: str, reference_actions=("idle",)) -> float:
    """One scale per unit so an action change never resizes the character.

    The reference action does not have to be part of the current run: packing
    ``death`` still measures itself against the ``idle`` rows on disk.
    """
    heights: list[int] = []
    for action in reference_actions:
        for direction in DIRECTIONS:
            try:
                heights.extend(frame.height for frame in load_row(unit, action, direction))
            except FileNotFoundError:
                continue
    if not heights:
        raise RuntimeError(f"no reference rows to scale {unit}; generate idle or walk first")
    # Median, not max: a raised spear or a mid-air leg should not shrink everyone.
    return UNITS[unit]["content_height"] / statistics.median(heights)


def build_sheet(unit: str, action: str, scale: float) -> Path:
    frame_size = UNITS[unit]["frame_size"]
    sheet = Image.new(
        "RGBA",
        (frame_size * FRAMES_PER_DIRECTION, frame_size * len(DIRECTIONS)),
        (0, 0, 0, 0),
    )
    for row, direction in enumerate(DIRECTIONS):
        frames = load_row(unit, action, direction)
        centre = statistics.median(frame.width / 2 for frame in frames)
        for column, frame in enumerate(frames):
            size = (max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
            scaled = frame.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")
            x = round(column * frame_size + frame_size / 2 - centre * scale)
            y = row * frame_size + frame_size - scaled.height - MARGIN_BOTTOM
            sheet.alpha_composite(scaled, (x, y))
    out_path = ACTION_DIR / f"{unit}_{action}.png"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, "PNG", optimize=True)
    return out_path



def run(args) -> None:
    units = args.units or list(UNITS)
    if args.actions:
        actions = args.actions
    else:
        actions = [
            name for name in ACTIONS if args.include_deferred or name not in DEFERRED_ACTIONS
        ]
        skipped = [name for name in ACTIONS if name not in actions]
        if skipped:
            print(f"deferred (run separately): {', '.join(skipped)}", flush=True)
    directions = args.directions or DIRECTIONS

    for unit in units:
        if unit not in UNITS:
            raise SystemExit(f"unknown unit {unit}")
        print(f"\n=== {unit} ===", flush=True)
        for action in actions:
            if action not in ACTIONS:
                raise SystemExit(f"unknown action {action}")
            if not args.assemble_only:
                for direction in directions:
                    generate_strip(unit, action, direction, args.force, args.seed_shift)

            missing = [d for d in DIRECTIONS if not raw_path(unit, action, d).exists()]
            if missing:
                print(f"  skip {unit}_{action}: missing rows {missing}")
                continue
            # Scale from the idle reference rows so every action of this unit
            # lands on the same size, then pack this action's eight rows. Walk is
            # deferred and may be regenerated later, so it must not move the scale.
            scale = unit_scale(unit, reference_actions=("idle",))
            out_path = build_sheet(unit, action, scale)
            with Image.open(out_path) as sheet_image:
                print(f"  {out_path.name}: {sheet_image.size[0]}x{sheet_image.size[1]} "
                      f"{out_path.stat().st_size // 1024} KB scale={scale:.3f}")
            # No portrait is written here: `build_unit_portrait.py` owns
            # `assets/units/<unit>_idle.png`, derives it from this sheet, and
            # this module's cell sizes have not matched the shipped sheets since
            # the units were redrawn (148x130, 192x168, 224x224).


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--units", nargs="*", help=f"subset of {list(UNITS)}")
    parser.add_argument("--actions", nargs="*", help=f"subset of {list(ACTIONS)}")
    parser.add_argument("--directions", nargs="*", help=f"subset of {DIRECTIONS}")
    parser.add_argument("--force", action="store_true", help="regenerate strips that already exist")
    parser.add_argument("--assemble-only", action="store_true", help="skip image generation")
    parser.add_argument(
        "--include-deferred",
        action="store_true",
        help=f"also generate {sorted(DEFERRED_ACTIONS)}, which the model draws badly",
    )
    parser.add_argument("--seed-shift", type=int, default=0, help="offset the per-unit seed to redraw a row")
    args = parser.parse_args()
    try:
        run(args)
    except urllib.error.URLError as error:
        raise SystemExit(f"local API unreachable at {API_HOST}: {error}")


if __name__ == "__main__":
    main()
