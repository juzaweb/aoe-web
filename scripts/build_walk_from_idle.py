"""Synthesise a directional walk sheet from the idle sheet, without the image API.

The generation model cannot draw a four-pose walk cycle in one strip: measured on
the spearman set, consecutive walk frames changed only 0.6% of the silhouette,
while the same measurement on attack gave 15%. A strip that static reads as a
unit sliding across the ground.

This script builds the walk locally from the idle art instead. Each frame is the
idle pose run through two deformations:

* **stride** — a horizontal displacement field applied to the body below the hip.
  The field is continuous in x and ramps from zero at the hip to full strength at
  the feet, so legs swing apart and together without tearing at a seam. The
  leading side moves further than the trailing side, which is what makes the two
  contact frames differ from each other.
* **squash** — a 1.5% vertical scale anchored on the ground line. The body drops
  on contact and rises on the pass frame, so the feet never leave the ground and
  the figure looks like it carries weight.

Because both deformations are analytic, the result is reproducible and costs no
image quota. It does not create new silhouettes the idle art lacks (no knee bend
on a figure whose trousers are drawn as one mass), so it is a principled
approximation rather than a true redraw.

Usage:
    python scripts/build_walk_from_idle.py SPEARMAN
    python scripts/build_walk_from_idle.py SPEARMAN --write     # publish to assets
    python scripts/build_walk_from_idle.py SPEARMAN --amp 0.11  # stronger stride
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
ACTIONS_DIR = REPO_ROOT / "apps" / "client" / "public" / "assets" / "units" / "actions"
STAGING_DIR = REPO_ROOT / "scripts" / "raw_downloads" / "units_8dir"

DIRECTIONS = ("E", "SE", "S", "SW", "W", "NW", "N", "NE")
FRAMES = 4
ALPHA_THRESHOLD = 24

# Frame size of each unit's action sheets, mirrored from ``unitDirections.ts``.
FRAME_SIZE = {"VILLAGER": 128, "SPEARMAN": 128, "ARCHER": 128, "CAVALRY": 160}

# Rows whose figure faces left on screen: the leading leg is the one on the left.
FACING_LEFT = {"W", "SW", "NW"}
# Rows facing the viewer or away have both legs visible, so the stride spreads
# symmetrically instead of leading with one side.
FRONTAL = {"S", "N"}

HIP_RATIO = 0.58
# A high exponent concentrates the displacement at the boots. On this art the
# tunic hangs to the calf, so moving the whole thigh just stretches the hem
# without changing the stance; the readable motion happens where the boots are.
STRIDE_FALLOFF = 3.5
TRAILING_GAIN = 0.55
# Torso sway, as a share of figure height. The whole upper body leans over the
# planted leg; feet stay put because this term fades out as the leg weight rises.
LEAN_RATIO = 0.045

# Foot lift, as a share of figure height. At the size a unit is drawn in game a
# horizontal slide alone does not read as walking: the eye needs one foot to
# leave the ground, which is what separates a step from a shove.
LIFT_RATIO = 0.08
LIFT_FALLOFF = 1.5

# (spread, lead side, squash) per frame. ``lead side`` names the leg that is
# forward and swinging (-1 screen-left, +1 screen-right, 0 for a pass frame with
# both planted). ``spread`` only controls how far apart the legs are; keeping the
# two separate is what makes the contact frames mirror images instead of one
# frame widening and the next collapsing inward.
# All four states differ so the cycle does not collapse to two alternating poses:
# contact-right (low), recoil (lowest, legs mid), contact-left (low), pass
# (highest, legs together). The squash is anchored on the ground line, so the body
# drops on contact and rises on the pass, which is the cue that survives when the
# sprite is drawn at 40 px in game.
PHASES = ((1.0, 1, 0.958), (0.35, 0, 0.945), (1.0, -1, 0.958), (0.0, 0, 1.02))


def load_row(sheet: Image.Image, row: int, frame_size: int) -> Image.Image:
    box = (0, row * frame_size, frame_size, (row + 1) * frame_size)
    return sheet.crop(box)


def figure_box(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    table = [0 if value < ALPHA_THRESHOLD else 255 for value in range(256)]
    box = alpha.point(table).getbbox()
    if not box:
        raise ValueError("frame is empty")
    return box


def sample(image: Image.Image, x: float, y: float) -> tuple[int, int, int, int]:
    """Bilinear sample of premultiplied RGBA; returns unpremultiplied RGBA."""
    width, height = image.size
    x = min(max(x, 0.0), width - 1.001)
    y = min(max(y, 0.0), height - 1.001)
    x0 = int(x)
    y0 = int(y)
    fx = x - x0
    fy = y - y0
    pixels = image.load()
    assert pixels is not None

    total = [0.0, 0.0, 0.0, 0.0]
    for dx, wx in (((0, 1.0 - fx), (1, fx)) if fx else ((0, 1.0),)):
        for dy, wy in (((0, 1.0 - fy), (1, fy)) if fy else ((0, 1.0),)):
            weight = wx * wy
            if weight <= 0.0:
                continue
            r, g, b, a = pixels[x0 + dx, y0 + dy]
            alpha = a / 255.0
            total[0] += r * alpha * weight
            total[1] += g * alpha * weight
            total[2] += b * alpha * weight
            total[3] += a * weight

    alpha = total[3]
    if alpha <= 0.5:
        return (0, 0, 0, 0)
    scale = 255.0 / alpha
    return (
        min(255, int(total[0] * scale + 0.5)),
        min(255, int(total[1] * scale + 0.5)),
        min(255, int(total[2] * scale + 0.5)),
        min(255, int(alpha + 0.5)),
    )


THIN_RATIO = 0.30
THIN_GAIN = 0.12


class Geometry:
    """Where the body is, as opposed to the whole cell.

    A naive bounding box of an armed unit includes the spear tip above the head
    and the shaft beside the legs. Using that box puts the hip line too low and
    the centre off to one side, so the warp deforms the weapon and leaves the legs
    alone. This measures the *body* instead: rows where the silhouette is broad
    enough to be torso or legs, and thin vertical structures (a shaft, a banner
    pole) are marked so they are barely displaced.
    """

    def __init__(self, image: Image.Image) -> None:
        width, height = image.size
        alpha = image.getchannel("A").tobytes()
        on = [[alpha[y * width + x] >= ALPHA_THRESHOLD for x in range(width)] for y in range(height)]

        counts = [sum(row) for row in on]
        peak = max(counts) if counts else 0
        if not peak:
            raise ValueError("frame is empty")
        broad = [y for y, count in enumerate(counts) if count >= peak * 0.35]
        body_top = broad[0]
        feet = max(y for y, count in enumerate(counts) if count)
        body_height = max(1, feet - body_top + 1)

        self.width = width
        self.height = height
        self.body_top = body_top
        self.feet_y = float(feet + 1)
        self.hip_y = body_top + body_height * HIP_RATIO
        self.body_height = float(body_height)

        # Centre and half-width from the torso band only, so a shaft on one side
        # does not drag the midpoint with it.
        torso = [y for y in broad if y <= self.hip_y] or broad
        extents = []
        weighted = 0.0
        total = 0
        for y in torso:
            xs = [x for x in range(width) if on[y][x]]
            if not xs:
                continue
            extents.append((xs[0], xs[-1]))
            for x in xs:
                weighted += x
                total += 1
        self.centre_x = weighted / total if total else width / 2.0
        if extents:
            span = max(high for _, high in extents) - min(low for low, _ in extents)
        else:
            span = width
        self.half_width = max(1.0, span / 2.0)

        # Vertical run length per pixel; a short run is a thin structure.
        threshold = max(2, int(THIN_RATIO * body_height))
        thin = [[False] * width for _ in range(height)]
        for x in range(width):
            y = 0
            while y < height:
                if not on[y][x]:
                    y += 1
                    continue
                start = y
                while y < height and on[y][x]:
                    y += 1
                if y - start < threshold:
                    for yy in range(start, y):
                        thin[yy][x] = True
        self.thin = thin

    def weight_at(self, x: int, y: int) -> float:
        """Stride weight: zero above the hip, rising to full strength at the feet."""
        if y < self.hip_y:
            return 0.0
        span = max(1.0, self.feet_y - self.hip_y)
        weight = min(1.0, (y - self.hip_y) / span) ** STRIDE_FALLOFF
        if 0 <= x < self.width and 0 <= y < self.height and self.thin[y][x]:
            weight *= THIN_GAIN
        return weight

    def u_at(self, x: float) -> float:
        return (x - self.centre_x) / self.half_width


def displacement(u: float, weight: float, spread: float, lead_side: int, amp: float, frontal: bool) -> float:
    """Horizontal offset in pixels for a body point ``u`` units from the centre.

    ``u`` is ``-1`` on the figure's left edge and ``1`` on its right edge. The
    offset always pushes points away from the centre, so the legs swing apart,
    and never inward: an inward pull would squash the pelvis and bow any prop
    that runs down the body. ``lead_side`` decides which leg travels further,
    which is what distinguishes one contact frame from the other; the sign of the
    spread must not carry that meaning or the two frames become copies of each
    other.
    """
    clamped = max(-1.15, min(1.15, u))
    if lead_side == 0 or frontal:
        gain = 1.0
    else:
        gain = 1.0 if clamped * lead_side >= 0 else TRAILING_GAIN
    return amp * spread * clamped * weight * gain


def lift_offset(u: float, weight: float, lift_side: int, lift: float) -> float:
    """Vertical offset in pixels, raising the foot on ``lift_side``.

    The ramp is smooth in ``u`` so the lifted leg blends into the pelvis instead
    of shearing off along a seam, and it is squared in ``weight`` so the motion
    concentrates at the foot rather than stretching the whole leg.
    """
    if lift_side == 0 or lift <= 0.0:
        return 0.0
    side = max(0.0, min(1.0, -u * lift_side))
    if side <= 0.0:
        return 0.0
    eased = side * side * (3.0 - 2.0 * side)
    return -lift * eased * (weight**LIFT_FALLOFF)


def build_frame(
    base: Image.Image,
    geometry: Geometry,
    direction: str,
    spread: float,
    lead_side: int,
    squash: float,
    amp_ratio: float,
) -> Image.Image:
    width, height = base.size
    figure_height = geometry.body_height
    amp = amp_ratio * figure_height
    lift = LIFT_RATIO * figure_height
    frontal = direction in FRONTAL
    feet_y = geometry.feet_y

    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    target = out.load()
    assert target is not None

    for y in range(height):
        source_y = feet_y - (feet_y - y) / squash
        if source_y < 0 or source_y > height - 1:
            continue
        row = min(height - 1, int(source_y))
        for x in range(width):
            weight = geometry.weight_at(x, row)
            lean = LEAN_RATIO * figure_height * lead_side * spread * (1.0 - min(1.0, weight))
            # The field is evaluated at the destination pixel, then one
            # correction pass pulls the source sample back to where it belongs.
            source_x = x - displacement(geometry.u_at(x), weight, spread, lead_side, amp, frontal) - lean
            u_source = geometry.u_at(source_x)
            source_x = x - displacement(u_source, weight, spread, lead_side, amp, frontal) - lean
            offset_y = lift_offset(u_source, weight, lead_side, lift)
            target[x, y] = sample(base, source_x, source_y - offset_y)
    return out


def build_row(row_image: Image.Image, direction: str, amp_ratio: float) -> list[Image.Image]:
    geometry = Geometry(row_image)
    return [
        build_frame(row_image, geometry, direction, spread, lead_side, squash, amp_ratio)
        for spread, lead_side, squash in PHASES
    ]


def build_sheet(unit: str, amp_ratio: float) -> Image.Image:
    frame_size = FRAME_SIZE.get(unit.upper())
    if frame_size is None:
        raise SystemExit(f"unknown unit {unit}; expected one of {sorted(FRAME_SIZE)}")
    source = ACTIONS_DIR / f"{unit.lower()}_idle.png"
    if not source.exists():
        raise SystemExit(f"missing idle sheet {source}")
    idle = Image.open(source).convert("RGBA")
    expected = (frame_size * FRAMES, frame_size * len(DIRECTIONS))
    if idle.size != expected:
        raise SystemExit(f"idle sheet is {idle.size}, expected {expected}")

    sheet = Image.new("RGBA", expected, (0, 0, 0, 0))
    for index, direction in enumerate(DIRECTIONS):
        row = load_row(idle, index, frame_size)
        frames = build_row(row, direction, amp_ratio)
        for column, frame in enumerate(frames):
            sheet.paste(frame, (column * frame_size, index * frame_size))
    return sheet


def write_preview(sheet: Image.Image, path: Path, scale: int = 2) -> None:
    """Checkerboard preview so transparent gaps and seams are visible."""
    width, height = sheet.size
    board = Image.new("RGBA", sheet.size, (255, 255, 255, 255))
    cell = 8
    pixels = board.load()
    assert pixels is not None
    for y in range(height):
        for x in range(width):
            if ((x // cell) + (y // cell)) % 2 == 0:
                pixels[x, y] = (206, 206, 206, 255)
    board.alpha_composite(sheet)
    board.resize((width * scale, height * scale), Image.Resampling.NEAREST).save(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("unit", help="unit type, e.g. SPEARMAN")
    parser.add_argument("--amp", type=float, default=0.09, help="stride strength as a share of figure height")
    parser.add_argument("--write", action="store_true", help="publish to the client assets folder")
    args = parser.parse_args()

    sheet = build_sheet(args.unit, args.amp)
    slug = args.unit.lower()

    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    staged = STAGING_DIR / f"{slug}_walk_procedural.png"
    sheet.save(staged)
    preview = STAGING_DIR / f"{slug}_walk_procedural_preview.png"
    write_preview(sheet, preview)

    target = staged
    if args.write:
        target = ACTIONS_DIR / f"{slug}_walk.png"
        sheet.save(target)

    print(f"{args.unit}: {sheet.size[0]}x{sheet.size[1]}, stride amp {args.amp:.3f} of figure height")
    print(f"  sheet   {staged}")
    print(f"  preview {preview}")
    if args.write:
        print(f"  written {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
