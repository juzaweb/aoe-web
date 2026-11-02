/**
 * OWN-01: resolves the colour of an entity's owner.
 *
 * Server colours are CSS hex strings (`PlayerState.color`), but the renderer
 * needs a numeric tint for Phaser and the minimap needs a CSS string again. This
 * module is deliberately free of Phaser so it can be unit-tested in isolation.
 */

/** Colour used for an owner whose player entry was never seen. */
export const UNKNOWN_OWNER_COLOR = 0x94a3b8;

const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * '#rrggbb' or '#rgb' -> 0xrrggbb. Returns null for anything else.
 * A missing '#' is accepted because the server palette may be edited without it.
 */
export function parseHexColor(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = HEX_COLOR.exec(value.trim());
  if (!match) return null;

  const digits = match[1].toLowerCase();
  const expanded =
    digits.length === 3
      ? digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2]
      : digits;
  return Number.parseInt(expanded, 16);
}

/** 0xrrggbb -> '#rrggbb', for canvas callers such as the minimap. */
export function colorToCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Per-owner colour cache.
 *
 * The players map drops an entry when its owner leaves the room while their
 * units stay in the world, so the last known colour is kept instead of falling
 * back to grey mid-session (OWN-01 / D4).
 */
export class OwnerColorRegistry {
  private readonly cached = new Map<string, number>();

  constructor(private readonly resolveCss: (ownerId: string) => string | null | undefined) {}

  /** Cache hit -> cached colour, miss -> resolve, unresolvable -> UNKNOWN. */
  colorOf(ownerId: string): number {
    if (!ownerId) return UNKNOWN_OWNER_COLOR;

    const cached = this.cached.get(ownerId);
    if (cached !== undefined) return cached;

    const parsed = parseHexColor(this.resolveCss(ownerId));
    // Unresolved owners are intentionally not cached: an entity restored from
    // the database before its player logs in must be able to turn from grey to
    // the real colour once the player entry appears.
    if (parsed === null) return UNKNOWN_OWNER_COLOR;
    this.cached.set(ownerId, parsed);
    return parsed;
  }

  /** Drops one owner's colour; the player may rejoin with a restored colour. */
  invalidate(ownerId: string): void {
    this.cached.delete(ownerId);
  }

  /** Called when a new Room is bound, so the old world cannot leak in. */
  invalidateAll(): void {
    this.cached.clear();
  }
}
