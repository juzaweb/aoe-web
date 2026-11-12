import * as Phaser from 'phaser';
import { getIsoDepth, screenToGrid } from '@chien-quoc/shared';
import { prefersReducedMotion } from './prefersReducedMotion.js';

/**
 * UIX-01: the transient ground marker an order leaves where it was issued.
 *
 * A right click is otherwise silent until the server round-trip moves the
 * units, so players double- and triple-click the same tile. The marker is a
 * purely cosmetic Graphics object (no texture, no particle manager) that is
 * drawn once, shrinks and fades in {@link ORDER_FEEDBACK_DURATION_MS}, then
 * destroys itself — so there is nothing to leak. With reduced motion on
 * (UIX-13) it is drawn at rest and destroyed after
 * {@link ORDER_FEEDBACK_STATIC_DURATION_MS} instead.
 *
 * Each order flavour gets its own colour *and* shape. Colour alone would be
 * unreadable for a colour-blind player and indistinguishable in a busy fight;
 * the crosshair for attack and the tick marks for worker orders survive both.
 */
export type OrderFeedbackKind =
  | 'move'
  | 'attack'
  | 'gather'
  | 'build'
  | 'rally'
  | 'stop'
  | 'focus'
  | 'reject';

export interface OrderFeedbackSpec {
  /** Primary ring colour. */
  color: number;
  /** Secondary ring / centre-dot colour, a lighter shade of `color`. */
  accent: number;
  /** Concentric rings; two reads as "go here", one as "this one". */
  rings: number;
  /** Attack orders draw a reticle instead of extra rings. */
  crosshair: boolean;
  /** Short radial ticks, used to tell worker orders from movement. */
  ticks: number;
}

/** The whole decal is gone in under a third of a second (UIX-01 AC). */
export const ORDER_FEEDBACK_DURATION_MS = 300;

/**
 * UIX-13: how long the untweened decal stays when reduced motion is on. Short
 * enough to still read as "your order landed here, then it was gone", and it
 * keeps the same under-a-third-of-a-second budget as the animated branch.
 */
export const ORDER_FEEDBACK_STATIC_DURATION_MS = 150;

/**
 * Ground decals sit just above the terrain and decor bands and below every
 * entity band (`EntityRenderer` starts at depth +10), so a ring is painted on
 * the ground under the units standing on it instead of floating over their
 * sprites.
 */
export const ORDER_FEEDBACK_DEPTH_OFFSET = 6;

const ORDER_FEEDBACK: Record<OrderFeedbackKind, OrderFeedbackSpec> = {
  // Green: plain movement is the safe, expected order.
  move: { color: 0x22c55e, accent: 0xbbf7d0, rings: 2, crosshair: false, ticks: 0 },
  // Red reticle: an attack is the one order that can lose the army.
  attack: { color: 0xef4444, accent: 0xfecaca, rings: 1, crosshair: true, ticks: 0 },
  // Amber: harvest / gather, matching the resource-carrying colour.
  gather: { color: 0xf59e0b, accent: 0xfde68a, rings: 2, crosshair: false, ticks: 4 },
  // Orange: walk into a foundation and build it.
  build: { color: 0xf97316, accent: 0xffedd5, rings: 2, crosshair: false, ticks: 4 },
  // Sky blue: the rally-point flag the server will draw on that tile.
  rally: { color: 0x38bdf8, accent: 0xbae6fd, rings: 1, crosshair: false, ticks: 3 },
  // Yellow: stop / hold position.
  stop: { color: 0xfacc15, accent: 0xfef08a, rings: 1, crosshair: false, ticks: 0 },
  // Cyan: the camera just jumped to a unit (idle cycle, control group).
  focus: { color: 0x22d3ee, accent: 0xa5f3fc, rings: 1, crosshair: false, ticks: 4 },
  // Red with radial ticks: the placement was refused, not an attack order.
  reject: { color: 0xef4444, accent: 0xfecaca, rings: 1, crosshair: false, ticks: 6 }
};

export function orderFeedbackSpec(kind: OrderFeedbackKind): OrderFeedbackSpec {
  return ORDER_FEEDBACK[kind];
}

/**
 * Depth key for a decal at a world point. Derived from the tapped tile so the
 * ring lands in the same isometric row as the ground it marks.
 */
export function orderFeedbackDepth(worldX: number, worldY: number): number {
  const grid = screenToGrid(worldX, worldY);
  return getIsoDepth(grid.gridX, grid.gridY, ORDER_FEEDBACK_DEPTH_OFFSET);
}

/**
 * Draws the marker at `(x, y)` — a world point, already projected — and starts
 * the shrink/fade tween, unless the player asked for reduced motion (UIX-13), in
 * which case the decal is left at rest and removed on a short timer.
 *
 * The Graphics object is *positioned* at the point and its shapes are drawn
 * around the local origin: a tween on `scaleX/scaleY` then shrinks the decal in
 * place. Drawing at the absolute point instead would scale the position too
 * (Phaser scales around the object origin, not the shape bounds), which makes
 * the ring slide away from the cursor while it animates.
 */
export function drawOrderFeedback(
  scene: Phaser.Scene,
  x: number,
  y: number,
  kind: OrderFeedbackKind
): Phaser.GameObjects.Graphics {
  const spec = orderFeedbackSpec(kind);
  const decal = scene.add.graphics({ x, y });
  decal.setDepth(orderFeedbackDepth(x, y));

  // Concentric ground rings. Widths are 30 x 14 world pixels: a circle in the
  // 2:1 isometric projection, not a flat ellipse on screen.
  for (let index = 0; index < spec.rings; index++) {
    const inset = index * 9;
    decal.lineStyle(index === 0 ? 3 : 2, index === 0 ? spec.color : spec.accent, index === 0 ? 0.95 : 0.8);
    decal.strokeEllipse(0, 0, 30 - inset, 14 - inset * 0.45);
  }

  if (spec.crosshair) {
    // Four arms with a gap at the centre so the reticle reads as a crosshair
    // rather than as a plus sign painted over the units standing there.
    decal.lineStyle(2.5, spec.color, 0.95);
    decal.lineBetween(-20, 0, -8, 0);
    decal.lineBetween(8, 0, 20, 0);
    decal.lineBetween(0, -10, 0, -4);
    decal.lineBetween(0, 4, 0, 10);
  }

  for (let index = 0; index < spec.ticks; index++) {
    const angle = (Math.PI * 2 * index) / spec.ticks - Math.PI / 2;
    const inner = 15;
    const outer = 21;
    decal.lineStyle(2, spec.accent, 0.9);
    decal.lineBetween(
      Math.cos(angle) * inner,
      Math.sin(angle) * inner * 0.5,
      Math.cos(angle) * outer,
      Math.sin(angle) * outer * 0.5
    );
  }

  decal.fillStyle(spec.accent, 0.9);
  decal.fillCircle(0, 0, 3);

  // UIX-13: the decal is feedback, not decoration — a player who asked for
  // reduced motion still has to see the order land somewhere, then see it leave.
  // Only the shrink/fade goes away: the rings are drawn at their resting size
  // and a short timer removes the object. Tweening meant a constant scale change
  // at the exact point the player was looking at, which is the motion this
  // preference exists to remove.
  if (prefersReducedMotion()) {
    scene.time.delayedCall(ORDER_FEEDBACK_STATIC_DURATION_MS, () => decal.destroy());
    return decal;
  }

  decal.setScale(1.45);
  decal.setAlpha(1);

  scene.tweens.add({
    targets: decal,
    scaleX: 1,
    scaleY: 1,
    alpha: 0,
    duration: ORDER_FEEDBACK_DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => decal.destroy()
  });

  return decal;
}
