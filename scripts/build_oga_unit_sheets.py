"""Build Phaser-ready directional action sheets from the OpenGameArt pack
"400+ Items - BaseHumanMale / Orc / Skeleton" (author: SKYZ0R, CC-BY 4.0).

Source: https://opengameart.org/content/400-items-basehumanmale-orc-skeleton

The pack ships one PNG per (item, animation, camera, frame):

    <Item>/<n>_<Anim>_CAM<cam>_<t>.png      e.g. BaseHumanMale/5_Walk_CAM7_180.png

Every layer is rendered onto the same 148x130 canvas, so building a character is
plain alpha-over compositing in draw order, and building an animation is plain
frame selection.

## Camera order

Camera order is *not* the order the author lists in the submission text (that
one is just a description). It was measured from the pack itself with three
independent signals: torso vs. stride silhouette widths, how much of a beard
layer stays visible, and the beard's centroid offset from the head centre.

    CAM0=SW  CAM1=W  CAM2=NW  CAM3=N  CAM4=NE  CAM5=E  CAM6=SE  CAM7=S

The client's sheets start at east and run clockwise (see `DIRECTION_NAMES` in
apps/client/src/game/render/unitDirections.ts), so row `r` takes camera
`(r + 5) % 8`.

## Anchoring

Frames are already aligned on a common canvas: the sprite centroid is stable to
under a pixel across a cycle, and the leftover vertical wobble is the authored
walk bob. What is *not* aligned is the figure's feet across cameras, because a
profile view is not symmetric about the frame centre. Each row is therefore
shifted once, by a whole number of pixels, so that the planted feet sit at the
frame centre with the sole on the same baseline for every direction - otherwise
a unit turning in place appears to slide sideways and pop up and down.

## Edges

The author rendered hard alpha (the target engine only supported bmp), so the
silhouette is a binary mask with hard, stair-stepped edges. `--feather` erodes
the mask by a pixel and blurs it back, which trades a hair of silhouette for an
edge that does not shimmer against the grass at the client's draw scale.

    bsdtar -xf part-1.7z -C scripts/raw_downloads/oga/extract <Item> ...
    python scripts/build_oga_unit_sheets.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from html import escape as html_escape
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PACK = SCRIPT_DIR / "raw_downloads" / "oga" / "extract"
DEFAULT_OUT = SCRIPT_DIR.parent / "apps" / "client" / "public" / "assets" / "units" / "actions"
DEFAULT_PREVIEW = SCRIPT_DIR / "out" / "oga_villager"

# Client sheet order: compass-from-east, clockwise (see unitDirections.ts).
DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
FRAME_SIZE = (148, 130)
CAM_TO_DIRECTION = {5: "E", 6: "SE", 7: "S", 0: "SW", 1: "W", 2: "NW", 3: "N", 4: "NE"}

# Playback rates, mirroring `unitArt.ts` so the preview moves at the in-game speed.
# The client config is the source of truth; keep these two in step.
ACTION_FPS = {"idle": 4, "walk": 16, "attack": 12, "death": 9, "gather": 9, "build": 9}


def camera_for_row(row: int) -> int:
    """Camera index feeding row `row` of the client's east-first sheet."""
    for cam, name in CAM_TO_DIRECTION.items():
        if name == DIRECTIONS[row]:
            return cam
    raise AssertionError(f"no camera mapped to {DIRECTIONS[row]}")


def frame_files(pack: Path, item: str, anim: str, cam: int) -> list[Path]:
    """Frames of one (item, animation, camera), ordered by the pack's time stamp."""
    files = sorted((pack / item).glob(f"{anim}_CAM{cam}_*.png"))
    if not files:
        raise SystemExit(
            f"missing frames: {item}/{anim}_CAM{cam}_*.png under {pack}\n"
            "extract them first: bsdtar -xf part-N.7z -C <pack> <Item>"
        )
    return sorted(files, key=lambda path: int(path.stem.rsplit("_", 1)[1]))


def composite(pack: Path, layers: list[str], anim: str, cam: int, index: int) -> Image.Image:
    """Alpha-over one frame of every layer, in draw order."""
    frames = [frame_files(pack, item, anim, cam) for item in layers]
    count = min(len(f) for f in frames)
    if index >= count:
        raise SystemExit(f"frame {index} is past the end of {anim} CAM{cam} ({count} frames)")
    canvas = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
    for files in frames:
        canvas.alpha_composite(Image.open(files[index]).convert("RGBA"))
    return canvas


def feet_anchor(frame: Image.Image) -> tuple[float, int]:
    """Horizontal centre of the planted feet and the sole's row in `frame`."""
    mask = np.array(frame.split()[3]) > 127
    rows = np.where(mask.any(axis=1))[0]
    sole = int(rows.max())
    # The sole band is a few pixels tall; its centroid sits between the two feet
    # in a contact pose, which is the point the figure actually pivots around.
    band = mask[max(0, sole - 5) : sole + 1]
    cols = np.where(band.any(axis=0))[0]
    return (float(cols.min() + cols.max()) / 2.0, sole)


def feather_frame(frame: Image.Image, radius: float) -> Image.Image:
    """Erode then blur the hard mask so the silhouette edge stops stair-stepping."""
    alpha = frame.split()[3]
    hard = alpha.point(lambda value: 255 if value > 127 else 0)
    eroded = hard.filter(ImageFilter.MinFilter(3))
    soft = eroded.filter(ImageFilter.GaussianBlur(radius)).point(
        lambda value: min(255, round(value * 1.45))
    )
    out = frame.copy()
    out.putalpha(soft)
    return out


def measure_offsets(
    pack: Path,
    layers: list[str],
    anim: str,
    anchor_x: bool,
) -> dict[str, tuple[int, int]]:
    """Per-direction (dx, dy) that puts every camera on one ground line.

    Measured once, from the rest action, and then applied to every other action
    of the unit. Measuring per action would align each sheet nicely on its own
    but make the sprite hop a few pixels every time the unit switched clips.
    """
    offsets: dict[str, tuple[int, int]] = {}
    cycles: dict[int, list[tuple[float, int]]] = {}
    for cam in range(8):
        files = frame_files(pack, layers[0], anim, cam)
        cycles[cam] = [
            feet_anchor(composite(pack, layers, anim, cam, index)) for index in range(len(files))
        ]

    baseline = max(round(sum(s for _, s in points) / len(points)) for points in cycles.values())
    for row, name in enumerate(DIRECTIONS):
        cam = camera_for_row(row)
        points = cycles[cam]
        mean_cx = sum(cx for cx, _ in points) / len(points)
        mean_sole = sum(s for _, s in points) / len(points)
        dx = round(FRAME_SIZE[0] / 2 - mean_cx) if anchor_x else 0
        offsets[name] = (dx, round(baseline - mean_sole))
    return offsets


def build_action(
    pack: Path,
    layers: list[str],
    anim: str,
    feather: float,
    offsets: dict[str, tuple[int, int]] | None,
) -> tuple[Image.Image, int]:
    """One row per direction, one column per frame, ground-anchored per direction."""
    counts = {cam: len(frame_files(pack, layers[0], anim, cam)) for cam in range(8)}
    frames_per_direction = min(counts.values())
    if len(set(counts.values())) > 1:
        print(f"  warning: uneven frame counts per camera {counts}, using {frames_per_direction}")

    sheet = Image.new(
        "RGBA",
        (FRAME_SIZE[0] * frames_per_direction, FRAME_SIZE[1] * len(DIRECTIONS)),
        (0, 0, 0, 0),
    )
    for row, name in enumerate(DIRECTIONS):
        cam = camera_for_row(row)
        dx, dy = offsets[name] if offsets is not None else (0, 0)
        for col in range(frames_per_direction):
            frame = composite(pack, layers, anim, cam, col)
            if dx or dy:
                shifted = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
                shifted.paste(frame, (dx, dy))
                frame = shifted
            if feather > 0:
                frame = feather_frame(frame, feather)
            sheet.paste(frame, (col * FRAME_SIZE[0], row * FRAME_SIZE[1]))
    return sheet, frames_per_direction


PREVIEW_HTML = """<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>{title} - kiểm tra animation</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ background: #0f1419; color: #e2e8f0; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; padding: 24px 28px 64px; }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  h2 {{ font-size: 12px; margin: 0 0 8px; color: #7dd3fc; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }}
  .note {{ color: #94a3b8; max-width: 900px; margin: 0 0 20px; }}
  .note b {{ color: #e2e8f0; font-weight: 600; }}
  code {{ color: #fbbf24; }}
  .action {{ margin-bottom: 28px; }}
  .row {{ display: flex; gap: 2px; flex-wrap: wrap; }}
  .cell {{ text-align: center; }}
  .cell span {{ display: block; font-size: 10px; color: #64748b; margin-top: 2px; }}
  .view {{ background-color: #58752d; background-repeat: no-repeat; border-radius: 3px; }}
  .compare {{ display: flex; gap: 24px; align-items: flex-start; }}
  .compare > div {{ text-align: center; }}
  .compare .cap {{ font-size: 11px; color: #94a3b8; margin-top: 6px; }}
  button {{ background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 4px; padding: 4px 12px; font: inherit; cursor: pointer; }}
  button:hover {{ background: #273449; }}
</style>
</head>
<body>
<h1>{title} — kiểm tra animation 8 hướng</h1>
<p class="note">
  Art: OpenGameArt <b>400+ Items</b> của <b>SKYZ0R</b>, license <b>CC-BY 4.0</b>.
  Phát ở đúng scale <code>{scale}</code> và đúng frame rate khai báo trong
  <code>unitArt.ts</code>. Thứ tự hướng: E, SE, S, SW, W, NW, N, NE.
</p>
<p><button id="toggle">Tạm dừng</button></p>
<div id="root"></div>
<script>
const ACTIONS = {actions};
const DIRS = ["E","SE","S","SW","W","NW","N","NE"];
const root = document.getElementById('root');
const clocks = [];
let playing = true;

for (const spec of ACTIONS) {{
  const section = document.createElement('div');
  section.className = 'action';
  const h2 = document.createElement('h2');
  h2.textContent = spec.label;
  section.appendChild(h2);
  const row = document.createElement('div');
  row.className = 'row';
  const cells = [];
  DIRS.forEach((name, dirIndex) => {{
    const cell = document.createElement('div');
    cell.className = 'cell';
    const view = document.createElement('div');
    view.className = 'view';
    const w = Math.round(spec.fw * spec.scale), h = Math.round(spec.fh * spec.scale);
    view.style.width = w + 'px';
    view.style.height = h + 'px';
    view.style.backgroundImage = 'url(' + spec.url + ')';
    view.style.backgroundSize = (w * spec.frames) + 'px ' + (h * 8) + 'px';
    cell.appendChild(view);
    const label = document.createElement('span');
    label.textContent = name;
    cell.appendChild(label);
    row.appendChild(cell);
    cells.push({{ view, dirIndex, w, h, frame: 0 }});
  }});
  section.appendChild(row);
  root.appendChild(section);
  clocks.push({{ cells, frames: spec.frames, fps: spec.fps }});
}}

function render() {{
  for (const clock of clocks) {{
    for (const c of clock.cells) {{
      c.view.style.backgroundPosition =
        (-c.frame * c.w) + 'px ' + (-c.dirIndex * c.h) + 'px';
    }}
  }}
}}

for (const clock of clocks) {{
  const step = 1000 / clock.fps;
  let acc = 0, last = performance.now();
  const tick = (now) => {{
    const dt = now - last; last = now;
    if (playing) {{
      acc += dt;
      while (acc >= step) {{
        acc -= step;
        for (const c of clock.cells) c.frame = (c.frame + 1) % clock.frames;
      }}
    }}
    requestAnimationFrame(tick);
  }};
  requestAnimationFrame(tick);
}}
setInterval(render, 1000 / 60);

document.getElementById('toggle').onclick = (event) => {{
  playing = !playing;
  event.target.textContent = playing ? 'Tạm dừng' : 'Tiếp tục';
}};
</script>
</body>
</html>
"""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, default=DEFAULT_PACK, help="folder holding the extracted items")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="folder for the Phaser sheets")
    parser.add_argument("--preview-dir", type=Path, default=DEFAULT_PREVIEW)
    parser.add_argument("--unit", default="villager", help="output file prefix, e.g. villager_walk.png")
    parser.add_argument(
        "--layers",
        default="BaseHumanMale,BrownPants,TunicBlue,ShortHairLight,BeardLight",
        help="items composited bottom to top",
    )
    parser.add_argument(
        "--actions",
        default="idle=1_Idle,walk=5_Walk,attack=2_Attack,death=7_Death",
        help="client action name = pack animation id",
    )
    parser.add_argument("--feather", type=float, default=0.8, help="edge softening radius in px, 0 to keep hard alpha")
    parser.add_argument("--no-anchor", action="store_true", help="keep the pack's own in-frame offsets")
    parser.add_argument(
        "--anchor-x",
        action="store_true",
        help="also centre each row horizontally; off by default because the pack already "
        "centres figures on the body and re-centring on the feet doubles the error",
    )
    parser.add_argument("--skip-preview", action="store_true", help="only write the sheets and the report")
    parser.add_argument("--scale", type=float, default=0.92, help="client draw scale, for the preview")
    parser.add_argument(
        "--title",
        default=None,
        help="preview page heading; defaults to the unit name",
    )
    parser.add_argument(
        "--fps",
        default="",
        help="override playback rates for this run, e.g. attack=10,walk=14; "
        "defaults come from ACTION_FPS",
    )
    args = parser.parse_args(argv)

    layers = [name.strip() for name in args.layers.split(",") if name.strip()]
    actions = {}
    for chunk in args.actions.split(","):
        action, _, anim = chunk.partition("=")
        if not anim:
            raise SystemExit(f"--actions entry '{chunk}' must look like walk=5_Walk")
        actions[action.strip()] = anim.strip()

    fps_overrides = {}
    for chunk in (args.fps or "").split(","):
        if not chunk.strip():
            continue
        action, _, rate = chunk.partition("=")
        if not rate:
            raise SystemExit(f"--fps entry '{chunk}' must look like attack=10")
        fps_overrides[action.strip()] = float(rate)
    fps_by_action = {**ACTION_FPS, **fps_overrides}

    args.out.mkdir(parents=True, exist_ok=True)
    args.preview_dir.mkdir(parents=True, exist_ok=True)

    report = {"unit": args.unit, "layers": layers, "frame": list(FRAME_SIZE), "actions": {}}

    # One offset table for the whole unit, measured on the rest action. Every clip
    # then shares it, so switching action cannot shift the sprite on screen.
    reference_action = next(iter(actions))
    offsets = (
        measure_offsets(args.pack, layers, actions[reference_action], args.anchor_x)
        if not args.no_anchor
        else None
    )
    report["offsets"] = offsets
    report["offsets_from"] = reference_action

    for action, anim in actions.items():
        sheet, frames_per_direction = build_action(
            args.pack, layers, anim, args.feather, offsets
        )
        path = args.out / f"{args.unit}_{action}.png"
        sheet.save(path)
        report["actions"][action] = {
            "anim": anim,
            "frames": frames_per_direction,
            "fps": fps_by_action.get(action, 8),
            "file": path.name,
        }
        print(f"{path.name}: {sheet.size[0]}x{sheet.size[1]}, {frames_per_direction} frames x 8 directions")

    (args.preview_dir / f"{args.unit}_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )

    if args.skip_preview:
        print(f"report {args.preview_dir / f'{args.unit}_report.json'}")
        return 0

    # Copy the sheets next to the preview so the page opens straight off disk.
    actions_for_preview = []
    for action, info in report["actions"].items():
        source = args.out / info["file"]
        shutil.copy2(source, args.preview_dir / info["file"])
        actions_for_preview.append(
            {
                "label": f"{action} — {info['frames']} frame/hướng",
                "url": f"./{info['file']}",
                "fw": FRAME_SIZE[0],
                "fh": FRAME_SIZE[1],
                "frames": info["frames"],
                "scale": args.scale,
                "fps": info["fps"],
            }
        )
    legacy = args.preview_dir / f"{args.unit}_walk_legacy.png"
    if legacy.exists():
        actions_for_preview.append(
            {
                "label": f"walk — {args.unit} cũ (procedural), 4 frame/hướng, 128px",
                "url": f"./{legacy.name}",
                "fw": 128,
                "fh": 128,
                "frames": 4,
                "scale": 0.72,
                "fps": 8,
            }
        )
    html = PREVIEW_HTML.format(
        title=html_escape(args.title or args.unit.capitalize()),
        scale=args.scale,
        actions=json.dumps(actions_for_preview),
    )
    (args.preview_dir / f"{args.unit}_preview.html").write_text(html, encoding="utf-8")
    print(f"preview {args.preview_dir / f'{args.unit}_preview.html'}")
    print(f"report {args.preview_dir / f'{args.unit}_report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
