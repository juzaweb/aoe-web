#!/usr/bin/env python3
"""Generate the siege workshop building art with the local ComfyUI server.

The asset is project-original AI art: it has no upstream URL, so it is not part
of `scripts/assets/manifest.json`. The shipped PNG is pinned under `legacy` in
`scripts/assets/assets.lock.json` by `scripts/assets/build.py --legacy`.

The workflow is the built-in ComfyUI Z-Image Turbo text-to-image graph. The
model files below are the ones installed on the local machine; pass different
names with the CLI flags when they change.

Example:

    python scripts/generate_siege_workshop_asset.py
    python scripts/generate_siege_workshop_asset.py --raw scripts/.cache/assets/siege_workshop/raw_2024.png
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
sys.path.insert(0, str(SCRIPT_DIR / "assets"))

import ops  # noqa: E402
from build_unit_8dir import remove_background  # noqa: E402

OUTPUT = ROOT / "apps" / "client" / "public" / "assets" / "buildings" / "siege_workshop.png"
CACHE = ROOT / "scripts" / ".cache" / "assets" / "siege_workshop"
DEFAULT_HOST = "http://127.0.0.1:8188"

CANVAS = (400, 320)
# The renderer lifts every 400x320 building sheet by this much; `buildingArt.ts`
# repeats the number for SIEGE_WORKSHOP.
SHEET_OFFSET_Y = -96
TARGET_LUMA = 90.4

PROMPT = (
    "A 2D game asset of a medieval European siege workshop, 2.5D isometric "
    "top-down 45-degree view, same muted painterly palette and weathered texture "
    "as an Age of Empires II military building. Open-sided grey-brown timber "
    "workshop with an aged grey shingle roof, rough stone foundation and mossy "
    "stone edging. A large wooden catapult with a raised throwing arm, torsion "
    "bundle and rope winch sits fully assembled under the open roof, surrounded "
    "by cut timber stacks, rope coils, an anvil and a tool rack. Packed dirt "
    "yard. Muted desaturated earthy palette, soft overcast lighting, subtle "
    "ambient occlusion, detailed hand-painted texture. No people, no ground "
    "shadow, solid pure white background, clean sharp silhouette, game asset ready."
)


def build_workflow(args: argparse.Namespace) -> dict:
    """Native ComfyUI API graph for Text to Image (Z-Image-Turbo)."""
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": args.unet, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": args.clip, "type": "lumina2", "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": args.vae}},
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": args.prompt, "clip": ["2", 0]},
        },
        "5": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["4", 0]},
        },
        "6": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": args.size, "height": args.size, "batch_size": 1},
        },
        "7": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": 3.0},
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["7", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": args.seed,
                "steps": args.steps,
                "cfg": 1.0,
                "sampler_name": "res_multistep",
                "scheduler": "simple",
                "denoise": 1.0,
            },
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["8", 0], "vae": ["3", 0]},
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": "siege_workshop"},
        },
    }


def request_json(url: str, data: dict | None = None) -> dict:
    body = None
    headers: dict[str, str] = {}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def generate(args: argparse.Namespace) -> Path:
    """Queue one image, wait for it, and return the downloaded raw PNG path."""
    CACHE.mkdir(parents=True, exist_ok=True)
    host = args.host.rstrip("/")
    prompt_id = request_json(
        f"{host}/prompt",
        {"prompt": build_workflow(args), "client_id": str(uuid.uuid4())},
    )["prompt_id"]
    print(f"queued {prompt_id} (seed {args.seed}, {args.size}x{args.size})", flush=True)

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        time.sleep(2)
        history = request_json(f"{host}/history/{prompt_id}")
        entry = history.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise SystemExit(f"ComfyUI failed: {json.dumps(status)[:2000]}")
        images = entry.get("outputs", {}).get("10", {}).get("images", [])
        if not images:
            raise SystemExit(f"ComfyUI finished without an image: {json.dumps(entry)[:2000]}")
        image = images[0]
        query = urllib.parse.urlencode(
            {
                "filename": image["filename"],
                "subfolder": image.get("subfolder", ""),
                "type": image.get("type", "output"),
            }
        )
        raw_path = CACHE / f"raw_{args.seed}.png"
        with urllib.request.urlopen(f"{host}/view?{query}", timeout=120) as response:
            raw_path.write_bytes(response.read())
        print(f"downloaded {raw_path.relative_to(ROOT)}", flush=True)
        return raw_path
    raise SystemExit(f"ComfyUI timed out after {args.timeout}s")


def process(raw_path: Path, match_luma: bool, meta: dict) -> dict:
    """Cut the white background, fit the client canvas and report measurements."""
    CACHE.mkdir(parents=True, exist_ok=True)
    with Image.open(raw_path) as source:
        transparent = remove_background(source.convert("RGB"))

    art = ops.crop_to_alpha(transparent)
    art = ops.floor_alpha(art, 8)
    scaled, scale = ops.fit(art, CANVAS)

    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((CANVAS[0] - scaled.width) // 2, CANVAS[1] - scaled.height))

    gain = 1.0
    if match_luma:
        canvas, gain = ops.match_luminance(canvas, TARGET_LUMA)

    bbox = ops.alpha_bbox(canvas)
    top_inset = bbox[1]
    bottom_inset = canvas.height - bbox[3]
    base_span, base_offset = ops.iso_base(canvas)
    if bottom_inset > 3:
        raise SystemExit(f"art is not bottom-anchored (bottom inset {bottom_inset}px)")
    if base_span > ops.ISO_BASE_MAX_SPAN or base_offset > ops.ISO_BASE_MAX_OFFSET:
        raise SystemExit(
            "art does not stand on a front corner "
            f"(base span {base_span:.1%}, offset {base_offset:.1%}); "
            "the prompt probably produced a straight-on view"
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, "PNG", optimize=True)

    try:
        source_name = raw_path.relative_to(ROOT).as_posix()
    except ValueError:
        source_name = str(raw_path)
    report = {
        **meta,
        "source": source_name,
        "output": OUTPUT.relative_to(ROOT).as_posix(),
        "canvas": list(CANVAS),
        "scale": round(scale, 4),
        "lumGain": round(gain, 4),
        "bbox": list(bbox),
        "topInset": top_inset,
        "bottomInset": bottom_inset,
        "isoBaseSpan": round(base_span, 4),
        "isoBaseOffset": round(base_offset, 4),
        "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        "hpBarY": int(SHEET_OFFSET_Y - CANVAS[1] / 2 + top_inset - 8),
    }
    (CACHE / "report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    if scale > 1.6:
        print(f"warning: source was upscaled {scale:.2f}x; art may look soft")
    if abs(gain - 1.0) > 0.25:
        print(f"warning: luminance gain {gain:.2f} is far from 1.0")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST, help="ComfyUI base URL")
    parser.add_argument("--seed", type=int, default=2024)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--unet", default="z_image_turbo_int8_convrot.safetensors")
    parser.add_argument("--clip", default="qwen_3_4b_fp8_mixed.safetensors")
    parser.add_argument("--vae", default="ae.safetensors")
    parser.add_argument("--prompt", default=PROMPT)
    parser.add_argument(
        "--raw",
        type=Path,
        help="reprocess an existing raw PNG instead of asking ComfyUI for a new one",
    )
    parser.add_argument(
        "--no-match-lum",
        action="store_true",
        help="keep the generated brightness instead of matching the map's buildings",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raw_path = args.raw if args.raw else generate(args)
    if not raw_path.is_absolute():
        raw_path = ROOT / raw_path
    meta = {
        "prompt": args.prompt,
        "seed": args.seed,
        "steps": args.steps,
        "size": args.size,
        "unet": args.unet,
        "clip": args.clip,
        "vae": args.vae,
        "host": args.host,
    }
    process(raw_path, match_luma=not args.no_match_lum, meta=meta)


if __name__ == "__main__":
    main()
