"""Proof sheets for the 9-slice UI chrome kit.

These are developer artifacts, not shipped assets: the contact sheet is a PNG
grid of every frame over the fill it is drawn on, and the HTML preview renders
the kit the way the CSS does (real sizes, `border-image` slices taken from the
same spec table the generator uses). Nothing here is checked or locked, so a
broken template can never fail the asset gate.

Written to `scripts/out/` (gitignored). Serve the repo root and open
`/scripts/out/ui-preview.html`, because the HTML references the assets by a
relative path from there.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PREVIEW_DIR = Path(__file__).resolve().parent / "out"


def fill_for(asset: str) -> str:
    """The tile a frame is drawn over, shared by both preview surfaces.

    The CSS is the real source of truth for which fill each class uses; this
    mirror exists so the proof sheets show the asset the way the client does.
    """
    if asset.startswith("button_primary"):
        return "primary_fill"
    if asset.startswith("button_"):
        return "button_fill"
    if asset.startswith("slot_") or asset in ("tooltip_frame", "chip_frame"):
        return "inset_fill"
    if asset == "modal_frame":
        return "modal_fill"
    return "panel_fill"


def fill_css(asset: str, specs: dict) -> tuple[str, int]:
    """`(fill name, tile size in px)` for the frame `asset`."""
    name = fill_for(asset)
    return name, specs[name]["size"]


def _font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def write_contact_sheet(assets: dict[str, Image.Image], specs: dict) -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (1500, 1100), (12, 9, 7, 255))
    draw = ImageDraw.Draw(sheet)
    font = _font(16)
    small = _font(12)

    draw.text((24, 20), "Chien Quoc UI chrome - contact sheet", font=font, fill=(240, 208, 144, 255))
    draw.text((24, 44), "frames are shown over their fill tile; button/slot states are separate files", font=small, fill=(180, 170, 150, 255))

    cursor_x, cursor_y = 24, 80
    max_height = 0

    for name, image in assets.items():
        if name.endswith("_fill") or name == "backdrop":
            continue
        if image.width > 220:
            scale = 220 / image.width
            preview = image.resize((220, max(1, int(image.height * scale))), Image.Resampling.NEAREST)
        else:
            preview = image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST)

        fill_name, _tile = fill_css(name, specs)
        fill = assets[fill_name].resize(preview.size, Image.Resampling.NEAREST)
        composited = Image.alpha_composite(fill, preview)

        if cursor_x + preview.width + 24 > sheet.width:
            cursor_x = 24
            cursor_y += max_height + 42
            max_height = 0

        sheet.alpha_composite(composited, dest=(cursor_x, cursor_y))
        draw.text((cursor_x, cursor_y + preview.height + 4), name, font=small, fill=(210, 200, 180, 255))
        cursor_x += preview.width + 24
        max_height = max(max_height, preview.height)

    path = PREVIEW_DIR / "ui_contact_sheet.png"
    sheet.convert("RGB").save(path, "PNG", optimize=True)
    return path


def write_preview(assets: dict[str, Image.Image], specs: dict, version: int) -> Path:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    base = "../../apps/client/public/assets/ui"

    def frame_div(name: str, width: int, height: int) -> str:
        """One frame at a real client size, over the fill its CSS class uses."""
        spec = specs[name]
        fill, tile = fill_css(name, specs)
        return (
            f'<div class="frame" style="width:{width}px;height:{height}px;'
            f'border-image:url(\'{base}/{name}.png\') {spec["slice"]} / {spec["borderWidthPx"]}px stretch;'
            f'background-image:url(\'{base}/{fill}.png\');'
            f'background-size:{tile}px;">'
            f'<span>{name} {width}x{height}</span></div>'
        )

    frame_rows = []
    for width, height in ((48, 48), (156, 156), (320, 180), (448, 260)):
        frame_rows.append(frame_div("panel_frame", width, height))
    modal_rows = [
        frame_div("modal_frame", 448, 260),
        frame_div("modal_frame", 320, 200),
    ]

    def state_rows(prefix: str, states: list[str], css_class: str = "key") -> str:
        rows = []
        for state in states:
            name = f"{prefix}_{state}"
            spec = specs[name]
            fill, tile = fill_css(name, specs)
            rows.append(
                f'<div class="{css_class}" style="border-image:url(\'{base}/{name}.png\') '
                f'{spec["slice"]} / {spec["borderWidthPx"]}px stretch;'
                f'background-image:url(\'{base}/{fill}.png\');background-size:{tile}px;">'
                f'<span>{state}</span></div>'
            )
        return "".join(rows)

    button_rows = state_rows("button", ["idle", "hover", "pressed", "disabled", "active"])
    danger_rows = state_rows("button_danger", ["idle", "hover", "pressed"], "key danger")
    primary_rows = state_rows("button_primary", ["idle", "hover", "pressed"], "key primary")
    slot_rows = state_rows("slot", ["idle", "hover", "active", "disabled"], "key slot")

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chien Quoc UI chrome preview</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0; padding: 24px; background: #050403; color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background-image: url('{base}/backdrop.png'); background-size: 256px;
  }}
  h1 {{ font-size: 18px; color: #f0d090; margin: 0 0 4px; }}
  h2 {{ font-size: 13px; color: #d9a441; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: .08em; }}
  p {{ margin: 0 0 14px; color: #94a3b8; font-size: 12px; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }}
  .frame {{
    position: relative; display: flex; align-items: center; justify-content: center;
    box-sizing: border-box; border: 2px solid transparent;
    color: #e2e8f0; font-size: 11px; text-align: center;
  }}
  .frame span, .key span {{ pointer-events: none; }}
  .key {{
    display: flex; align-items: center; justify-content: center;
    width: 48px; height: 48px; box-sizing: border-box;
    border: 1px solid transparent; color: #fef3c7; font-size: 10px;
  }}
  .key.danger {{ color: #fecaca; }}
  .key.primary {{ color: #0f172a; }}
  .key.slot {{ width: 38px; height: 38px; color: #fef3c7; }}
  .chip {{
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 64px; height: 24px; padding: 0 8px; box-sizing: border-box;
    border: 1px solid transparent; color: #e2e8f0; font-size: 11px;
    border-image: url('{base}/chip_frame.png') 12 / 3px stretch;
    background-image: url('{base}/inset_fill.png'); background-size: 32px;
  }}
  .tooltip {{
    width: 220px; padding: 8px; box-sizing: border-box;
    border: 1px solid transparent; color: #e2e8f0; font-size: 11px;
    border-image: url('{base}/tooltip_frame.png') 24 / 6px stretch;
    background-image: url('{base}/inset_fill.png'); background-size: 32px;
  }}
  .backdrop {{
    width: 100%; max-width: 520px; height: 180px; box-sizing: border-box;
    border: 1px solid #3b2a16; color: #94a3b8; font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    background-image: radial-gradient(ellipse at 50% 38%, rgba(120,80,30,.20), transparent 62%), url('{base}/backdrop.png');
    background-size: 100% 100%, 256px 256px; background-repeat: no-repeat, repeat;
  }}
</style>
</head>
<body>
  <h1>Chien Quoc UI chrome</h1>
  <p>Procedural 9-slice kit, version {version}. Frames use border-image-width larger than border-width so the box model does not move.</p>

  <h2>Panel frame (8 px inward)</h2>
  <div class="row">{''.join(frame_rows)}</div>

  <h2>Modal frame (12 px inward)</h2>
  <div class="row">{''.join(modal_rows)}</div>

  <h2>Buttons</h2>
  <div class="row">{button_rows}</div>
  <div class="row">{danger_rows}</div>
  <div class="row">{primary_rows}</div>

  <h2>Command slots</h2>
  <div class="row">{slot_rows}</div>

  <h2>Chip + tooltip</h2>
  <div class="row"><span class="chip">wood 1234</span><span class="chip">food 999</span>
    <div class="tooltip">A tooltip on the inset stone fill. 11 px text must stay readable.</div>
  </div>

  <h2>Backdrop</h2>
  <div class="row"><div class="backdrop">modal / auth backdrop texture</div></div>
</body>
</html>
"""
    path = PREVIEW_DIR / "ui-preview.html"
    path.write_text(html, encoding="utf-8")
    return path
