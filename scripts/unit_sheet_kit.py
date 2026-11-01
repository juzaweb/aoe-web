"""Helpers for slicing a generated unit strip into its individual character poses.

The image model lays four poses out on a white background but does not respect an
exact grid: spacing drifts and it sometimes adds a fifth figure. Splitting at
``width / 4`` therefore cuts a limb off one panel and leaves half a spear in the
next. Instead, split at the empty columns between characters, then fold tiny
stray segments (a detached spear tip, an arrow in flight) back into the
neighbouring character so a single figure is never split in two.
"""

from __future__ import annotations

from PIL import Image

ALPHA_THRESHOLD = 24
MIN_GAP = 6
STRAY_RATIO = 0.25


def column_runs(mask: Image.Image, threshold: int = ALPHA_THRESHOLD) -> list[tuple[int, int]]:
    """Return ``(start, end)`` x-ranges of the columns that contain any foreground."""
    width, height = mask.size
    pixels = mask.load()
    occupied = []
    for x in range(width):
        hit = any(pixels[x, y] >= threshold for y in range(height))
        occupied.append(hit)

    runs: list[tuple[int, int]] = []
    start = None
    for x, hit in enumerate(occupied):
        if hit and start is None:
            start = x
        elif not hit and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, width))
    return runs


def merge_close_runs(runs: list[tuple[int, int]], min_gap: int = MIN_GAP) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in runs:
        if merged and start - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def split_characters(mask: Image.Image, expected: int = 4) -> list[tuple[int, int]]:
    """Split a strip's foreground into ``expected`` character x-ranges.

    Stray narrow runs are folded into the previous character before the count is
    checked; when the model drew a different number of figures the runs are
    returned as-is so the caller can decide (and warn) instead of silently
    producing a misaligned sheet.
    """
    runs = merge_close_runs(column_runs(mask))
    if not runs:
        return runs
    widest = max(end - start for start, end in runs)
    folded: list[tuple[int, int]] = []
    for start, end in runs:
        if folded and (end - start) < widest * STRAY_RATIO:
            folded[-1] = (folded[-1][0], end)
        else:
            folded.append((start, end))
    return folded


def even_runs(width: int, expected: int = 4) -> list[tuple[int, int]]:
    step = width / expected
    return [(round(i * step), round((i + 1) * step)) for i in range(expected)]


def column_density(mask: Image.Image, threshold: int = ALPHA_THRESHOLD) -> list[int]:
    """Foreground pixel count per column.

    A boolean occupancy profile cannot split a strip whose weapons bridge the gap
    between two figures: one raised spear makes four characters read as two
    blobs. Density can, because the bridge is only a few pixels tall while a body
    is hundreds.
    """
    width, height = mask.size
    pixels = mask.load()
    assert pixels is not None
    density = []
    for x in range(width):
        density.append(sum(1 for y in range(height) if pixels[x, y] >= threshold))
    return density


def density_runs(mask: Image.Image, expected: int = 4, window: int = 9) -> list[tuple[int, int]]:
    """Split at the ``expected - 1`` emptiest columns, then widen to figure bounds.

    Used when the gap-based split finds the wrong number of characters: the cuts
    land in the visual gutters, which stays correct even when a spear or an arrow
    touches the neighbouring panel.
    """
    density = column_density(mask)
    width = len(density)
    if width < expected * 2:
        return []
    # Moving average: a single empty column inside a body must not win a cut.
    step = max(1, window // 2)
    smoothed = [
        sum(density[max(0, x - step) : min(width, x + step + 1)]) / (2 * step + 1) for x in range(width)
    ]
    floor = max(smoothed) * 0.2 if max(smoothed) else 0
    minimum_gap = width // (expected * 2)

    # The outer margins are empty too, so a cut there would produce an empty
    # first or last panel. Only interior gutters may win a cut.
    inner = range(minimum_gap, width - minimum_gap)
    chosen: list[int] = []
    for x in sorted(inner, key=lambda index: smoothed[index]):
        if smoothed[x] > floor:
            break
        if all(abs(x - other) >= minimum_gap for other in chosen):
            chosen.append(x)
            if len(chosen) == expected - 1:
                break
    if len(chosen) != expected - 1:
        return []

    edges = [0, *sorted(chosen), width]
    runs = [(edges[index], edges[index + 1]) for index in range(expected)]

    # Trim only the fully empty margins. A low-density column is a spear or an
    # arrow, part of the figure, so it must stay inside the crop.
    trimmed: list[tuple[int, int]] = []
    for start, end in runs:
        occupied = [x for x in range(start, end) if density[x] > 0]
        if not occupied:
            return []
        trimmed.append((occupied[0], occupied[-1] + 1))
    return trimmed


def pad_run(run: tuple[int, int], width: int, padding_ratio: float = 0.12) -> tuple[int, int]:
    start, end = run
    padding = round((end - start) * padding_ratio)
    return max(0, start - padding), min(width, end + padding)
