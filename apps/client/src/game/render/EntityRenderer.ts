import * as Phaser from 'phaser';
import { TILE_HEIGHT, TILE_WIDTH, UNIT_BLUEPRINTS, getIsoDepth, gridToScreen } from '@chien-quoc/shared';
import type { BuildingType } from '@chien-quoc/shared';
import type { WorldScene } from '../scenes/WorldScene.js';
import { buildingArt, buildingHpBarY } from './buildingArt.js';
import { buildingDepth } from './isoDepth.js';
import { syncBuildingFire } from './buildingFire.js';
import {
  DEFAULT_DIRECTION_INDEX,
  DIRECTION_NAMES,
  actionRowFrames,
  unitActionKey,
  unitActionTexture
} from './unitDirections.js';
import { UNIT_ART, hasDirectionalArt, unitArt, unitClips } from './unitArt.js';
import type { UnitAction } from './unitDirections.js';
import { UnitMotion, walkTimeScale } from './unitMotion.js';
import { treeVariant } from './treeVariants.js';
import { resourceLook } from './visualVariation.js';
import { TownCenterFireEffect } from './BuildingFireEffect.js';

/**
 * Builds and maintains the visual object for every server entity: the container,
 * its artwork, its health/construction bar, and the state-driven animation.
 *
 * This is the only place that decides what a unit or building looks like; the
 * simulation layer only reports `actionState` / `hp` / `constructionProgress`.
 */
export class EntityRenderer {
  /**
   * OWN-05: last applied ownership signature per entity id: `-1` when the
   * marker is hidden (our own entity), otherwise the ring/outline colour. The
   * refresh pass compares against it so a players event only repaints entities
   * whose owner colour actually changed.
   */
  private readonly ownershipSignatures = new Map<string, number>();

  constructor(private readonly scene: WorldScene) {}

  /** Registers the per-type animation clips. Call once, from create(). */
  initUnitAnimations() {
    const scene = this.scene;
    const registerAnim = (
      key: string,
      texture: string,
      frames: number[],
      frameRate: number,
      repeat: number = -1
    ) => {
      if (scene.textures.exists(texture) && !scene.anims.exists(key)) {
        scene.anims.create({
          key,
          frames: scene.anims.generateFrameNumbers(texture, { frames }),
          frameRate,
          repeat
        });
      }
    };

    // Villager
    registerAnim('villager_idle', 'unit_VILLAGER_sheet', [0], 1);
    registerAnim('villager_walk', 'unit_VILLAGER_sheet', [0, 1, 2, 1], 6);
    registerAnim('villager_harvest', 'unit_VILLAGER_sheet', [3, 0], 3);

    // Spearman
    registerAnim('spearman_idle', 'unit_SPEARMAN_sheet', [0], 1);
    registerAnim('spearman_walk', 'unit_SPEARMAN_sheet', [0, 1, 2, 1], 6);
    registerAnim('spearman_attack', 'unit_SPEARMAN_sheet', [0, 3, 0], 5);

    // Archer
    registerAnim('archer_idle', 'unit_ARCHER_sheet', [0], 1);
    registerAnim('archer_walk', 'unit_ARCHER_sheet', [0, 1, 2, 1], 6);
    registerAnim('archer_attack', 'unit_ARCHER_sheet', [0, 3, 0], 4);

    // Cavalry
    registerAnim('cavalry_idle', 'unit_CAVALRY_sheet', [0], 1);
    registerAnim('cavalry_walk', 'unit_CAVALRY_sheet', [0, 1, 2, 1], 8);
    registerAnim('cavalry_attack', 'unit_CAVALRY_sheet', [0, 3, 0], 6);

    // Directional action sheets: one row per compass direction, four frames per
    // row, one clip per (unit, action, facing). Units without a sheet keep the
    // clips above, so both systems coexist.
    for (const unitType of Object.keys(UNIT_ART)) {
      for (const clip of unitClips(unitType)) {
        // An aliased action (a villager's gather/build) registers its own clip
        // names but reads the sheet of the action it borrows.
        const texture = unitActionTexture(unitType, clip.sheetAction);
        if (!scene.textures.exists(texture)) continue;
        DIRECTION_NAMES.forEach((_, direction) => {
          registerAnim(
            unitActionKey(unitType, clip.action, direction),
            texture,
            actionRowFrames(direction, clip.frames),
            clip.frameRate,
            clip.repeat
          );
        });
      }
    }
  }

  /**
   * Plays a dead unit's fall where it died, then leaves it on its last frame.
   *
   * A corpse is not an entity: no container, no selection ring, no health bar,
   * no per-frame motion tracking. The scene owns the lifetime and destroys the
   * sprite when the server drops the corpse, so nothing here needs a timer.
   *
   * The facing is the default one (toward the viewer): the server never
   * replicates a unit's heading, and falling sideways reads better than a
   * guessed direction.
   */
  createCorpseSprite(id: string, corpse: any) {
    const scene = this.scene;
    const unitType = (corpse.unitType || 'VILLAGER') as string;
    const texture = unitActionTexture(unitType, 'death');
    // Units still drawn from the legacy single-facing sheet have no directional
    // death art, so there is nothing to play and no sprite to keep.
    if (!scene.textures.exists(texture)) return;

    const art = unitArt(unitType);
    const screenPos = gridToScreen(corpse.x, corpse.y);
    const sprite = scene.add.sprite(
      screenPos.x,
      screenPos.y + art.offsetY,
      texture,
      0
    );
    sprite.setScale(art.scale);
    // Same depth rule as a living unit, one step lower so a body lying under a
    // unit that survived the fight is drawn beneath it.
    sprite.setDepth(getIsoDepth(corpse.x, corpse.y, 24));

    const clip = unitActionKey(unitType, 'death', DEFAULT_DIRECTION_INDEX);
    if (scene.anims.exists(clip)) {
      sprite.play(clip);
    }
    scene.corpseSprites.set(id, sprite);
  }

  createResourceNodeSprite(id: string, node: any, cb?: any) {
    const screenPos = gridToScreen(node.gridX, node.gridY);
    let textureKey = 'res_tree';
    let offsetY = -42;

    const customKey = `res_node_${node.type}`;
    if (this.scene.textures.exists(customKey)) {
      textureKey = customKey;
      if (node.type === 'TREE') {
        offsetY = -84;
      } else if (node.type === 'GOLD_MINE') {
        offsetY = -28;
      } else if (node.type === 'STONE_MINE') {
        offsetY = -28;
      } else if (node.type === 'BERRY_BUSH') {
        offsetY = -28;
      }
      // Trees ship four silhouettes. The pick is derived from the tile, so two
      // clients see the same forest without the server replicating a variant.
      if (node.type === 'TREE') {
        const variant = treeVariant(node.gridX, node.gridY);
        const variantKey = `res_node_TREE_${variant}`;
        if (variant > 1 && this.scene.textures.exists(variantKey)) {
          textureKey = variantKey;
        }
      }
    } else {
      if (node.type === 'GOLD_MINE') {
        textureKey = 'res_gold';
        offsetY = -16;
      } else if (node.type === 'STONE_MINE') {
        textureKey = 'res_stone';
        offsetY = -16;
      } else if (node.type === 'BERRY_BUSH') {
        textureKey = 'res_berry';
        offsetY = -16;
      }
    }

    const container = this.scene.add.container(screenPos.x, screenPos.y);
    // A forest of identical sprites was the other half of the "test grid" look:
    // per-node scale, mirror and a slight tint break up the four silhouettes
    // without changing the footprint or the hit area.
    const look = resourceLook(id, node.type);
    const img = this.scene.add.image(0, offsetY, textureKey);
    img.setScale(look.scale);
    img.setFlipX(look.flipX);
    img.setTint(look.tint);
    // Scaling happens around the image centre, so lift the sprite by half the
    // height it lost; otherwise a shrunken tree floats above its tile.
    img.y = offsetY + (img.height * (1 - look.scale)) / 2 + look.offsetY;
    img.x = look.offsetX;
    container.add(img);

    container.setDepth(getIsoDepth(node.gridX, node.gridY, 10));
    container.setData('entityId', id);
    container.setData('entityType', 'resource');
    container.setData('resourceType', node.type);
    container.setData('visualCenterY', offsetY);
    container.setData('gridX', node.gridX);
    container.setData('gridY', node.gridY);

    // A depleted node stays in the snapshot (so it can respawn) but must not be
    // drawn or hit-tested while it is empty.
    container.setVisible(node.remainingAmount > 0);
    if (cb) {
      cb.listen(node, 'remainingAmount', () => {
        container.setVisible(node.remainingAmount > 0);
      });
    }

    this.scene.resourceSprites.set(id, container);
  }

  createBuildingSprite(id: string, building: any, cb?: any) {
    // The citadel compound is a scoring entity, not a drawn building: its floor,
    // walls and gate are rendered by `CitadelLayer`. Drawing it here would fall
    // back to the Town Center placeholder in the middle of the compound and,
    // worse, give it a 26x26 clickable box that swallowed every interior
    // building.
    if (building.type === 'CITADEL') return;

    const scene = this.scene;
    const screenPos = gridToScreen(
      building.gridX + building.sizeX / 2 - 0.5,
      building.gridY + building.sizeY / 2 - 0.5
    );

    const { textureKey, offsetY, scale } = buildingArt(
      building.type as BuildingType,
      (key) => scene.textures.exists(key),
      building.level ?? 1
    );


    const container = scene.add.container(screenPos.x, screenPos.y);

    // Age of Empires style foundation highlight on ground (2x tile dimensions)
    const foundation = scene.add.graphics();
    const halfW = (building.sizeX * TILE_WIDTH) / 2;
    const halfH = (building.sizeY * TILE_HEIGHT) / 2;
    foundation.lineStyle(2, 0x38bdf8, 0.9);
    foundation.beginPath();
    foundation.moveTo(0, -halfH);
    foundation.lineTo(halfW, 0);
    foundation.lineTo(0, halfH);
    foundation.lineTo(-halfW, 0);
    foundation.closePath();
    foundation.strokePath();
    foundation.fillStyle(0x0284c7, 0.2);
    foundation.fillPath();
    foundation.setVisible(false);
    container.add(foundation);
    container.setData('foundation', foundation);

    // OWN-03: ownership diamond. Deliberately separate from `foundation`, which
    // is the "selected" indicator and is toggled by SelectionController. Added
    // before the art so the outline never covers the building itself.
    const ownerBase = scene.add.graphics();
    ownerBase.setVisible(false);
    container.add(ownerBase);
    container.setData('ownerBase', ownerBase);
    container.setData('ownerBaseHalfW', halfW);
    container.setData('ownerBaseHalfH', halfH);

    const img = scene.add.image(0, offsetY, textureKey);
    img.setScale(scale);
    // The generated gate faces south-east by default. Mirror it so a kingdom
    // portal on the eastern edge opens towards the citadel instead of away.
    if (building.type === 'PORTAL') img.setFlipX(true);
    container.add(img);
    // ECO-01: kept so the gather state of a field can be drawn without
    // rebuilding the container.
    container.setData('buildingImage', img);

    if (building.type === 'TOWN_CENTER') {
      const fireEffect = new TownCenterFireEffect(scene, container);
      container.setData('fireEffect', fireEffect);
      container.once('destroy', () => fireEffect.destroy());
    }

    // Health / Construction Bar
    const hpBar = scene.add.graphics();
    container.add(hpBar);
    container.setData('hpBar', hpBar);

    // LVL: level badge above the artwork. Hidden at level 1 so the baseline map
    // is unchanged until the player actually invests in the building. Anchored
    // to the image top instead of the HP bar, whose per-type offsets are tuned
    // for combat bars and can sit far above small buildings.
    const levelBadge = scene.add
      .text(0, offsetY - img.displayHeight / 2 - 6, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#fbbf24',
        stroke: '#0f172a',
        strokeThickness: 3
      })
      .setOrigin(0.5, 1);
    container.add(levelBadge);
    container.setData('levelBadge', levelBadge);

    // Walls and buildings share one ordering table with `CitadelLayer`, so a
    // player-painted segment sorts exactly like the capital's ring and a house
    // can never paint its wide roof over the wall it stands against.
    container.setDepth(buildingDepth(building));
    container.setData('entityId', id);
    container.setData('entityType', 'building');
    container.setData('buildingType', building.type);
    container.setData('gridX', building.gridX);
    container.setData('gridY', building.gridY);
    container.setData('sizeX', building.sizeX);
    container.setData('sizeY', building.sizeY);
    container.setData('visualCenterY', offsetY);

    this.refreshOwnerBase(container, id, building.ownerId);
    this.updateBuildingBar(container, building);
    syncBuildingFire(this.scene, container, building);

    // ATK-03: seed the under-attack tracker with the initial hp (no alert).
    const initialGx = building.gridX + building.sizeX / 2;
    const initialGy = building.gridY + building.sizeY / 2;
    scene.recordEntityHp(id, building.ownerId, building.hp, initialGx, initialGy);
    container.setData('lastHp', building.hp);

    if (cb) {
      cb.onChange(building, () => {
        const gx = building.gridX + building.sizeX / 2;
        const gy = building.gridY + building.sizeY / 2;
        scene.recordEntityHp(id, building.ownerId, building.hp, gx, gy);
        this.applyBuildingTier(container, building);
        this.updateBuildingBar(container, building);
        syncBuildingFire(this.scene, container, building);
        if (scene.selectedBuildingId === id) {
          scene.notifySelectionChange();
        }
      });
    }

    scene.buildingSprites.set(id, container);
  }

  /**
   * LVL3: swaps the artwork when a building crosses a visual tier.
   *
   * A level-up finishes on the server, so the client only sees `level` jump in
   * a state patch. Everything that depends on the sheet has to move with it: the
   * image texture, the badge anchored to the art's top and the `visualCenterY`
   * the selection hit-test reads.
   *
   * The texture key is the cache: it is what the sheet actually resolved to, so
   * one comparison covers both "level crossed a tier" and "the sheet we wanted
   * was missing and we degraded". Any other state patch is a no-op.
   */
  applyBuildingTier(container: any, building: any) {
    const image = container.getData('buildingImage') as Phaser.GameObjects.Image | undefined;
    if (!image) return;

    const art = buildingArt(
      building.type as BuildingType,
      (key) => this.scene.textures.exists(key),
      building.level ?? 1
    );
    if (image.texture.key === art.textureKey) return;

    image.setTexture(art.textureKey);
    image.setY(art.offsetY);
    image.setScale(art.scale);

    const badge = container.getData('levelBadge') as Phaser.GameObjects.Text | undefined;
    if (badge) badge.setY(art.offsetY - image.displayHeight / 2 - 6);

    container.setData('visualCenterY', art.offsetY);
  }

  updateBuildingBar(container: any, building: any) {
    const hpBar = container.getData('hpBar') as any;
    if (!hpBar) return;

    const levelBadge = container.getData('levelBadge') as Phaser.GameObjects.Text | undefined;
    if (levelBadge) {
      const level = building.level ?? 1;
      levelBadge.setText(level > 1 ? `Lv ${level}` : '');
      levelBadge.setVisible(level > 1);
    }

    // ECO-01: a field with nothing left in it turns brown, so an empty farm is
    // readable at a glance instead of only through the detail panel.
    const image = container.getData('buildingImage') as Phaser.GameObjects.Image | undefined;
    if (image && building.resourceCapacity > 0) {
      image.setTint(building.resourceAmount > 0 ? 0xffffff : 0x9a7b52);
    }

    const fireEffect = container.getData('fireEffect') as TownCenterFireEffect | undefined;
    if (fireEffect) {
      fireEffect.update(building.hp, building.maxHp, building.isConstructed);
    }

    hpBar.clear();

    // LVL: an upgrade in progress keeps a bar visible even at full HP.
    const upgrading = (building.upgradeTimeMs ?? 0) > 0;

    // CMB-02: a finished, undamaged building shows nothing. The construction bar
    // still has to draw, so the early exit only covers the built case.
    if (building.isConstructed && building.hp >= building.maxHp && !upgrading) return;

    const width = Math.max(70, building.sizeX * 36);
    const height = 6;

    const barY = buildingHpBarY(
      building.type as BuildingType,
      building.level ?? 1,
      (key) => this.scene.textures.exists(key)
    );

    // Background
    hpBar.fillStyle(0x0f172a, 0.85);
    hpBar.fillRect(-width / 2, barY, width, height);

    if (!building.isConstructed) {
      // Construction progress (Yellow)
      const prog = Phaser.Math.Clamp(building.constructionProgress / 100, 0, 1);
      hpBar.fillStyle(0xf59e0b, 1);
      hpBar.fillRect(-width / 2, barY, width * prog, height);
    } else if (upgrading) {
      // Upgrade progress (Sky) — distinct from both HP and construction.
      const prog = Phaser.Math.Clamp(
        building.upgradeProgressMs / Math.max(1, building.upgradeTimeMs),
        0,
        1
      );
      hpBar.fillStyle(0x38bdf8, 1);
      hpBar.fillRect(-width / 2, barY, width * prog, height);
    } else {
      // HP Bar (Green to Red)
      const pct = Phaser.Math.Clamp(building.hp / building.maxHp, 0, 1);
      const color = pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444;
      hpBar.fillStyle(color, 1);
      hpBar.fillRect(-width / 2, barY, width * pct, height);
    }

    hpBar.lineStyle(1, 0x334155, 1);
    hpBar.strokeRect(-width / 2, barY, width, height);
  }

  /**
   * OWN-02: paints the ownership ring for one unit, or hides it for our own
   * units (D2). A no-op when the colour and visibility did not change, so the
   * OWN-05 refresh pass can call it for every unit without repainting.
   */
  refreshOwnerRing(container: Phaser.GameObjects.Container, entityId: string, ownerId: string) {
    const ring = container.getData('ownerRing') as Phaser.GameObjects.Graphics | undefined;
    if (!ring) return;

    const visible = !!ownerId && ownerId !== this.scene.myOwnerId;
    const color = visible ? this.scene.ownerColorRegistry.colorOf(ownerId) : -1;
    if (this.ownershipSignatures.get(entityId) === color) return;
    this.ownershipSignatures.set(entityId, color);

    if (!visible) {
      ring.setVisible(false);
      return;
    }

    const radiusX = container.getData('ownerRingRadiusX') as number;
    const radiusY = container.getData('ownerRingRadiusY') as number;
    ring.clear();
    ring.fillStyle(color, 0.18);
    ring.fillEllipse(0, 0, radiusX, radiusY);
    ring.lineStyle(2, color, 0.85);
    ring.strokeEllipse(0, 0, radiusX, radiusY);
    ring.setVisible(true);
  }

  /**
   * OWN-03: paints the ownership diamond under one building, or hides it for
   * our own buildings (D3). Foundations of enemy buildings keep the outline too;
   * it is independent from the construction bar and the selection foundation.
   */
  refreshOwnerBase(container: Phaser.GameObjects.Container, entityId: string, ownerId: string) {
    const base = container.getData('ownerBase') as Phaser.GameObjects.Graphics | undefined;
    if (!base) return;

    const visible = !!ownerId && ownerId !== this.scene.myOwnerId;
    const color = visible ? this.scene.ownerColorRegistry.colorOf(ownerId) : -1;
    if (this.ownershipSignatures.get(entityId) === color) return;
    this.ownershipSignatures.set(entityId, color);

    if (!visible) {
      base.setVisible(false);
      return;
    }

    const halfW = container.getData('ownerBaseHalfW') as number;
    const halfH = container.getData('ownerBaseHalfH') as number;
    base.clear();
    base.lineStyle(2, color, 0.7);
    base.beginPath();
    base.moveTo(0, -halfH);
    base.lineTo(halfW, 0);
    base.lineTo(0, halfH);
    base.lineTo(-halfW, 0);
    base.closePath();
    base.fillStyle(color, 0.12);
    base.fillPath();
    base.strokePath();
    base.setVisible(true);
  }

  /**
   * OWN-05: repaints every ownership marker after the players map changed.
   *
   * Entities can be created before their owner's player entry arrives (world
   * restored from the database on server boot), so setting the colour only at
   * creation time is not enough. Only entities whose signature changed touch
   * their Graphics object, and ids that no longer exist are pruned.
   */
  refreshOwnershipVisuals() {
    const scene = this.scene;
    scene.unitSprites.forEach((container, id) => {
      const unit = scene.room?.state?.units?.get(id);
      if (unit) this.refreshOwnerRing(container, id, unit.ownerId);
    });
    scene.buildingSprites.forEach((container, id) => {
      const building = scene.room?.state?.buildings?.get(id);
      if (building) this.refreshOwnerBase(container, id, building.ownerId);
    });

    for (const id of this.ownershipSignatures.keys()) {
      if (!scene.unitSprites.has(id) && !scene.buildingSprites.has(id)) {
        this.ownershipSignatures.delete(id);
      }
    }
  }

  createUnitSprite(id: string, unit: any, cb?: any) {
    const scene = this.scene;
    const screenPos = gridToScreen(unit.x, unit.y);
    const container = scene.add.container(screenPos.x, screenPos.y);

    const unitType = (unit.type || 'VILLAGER') as string;
    const lowerType = unitType.toLowerCase();
    const sheetKey = `unit_${unitType}_sheet`;
    const idleKey = `unit_${unitType}_idle`;
    const art = unitArt(unitType);
    const walkSheetKey = unitActionTexture(unitType, 'walk');
    const hasDirectionalSheet = hasDirectionalArt(unitType) && scene.textures.exists(walkSheetKey);
    const hasSheet = hasDirectionalSheet || scene.textures.exists(sheetKey);
    const blueprint = UNIT_BLUEPRINTS[unitType as keyof typeof UNIT_BLUEPRINTS];

    let unitDisplay: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
    const isCavalry = unitType === 'CAVALRY';
    // Geometry lives in `unitArt.ts`: sheets differ in cell size and the figure
    // sits at a different height inside each of them.
    const visualOffsetY = art.offsetY;
    const visualScale = art.scale;

    const ringRadiusX = art.ringRadiusX;
    const ringRadiusY = art.ringRadiusY;

    // OWN-02: ownership ring, added before the sprite so it stays under the
    // unit's feet. `selectRing` is added last and therefore stays on top of it.
    // It is a little larger than the selection ring so both read together.
    const ownerRing = scene.add.graphics();
    ownerRing.setVisible(false);
    container.add(ownerRing);
    container.setData('ownerRing', ownerRing);
    container.setData('ownerRingRadiusX', ringRadiusX + 4);
    container.setData('ownerRingRadiusY', ringRadiusY + 2);

    if (hasSheet) {
      const sprite = scene.add.sprite(0, visualOffsetY, hasDirectionalSheet ? walkSheetKey : sheetKey, 0);
      sprite.setScale(visualScale);
      const idleAnim = hasDirectionalSheet
        ? unitActionKey(unitType, 'idle', DEFAULT_DIRECTION_INDEX)
        : `${lowerType}_idle`;
      const startAnim = scene.anims.exists(idleAnim)
        ? idleAnim
        : unitActionKey(unitType, 'walk', DEFAULT_DIRECTION_INDEX);
      if (scene.anims.exists(startAnim)) {
        sprite.play(startAnim);
      }
      unitDisplay = sprite;
    } else if (scene.textures.exists(idleKey)) {
      unitDisplay = scene.add.image(0, visualOffsetY, idleKey);
      unitDisplay.setScale(visualScale);
    } else {
      const fallbackKey = `unit_${unitType}`;
      unitDisplay = scene.add.image(0, visualOffsetY, fallbackKey);
      unitDisplay.setScale(0.75);
    }

    container.add(unitDisplay);
    container.setData('unitDisplay', unitDisplay);
    // Body ellipse from the unit's art config, relative to the container origin
    // which sits at the unit's feet (the pack figures span y 10..112 of a 130 px
    // cell at scale 0.92, cavalry y 29..155 of 160 at 0.75).
    container.setData('bodyOffsetY', art.bodyOffsetY);
    container.setData('bodyRadiusX', art.bodyRadiusX);
    container.setData('bodyRadiusY', art.bodyRadiusY);

    // Selected indicator ring (AoE ground ellipse under feet, scaled for 128x64 tiles)
    const selectRing = scene.add.graphics();
    selectRing.lineStyle(2, 0x38bdf8, 0.9);
    selectRing.strokeEllipse(0, 0, ringRadiusX, ringRadiusY);
    selectRing.fillStyle(0x0284c7, 0.2);
    selectRing.fillEllipse(0, 0, ringRadiusX, ringRadiusY);
    selectRing.setVisible(false);
    container.add(selectRing);
    container.setData('selectRing', selectRing);

    // Unit Health Bar
    const hpBar = scene.add.graphics();
    container.add(hpBar);
    container.setData('hpBar', hpBar);

    container.setDepth(getIsoDepth(unit.x, unit.y, 25));
    container.setData('entityId', id);
    container.setData('entityType', 'unit');

    this.refreshOwnerRing(container, id, unit.ownerId);

    // ATK-03: seed the under-attack tracker with the initial hp (no alert).
    scene.recordEntityHp(id, unit.ownerId, unit.hp, unit.x, unit.y);

    scene.unitSprites.set(id, container);
    // MOV-01: the scene owns the per-frame sampling from here on. It starts
    // parked on the spawn tile, facing the viewer.
    scene.unitMotion.set(id, new UnitMotion(unit.x, unit.y, scene.time.now));

    // The scene calls this once per frame now, so it is worth remembering what was
    // last applied: resolving a clip costs several key builds and `anims.exists`
    // lookups, and most frames ask for exactly the same clip again. The guard runs
    // before any of that, and `speed` is part of it because it drives the playback
    // rate.
    let appliedActionState: string | null = null;
    let appliedDirection = Number.NaN;
    let appliedSpeed = Number.NaN;

    const updateVisualState = (
      actionState: string,
      direction: number = DEFAULT_DIRECTION_INDEX,
      speed: number = 0
    ) => {
      if (!hasSheet || !(unitDisplay instanceof Phaser.GameObjects.Sprite)) return;
      if (
        actionState === appliedActionState &&
        direction === appliedDirection &&
        speed === appliedSpeed
      ) {
        return;
      }
      appliedActionState = actionState;
      appliedDirection = direction;
      appliedSpeed = speed;

      // A directional clip wins when it exists; otherwise the legacy clip for that
      // state does, so a partially redrawn unit still animates instead of freezing.
      const pickAnim = (action: UnitAction, legacyKey?: string): string | null => {
        if (hasDirectionalSheet) {
          const directional = unitActionKey(unitType, action, direction);
          if (scene.anims.exists(directional)) return directional;
        }
        if (legacyKey && scene.anims.exists(legacyKey)) return legacyKey;
        return null;
      };

      const idleAnim = pickAnim('idle', `${lowerType}_idle`) ?? `${lowerType}_idle`;
      const walkAnim = pickAnim('walk', `${lowerType}_walk`) ?? idleAnim;
      const attackAnim = pickAnim('attack', `${lowerType}_attack`) ?? idleAnim;
      // Only villagers ship the legacy harvest clip; for them BUILDING reuses it.
      const harvestLegacy = blueprint?.canHarvest ? 'villager_harvest' : undefined;

      let desired: string | null;
      // MOV-02: only the walk cycle is speed-locked; every other clip plays at
      // its authored rate.
      let walking = false;
      switch (actionState) {
        case 'MOVING':
        // CMD-01: an attack-moving or patrolling unit is walking, fight or not.
        case 'ATTACK_MOVE':
        case 'PATROL':
        // SIM-02: carrying a load back to a drop-off is a walk, not a gather. The
        // villager's carry sheet is the same cycle with the load layered on, so
        // only the sprite changes - stride and speed stay identical. Units that
        // cannot carry (soldiers) have no carry clip and keep walking.
        case 'RETURNING':
          desired = pickAnim('carry', walkAnim) ?? walkAnim;
          walking = true;
          break;
        case 'HARVESTING':
          desired = pickAnim('gather', harvestLegacy) ?? idleAnim;
          break;
        case 'BUILDING':
          desired = pickAnim('build', harvestLegacy) ?? pickAnim('gather', harvestLegacy) ?? idleAnim;
          break;
        case 'ATTACKING':
          // Villagers have no attack animation — fall back to idle instead of
          // freezing on whatever clip happened to be playing before.
          desired = attackAnim;
          break;
        default:
          desired = idleAnim;
      }

      if (!desired || !scene.anims.exists(desired)) {
        desired = idleAnim;
        walking = false;
      }
      if (scene.anims.exists(desired) && unitDisplay.anims.currentAnim?.key !== desired) {
        unitDisplay.play(desired);
      }

      // MOV-02: every walk sheet was drawn for one speed, but units travel
      // between 2.2 and 4.0 tiles/second, so a fixed frame rate makes the fast
      // ones skate. Scaling playback by `speed / reference` keeps the stride
      // matched to the ground. Applied after `play` because that is when the
      // clip exists; Phaser keeps the current frame, so the phase survives a
      // change of rate.
      const timeScale = walking ? walkTimeScale(speed) : 1;
      if (unitDisplay.anims.timeScale !== timeScale) {
        unitDisplay.anims.timeScale = timeScale;
      }
    };

    // Expose the state-driven animation helper so update() never has to guess
    // which animation key belongs to this unit type.
    //
    // The scene's per-frame pass is its ONLY caller: it also knows whether the
    // sprite is still gliding, so it can keep the walk cycle running while the
    // server has already switched to the order being executed (harvest, build).
    // Never call this from the replicated `onChange` callback below — a patch
    // carrying a new x/y arrives every tick and would cut the walk short.
    container.setData('updateVisualState', updateVisualState);
    container.setData('hasDirectionalSheet', hasDirectionalSheet);
    container.setData('facingDirection', DEFAULT_DIRECTION_INDEX);

    updateVisualState(unit.actionState, DEFAULT_DIRECTION_INDEX, unit.speed);

    if (cb) {
      cb.onChange(unit, () => {
        // Position is deliberately not copied here: the scene samples the
        // authoritative position once per frame instead, so a multi-property
        // patch cannot produce a sample that pairs a new x with a stale y.
        // ATK-03: detect hp loss before repainting the bar.
        scene.recordEntityHp(id, unit.ownerId, unit.hp, unit.x, unit.y);
        this.updateUnitBar(container, unit.hp, unit.maxHp, isCavalry);
        // Animation is deliberately not touched here: this callback fires on
        // every replicated field change, including x/y each tick, and the
        // server keeps a villager on HARVESTING while it is still walking to
        // the node. The per-frame clip in `updateUnitSprites` owns that
        // decision (see the note where `updateVisualState` is exposed).
      });
    }
  }

  updateUnitBar(container: any, hp: number, maxHp: number, isCavalry: boolean = false) {
    const hpBar = container.getData('hpBar') as any;
    if (!hpBar) return;

    hpBar.clear();

    // CMB-02: AoE2 hides the bar until the unit is hurt. A full-health unit then
    // reads as the sprite alone; the panel still reports exact numbers.
    if (hp >= maxHp) return;

    // The mounted art is taller than the legacy cavalry cell (the rider's helm
    // reaches ~94 px above the tile), so its bar sits above that, not across the
    // rider's shoulders.
    const width = isCavalry ? 54 : 38;
    const height = 4;
    const barY = isCavalry ? -100 : -68;

    hpBar.fillStyle(0x0f172a, 0.8);
    hpBar.fillRect(-width / 2, barY, width, height);

    const pct = Phaser.Math.Clamp(hp / maxHp, 0, 1);
    const color = pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444;
    hpBar.fillStyle(color, 1);
    hpBar.fillRect(-width / 2, barY, width * pct, height);

    hpBar.lineStyle(1, 0x1e293b, 1);
    hpBar.strokeRect(-width / 2, barY, width, height);
  }
}
