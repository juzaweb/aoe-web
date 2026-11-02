"""Compare several layer combinations of the OpenGameArt unit pack side by side.

`build_oga_unit_sheets.py` builds one sheet per run, so trying out hair, skin or
clothing variants means running it several times into separate folders. This
collects those folders into one animated page, which is the only practical way to
judge a layer in motion at the client's draw scale.

    python scripts/build_oga_unit_sheets.py --layers BaseHumanMale,BrownPants,BrvHrtTunic \
        --out scripts/out/oga_villager/hair/none --preview-dir scripts/out/oga_villager/hair/none \
        --unit villager --skip-preview --actions walk=5_Walk
    ... one run per variant ...
    python scripts/preview_oga_variants.py scripts/out/oga_villager/hair
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

FRAME_SIZE = (148, 130)
DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
ACTION_FPS = {"idle": 4, "walk": 16, "attack": 12, "death": 9}

PAGE = """<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>So sánh biến thể dân làng</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ background: #0f1419; color: #e2e8f0; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; padding: 24px 28px 64px; }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  .note {{ color: #94a3b8; max-width: 900px; margin: 0 0 16px; }}
  code {{ color: #fbbf24; }}
  button {{ background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 4px; padding: 4px 12px; font: inherit; cursor: pointer; margin-bottom: 18px; }}
  button:hover {{ background: #273449; }}
  .zoom {{ display: inline-flex; align-items: center; gap: 8px; margin-left: 16px; color: #94a3b8; font-size: 12px; }}
  .zoom input {{ width: 140px; }}
  .variant {{ margin-bottom: 22px; }}
  .variant h2 {{ font-size: 12px; margin: 0 0 6px; color: #7dd3fc; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }}
  .variant .layers {{ font-size: 11px; color: #64748b; margin-bottom: 6px; }}
  .row {{ display: flex; gap: 2px; flex-wrap: wrap; }}
  .cell {{ text-align: center; }}
  .cell span {{ display: block; font-size: 10px; color: #64748b; margin-top: 2px; }}
  .view {{ background-color: #58752d; background-repeat: no-repeat; border-radius: 3px; }}
</style>
</head>
<body>
<h1>So sánh biến thể dân làng</h1>
<p class="note">Cùng một bộ xương/khung hình; chỉ khác lớp phủ. Hàng hình vẽ ở scale in-game <code>{scale}</code> — mức 1x của thanh zoom chính là cỡ thật trong game.</p>
<p>
  <button id="toggle">Tạm dừng</button>
  <label class="zoom">Zoom <input id="zoom" type="range" min="1" max="4" step="1" value="1" /> <span id="zoomValue">1x (cỡ trong game)</span></label>
</p>
<div id="root"></div>
<script>
const VARIANTS = {variants};
const DIRS = ["E","SE","S","SW","W","NW","N","NE"];
const root = document.getElementById('root');
let playing = true;
const clocks = [];

for (const variant of VARIANTS) {{
  const section = document.createElement('div');
  section.className = 'variant';
  const h2 = document.createElement('h2');
  h2.textContent = variant.name;
  section.appendChild(h2);
  if (variant.layers) {{
    const layers = document.createElement('div');
    layers.className = 'layers';
    layers.textContent = variant.layers;
    section.appendChild(layers);
  }}
  const row = document.createElement('div');
  row.className = 'row';
  const cells = [];
  DIRS.forEach((name, dirIndex) => {{
    const cell = document.createElement('div');
    cell.className = 'cell';
    const view = document.createElement('div');
    view.className = 'view';
    const w = Math.round(variant.fw * variant.scale);
    const h = Math.round(variant.fh * variant.scale);
    view.style.width = w + 'px';
    view.style.height = h + 'px';
    view.style.backgroundImage = 'url(' + variant.url + ')';
    cell.appendChild(view);
    const label = document.createElement('span');
    label.textContent = name;
    cell.appendChild(label);
    row.appendChild(cell);
    cells.push({{ view, dirIndex, w, h, frame: 0 }});
  }});
  section.appendChild(row);
  root.appendChild(section);
  clocks.push({{ cells, frames: variant.frames, fps: variant.fps }});
}}

function render() {{
  for (const clock of clocks) {{
    for (const c of clock.cells) {{
      c.view.style.backgroundSize = (c.w * clock.frames) + 'px ' + (c.h * 8) + 'px';
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

// The rows are already laid out at the in-game scale, so the slider is a plain
// multiplier on top of it.
const zoom = document.getElementById('zoom');
zoom.oninput = () => {{
  document.getElementById('zoomValue').textContent =
    zoom.value === '1' ? '1x (cỡ trong game)' : zoom.value + 'x';
  for (const el of document.querySelectorAll('.variant')) {{
    el.style.zoom = zoom.value;
  }}
}};

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
    parser.add_argument("root", type=Path, help="folder holding one sub-folder per variant")
    parser.add_argument("--action", default="walk")
    parser.add_argument("--scale", type=float, default=0.92, help="draw scale the rows are laid out at, matching the client")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)

    variants = []
    for folder in sorted(p for p in args.root.iterdir() if p.is_dir()):
        report_path = folder / "villager_report.json"
        sheet = folder / f"villager_{args.action}.png"
        if not report_path.exists() or not sheet.exists():
            continue
        report = json.loads(report_path.read_text())
        with Image.open(sheet) as image:
            width, height = image.size
        variants.append(
            {
                "name": folder.name,
                "layers": ", ".join(report["layers"]),
                "url": f"./{folder.name}/{sheet.name}",
                "fw": FRAME_SIZE[0],
                "fh": FRAME_SIZE[1],
                "frames": width // FRAME_SIZE[0],
                "scale": args.scale,
                "fps": ACTION_FPS.get(args.action, 8),
            }
        )

    if not variants:
        raise SystemExit(f"no variant folders with villager_report.json + villager_{args.action}.png under {args.root}")
    if len({v["frames"] for v in variants}) > 1:
        print("warning: variants have different frame counts; each plays at its own length")

    out = args.out or (args.root / "compare.html")
    out.write_text(
        PAGE.format(scale=args.scale, variants=json.dumps(variants)),
        encoding="utf-8",
    )
    print(f"wrote {out} with {len(variants)} variants: {', '.join(v['name'] for v in variants)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
