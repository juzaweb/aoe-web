/**
 * One definition of the portrait URL a unit is listed with.
 *
 * The dock slot, the train buttons, the selection strip and the entity panel all
 * draw the same file. Three of those surfaces used to spell the path out
 * themselves, so refreshing the art meant remembering every copy - the villager
 * and the three soldiers kept portraits from a retired art pass precisely
 * because one of those copies was missed.
 *
 * `?v=` is a single cache-busting version for the whole set: the files are
 * rebuilt together by `scripts/build_unit_portrait.py`, never one at a time, so
 * bump it here when that script rewrites them and every surface follows.
 */
const PORTRAIT_VERSION = 5;

/** Portrait URL for a unit type, e.g. `/assets/units/villager_idle.png?v=5`. */
export function unitThumbnail(type: string): string {
  return `/assets/units/${type.toLowerCase()}_idle.png?v=${PORTRAIT_VERSION}`;
}
