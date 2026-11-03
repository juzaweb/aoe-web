#!/usr/bin/env python3
"""Build the client's OpenGameArt sprites from a declarative manifest.

Usage:
    python scripts/assets/build.py --fetch          # download + extract sources
    python scripts/assets/build.py --all            # rebuild every target
    python scripts/assets/build.py --only tree      # rebuild ids containing a word
    python scripts/assets/build.py --check          # verify shipped files vs lock
    python scripts/assets/build.py --report         # print measured metrics

The manifest declares where a sprite comes from and how it is transformed; the
lock file records what was actually written (sha256, canvas, measured artwork
box). `--check` is the CI entry point: it fails when a shipped PNG was edited by
hand, when the canvas drifted, or when a source lost its license/author.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ops  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
CACHE = ROOT / "scripts" / ".cache" / "assets"
EXTRACT = CACHE / "extract"
MANIFEST = SCRIPT_DIR / "manifest.json"
LOCK = SCRIPT_DIR / "assets.lock.json"
CREDITS = ROOT / "CREDITS.md"
ASSET_ROOT = ROOT / "apps" / "client" / "public" / "assets"

# Sprites built by `scripts/process_generated_assets.py` from project-original
# generated textures. They have no upstream URL or license to record here and
# are reproducible from that script, so they stay out of both `targets` and
# `legacy`: pinning their bytes would make every regeneration look like a hand
# edit. Their contract is checked by `process_generated_assets.py --check`.
# Keep this list in sync with GATE_REL and ROAD_NAMES there; a new generated
# file that is missing here fails `--check` with "not in the lock".
GENERATED_PATHS = frozenset(
    {
        "apps/client/public/assets/buildings/portal.png",
        "apps/client/public/assets/terrain/road_stamp.png",
        "apps/client/public/assets/terrain/road_stamp_1.png",
        "apps/client/public/assets/terrain/road_stamp_2.png",
        "apps/client/public/assets/terrain/road_stamp_3.png",
    }
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def source_path(source_key: str, file_key: str, entry: str | None, manifest: dict) -> Path:
    """Resolve one manifest target's input file inside the cache."""
    source = manifest["sources"][source_key]
    file = source["files"][file_key]
    if entry:
        return EXTRACT / entry
    name = file["url"].rsplit("/", 1)[-1]
    return CACHE / name


def fetch(manifest: dict, force: bool = False) -> None:
    """Download every source into the cache.

    A cached file is re-hashed against the lock before it is reused, and a
    freshly downloaded file is checked the same way. Without that check an
    upstream re-upload would silently change a shipped sprite and the lock would
    only notice on the next `--check`.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    lock = load_json(LOCK) if LOCK.exists() else {"sources": {}}
    for key, source in manifest["sources"].items():
        for file_key, file in source["files"].items():
            name = file["url"].rsplit("/", 1)[-1]
            target = CACHE / name
            expected = lock.get("sources", {}).get(key, {}).get("files", {}).get(file_key, {}).get("sha256")
            if target.exists() and not force:
                actual = sha256(target)
                if expected and actual != expected:
                    raise SystemExit(
                        f"{key}/{file_key}: cached {target.name} does not match the lock "
                        f"({actual[:12]} != {expected[:12]}); rerun with --force to refetch"
                    )
                print(f"cached  {key}/{file_key}  {target.name}")
            else:
                print(f"fetch   {key}/{file_key}  {file['url']}")
                request = urllib.request.Request(file["url"], headers={"User-Agent": "chien-quoc-asset-build/1"})
                with urllib.request.urlopen(request, timeout=180) as response, target.open("wb") as handle:
                    shutil.copyfileobj(response, handle)
                actual = sha256(target)
                if expected and actual != expected:
                    target.unlink()
                    raise SystemExit(
                        f"{key}/{file_key}: downloaded {target.name} does not match the lock "
                        f"({actual[:12]} != {expected[:12]}); upstream changed, inspect before updating"
                    )
            if file.get("archive") == "zip":
                extract_zip(target)


def extract_zip(archive: Path) -> None:
    EXTRACT.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive) as zf:
            for member in zf.namelist():
                if member.startswith("/") or ".." in Path(member).parts:
                    raise ValueError(f"unsafe archive member: {member}")
            zf.extractall(EXTRACT)
    except zipfile.BadZipFile as error:
        raise SystemExit(f"{archive} is not a valid zip: {error}") from error


def apply_op(im: Image.Image, op: dict, canvas: tuple[int, int]) -> tuple[Image.Image, float, float]:
    if op.get("crop", "alpha") == "alpha":
        im = ops.crop_to_alpha(im)
    # Mirroring keeps a 2:1 iso render valid (it becomes the opposite visible
    # corner), which is how a single-direction source is turned to face the
    # camera the client's projection uses.
    if op.get("flip") == "x":
        im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # Per-channel gain runs before the luminance match on purpose: the match
    # rescales all channels by one factor, so chroma has to be corrected first
    # or it is either cancelled out or ends up clipping.
    if op.get("gain") is not None:
        im = ops.apply_gain(im, op["gain"])
    gain = 1.0
    if op.get("matchLum") is not None:
        im, gain = ops.match_luminance(im, float(op["matchLum"]))
    scale = 1.0
    if op.get("fit", True):
        im, scale = ops.fit(im, canvas)
    return ops.place(im, canvas, op.get("anchor", "bottom-center")), scale, gain


SPLIT_CACHE: dict[str, list[Image.Image]] = {}


def select_part(image: Image.Image, target_id: str, op: dict, cache_key: str) -> Image.Image:
    """Cut one sprite out of a sheet target before the normal op chain runs.

    Several targets share one sheet (12 forbs out of 3 uploads), so the split is
    cached per source file: without it each target re-walks the whole sheet.
    """
    config = op["split"]
    parts = SPLIT_CACHE.get(cache_key)
    if parts is None:
        parts = ops.split_sheet(
            image,
            min_area=int(config.get("minArea", 300)),
            drop_edge=bool(config.get("dropEdge", True))
        )
        SPLIT_CACHE[cache_key] = parts
    index = int(config.get("index", 0))
    if not parts:
        raise SystemExit(f"{target_id}: split found no sprite above minArea")
    if index >= len(parts):
        raise SystemExit(f"{target_id}: split index {index} out of range ({len(parts)} parts)")
    return parts[index]


def build_target(target_id: str, target: dict, manifest: dict) -> dict:
    canvas = tuple(target["canvas"])
    path = source_path(target["source"], target["file"], target.get("entry"), manifest)
    if not path.exists():
        raise SystemExit(f"{target_id}: missing source file {path} (run --fetch)")
    source = manifest["sources"][target["source"]]
    image = ops.load_rgba(path)
    op = target.get("op", {})
    if "split" in op:
        image = select_part(image, target_id, op, f"{target['source']}/{target['file']}")
    sheet, scale, gain = apply_op(image, op, canvas)
    out = ROOT / target["out"]
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, "PNG", optimize=True)

    box = ops.alpha_bbox(sheet)
    return {
        "out": target["out"],
        "canvas": list(canvas),
        "sha256": sha256(out),
        "bbox": list(box),
        "topInset": ops.top_inset(sheet),
        "bottomInset": ops.bottom_inset(sheet),
        "scale": round(scale, 4),
        "lumGain": round(gain, 4),
        "source": target["source"],
        "sourceSha256": sha256(path),
        "page": source["page"],
        "author": source["author"],
        "license": source["license"]
    }


def write_lock(entries: dict, manifest: dict, legacy: dict | None = None) -> None:
    sources = {}
    for key, source in manifest["sources"].items():
        files = {}
        for file_key, file in source["files"].items():
            name = file["url"].rsplit("/", 1)[-1]
            cached = CACHE / name
            files[file_key] = {
                "url": file["url"],
                "sha256": sha256(cached) if cached.exists() else None
            }
        sources[key] = {
            "page": source["page"],
            "author": source["author"],
            "license": source["license"],
            "files": files
        }
    # A plain `--all` rebuild must not drop the legacy hashes: they are recorded
    # by a separate command because they pin files this pipeline never builds.
    if legacy is None:
        legacy = load_json(LOCK).get("legacy", {}) if LOCK.exists() else {}
    payload: dict = {"version": 1, "sources": sources, "targets": entries}
    if legacy:
        payload["legacy"] = legacy
    LOCK.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8"
    )
    print(f"\nwrote {LOCK.relative_to(ROOT)}")


def legacy_paths(lock: dict) -> set[str]:
    """PNGs under the client's asset root that no manifest target builds."""
    owned = {entry["out"] for entry in lock.get("targets", {}).values()}
    present = {
        path.relative_to(ROOT).as_posix()
        for path in ASSET_ROOT.rglob("*.png")
    }
    return present - owned - GENERATED_PATHS


def cmd_legacy() -> None:
    """Pin the hashes of the sprites this pipeline does not own.

    Most of the client's art predates the manifest: terrain, gold/stone/berry,
    the four non-migrated buildings, units, cursors and icons. They have no
    upstream source to rebuild from, but they can still be pinned so a hand edit
    or a stray regeneration shows up in `--check` instead of shipping silently.
    """
    lock = load_json(LOCK) if LOCK.exists() else {"targets": {}}
    entries = {
        rel: sha256(ROOT / rel)
        for rel in sorted(legacy_paths(lock))
    }
    write_lock(dict(lock.get("targets", {})), load_json(MANIFEST), legacy=entries)
    print(f"recorded {len(entries)} legacy sprites")


def cmd_build(manifest: dict, only: str | None) -> None:
    lock = load_json(LOCK) if LOCK.exists() else {"targets": {}}
    entries = dict(lock.get("targets", {}))
    selected = {k: v for k, v in manifest["targets"].items() if only is None or only in k}
    if not selected:
        raise SystemExit(f"no target matches {only!r}")
    credits = CREDITS.read_text(encoding="utf-8") if CREDITS.exists() else ""
    for target_id, target in selected.items():
        entry = build_target(target_id, target, manifest)
        entries[target_id] = entry
        name = Path(target["out"]).name
        source = manifest["sources"][target["source"]]
        print(
            f"build   {target_id:26s} {name:18s} {entry['canvas'][0]}x{entry['canvas'][1]} "
            f"top={entry['topInset']:3d} bottom={entry['bottomInset']} "
            f"{source['license']} {source['author']}"
        )
        if source["author"] not in credits:
            print(f"  warn: {source['author']} is not credited in CREDITS.md yet")
    write_lock(entries, manifest)


def cmd_check() -> None:
    if not LOCK.exists():
        raise SystemExit("no lock file; run --all first")
    lock = load_json(LOCK)
    problems: list[str] = []
    credits = CREDITS.read_text(encoding="utf-8") if CREDITS.exists() else ""

    for source_key, source in lock.get("sources", {}).items():
        if not source.get("author") or not source.get("license"):
            problems.append(f"source {source_key}: missing author or license")
        if source.get("author") and source["author"] not in credits:
            problems.append(f"source {source_key}: author {source['author']!r} missing from CREDITS.md")
        for file_key, file in source.get("files", {}).items():
            name = file["url"].rsplit("/", 1)[-1]
            cached = CACHE / name
            if cached.exists() and file.get("sha256") and sha256(cached) != file["sha256"]:
                problems.append(f"source {source_key}/{file_key}: cached file hash drifted")

    for target_id, entry in lock.get("targets", {}).items():
        path = ROOT / entry["out"]
        if not path.exists():
            problems.append(f"{target_id}: missing {entry['out']}")
            continue
        if sha256(path) != entry["sha256"]:
            problems.append(f"{target_id}: {entry['out']} does not match the lock (edited by hand?)")
            continue
        with Image.open(path) as im:
            sheet = im.convert("RGBA")
            if list(im.size) != entry["canvas"]:
                problems.append(f"{target_id}: canvas {im.size} != {entry['canvas']}")
            last_row = sheet.getchannel("A").crop((0, im.height - 1, im.width, im.height))
            if last_row.getbbox() is None:
                problems.append(f"{target_id}: bottom row is empty (art is not bottom-anchored)")
            # The recorded box and insets feed `HP_BAR_Y`; a mismatch means the
            # lock is stale even though the file hash matched (for example after
            # a manual lock edit).
            if list(ops.alpha_bbox(sheet)) != entry["bbox"]:
                problems.append(f"{target_id}: recorded bbox does not match the sprite")
            if ops.top_inset(sheet) != entry["topInset"]:
                problems.append(f"{target_id}: recorded topInset does not match the sprite")
            if ops.bottom_inset(sheet) != entry["bottomInset"]:
                problems.append(f"{target_id}: recorded bottomInset does not match the sprite")
        if not entry.get("license") or not entry.get("author"):
            problems.append(f"{target_id}: missing license/author")

    legacy = lock.get("legacy", {})
    for rel, digest in legacy.items():
        path = ROOT / rel
        if not path.exists():
            problems.append(f"legacy {rel}: missing")
        elif sha256(path) != digest:
            problems.append(f"legacy {rel}: edited since --legacy recorded its hash")
    unlisted = legacy_paths(lock) - set(legacy)
    for rel in sorted(unlisted):
        problems.append(f"legacy {rel}: not in the lock (run --legacy)")

    if problems:
        print("asset check FAILED")
        for problem in problems:
            print("  -", problem)
        raise SystemExit(1)
    print(f"asset check OK: {len(lock.get('targets', {}))} targets, "
          f"{len(lock.get('sources', {}))} sources, {len(legacy)} legacy")


def cmd_report(only: str | None) -> None:
    if not LOCK.exists():
        raise SystemExit("no lock file; run --all first")
    for target_id, entry in load_json(LOCK).get("targets", {}).items():
        if only and only not in target_id:
            continue
        bbox = entry["bbox"]
        print(
            f"{target_id:26s} {entry['canvas'][0]}x{entry['canvas'][1]} "
            f"art={bbox[2]-bbox[0]}x{bbox[3]-bbox[1]} top={entry['topInset']} "
            f"bottom={entry['bottomInset']} scale={entry['scale']} {entry['license']}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true", help="download and extract sources into the cache")
    parser.add_argument("--all", action="store_true", help="build every manifest target")
    parser.add_argument("--only", metavar="SUBSTRING", help="build only targets whose id contains this")
    parser.add_argument("--check", action="store_true", help="verify shipped files against the lock")
    parser.add_argument("--report", action="store_true", help="print the measured metrics of the lock")
    parser.add_argument("--legacy", action="store_true", help="pin hashes of sprites the manifest does not build")
    parser.add_argument("--force", action="store_true", help="refetch cached sources even when the hash matches")
    args = parser.parse_args()

    manifest = load_json(MANIFEST)
    if args.fetch:
        fetch(manifest, force=args.force)
    if args.legacy:
        cmd_legacy()
        return
    if args.check:
        cmd_check()
        return
    if args.report:
        cmd_report(args.only)
        return
    if args.all or args.only or not (args.fetch or args.check or args.report):
        cmd_build(manifest, args.only)


if __name__ == "__main__":
    main()
