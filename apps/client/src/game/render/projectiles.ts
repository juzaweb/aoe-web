import * as Phaser from 'phaser';
import type { WorldScene } from '../scenes/WorldScene.js';
import {
  ARROW_ARC_PX,
  BOULDER_ARC_PX,
  arrowAngle,
  arrowPositionAt,
  boulderFlightDurationMs,
  flightDurationMs,
  gridToScreenPoint
} from './arrowFlight.js';
import type { ScreenPoint } from './arrowFlight.js';
import { prefersReducedMotion } from './prefersReducedMotion.js';
import type { RangedShot } from './rangedFire.js';

/**
 * FX-01: the projectiles ranged units and watch towers loose, drawn over the
 * battlefield.
 *
 * The simulation already owns the damage — this layer is decoration and never
 * writes to the room state. It exists because the server replicates *what*
 * happened (`hp` drops, `actionState = ATTACKING`) but not the projectile, so
 * the client reconstructs the shot from the same rules the server used (see
 * `rangedFire.ts`) and paints it here.
 *
 * Two properties matter more than the art:
 *
 * 1. Nothing leaks. Every sprite is created by this layer, tracked in
 *    `projectiles`, and destroyed when it lands or when the scene shuts down.
 *    A Phaser tween that outlives its target is the usual way an RTS client
 *    grows a frame-rate cliff after an hour of play.
 * 2. The effect is bounded. {@link MAX_LIVE_PROJECTILES} caps the work a huge
 *    fight can create, and reduced motion (UIX-13) collapses the flight into a
 *    short tracer with no arc and no impact burst.
 */

/** Texture key the scene preloads in `WorldScene.preload`. */
export const ARROW_TEXTURE_KEY = 'fx_arrow';

/** Where the shipped arrow sprite lives, with the cache-busting suffix. */
export const ARROW_ASSET_URL = '/assets/fx/arrow.png?v=1';

/** Drawn on the fly when the PNG failed to load, so arrows never vanish. */
const ARROW_FALLBACK_TEXTURE_KEY = 'fx_arrow_procedural';

/** The soft puff an arrow kicks up when it lands. */
const IMPACT_TEXTURE_KEY = 'fx_arrow_impact';

/**
 * How long the arrow stays stuck in the target after it lands, in ms.
 *
 * Long enough to read as an arrow in a body, short enough that a busy fight does
 * not accumulate a hedgehog of sprites. Reduced motion skips this entirely.
 */
export const ARROW_STICK_MS = 420;

/** Lifetime of the landing puff, in ms. */
export const IMPACT_MS = 260;

/**
 * Ceiling on simultaneously visible projectiles.
 *
 * A 300-unit brawl can legitimately produce a few dozen shots per second. The
 * cap keeps the display list and the tween manager bounded; shots beyond it are
 * simply not drawn, which reads as a stray arrow going unseen rather than as a
 * frame-rate drop.
 */
export const MAX_LIVE_PROJECTILES = 160;

/** Length the arrow sprite is drawn at, in pixels. */
export const ARROW_LENGTH_PX = 46;

/** Diameter the boulder sprite is drawn at, in pixels. */
export const BOULDER_DIAMETER_PX = 30;

/** Where an arrow leaves a unit, relative to the unit's feet anchor. */
export const ARCHER_MUZZLE_Y = -34;

/** Where a boulder leaves the catapult's cup, relative to its feet anchor. */
export const CATAPULT_MUZZLE_Y = -112;

/** Radians the boulder spins per ms in flight. */
const BOULDER_SPIN_PER_MS = 0.009;

/** Texture key of the runtime-drawn boulder. */
const BOULDER_TEXTURE_KEY = 'fx_boulder';

/** Where an arrow leaves a watch tower, relative to its footprint centre. */
export const TOWER_MUZZLE_Y = -96;

/** Where an arrow lands on a unit, relative to its feet anchor. */
const UNIT_AIM_Y = -26;

/** Where an arrow lands on a building, relative to its footprint centre. */
const BUILDING_AIM_Y = -18;

/**
 * Draw order for every projectile and impact.
 *
 * Above the whole world (the deepest map row is ~440 000) and below the order
 * overlays (999 990+): an arrow has to be visible over the units it flies past,
 * but the pointer feedback and the drag box must stay on top of it.
 */
const PROJECTILE_DEPTH = 900_000;

/** One projectile currently in the air, or stuck in its target. */
interface LiveProjectile {
  sprite: Phaser.GameObjects.Image;
  /** Arrow art noses along the flight; the boulder spins freely. */
  kind: RangedShot['projectile'];
  /** Scene-clock time the arrow was released, in ms. */
  startedAt: number;
  /** Total time in the air, in ms. */
  duration: number;
  /** Height of the arc, in px. */
  arc: number;
  /** Where the shot came from, in screen space. */
  from: ScreenPoint;
  /** Last drawn position, so the draw angle follows the real flight path. */
  last: ScreenPoint;
  /** Target identity, so a moving target is still hit where it stands. */
  targetId: string;
  targetKind: 'unit' | 'building';
  /** Where the target was when the shot was fired, in screen space. */
  fallbackTarget: ScreenPoint;
  /** Set once the arrow has landed and is playing its stick-and-fade. */
  landed: boolean;
}

export class ProjectileLayer {
  private readonly projectiles: LiveProjectile[] = [];
  /** Reused by the projection helpers: this runs per arrow per frame. */
  private readonly point: ScreenPoint = { x: 0, y: 0 };
  private readonly from: ScreenPoint = { x: 0, y: 0 };
  private readonly to: ScreenPoint = { x: 0, y: 0 };

  constructor(private readonly scene: WorldScene) {}

  /**
   * Turns one simulated shot into a flying sprite.
   *
   * Positions are read from the live sprite containers rather than from the
   * shot's grid coordinates: a unit that started walking during the last
   * snapshot is already drawn a little ahead of the position the simulation saw,
   * and a projectile that leaves from the drawn weapon reads correctly.
   */
  spawn(shot: RangedShot, now: number) {
    if (this.projectiles.length >= MAX_LIVE_PROJECTILES) return;

    const boulder = shot.projectile === 'boulder';
    const textureKey = boulder ? this.ensureBoulderTexture() : this.ensureArrowTexture();
    if (!textureKey) return;

    const reduced = prefersReducedMotion();
    const from = this.shooterScreenPoint(shot, this.from);
    const fallbackTarget = this.targetScreenPoint(shot, this.to);

    // Measured on the ground, not on screen: the isometric projection squashes
    // the vertical axis, so a screen-space length would make north-south shots
    // slower than east-west ones at the same range. A boulder is heavier, so it
    // takes a slower, higher arc than an arrow over the same ground.
    const gridDistance = Math.hypot(shot.toX - shot.fromX, shot.toY - shot.fromY);
    const flightMs = boulder
      ? boulderFlightDurationMs(gridDistance)
      : flightDurationMs(gridDistance);
    const duration = reduced ? Math.max(80, flightMs * 0.35) : flightMs;

    const sprite = this.scene.add
      .image(from.x, from.y, textureKey)
      .setDepth(PROJECTILE_DEPTH)
      .setOrigin(0.5, 0.5);
    this.fitProjectileSprite(sprite, shot.projectile);
    // Point at the target before the first frame moves it: at t = 0 the arrow has
    // no step behind it, so an angle taken from the previous position would draw
    // it facing east whatever direction the shot really goes.
    if (!boulder) sprite.setRotation(arrowAngle(from, fallbackTarget));

    const projectile: LiveProjectile = {
      sprite,
      kind: shot.projectile,
      startedAt: now,
      duration,
      arc: reduced ? 0 : boulder ? BOULDER_ARC_PX : ARROW_ARC_PX,
      from: { x: from.x, y: from.y },
      last: { x: from.x, y: from.y },
      targetId: shot.targetId,
      targetKind: shot.targetKind,
      fallbackTarget: { x: fallbackTarget.x, y: fallbackTarget.y },
      landed: false
    };

    this.projectiles.push(projectile);
  }

  /**
   * Advances every live projectile.
   *
   * Called once per frame from the scene's update with the scene clock, so the
   * flight is a pure function of elapsed time and stays correct regardless of
   * the frame rate.
   */
  update(now: number) {
    if (this.projectiles.length === 0) return;

    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const projectile = this.projectiles[index];
      if (projectile.landed) continue;

      const elapsed = now - projectile.startedAt;
      const t = projectile.duration <= 0 ? 1 : elapsed / projectile.duration;
      const target = this.liveTargetScreenPoint(projectile, this.to);
      const position = arrowPositionAt(projectile.from, target, t, projectile.arc, this.point);

      projectile.sprite.setPosition(position.x, position.y);
      if (projectile.kind === 'boulder') {
        // A tumbling rock, not a nosed arrow: the art has cracks and highlights,
        // so a steady spin reads as rotation without ever pointing at the target.
        projectile.sprite.setRotation(elapsed * BOULDER_SPIN_PER_MS + 0.6);
      } else {
        projectile.sprite.setRotation(arrowAngle(projectile.last, position));
      }
      projectile.last.x = position.x;
      projectile.last.y = position.y;

      if (t >= 1) this.land(projectile, position.x, position.y);
    }
  }

  /** Destroys every projectile this layer owns. Called when the map is torn down. */
  destroy() {
    this.projectiles.forEach((projectile) => {
      // A landed projectile is fading under a tween that would keep writing to
      // a destroyed sprite; kill it before the target goes away.
      this.scene.tweens.killTweensOf(projectile.sprite);
      projectile.sprite.destroy();
    });
    this.projectiles.length = 0;
  }

  /**
   * Starts the landing sequence: an arrow sticks where it hit, a boulder
   * shatters; either way a puff of dust goes up and the sprite fades out.
   */
  private land(projectile: LiveProjectile, x: number, y: number) {
    projectile.landed = true;
    projectile.sprite.setPosition(x, y);

    const reduced = prefersReducedMotion();
    const boulder = projectile.kind === 'boulder';
    if (!reduced) this.spawnImpact(x, y, boulder ? 2.2 : 1.0);

    if (boulder) {
      // A boulder shatters instead of sticking: a short flash of the rock, a
      // bigger dust cloud, then nothing. It never becomes decor on the ground.
      this.scene.tweens.add({
        targets: projectile.sprite,
        alpha: 0,
        scale: projectile.sprite.scaleX * 0.7,
        y: y + 3,
        duration: reduced ? 80 : 150,
        ease: 'Quad.easeIn',
        onComplete: () => {
          projectile.sprite.destroy();
          const live = this.projectiles.indexOf(projectile);
          if (live >= 0) this.projectiles.splice(live, 1);
        }
      });
      return;
    }

    const stickMs = reduced ? 90 : ARROW_STICK_MS;
    this.scene.tweens.add({
      targets: projectile.sprite,
      alpha: 0,
      // A landed arrow sits a couple of pixels lower than its flight path, which
      // is what makes it read as embedded rather than hovering.
      y: y + 2,
      duration: stickMs,
      ease: 'Quad.easeIn',
      onComplete: () => {
        projectile.sprite.destroy();
        const live = this.projectiles.indexOf(projectile);
        if (live >= 0) this.projectiles.splice(live, 1);
      }
    });
  }

  /** The dust puff that marks the hit point. */
  private spawnImpact(x: number, y: number, scale: number = 1) {
    const textureKey = this.ensureImpactTexture();
    if (!textureKey) return;

    const puff = this.scene.add
      .image(x, y, textureKey)
      .setDepth(PROJECTILE_DEPTH - 1)
      .setAlpha(0.85);
    puff.setScale(0.45 * scale);

    this.scene.tweens.add({
      targets: puff,
      scale: 1.15 * scale,
      alpha: 0,
      duration: IMPACT_MS * (scale > 1 ? 1.35 : 1),
      ease: 'Quad.easeOut',
      onComplete: () => puff.destroy()
    });
  }

  /** Screen point an arrow leaves from: the drawn shooter, or its grid position. */
  private shooterScreenPoint(shot: RangedShot, out: ScreenPoint): ScreenPoint {
    if (shot.shooterKind === 'unit') {
      const container = this.scene.unitSprites.get(shot.shooterId);
      if (container) {
        out.x = container.x;
        out.y =
          container.y +
          (shot.projectile === 'boulder' ? CATAPULT_MUZZLE_Y : ARCHER_MUZZLE_Y);
        return out;
      }
    } else {
      const container = this.scene.buildingSprites.get(shot.shooterId);
      if (container) {
        out.x = container.x;
        out.y = container.y + TOWER_MUZZLE_Y;
        return out;
      }
    }

    gridToScreenPoint(shot.fromX, shot.fromY, out);
    out.y +=
      shot.shooterKind === 'building'
        ? TOWER_MUZZLE_Y
        : shot.projectile === 'boulder'
          ? CATAPULT_MUZZLE_Y
          : ARCHER_MUZZLE_Y;
    return out;
  }

  /** Screen point of the target when the shot was fired. */
  private targetScreenPoint(shot: RangedShot, out: ScreenPoint): ScreenPoint {
    const container = this.scene.unitSprites.get(shot.targetId);
    if (container) {
      out.x = container.x;
      out.y = container.y + UNIT_AIM_Y;
      return out;
    }

    const building = this.scene.buildingSprites.get(shot.targetId);
    if (building) {
      out.x = building.x;
      out.y = building.y + BUILDING_AIM_Y;
      return out;
    }

    gridToScreenPoint(shot.toX, shot.toY, out);
    out.y += UNIT_AIM_Y;
    return out;
  }

  /**
   * Screen point of the target *now*, so a projectile follows a unit that walks
   * during the flight instead of landing where it used to be.
   */
  private liveTargetScreenPoint(projectile: LiveProjectile, out: ScreenPoint): ScreenPoint {
    const container =
      projectile.targetKind === 'unit'
        ? this.scene.unitSprites.get(projectile.targetId)
        : this.scene.buildingSprites.get(projectile.targetId);

    if (!container) {
      // The target died or left the room: the projectile finishes its flight to
      // the last known spot rather than snapping to the origin.
      out.x = projectile.fallbackTarget.x;
      out.y = projectile.fallbackTarget.y;
      return out;
    }

    out.x = container.x;
    out.y =
      container.y + (projectile.targetKind === 'unit' ? UNIT_AIM_Y : BUILDING_AIM_Y);
    return out;
  }

  /** Keeps every projectile the same on-screen size, whatever its texture. */
  private fitProjectileSprite(sprite: Phaser.GameObjects.Image, kind: RangedShot['projectile']) {
    const target = kind === 'boulder' ? BOULDER_DIAMETER_PX : ARROW_LENGTH_PX;
    const width = sprite.width || target;
    sprite.setScale(target / width);
  }

  /**
   * The shipped arrow sprite, or a drawn one when the PNG is missing.
   *
   * The fallback exists because a missing texture would otherwise throw inside
   * `add.image` and take the whole scene down over a cosmetic asset; a canvas
   * arrow keeps the effect alive and makes the failure obvious to the eye.
   */
  private ensureArrowTexture(): string | null {
    if (this.scene.textures.exists(ARROW_TEXTURE_KEY)) return ARROW_TEXTURE_KEY;
    if (this.scene.textures.exists(ARROW_FALLBACK_TEXTURE_KEY)) return ARROW_FALLBACK_TEXTURE_KEY;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 18;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Shaft.
    const shaft = ctx.createLinearGradient(0, 0, 0, 18);
    shaft.addColorStop(0, '#d8b27a');
    shaft.addColorStop(0.5, '#a97a45');
    shaft.addColorStop(1, '#6b4a26');
    ctx.fillStyle = shaft;
    ctx.fillRect(10, 7, 38, 4);

    // Head.
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(48, 3);
    ctx.lineTo(62, 9);
    ctx.lineTo(48, 15);
    ctx.lineTo(52, 9);
    ctx.closePath();
    ctx.fill();

    // Fletching.
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(6, 2);
    ctx.lineTo(16, 7);
    ctx.lineTo(6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(6, 16);
    ctx.lineTo(16, 11);
    ctx.lineTo(6, 9);
    ctx.closePath();
    ctx.fill();

    this.scene.textures.addCanvas(ARROW_FALLBACK_TEXTURE_KEY, canvas);
    return ARROW_FALLBACK_TEXTURE_KEY;
  }

  /**
   * The boulder, drawn once per scene.
   *
   * Deliberately procedural: the boulder is a 30 px projectile that lives for
   * half a second, so a shipped PNG would add a download and a lock entry for
   * an effect this shape can carry. Fixed vertices and a fixed gradient keep it
   * deterministic across sessions.
   */
  private ensureBoulderTexture(): string | null {
    if (this.scene.textures.exists(BOULDER_TEXTURE_KEY)) return BOULDER_TEXTURE_KEY;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // An irregular decagon, so the spin is visible and it never reads as a ball.
    const radii = [28, 26, 30, 27, 29, 25, 28, 30, 26, 29];
    ctx.beginPath();
    for (let index = 0; index < radii.length; index++) {
      const angle = (index / radii.length) * Math.PI * 2;
      const x = 32 + Math.cos(angle) * radii[index];
      const y = 32 + Math.sin(angle) * radii[index] * 0.92;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    const stone = ctx.createRadialGradient(24, 22, 4, 32, 32, 32);
    stone.addColorStop(0, '#b6a68c');
    stone.addColorStop(0.45, '#7f7361');
    stone.addColorStop(1, '#4a4339');
    ctx.fillStyle = stone;
    ctx.fill();

    ctx.strokeStyle = 'rgba(40, 35, 29, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cracks and chips, offset so one face looks struck.
    ctx.strokeStyle = 'rgba(48, 42, 35, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24, 20);
    ctx.lineTo(30, 28);
    ctx.lineTo(25, 36);
    ctx.moveTo(39, 24);
    ctx.lineTo(44, 33);
    ctx.stroke();
    ctx.fillStyle = 'rgba(196, 182, 158, 0.5)';
    ctx.beginPath();
    ctx.ellipse(25, 20, 5, 3, -0.5, 0, Math.PI * 2);
    ctx.fill();

    this.scene.textures.addCanvas(BOULDER_TEXTURE_KEY, canvas);
    return BOULDER_TEXTURE_KEY;
  }

  /** Soft dust puff, drawn once per scene. */
  private ensureImpactTexture(): string | null {
    if (this.scene.textures.exists(IMPACT_TEXTURE_KEY)) return IMPACT_TEXTURE_KEY;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 244, 214, 0.95)');
    gradient.addColorStop(0.45, 'rgba(226, 200, 150, 0.55)');
    gradient.addColorStop(1, 'rgba(226, 200, 150, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, Math.PI * 2);
    ctx.fill();

    this.scene.textures.addCanvas(IMPACT_TEXTURE_KEY, canvas);
    return IMPACT_TEXTURE_KEY;
  }
}
