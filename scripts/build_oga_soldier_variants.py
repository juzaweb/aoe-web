"""Pick outfit layers for the OGA-pack soldiers and build their sheets.

`build_oga_unit_sheets.py` turns one layer list into one set of sheets, so
choosing armour means running it once per candidate. This script holds the
candidate list, builds them into throwaway folders for comparison, and then
rebuilds the chosen one into the client's asset directory.

    # compare all candidates of a unit (writes scripts/out/oga_soldiers/<unit>/compare.html)
    python scripts/build_oga_soldier_variants.py gallery spearman

    # build the chosen candidate as the real sheets
    python scripts/build_oga_soldier_variants.py final spearman 03

Candidates are numbered because that is what a person picks from in the gallery.

## Why soldiers and not cavalry

The pack is humanoid paperdoll only (`BaseHumanMale`, `BaseElf`, `BaseDwarf`,
...) with weapons and armour as separate layers. There is no mounted base, so
cavalry keeps its procedurally drawn art.

## Why the archer's attack is `3_Bow`

The pack ships four distinct action animations: `2_Attack` (melee swing),
`3_Bow` (draw and loose), `4_Cast` (spell), plus `7_Death`. The client only ever
plays its `attack` clip, so the archer's attack sheet is built from `3_Bow` - the
clip name is the client's, the animation behind it is the pack's.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
GALLERY_ROOT = SCRIPT_DIR / "out" / "oga_soldiers"
ASSET_DIR = SCRIPT_DIR.parent / "apps" / "client" / "public" / "assets" / "units" / "actions"

# Layers are listed bottom to top; `BaseHumanMale` is the body every other layer
# is authored to sit on. Skirt-length items (tabards, kilts) go over the pants but
# under the chest armour, and helmets go on last, over the hair.
SOLDIERS: dict[str, dict] = {
    "spearman": {
        "title": "So sánh biến thể lính giáo (spearman)",
        # The client only ever plays idle/walk/attack/death; gather and build are
        # villager actions, so the soldiers ship no sheets for them.
        "actions": "idle=1_Idle,walk=5_Walk,attack=2_Attack,death=7_Death",
        "variants": {
            "01": "BaseHumanMale,BrownPants,ScaleShirt,ShortHairDark,SteelCap,Spear",
            "02": "BaseHumanMale,BrownPants,LightChainmail,ShortHairDark,Helmet3,Spear",
            "03": "BaseHumanMale,BrownPants,BreastPlate1,ShortHairDark,GuardHelmet1,Spear",
            "04": "BaseHumanMale,BrownPants,ScaleShirt,FullHelmet,Spear",
            "05": "BaseHumanMale,TightsDarkRed,PaddedTunic,LeatherArmSplints,SteelBoots,SteelCap,Spear",
            "06": "BaseHumanMale,BrownPants,ScaleShirt,ChainCoif,Helmet4,Spear",
            "07": "BaseHumanMale,BrownPants,PaddedTunic,ScaleShirt,SpikyHelm1,Spear",
            "08": "BaseHumanMale,BrownPants,RotTabard1,LightChainmail,ShortHairDark,SteelCap,Spear",
        },
    },
    "archer": {
        "title": "So sánh biến thể cung thủ (archer)",
        "actions": "idle=1_Idle,walk=5_Walk,attack=3_Bow,death=7_Death",
        # Must match `unitArt.ts`: nine frames at 10 fps keeps the draw inside the
        # archer's 1400 ms attack cooldown.
        "fps": "attack=10",
        "variants": {
            "01": "BaseHumanMale,BrownPants,PaddedTunic,LeatherBoots,ShortHairLight,SteelCap,LongBow,QuiverBelt",
            "02": "BaseHumanMale,BrownPants,SoftLeatherVest,LeatherBoots,ShortHairDark,PeasantHat,LongBow,QuiverBelt",
            "03": "BaseHumanMale,BrownPants,RotTabard1,LeatherBoots,ShortHairLight,GuardHelmet1,LongBow,QuiverBelt",
            "04": "BaseHumanMale,TightsDarkGreen,LightChainmail,LeatherBoots,ShortHairDark,SteelCap,LongBow,QuiverBelt",
            "05": "BaseHumanMale,BrownPants,ScaleShirt,LeatherBoots,ShortHairDark,ChainCoif,HuntingBow,QuiverBelt",
            "06": "BaseHumanMale,BrownPants,StuddedLeatherTunic,LeatherBoots,ShortHairLight,Helmet5,LongBow,QuiverBelt",
            "07": "BaseHumanMale,BrownPants,TabardNoCrest,LeatherBoots,ShortHairLight,SteelCap,LongBow,QuiverBelt",
            "08": "BaseHumanMale,BrownPants,LeatherArmor,LeatherBoots,ShortHairDark,LongBow,QuiverBelt",
        },
    },
}


def run_build(
    unit: str,
    layers: str,
    out: Path,
    actions: str,
    preview_dir: Path | None,
    title: str | None = None,
    fps: str = "",
) -> None:
    """Build one layer list, failing loudly rather than leaving a half-written set.

    `preview_dir` is a separate folder for the client asset build: the builder
    copies each sheet next to its preview page, and copying a file onto itself
    raises `SameFileError`.
    """
    command = [
        sys.executable,
        str(SCRIPT_DIR / "build_oga_unit_sheets.py"),
        "--unit", unit,
        "--layers", layers,
        "--actions", actions,
        "--out", str(out),
        "--preview-dir", str(preview_dir or out),
        "--title", title or unit.capitalize(),
        "--fps", fps,
    ]
    if preview_dir is None:
        command.append("--skip-preview")
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise SystemExit(f"build failed for {unit} ({layers})")


def gallery(unit: str) -> int:
    """Build every candidate's idle+walk sheets and the comparison page."""
    spec = SOLDIERS[unit]
    # The gallery only needs a moving figure, and idle is what the ground offsets
    # are measured from, so building both keeps the preview identical to the
    # final sheets apart from the action list. The pairs come from the unit's own
    # action map so the two cannot disagree about which pack animation is `walk`.
    actions = ",".join(
        pair for pair in spec["actions"].split(",") if pair.split("=")[0] in ("idle", "walk")
    )
    root = GALLERY_ROOT / unit
    root.mkdir(parents=True, exist_ok=True)
    for name, layers in spec["variants"].items():
        out = root / name
        out.mkdir(parents=True, exist_ok=True)
        print(f"[{unit} {name}] {layers}")
        run_build(unit, layers, out, actions, preview_dir=None)
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT_DIR / "preview_oga_variants.py"),
            str(root),
            "--unit", unit,
            "--title", spec["title"],
        ],
        check=False,
    )
    return result.returncode


def final(unit: str, variant: str, out_dir: Path) -> int:
    """Build the chosen candidate's full action set into the client assets."""
    spec = SOLDIERS[unit]
    layers = spec["variants"].get(variant)
    if not layers:
        raise SystemExit(
            f"unknown {unit} variant '{variant}'; choose from {', '.join(spec['variants'])}"
        )
    print(f"[{unit} {variant}] {layers}")
    run_build(
        unit,
        layers,
        out_dir,
        spec["actions"],
        # Sibling of the candidate folder, not inside it: the gallery tool treats
        # every sub-folder of the candidate root as a candidate.
        preview_dir=GALLERY_ROOT / f"{unit}_final",
        # The builder appends its own "- kiểm tra animation" suffix.
        title=f"{unit} {variant}",
        fps=spec.get("fps", ""),
    )
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    gallery_parser = sub.add_parser("gallery", help="build every candidate and the comparison page")
    gallery_parser.add_argument("unit", choices=sorted(SOLDIERS))

    final_parser = sub.add_parser("final", help="build the chosen candidate into the client assets")
    final_parser.add_argument("unit", choices=sorted(SOLDIERS))
    final_parser.add_argument("variant")
    final_parser.add_argument("--out", type=Path, default=ASSET_DIR)

    args = parser.parse_args(argv)
    if args.command == "gallery":
        return gallery(args.unit)
    return final(args.unit, args.variant, args.out)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
