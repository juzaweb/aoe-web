import * as Phaser from 'phaser';
import { Room } from '@colyseus/sdk';
import { Callbacks } from '@colyseus/schema';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  CORE_BUILDING_TYPES,
  MAP_GRID_HEIGHT,
  MAP_GRID_WIDTH,
  MAX_UNIT_LEVEL,
  MapTerrain,
  TERRAIN_BATTLEFIELD,
  TILE_HEIGHT,
  TILE_WIDTH,
  getBuildingMaxLevel,
  getIsoDepth,
  gridToScreen,
  screenToGrid,
  terrainForZone
} from '@chien-quoc/shared';
import { generateProceduralTextures } from '../renderers/ProceduralSprites.js';
import { buildingTierInfo, buildingVisualTierCount } from '../render/buildingArt.js';
import { CommandController } from '../input/CommandController.js';
import { CursorController } from '../input/CursorController.js';
import { PlacementController } from '../input/PlacementController.js';
import { RoadController, type RoadMode } from '../input/RoadController.js';
import { SelectionController } from '../input/SelectionController.js';
import type { BoxSelectFilter } from '../input/SelectionController.js';
import { applyEdgeScroll, installCanvasPresence } from '../input/cameraInput.js';
import { CameraController, ZOOM_MIN } from '../input/CameraController.js';
import { installHudPointerGuard } from '../input/hudPointerGuard.js';
import { TouchController } from '../input/TouchController.js';
import { pointerWorldGrid } from '../input/pointer.js';
import { TOUCH_PICK_SLACK } from '../../device/inputMode.js';
import { EntityRenderer } from '../render/EntityRenderer.js';
import { FocusIndicator } from '../render/FocusIndicator.js';
import { DecorLayer } from '../render/DecorLayer.js';
import { decorPreloadList } from '../render/decorArt.js';
import { TerrainLayer } from '../render/TerrainLayer.js';
import { OwnerColorRegistry, colorToCss } from '../render/ownerColor.js';
import { UnderAttackTracker } from '../alerts/underAttack.js';
import { shouldAlertOnBuildingRemoval } from '../alerts/foundationRemoval.js';
import type { AttackPing, DamageResult } from '../alerts/underAttack.js';
import { unitActionTexture } from '../render/unitDirections.js';
import { UNIT_ART, unitArt, unitSheets } from '../render/unitArt.js';
import { RENDER_DELAY_MS } from '../render/unitMotion.js';
import type { UnitMotion } from '../render/unitMotion.js';

/**
 * How far the pointer may travel (in world pixels) before a left-button press
 * counts as a box-drag instead of a click.
 *
 * The tolerance has to grow with zoom: hand jitter is roughly constant on screen,
 * so a fixed world threshold would make clicking nearly impossible when zoomed in.
 * It also must not shrink below what a human can physically hold steady, otherwise
 * a plain click while zoomed way out turns into an accidental box-drag (which
 * wipes the current selection).
 */
const CLICK_DRAG_THRESHOLD_WORLD_PX = 8;
const CLICK_DRAG_MIN_SCREEN_PX = 6;

/**
 * Half a tile in screen pixels, precomputed because the frame loop projects
 * every unit's grid position inline (see MOV-01) instead of calling
 * `gridToScreen`, which allocates a point per unit per frame.
 */
const HALF_TILE_WIDTH = TILE_WIDTH / 2;
const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;

/**
 * ECO-02: how often the idle-villager count is recomputed, in milliseconds.
 *
 * The HUD only needs to look live, and scanning every owned unit at 60 Hz to
 * publish a number React would re-render anyway is wasted work — four scans a
 * second are indistinguishable from instant and cost nothing.
 */
const IDLE_VILLAGER_SCAN_MS = 250;

/**
 * Modifiers captured on pointerdown, then used by the click / box-select release
 * (CTL-02).
 *
 * `additive` is Shift (add to the selection), `selectSameType` is Ctrl (a click
 * takes every unit of the clicked type) and `filter` is what a drag is allowed to
 * take: Ctrl-drag soldiers, Alt-drag villagers. Ctrl means "narrow to soldiers" on
 * the drag path and "same type" on the click path, which is what makes one
 * modifier cover both without a new key.
 */
interface SelectionMods {
  additive: boolean;
  selectSameType: boolean;
  filter: BoxSelectFilter;
}

/** Plain left-drag: takes every owned unit it covers. */
const NO_SELECTION_MODS: SelectionMods = { additive: false, selectSameType: false, filter: 'all' };

function selectionModsFor(event: MouseEvent | undefined): SelectionMods {
  const ctrl = !!event?.ctrlKey || !!event?.metaKey;
  return {
    additive: !!event?.shiftKey,
    selectSameType: ctrl,
    filter: event?.altKey ? 'villager' : ctrl ? 'military' : 'all'
  };
}

/**
 * UIX-03: one control group as the HUD renders it. `breakdown` is the unit mix,
 * so the panel can read "4 · Spearman 3, Villager 1" without the HUD knowing
 * anything about the scene's registries.
 */
export interface ControlGroupSummary {
  index: number;
  count: number;
  breakdown: Array<{ type: string; count: number }>;
}

/**
 * MOB-05: an order waiting for its destination.
 *
 * `'CONTEXT'` is the right-click equivalent (attack / harvest / travel / rally /
 * move, decided by what is under the target), while the other two carry the
 * explicit move mode the desktop `A` / `P` keys arm.
 */
export type ArmedOrder = 'ATTACK_MOVE' | 'PATROL' | 'CONTEXT';

export interface SelectedEntityData {
  id: string;
  type: 'unit' | 'building' | 'resource';
  name: string;
  subType: string;
  hp?: number;
  maxHp?: number;
  /** LVL: current upgrade level and the cap for this entity's type. */
  level?: number;
  maxLevel?: number;
  isOwner?: boolean;
  /** MAPS: an owned portal renders the travel panel. */
  isPortal?: boolean;
  trainingQueue?: string[];
  /** LVL: building upgrade timer; `upgradeTimeMs = 0` means idle. */
  upgradeProgressMs?: number;
  upgradeTimeMs?: number;
  /**
   * LVL3: which of the building's shipped shapes is drawn at the current level.
   * `visualTierCount` is 1 for types that never change shape, so the panel can
   * hide the whole block with one check.
   */
  visualTier?: number;
  visualTierCount?: number;
  visualTierName?: string | null;
  /** LVL3: level at which the next shape appears; `null` at the last tier. */
  nextVisualTierLevel?: number | null;
  /** LVL: player-wide research levels, indexed by UNIT_UPGRADE_ORDER. */
  unitLevels?: number[];
  researchUnitType?: string;
  researchProgressMs?: number;
  /**
   * LVL2: highest finished level per core building type. The Town Center gate
   * asks for four pillars, and the panel cannot read them from one building's
   * state, so the scene aggregates them on the selected empire.
   */
  coreLevels?: Partial<Record<BuildingType, number>>;
  /** LVL2: how many of the player's buildings are upgrading right now. */
  activeUpgrades?: number;
  researchTimeMs?: number;
  /** CMD-04b: foundations can be cancelled; finished buildings cannot. */
  isConstructed?: boolean;
  constructionProgress?: number;
  remainingAmount?: number;
  maxAmount?: number;
  /**
   * SIM-02: what a villager is hauling right now. Shown in the entity panel so
   * the player can see a load without waiting for the stockpile to jump.
   */
  carryingAmount?: number;
  carryingResourceType?: string;
  /**
   * CMB-01: AGGRESSIVE | DEFENSIVE | STAND_GROUND | NO_ATTACK. Units only; shown
   * in the panel so the stance cycle is observable without opening a menu.
   */
  stance?: string;
  /**
   * UIX-06: whether the current unit selection includes one of this player's
   * villagers. The build command card belongs to villagers only, the same way
   * AoE hides it when a military unit or a building is selected.
   */
  villagerSelected?: boolean;
}

/**
 * The Phaser scene: owns the world state the other modules read (entity sprite
 * registries, the selection sets, camera and entity interpolation) and wires the
 * input handlers to the controllers that implement each behaviour.
 *
 * Rendering lives in `render/`, input policy in `input/`. This class is the
 * composition root plus the per-frame loop, so the public fields below are the
 * scene's API to those modules, not internal scratch space.
 */
export class WorldScene extends Phaser.Scene {
  public room: Room | null = null;
  /**
   * Ownership key the server writes on every entity (`Player.id`, the account
   * id). It is not the socket session id: that changes on every refresh and
   * reconnect, which is exactly what used to lose the empire.
   */
  public get myOwnerId(): string {
    if (this.cachedOwnerId) return this.cachedOwnerId;
    // The minimap polls this on every animation frame, and the socket can be
    // joined a frame or two before the first state patch lands. Reading through
    // an unsynced state would throw inside the render loop and kill it for good,
    // which is why the guard is here and not at the call sites.
    const players = this.room?.state?.players;
    if (!players || !this.myPlayerName) return '';

    // Resolved from the snapshot rather than `room.sessionId`; the SDK does not
    // expose the auth payload the server keyed the entities with.
    let found = '';
    players.forEach((p: any) => {
      if (!found && p.name === this.myPlayerName) found = p.id;
    });
    this.cachedOwnerId = found;
    return found;
  }
  /** Display name of this account, from the auth API. Stable across reloads. */
  public myPlayerName: string = '';
  private cachedOwnerId: string = '';
  private boundRoomId: string = '';

  /** ATK-01: client-side under-attack detection from replicated hp. */
  public underAttackTracker = new UnderAttackTracker();
  /** FND-02: foundations locally cancelled (self) to suppress false alerts. */
  private cancelledFoundations = new Set<string>();
  /** ATK-05: raised when a banner should be shown. */
  public onUnderAttack: (() => void) | null = null;
  private eventsBoundRoom: Room | null = null;

  /**
   * OWN-01 / D4: per-owner colour cache. The resolver reads
   * `PlayerState.color`; a cached entry survives the player leaving the room so
   * their units keep their colour instead of turning grey mid-session.
   */
  public readonly ownerColorRegistry = new OwnerColorRegistry((ownerId) => {
    const player = this.room?.state?.players?.get(ownerId);
    return player?.color ?? null;
  });

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Entity visual objects, keyed by server entity id.
  public buildingSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  public unitSprites: Map<string, Phaser.GameObjects.Container> = new Map();
  /**
   * Death clips in flight, keyed by corpse id. Kept apart from `unitSprites`
   * because a corpse is not a unit: it must not enter selection, drag-box,
   * minimap or command targeting, and the server deletes it on its own timer.
   */
  public corpseSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  public resourceSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  /**
   * MAPS/PERF: a map carries ~1.3k nodes, and creating every container in one
   * synchronous pass blocked the main thread for seconds on a map switch. Nodes
   * are queued and materialised a slice per frame; the terrain shows
   * immediately and the nodes pop in over a few frames.
   */
  private pendingResourceKeys: Set<string> = new Set();
  private pendingResources: Array<{ key: string; node: any }> = [];
  private roomCallbacks: any = null;
  private static readonly RESOURCE_SPAWN_PER_FRAME = 80;

  // MOV-01: per-unit smoothing state — the last two authoritative positions, the
  // smoothed heading and the committed compass row. The scene samples the room
  // state once per frame into these, and the frame loop draws from them.
  public unitMotion: Map<string, UnitMotion> = new Map();

  // CMD-03: last pointer position in world space, kept so the cursor can be
  // recomputed when the selection or the input mode changes without the pointer
  // moving (box-select under the cursor, hotkey-entered placement mode).
  public lastPointerWorld: { x: number; y: number } | null = null;

  /**
   * Whether the pointer is really over the game canvas (see
   * `installCanvasPresence` for why edge scrolling must not trust Phaser's
   * stale pointer coordinates).
   */
  public pointerInsideCanvas = false;

  // Building placement preview
  public buildingToPlace: BuildingType | null = null;

  // Selection
  public selectedUnitIds: Set<string> = new Set();
  public selectedBuildingId: string | null = null;
  public selectedResourceId: string | null = null;

  private hasCenteredOnSpawn: boolean = false;
  private centerAttempts: number = 0;
  /**
   * MAPS: while a travel swaps rooms, the last frame of the old map must stay
   * on screen. Skipping the update keeps every sprite exactly where it was and
   * avoids touching a Room whose socket has already left; the scene keeps
   * rendering, so the canvas never goes blank.
   */
  private worldFrozen: boolean = false;

  /**
   * MOB-03: the pointer currently driving the world is a finger.
   *
   * Set by every touch event and cleared by the next mouse event, so it gates the
   * mouse-only affordances (CSS cursor, edge scroll) per input device rather than
   * per session: a hybrid laptop goes back to its cursor the moment the trackpad
   * is used again.
   */
  public touchMode = false;

  /**
   * MOB-04: the command bar armed a one-shot box selection, so the next
   * one-finger drag paints a rectangle instead of panning. Cleared automatically
   * when that drag finishes.
   */
  public boxSelectArmed = false;

  /** MOB-04: the armed box selection is currently painting. */
  private touchBoxActive = false;

  // Selection Drag Box
  public isDragSelecting: boolean = false;
  private dragStartScreen: { x: number; y: number } = { x: 0, y: 0 };
  private dragSelectionGraphics!: Phaser.GameObjects.Graphics;

  /** Middle-button drag panning, edge scroll, zoom and camera bookmarks. */
  public cameraControl!: CameraController;

  // CTL-02: modifiers are captured on pointerdown because pointerup can report
  // them differently (the browser fires `contextmenu` early for ctrl-click).
  private pendingSelectionMods: SelectionMods = NO_SELECTION_MODS;

  // React Callbacks
  public onSelectionChange: ((entity: SelectedEntityData | null) => void) | null = null;
  public onPlacementCancelled: (() => void) | null = null;
  /**
   * Set by `PhaserGame`. A build hotkey (`Q/W/E/R/T`) is owned by the keyboard
   * layer but has to open React state, because the HUD highlights the selected
   * building type and the placement panel reads it.
   */
  public onBuildingHotkey: ((type: BuildingType) => void) | null = null;
  /**
   * The road tool was entered or left from the map itself (right-click backs
   * out). React mirrors this so the HUD button and the map never disagree.
   */
  public onRoadModeChange: ((mode: RoadMode | null) => void) | null = null;
  /** A road tile was added or removed; rebuild the terrain pool once per frame. */
  private roadsDirty = false;
  /**
   * Bumped on every road add/remove. The minimap rasterises the road set, and a
   * stroke that removes one tile and adds another leaves the count unchanged, so
   * a counter is the only cheap signal that the tile set really changed.
   */
  public roadsVersion = 0;
  /**
   * ECO-02: published whenever the number of this player's idle villagers
   * changes, so the HUD can show the AoE idle-counter without scanning state.
   */
  public onIdleVillagersChange: ((count: number) => void) | null = null;
  /**
   * UIX-03: published whenever the `Ctrl+1..9` rosters change (assign, recall,
   * a member dying), so the right-hand group panel mirrors the real groups.
   */
  public onControlGroupsChange: ((groups: ControlGroupSummary[]) => void) | null = null;
  /**
   * MOB-05: the armed order changed (armed from the touch bar, committed by a tap,
   * or cancelled). The bar's pressed state and its "Huỷ lệnh" button read this.
   */
  public onArmedOrderChange: ((armed: ArmedOrder | null) => void) | null = null;
  /** MOB-04: the one-shot box-selection mode was armed or consumed. */
  public onBoxSelectChange: ((armed: boolean) => void) | null = null;
  /** Last `hp|carrying|actionState` string published to the entity panel. */
  private lastUnitDetailSignature = '';
  /** LVL: last building/panel signature, including player research progress. */
  private lastBuildingDetailSignature = '';
  /** ECO-02: last count published, and when the next scan is allowed. */
  private lastIdleVillagerCount = -1;
  private nextIdleVillagerScanAt = 0;

  // Behaviour modules. Constructed in create() so they can allocate Phaser
  // objects; every one of them reads this scene's state rather than keeping a copy.
  public selection!: SelectionController;
  public cursor!: CursorController;
  public placement!: PlacementController;
  /** Road paint tool; only enters a mode in a kingdom. */
  public roadController!: RoadController;
  public commands!: CommandController;
  /** MOB-02: gestures, camera pan/pinch and the touch order dispatch. */
  public touch!: TouchController;
  public entityRenderer!: EntityRenderer;
  public terrain!: TerrainLayer;
  public decor!: DecorLayer;
  /**
   * Size of the map currently joined. A kingdom is 110x110, the battlefield
   * 220x220; the room replicates both numbers so camera, terrain culling,
   * minimap and placement bounds all follow the map instead of a constant.
   */
  public mapWidth: number = MAP_GRID_WIDTH;
  public mapHeight: number = MAP_GRID_HEIGHT;
  /** Road/plaza layout of the current map, derived from its zone id. */
  public terrainLayout: MapTerrain = TERRAIN_BATTLEFIELD;
  /** CMB-03: red marker on the enemy the selection is hitting. */
  public focus!: FocusIndicator;

  constructor() {
    super('WorldScene');
  }

  preload() {
    generateProceduralTextures(this);

    // Preload generated unit assets with spritesheet & idle frame support (2x resolution)
    // Bumped whenever a sheet on disk changes: the URL is the cache key.
    const uv = 'v=6';
    // The legacy single-facing sheets stay loaded even for units that have been
    // redrawn: `EntityRenderer` falls back to them when a directional sheet is
    // missing, so an art regression still renders a unit instead of a green box.
    // Their cell size is the old 128 px grid, not the pack's 148x130, which is why
    // it is written out here instead of read from `unitArt.ts`.
    this.load.spritesheet('unit_VILLAGER_sheet', `/assets/units/villager_sheet.png?${uv}`, {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.image('unit_VILLAGER_idle', `/assets/units/villager_idle.png?${uv}`);

    this.load.spritesheet('unit_SPEARMAN_sheet', `/assets/units/spearman_sheet.png?${uv}`, {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.image('unit_SPEARMAN_idle', `/assets/units/spearman_idle.png?${uv}`);

    this.load.spritesheet('unit_ARCHER_sheet', `/assets/units/archer_sheet.png?${uv}`, {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.image('unit_ARCHER_idle', `/assets/units/archer_idle.png?${uv}`);

    this.load.spritesheet('unit_CAVALRY_sheet', `/assets/units/cavalry_sheet.png?${uv}`, {
      frameWidth: 160,
      frameHeight: 160
    });
    this.load.image('unit_CAVALRY_idle', `/assets/units/cavalry_idle.png?${uv}`);

    // Directional action sheets, one file per (unit, action): 8 rows of frames in
    // assets/units/actions, cell size from the unit's art config. Units without
    // one keep the single-facing sheet above and are mirrored instead of rotated.
    for (const unitType of Object.keys(UNIT_ART)) {
      const art = unitArt(unitType);
      for (const sheet of unitSheets(unitType)) {
        this.load.spritesheet(
          unitActionTexture(unitType, sheet.sheetAction),
          `/assets/units/actions/${unitType.toLowerCase()}_${sheet.sheetAction}.png?${uv}`,
          { frameWidth: art.frameWidth, frameHeight: art.frameHeight }
        );
      }
    }

    // Preload generated building assets with cache-busting version (2x resolution)
    // v=10: the house gained four level-tier sheets (`house_2..5.png`), which
    // will ship alongside the existing level-1 sheet. Bump the key whenever a
    // PNG under public/assets/buildings or /resources changes.
    const v = 'v=10';
    this.load.image('building_TOWN_CENTER', `/assets/buildings/town_center.png?${v}`);
    this.load.image('building_BARRACKS', `/assets/buildings/barracks.png?${v}`);
    this.load.image('building_HOUSE', `/assets/buildings/house.png?${v}`);
    // LVL3: the house changes silhouette at four level milestones. Keys follow
    // `building_<TYPE>_<tier>`; `buildingArt` walks down from the requested tier
    // so a sheet that fails to load degrades to the previous shape. The loop
    // counts the *sheets the renderer knows about*, not the shared milestone
    // table, so a milestone added before its art cannot 404 here.
    for (let tier = 2; tier <= buildingVisualTierCount('HOUSE'); tier++) {
      this.load.image(`building_HOUSE_${tier}`, `/assets/buildings/house_${tier}.png?${v}`);
    }
    this.load.image('building_FARM', `/assets/buildings/farm.png?${v}`);
    this.load.image('building_TOWER', `/assets/buildings/tower.png?${v}`);
    this.load.image('building_PORTAL', `/assets/buildings/portal.png?${v}`);
    this.load.image('building_LUMBER_CAMP', `/assets/buildings/lumber_camp.png?${v}`);
    this.load.image('building_MILL', `/assets/buildings/mill.png?${v}`);
    this.load.image('building_MINING_CAMP', `/assets/buildings/mining_camp.png?${v}`);

    // Preload generated resource node assets with cache-busting version
    this.load.image('res_node_TREE', `/assets/resources/tree.png?${v}`);
    // OGA tree collection: three extra silhouettes, picked per node in
    // `EntityRenderer.createResourceNodeSprite` so a forest is not one tree
    // stamped over and over.
    this.load.image('res_node_TREE_2', `/assets/resources/tree_2.png?${v}`);
    this.load.image('res_node_TREE_3', `/assets/resources/tree_3.png?${v}`);
    this.load.image('res_node_TREE_4', `/assets/resources/tree_4.png?${v}`);
    this.load.image('res_node_GOLD_MINE', `/assets/resources/gold.png?${v}`);
    this.load.image('res_node_STONE_MINE', `/assets/resources/stone.png?${v}`);
    this.load.image('res_node_BERRY_BUSH', `/assets/resources/berry.png?${v}`);

    // Preload Age of Empires 2 Grass Terrain textures
    const tv = 'v=8';
    this.load.image('tile_grass_1', `/assets/terrain/grass_1.png?${tv}`);
    this.load.image('tile_grass_2', `/assets/terrain/grass_2.png?${tv}`);
    this.load.image('tile_grass_3', `/assets/terrain/grass_3.png?${tv}`);
    this.load.image('tile_grass', `/assets/terrain/grass.png?${tv}`);

    // Preload Age of Empires 2 Dirt Road Terrain textures
    this.load.image('tile_dirt_1', `/assets/terrain/dirt_1.png?${tv}`);
    this.load.image('tile_dirt_2', `/assets/terrain/dirt_2.png?${tv}`);
    this.load.image('tile_dirt_3', `/assets/terrain/dirt_3.png?${tv}`);
    this.load.image('tile_dirt', `/assets/terrain/dirt.png?${tv}`);

    // Decorative ground cover and the border forest. Single images built by
    // `scripts/assets/build.py` (targets `decor.*`), listed in `decorArt.ts`.
    for (const { key, url } of decorPreloadList('v=1')) {
      this.load.image(key, url);
    }

    // CTL-06 rally-point banner. Derived from the `order` cursor artwork and
    // regenerated offline; bump the query string whenever the PNG changes.
    this.load.image('rally_flag', '/assets/markers/rally_flag.png?v=1');
  }

  create() {
    // Disable right click context menu in browser
    this.input.mouse?.disableContextMenu();

    // Natural AoE grass background clear color (eliminates any sub-pixel black seam line)
    this.cameras.main.setBackgroundColor('#58752d');

    // Register unit animations if spritesheets are loaded
    this.entityRenderer = new EntityRenderer(this);
    this.entityRenderer.initUnitAnimations();

    // 1. Terrain: pre-allocated tile and road-tile pools, rendered per viewport
    // across a 220x220 map.
    this.terrain = new TerrainLayer(this);
    this.terrain.create();

    // 1b. Ground cover and border forest, above the grass but below every
    // entity (the layer draws at depth 5, resources sit at 10).
    this.decor = new DecorLayer(this);
    this.decor.create();

    // 2. Building placement ghost
    this.placement = new PlacementController(this);
    this.placement.create();

    // 2b. Road paint tool (kingdom only)
    this.roadController = new RoadController(this);

    // 3. Drag selection box graphics
    this.dragSelectionGraphics = this.add.graphics();
    this.dragSelectionGraphics.setDepth(1000000);

    // 4b. Waypoint + rally overlays (CTL-05 / CTL-06), under the selection box
    this.commands = new CommandController(this);
    this.commands.createOverlays();

    // 4b-2. Camera: wheel zoom, +/- steps, bookmarks and middle-drag panning.
    // Built after `commands` because a saved bookmark flashes feedback through it.
    this.cameraControl = new CameraController(this);

    // 4c. Focus-fire marker (CMB-03), under the drag box like every other overlay
    this.focus = new FocusIndicator(this);

    // 5. Selection and cursor policy. Built after placement because the cursor
    // reads the placement validator.
    this.selection = new SelectionController(this);
    this.cursor = new CursorController(this);

    // 5b. Touch gestures (MOB-02): pan, pinch, tap and long-press. Built last
    // because every intent it emits goes through the layers above.
    this.touch = new TouchController(this);

    // 6. Camera & Controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      // WASD is intentionally NOT bound: it collides with the Q/W/E/R/T build
      // hotkeys in App.tsx. Panning is arrows + edge scroll (see update()).
      this.commands.bindKeys(this.input.keyboard);
    }

    // Ctrl+left-click is the same-type selection shortcut (CTL-02). On macOS the
    // OS turns that gesture into a context menu unless we suppress it here.
    this.input.mouse?.disableContextMenu();

    // Initial camera position centered on map - default to max visible area (ZOOM_MIN)
    const center = gridToScreen(this.mapWidth / 2, this.mapHeight / 2);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameras.main.setZoom(ZOOM_MIN);

    // Mouse wheel zoom
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number) => {
      this.cameraControl.handleWheel(deltaY);
    });

    // Pointer events for selection and actions
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerMove(pointer);
    });

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerDown(pointer);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerUp(pointer);
    });

    // A release outside the canvas emits `pointerupoutside` *instead of*
    // `pointerup`, and both middle-drag panning and box selection end on that
    // event. Without this the camera would keep panning with the mouse until the
    // next release inside the canvas.
    this.input.on('pointerupoutside', (pointer: Phaser.Input.Pointer) => {
      this.handlePointerUp(pointer);
    });

    // Presses and releases that land on a React HUD panel never reach the canvas,
    // so neither Phaser handler above fires. UIX-01: treat an off-canvas press as
    // "clicked the world chrome" — the armed order or the placement ghost must
    // drop, and an in-flight box selection must finish instead of leaving its
    // rectangle painted on screen.
    installHudPointerGuard(this.game, this.events, {
      onPressOutside: () => {
        if (this.buildingToPlace) {
          this.placement.cancel();
        } else if (this.commands.pendingOrder || this.commands.contextualArmed) {
          this.commands.cancelPendingOrder();
        }
      },
      onReleaseOutside: () => {
        // A middle-button pan can also end over a panel; stop it unconditionally.
        this.cameraControl.endMiddleDrag();
        // `outside` so a sub-threshold drag is not read as a click: the pointer
        // then sits over a panel, and `handleClick` would hit-test (or clear the
        // selection through) whatever is painted underneath it.
        if (this.isDragSelecting) this.handlePointerUp(this.input.activePointer, true);
      },
      onPointerCancelled: () => {
        // The browser aborted the gesture (touch interruption, window drag-out).
        // A drawn box still completes — the player did drag it — but the
        // sub-threshold click is skipped for the same reason as above, and the
        // pan must stop because no `pointerup` is coming.
        this.cameraControl.endMiddleDrag();
        // Same for the touch gesture: no release is coming, so any half-open
        // pinch or box would otherwise keep the next finger's events.
        this.touch.cancel();
        if (this.isDragSelecting) this.handlePointerUp(this.input.activePointer, true);
      }
    });

    // Edge scrolling must stop the moment the pointer leaves the canvas; see
    // `installCanvasPresence` for why Phaser's pointer state cannot tell that
    // apart from "parked on the edge".
    installCanvasPresence(this.game, this.events, (inside) => {
      this.pointerInsideCanvas = inside;
    });

    // Bind room events if room already passed
    if (this.room) {
      this.bindRoomEvents(this.room);
    }

    // Initial viewport terrain render
    this.terrain.render();
    this.decor.render();
  }

  /**
   * Binds a room, or detaches the scene when `room` is null.
   *
   * A travel leaves the old room and joins the new one asynchronously. During
   * that gap the scene must not keep reading the old snapshot: after `leave()`
   * its state is gone, and an update tick against it stops the Phaser loop
   * (which reads as a black screen). The React layer calls this with null as
   * soon as the old room is released and with the new Room once it is joined.
   */
  public setRoom(room: Room | null) {
    // Same instance = nothing to wire up. React StrictMode and Phaser's 'ready'
    // event can both call this with the same object.
    if (room === this.room) return;

    if (!room) {
      this.resumeWorld();
      this.room = null;
      this.eventsBoundRoom = null;
      this.boundRoomId = '';
      this.resetForNewWorld();
      this.centerCameraOnMap();
      return;
    }

    // Same roomId but a different Room instance means a reconnect: the snapshot
    // is the same world, but the cached owner id may not be resolvable yet, so
    // it is dropped and re-resolved from the new snapshot.
    const isNewWorld = room.roomId !== this.boundRoomId;

    this.room = room;
    this.cachedOwnerId = '';
    this.boundRoomId = room.roomId;
    // The new map may be a different size than the one still on screen, so its
    // size has to be adopted before the camera and terrain use it.
    this.syncMapSize();

    // OWN-05: the cache belongs to the previous Room's snapshot. A reconnect may
    // restore a different profile colour, so re-resolve before repainting.
    this.ownerColorRegistry.invalidateAll();
    this.underAttackTracker.clear();
    this.cancelledFoundations.clear();
    // A travel freezes the old map on screen instead of going blank while the
    // destination room syncs. Unfreeze before binding the new snapshot.
    this.resumeWorld();

    if (isNewWorld) {
      // MAPS: a different room is a different map (or at least a different
      // snapshot), so every sprite and selection from the old one is stale.
      this.resetForNewWorld();
      // Put the camera on the new map before waiting for its first patch; the
      // base-centred pass below replaces this as soon as the snapshot lands.
      this.centerCameraOnMap();
    }

    // Callbacks belong to a Room instance, so a new instance always needs binding.
    if (this.scene.isActive()) {
      this.bindRoomEvents(room);
      this.entityRenderer?.refreshOwnershipVisuals();
      this.centerOnOwnBaseIfNeeded();
    }
  }

  /**
   * Pushes the room's current road set into the terrain layer.
   *
   * Called on bind and on every add/remove. `TerrainLayer` keeps only the tile
   * coordinates and reuses one image pool, so a long drag does not allocate.
   */
  public refreshPlayerRoads() {
    // Anything that rebuilds the visual road set (bind, patch, reset) also
    // invalidates the minimap raster, which reads the same tiles.
    this.roadsVersion++;
    const roads = (this.room?.state as { roads?: { forEach: (cb: (road: any) => void) => void } } | null)
      ?.roads;
    const tiles: Array<{ gridX: number; gridY: number }> = [];
    roads?.forEach((road: any) => {
      tiles.push({ gridX: road.gridX, gridY: road.gridY });
    });
    this.terrain?.setPlayerRoads(tiles);
    this.decor?.invalidateViewport();
  }

  /** Freezes the last rendered frame while a travel swaps rooms. */
  public pauseWorld() {
    this.worldFrozen = true;
  }

  public resumeWorld() {
    this.worldFrozen = false;
  }

  /**
   * Adopts the map size and terrain layout the room replicates.
   *
   * Called whenever a Room instance is bound, before any sprite is created: a
   * kingdom is 110x110 with its own road layout, the battlefield is the original
   * 220x220. Nothing is allocated here — the terrain layer only swaps its cached
   * road spline and both controllers read the fields on demand.
   */
  private syncMapSize() {
    const state = this.room?.state as
      | { mapWidth?: number; mapHeight?: number; zoneId?: string }
      | null
      | undefined;
    const width = Number(state?.mapWidth);
    const height = Number(state?.mapHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    const layout = terrainForZone(state?.zoneId ?? 'battlefield');
    // Patches arrive continuously; only a real map change may invalidate the
    // terrain pool, or every server tick would force a full re-stamp.
    if (
      width === this.mapWidth &&
      height === this.mapHeight &&
      layout.kind === this.terrainLayout.kind
    ) {
      return;
    }

    this.mapWidth = width;
    this.mapHeight = height;
    this.terrainLayout = layout;
    this.terrain?.setTerrain(layout);
    // Decor depends on the terrain (roads, map edge), so it has to re-lay out
    // when the layout changes even if the camera never moved.
    this.decor?.invalidateViewport();
  }

  /** Default view for a map with no known anchor yet: the whole terrain. */
  private centerCameraOnMap() {
    const center = gridToScreen(this.mapWidth / 2, this.mapHeight / 2);
    this.cameras.main.panEffect.reset();
    this.cameras.main.centerOn(center.x, center.y);
    this.cameras.main.setZoom(ZOOM_MIN);
  }

  /**
   * Drops every visual and selection belonging to the previous map.
   *
   * Colyseus rooms have separate state, but the scene is one long-lived object:
   * without this, sprites from the kingdom would remain painted over the
   * battlefield (and their ids would shadow the new map's entities).
   */
  private resetForNewWorld() {
    this.buildingSprites.forEach((container) => container.destroy());
    this.buildingSprites.clear();
    this.unitSprites.forEach((container) => container.destroy());
    this.unitSprites.clear();
    this.corpseSprites.forEach((sprite) => sprite.destroy());
    this.corpseSprites.clear();
    this.resourceSprites.forEach((container) => container.destroy());
    this.resourceSprites.clear();
    this.pendingResources = [];
    this.pendingResourceKeys.clear();
    this.unitMotion.clear();

    this.selection?.clear();
    this.selectedUnitIds.clear();
    this.selectedBuildingId = null;
    this.selectedResourceId = null;
    this.isDragSelecting = false;
    this.dragSelectionGraphics?.clear();

    this.commands?.resetControlGroups();
    this.commands?.cancelPendingOrder();
    this.placement?.cancel();
    this.roadController?.cancel();
    // The new map may have no roads at all (a battlefield always does not), so
    // the painted quads of the previous map must not survive the switch.
    this.terrain?.setPlayerRoads([]);
    this.onRoadModeChange?.(null);
    this.cameraControl?.resetBookmarks();
    // The pool is repositioned only when the viewport moves; a new map can start
    // at a very different corner, so force the next frame to repaint it.
    this.terrain?.invalidateViewport();
    this.decor?.invalidateViewport();

    this.hasCenteredOnSpawn = false;
    this.centerAttempts = 0;
    this.cachedOwnerId = '';
    this.ownerColorRegistry.invalidateAll();
    this.underAttackTracker.clear();
    this.cancelledFoundations.clear();
    // Repaint the overlays against the now-empty selection so nothing from the
    // old map survives the frame. The new Room may not have delivered its first
    // state patch yet, so the rally pass is guarded.
    this.focus?.render();
    this.commands?.updateWaypointPreview();
    if (this.room?.state?.buildings) this.commands?.updateRallyMarkers();
    this.onSelectionChange?.(null);
  }

  /**
   * Player name is stable across reconnects, so the camera and the owner id can
   * always be resolved even after the socket changed.
   */
  public setPlayerName(playerName: string) {
    this.myPlayerName = playerName;
    // OWN-05: resolving our own id is what hides the ownership marker on our own
    // units and buildings. The pass may run before the first state patch, in
    // which case the lazy getter keeps retrying and a later players event wins.
    this.cachedOwnerId = '';
    this.entityRenderer?.refreshOwnershipVisuals();
    this.centerOnOwnBaseIfNeeded();
  }

  public isOwnBuilding(ownerId: string): boolean {
    if (!ownerId) return false;
    return ownerId === this.myOwnerId;
  }

  /** OWN-04: CSS colour of an owner, so the canvas minimap matches the world. */
  public ownerColorCss(ownerId: string): string {
    return colorToCss(this.ownerColorRegistry.colorOf(ownerId));
  }

  /**
   * Own Town Center, or null when the snapshot does not contain it yet.
   */
  public findOwnTownCenter(): any | null {
    if (!this.room?.state?.buildings) return null;

    let target: any = null;
    this.room.state.buildings.forEach((b: any) => {
      if (!target && b.type === 'TOWN_CENTER' && this.isOwnBuilding(b.ownerId)) {
        target = b;
      }
    });
    return target;
  }

  /** Own portal, used as the camera anchor when the map has no Town Center. */
  public findOwnPortal(): any | null {
    if (!this.room?.state?.buildings) return null;

    let target: any = null;
    this.room.state.buildings.forEach((b: any) => {
      if (!target && b.type === 'PORTAL' && this.isOwnBuilding(b.ownerId)) {
        target = b;
      }
    });
    return target;
  }

  private centerOnOwnBaseIfNeeded() {
    if (this.hasCenteredOnSpawn || !this.room?.state) return;

    // Player name may not be known yet; retry on the next tick instead.
    if (!this.myPlayerName) return;

    // A kingdom centres on its Town Center; the battlefield has no base, so the
    // account's arrival portal is the next-best anchor.
    const target = this.findOwnTownCenter() ?? this.findOwnPortal();
    if (!target) return;

    this.hasCenteredOnSpawn = true;
    const screenPos = gridToScreen(target.gridX + target.sizeX / 2, target.gridY + target.sizeY / 2);
    this.cameras.main.centerOn(screenPos.x, screenPos.y);
  }

  /**
   * Called from update() as a bounded fallback (max ~5s at 60fps) in case the
   * Town Center arrives in a snapshot after the initial onAdd burst.
   */
  private retryCenterOnBase() {
    // Don't burn the retry budget while still in the lobby (no room yet) — the
    // player can sit there for minutes before joining.
    if (this.hasCenteredOnSpawn || !this.room) return;

    if (this.centerAttempts++ > 300) {
      this.hasCenteredOnSpawn = true; // give up, keep the default camera position
      return;
    }
    this.centerOnOwnBaseIfNeeded();
  }

  /** ATK-01: record an entity's replicated hp and raise a banner if warranted. */
  public recordEntityHp(entityId: string, ownerId: string, hp: number, gx: number, gy: number): DamageResult {
    const result = this.underAttackTracker.record(entityId, ownerId, this.myOwnerId, hp, gx, gy, Date.now());
    if (result.showBanner) this.onUnderAttack?.();
    return result;
  }

  /** FND-02/FND-06: mark a foundation as locally cancelled; self-heal after 2s. */
  public markFoundationCancelled(id: string): void {
    this.cancelledFoundations.add(id);
    window.setTimeout(() => this.cancelledFoundations.delete(id), 2000);
  }

  /** ATK-04: active under-attack pings for the minimap. */
  public getUnderAttackPings(now: number = Date.now()): AttackPing[] {
    return this.underAttackTracker.activePings(now);
  }

  public bindRoomEvents(room: Room) {
    // Called from create(), setRoom() and PhaserGame effects; binding the same
    // Room twice would register duplicate schema callbacks (duplicate sprites).
    if (this.eventsBoundRoom === room) return;
    this.eventsBoundRoom = room;
    this.underAttackTracker.clear();
    this.cancelledFoundations.clear();
    // Same reason as `setRoom`: a room bound directly from `create()` (page
    // refresh straight into a map) also has to publish its map size. The state
    // listener covers a join whose snapshot lands after the room was handed over.
    this.syncMapSize();
    room.onStateChange(() => this.syncMapSize());

    const cb = Callbacks.get(room);
    this.roomCallbacks = cb;
    this.pendingResources = [];
    this.pendingResourceKeys.clear();

    // 0. Player-painted roads: a kingdom's entire network arrives as state, so
    // the terrain layer is rebuilt from the map whenever a tile appears or goes.
    this.roadsDirty = false;
    this.refreshPlayerRoads();
    // A loaded kingdom arrives one tile at a time, so the rebuild is deferred to
    // the frame instead of running once per patch (which would be O(n^2)).
    cb.onAdd('roads', () => {
      this.roadsDirty = true;
      this.roadsVersion++;
    });
    cb.onRemove('roads', () => {
      this.roadsDirty = true;
      this.roadsVersion++;
    });

    // 1. Synchronize Resource Nodes
    cb.onAdd('resourceNodes', (node: any, key: any) => {
      this.enqueueResourceSprite(key, node);
    });

    cb.onRemove('resourceNodes', (node: any, key: any) => {
      this.pendingResourceKeys.delete(key);
      const sprite = this.resourceSprites.get(key);
      if (sprite) {
        sprite.destroy();
        this.resourceSprites.delete(key);
      }
      // A felled starter node leaves the state for good, so a details panel
      // still pinned to it would show a resource that no longer exists.
      if (this.selectedResourceId === key) {
        this.selection.clearEntity();
        this.notifySelectionChange();
      }
    });

    // 2. Synchronize Buildings
    cb.onAdd('buildings', (building: any, key: any) => {
      if (this.buildingSprites.has(key)) return;
      this.entityRenderer.createBuildingSprite(key, building, cb);
      this.centerOnOwnBaseIfNeeded();
    });

    cb.onRemove('buildings', (building: any, key: any) => {
      // ATK-01 / FND-02 fallback: one-shot kill may remove before an hp patch lands.
      // Foundation (isConstructed !== true) dies in one hit, so any removal that
      // is not a self-cancel counts as an attack.
      const cancelled = this.cancelledFoundations.has(key);
      const shouldAlert = shouldAlertOnBuildingRemoval(building, this.myOwnerId, cancelled);
      if (shouldAlert) {
        const gx = (building?.gridX ?? 0) + (building?.sizeX ?? 1) / 2;
        const gy = (building?.gridY ?? 0) + (building?.sizeY ?? 1) / 2;
        this.recordEntityHp(key, building.ownerId, 0, gx, gy);
      } else {
        this.underAttackTracker.forget(key);
      }
      this.cancelledFoundations.delete(key);

      const sprite = this.buildingSprites.get(key);
      if (sprite) {
        sprite.destroy();
        this.buildingSprites.delete(key);
      }
      if (this.selectedBuildingId === key) {
        this.selectedBuildingId = null;
        this.notifySelectionChange();
      }
    });

    // 3. Synchronize Units
    cb.onAdd('units', (unit: any, key: any) => {
      if (this.unitSprites.has(key)) return;
      this.entityRenderer.createUnitSprite(key, unit, cb);
    });

    cb.onRemove('units', (unit: any, key: any) => {
      // ATK-01 fallback: one-shot kill may remove before an hp patch lands.
      const fallbackUnit = unit?.ownerId === this.myOwnerId && (unit?.hp ?? 0) <= 0;
      if (fallbackUnit) {
        this.recordEntityHp(key, unit.ownerId, 0, unit.x ?? 0, unit.y ?? 0);
      } else {
        this.underAttackTracker.forget(key);
      }

      const sprite = this.unitSprites.get(key);
      if (sprite) {
        sprite.destroy();
        this.unitSprites.delete(key);
      }
      this.unitMotion.delete(key);
      this.commands.forgetUnit(key);
      if (this.selectedUnitIds.has(key)) {
        this.selectedUnitIds.delete(key);
        this.notifySelectionChange();
      }
    });

    // 3b. Corpses: a dying unit leaves one behind for the length of its death
    // clip. The server owns the lifetime, so removal is the only cleanup needed.
    cb.onAdd('corpses', (corpse: any, key: any) => {
      if (this.corpseSprites.has(key)) return;
      this.entityRenderer.createCorpseSprite(key, corpse);
    });

    cb.onRemove('corpses', (_corpse: any, key: any) => {
      const sprite = this.corpseSprites.get(key);
      if (sprite) {
        sprite.destroy();
        this.corpseSprites.delete(key);
      }
    });

    // 4. Ownership colours (OWN-05). Entities can enter the scene before their
    // owner's player entry arrives (the world is restored from the database on
    // server boot), so every players event re-evaluates the ownership markers.
    cb.onAdd('players', (player: any) => {
      if (!player?.id) return;
      this.ownerColorRegistry.invalidate(player.id);
      // A rejoin can restore a different profile colour from the database.
      cb.listen(player, 'color', () => {
        this.ownerColorRegistry.invalidate(player.id);
        this.entityRenderer.refreshOwnershipVisuals();
      });
      this.entityRenderer.refreshOwnershipVisuals();
    });

    cb.onRemove('players', () => {
      // D4: the colour stays cached so units of a player who left keep it. The
      // pass still runs because entries can arrive in any order on restore.
      this.entityRenderer.refreshOwnershipVisuals();
    });

    // A room that synced before these callbacks were attached would otherwise
    // stay empty until its next patch (which can be seconds, or never for a
    // static map). Materialise anything already in the snapshot.
    this.hydrateExistingEntities(room, cb);

    // Repaint sprites that already exist against the newly bound snapshot.
    this.entityRenderer.refreshOwnershipVisuals();
  }

  private hydrateExistingEntities(room: Room, cb: any) {
    const state = room.state as any;
    if (!state) return;

    state.resourceNodes?.forEach((node: any, key: string) => {
      this.enqueueResourceSprite(key, node);
    });

    state.buildings?.forEach((building: any, key: string) => {
      if (this.buildingSprites.has(key)) return;
      this.entityRenderer.createBuildingSprite(key, building, cb);
    });

    state.units?.forEach((unit: any, key: string) => {
      if (this.unitSprites.has(key)) return;
      this.entityRenderer.createUnitSprite(key, unit, cb);
    });
  }

  private enqueueResourceSprite(key: string, node: any): void {
    if (this.resourceSprites.has(key) || this.pendingResourceKeys.has(key)) return;
    this.pendingResourceKeys.add(key);
    this.pendingResources.push({ key, node });
  }

  /** Materialises a bounded slice of the queued resource nodes per frame. */
  private flushResourceSpawns(): void {
    let created = 0;
    while (
      this.pendingResources.length > 0 &&
      created < WorldScene.RESOURCE_SPAWN_PER_FRAME
    ) {
      const item = this.pendingResources.shift() as { key: string; node: any };
      this.pendingResourceKeys.delete(item.key);

      // The node may have been removed while queued (or the map changed); read
      // the live snapshot instead of the queued reference.
      const state = this.room?.state as any;
      const node = state?.resourceNodes?.get(item.key);
      if (!node || this.resourceSprites.has(item.key)) continue;

      this.entityRenderer.createResourceNodeSprite(item.key, node, this.roomCallbacks);
      created++;
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer handling
  // ---------------------------------------------------------------------------

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    // Any move that reaches the scene came from the canvas, so it settles the
    // edge-scroll presence flag too (`pointerenter` normally sets it first).
    this.pointerInsideCanvas = true;

    // MOB-02: a finger moves the camera, paints a box or is part of a pinch; it
    // never hovers, so the desktop hover work below (cursor, ghost) is skipped.
    if (pointer.wasTouch) {
      this.touchMode = true;
      this.touch.move(pointer);
      return;
    }

    // A mouse is driving again (hybrid laptop): restore the cursor and edge pan.
    this.touchMode = false;

    // Middle-drag pan moves the camera under a still pointer, so the world point
    // below the cursor is recomputed first: the cursor and the waypoint preview
    // both read it, and a stale one would pin them to the tile left behind.
    const panning = this.cameraControl.updateMiddleDrag(pointer);

    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const hoverGridCoord = screenToGrid(worldPoint.x, worldPoint.y);
    this.lastPointerWorld = { x: worldPoint.x, y: worldPoint.y };

    // A pan owns the pointer: no placement ghost and no box selection while the
    // map is being dragged.
    if (panning) {
      this.cursor.refresh();
      return;
    }

    // A road stroke owns the pointer while it is down; the ghost is redrawn by
    // the controller itself.
    if (this.roadController?.isDrawing) {
      this.roadController.drag(pointer);
      this.cursor.refresh();
      return;
    }

    // Placement ghost follows the pointer while the mode is active
    this.placement.updateGhost(hoverGridCoord.gridX, hoverGridCoord.gridY);

    // Drag selection rendering
    if (this.isDragSelecting) {
      this.drawDragBox({ x: pointer.x, y: pointer.y });
    }

    this.cursor.refresh();
  }

  /**
   * Paints the drag-selection rectangle in camera-fixed screen space.
   *
   * Extracted because two input paths own a rectangle: the mouse box-drag and the
   * armed touch box-drag. Drawing it in two places had already started to drift.
   */
  private drawDragBox(current: { x: number; y: number }) {
    this.dragSelectionGraphics.clear();
    this.dragSelectionGraphics.lineStyle(1.5, 0x38bdf8, 1);
    this.dragSelectionGraphics.fillStyle(0x0284c7, 0.2);

    const start = this.dragStartScreen;
    const minX = Math.min(start.x, current.x);
    const minY = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    this.dragSelectionGraphics.fillRect(
      this.cameras.main.worldView.x + minX / this.cameras.main.zoom,
      this.cameras.main.worldView.y + minY / this.cameras.main.zoom,
      width / this.cameras.main.zoom,
      height / this.cameras.main.zoom
    );
    this.dragSelectionGraphics.strokeRect(
      this.cameras.main.worldView.x + minX / this.cameras.main.zoom,
      this.cameras.main.worldView.y + minY / this.cameras.main.zoom,
      width / this.cameras.main.zoom,
      height / this.cameras.main.zoom
    );
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    // MOB-02: Phaser reports a touch as the left button, so every desktop branch
    // below would misfire (a tap would start a box selection). The gesture layer
    // owns touch entirely and dispatches back through the public touch methods.
    if (pointer.wasTouch) {
      this.touchMode = true;
      this.touch.begin(pointer);
      return;
    }

    this.touchMode = false;
    const native = pointer.event as MouseEvent | undefined;

    // A road tool owns the drag: left button starts a stroke, right button
    // backs out of the tool (same gesture as leaving placement mode).
    if (this.roadController?.active) {
      if (pointer.rightButtonDown() && !native?.ctrlKey) {
        this.cancelRoadMode();
        this.onRoadModeChange?.(null);
        return;
      }
      if (pointer.leftButtonDown()) {
        native?.preventDefault();
        this.roadController.begin(pointer);
        return;
      }
    }

    // macOS: Phaser rewrites Ctrl+left-click into a right-click to match the OS
    // convention (see Pointer#down). Ctrl+click is our same-type-selection
    // modifier and the canvas context menu is disabled, so read the native
    // button instead of trusting `rightButtonDown()`.
    const ctrlLeftClick = !!native && native.button === 0 && native.ctrlKey;

    // Middle-button drag pans the map (AoE2). The default is suppressed so the
    // browser does not start its own autoscroll on the canvas.
    if (pointer.middleButtonDown()) {
      native?.preventDefault();
      if (!this.buildingToPlace) {
        this.cameraControl.beginMiddleDrag(pointer);
        return;
      }
    }

    // CMD-01: an armed attack-move / patrol consumes the next left click as its
    // destination, before anything can start a drag selection box. Placement mode
    // keeps its click: the cursor is already promising a building there.
    // MOB-05: a contextual arm (touch bar) consumes the click the same way.
    if (
      (this.commands.pendingOrder || this.commands.contextualArmed) &&
      !this.buildingToPlace &&
      (pointer.leftButtonDown() || ctrlLeftClick)
    ) {
      this.commands.commitPendingOrder(pointer);
      return;
    }

    if (pointer.rightButtonDown() && !ctrlLeftClick) {
      // Right Click
      if (this.buildingToPlace) {
        this.placement.cancel();
      } else if (this.commands.pendingOrder || this.commands.contextualArmed) {
        // Right click used to fire a normal order; with an order armed it only
        // backs out, like cancelling a placement.
        this.commands.cancelPendingOrder();
      } else if (native?.ctrlKey && native.button === 2) {
        // CMD-01: Ctrl + right click is AoE2's attack-move.
        this.commands.issueAttackMove(pointer, 'ATTACK_MOVE');
      } else {
        this.commands.handleRightClick(pointer, !!native?.shiftKey);
      }
      return;
    }

    if (pointer.leftButtonDown() || ctrlLeftClick) {
      if (this.buildingToPlace) {
        // Shift keeps the placement mode open after a successful drop, so the
        // player can place a row of the same building without re-picking it.
        this.placement.commit(pointer, !!native?.shiftKey);
      } else {
        // Start Drag selection box. Modifiers are resolved here, from the native
        // event, because the release can report them differently.
        this.pendingSelectionMods = selectionModsFor(native);
        this.isDragSelecting = true;
        this.dragStartScreen = { x: pointer.x, y: pointer.y };
      }
    }
  }

  /**
   * @param outside true when the button came up off-canvas (over a HUD panel, or
   *   after a cancelled gesture). A box selection still finishes at the last
   *   on-canvas position, but a sub-threshold drag must not become a click-select:
   *   the pointer coordinates then point at the panel, not at the world.
   */
  private handlePointerUp(pointer: Phaser.Input.Pointer, outside = false) {
    // MOB-02: a finger release is resolved by the gesture layer (tap, end of a
    // box drag, or the tail of a pinch); there is no button state to inspect.
    // This runs first even for a road stroke: the gesture must be reset here, and
    // `endTouchDrag` commits the stroke on the way through.
    if (pointer.wasTouch) {
      this.touch.end(pointer, outside);
      return;
    }

    // A stroke is committed on release, even off-canvas: the tiles were already
    // painted on screen, so dropping them would read as a lost drag.
    if (this.roadController?.isDrawing) {
      this.roadController.end();
      return;
    }

    // The middle button can be released outside the drag state (e.g. pressed
    // while placing a building), so this is unconditional.
    this.cameraControl.endMiddleDrag();

    if (this.isDragSelecting) {
      this.isDragSelecting = false;
      this.dragSelectionGraphics.clear();

      // Compare in world pixels so the tolerance tracks zoom. Clamped so that
      // zooming all the way out cannot shrink click tolerance to a couple of
      // screen pixels (which would turn steady clicks into accidental box-drags).
      const zoom = this.cameras.main.zoom;
      const screenDistance = Math.hypot(pointer.x - this.dragStartScreen.x, pointer.y - this.dragStartScreen.y);
      const dragDistanceWorld = screenDistance / zoom;
      const threshold = Math.max(CLICK_DRAG_THRESHOLD_WORLD_PX, CLICK_DRAG_MIN_SCREEN_PX / zoom);
      const mods = this.pendingSelectionMods;
      this.pendingSelectionMods = NO_SELECTION_MODS;

      if (dragDistanceWorld > threshold) {
        // Box Selection
        this.selection.handleBoxSelect(
          this.dragStartScreen,
          { x: pointer.x, y: pointer.y },
          mods.additive,
          mods.filter
        );
      } else if (!outside) {
        // Single Click Selection
        this.selection.handleClick(pointer, mods.additive, mods.selectSameType);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API (React HUD, minimap)
  // ---------------------------------------------------------------------------

  public clearSelection() {
    this.selection.clear();
  }

  public stopSelectedUnits() {
    this.commands.stopSelectedUnits();
  }

  public cancelSelectedFoundation(): boolean {
    return this.commands.cancelSelectedFoundation();
  }

  /**
   * UIX-06: does the current unit selection include one of this player's
   * villagers? Scans the whole selection rather than the panel's first unit, so
   * a mixed stack (villagers + spearmen) still exposes the build card.
   */
  public hasVillagerSelected(): boolean {
    // Hotkeys and pointer events can fire a frame before the first state patch,
    // so `units` is read defensively: a throw here would abort the caller.
    const units = this.room?.state?.units;
    if (!units) return false;

    for (const unitId of this.selectedUnitIds) {
      const unit = units.get(unitId);
      if (!unit) continue;
      if (unit.type === 'VILLAGER' && unit.ownerId === this.myOwnerId) return true;
    }
    return false;
  }

  public setBuildingMode(type: BuildingType) {
    // The two tools are mutually exclusive: a click cannot mean both.
    if (this.roadController?.active) this.cancelRoadMode();
    this.placement.enter(type);
  }

  public cancelBuildingPlacement() {
    this.placement.cancel();
  }

  /** Enters the road paint tool. Only meaningful on a kingdom map. */
  public setRoadMode(mode: RoadMode) {
    if (!this.roadController) return;
    if (this.terrainLayout.kind !== 'kingdom') return;
    if (this.buildingToPlace) this.placement.cancel();
    this.roadController.enter(mode);
    this.cursor.refresh();
  }

  public cancelRoadMode() {
    this.roadController?.cancel();
  }

  public get roadMode(): RoadMode | null {
    return this.roadController?.active ?? null;
  }

  public commandMoveTo(gridX: number, gridY: number) {
    this.commands.commandMoveTo(gridX, gridY);
  }

  public cycleToIdleUnit(category: 'villager' | 'military') {
    this.commands.cycleToIdleUnit(category);
  }

  /**
   * UIX-03: recalling a group from the HUD panel is the same action as pressing
   * its digit, including the second-press camera jump.
   */
  public selectControlGroup(index: number) {
    this.commands.recallControlGroup(index);
  }

  public panTo(gridX: number, gridY: number) {
    const screenPos = gridToScreen(gridX, gridY);
    this.cameras.main.pan(screenPos.x, screenPos.y, 350, 'Power2');
  }

  // ---------------------------------------------------------------------------
  // Touch API (MOB-03 / MOB-04 / MOB-05)
  //
  // `TouchController` owns the gestures and calls back into these; React's mobile
  // command bar uses the same methods for its buttons. None of them touch the
  // snapshot: everything ends in an existing `NetworkMessage` sent by the
  // controller that already owned that order.
  // ---------------------------------------------------------------------------

  /**
   * MOB-03: zoom from the command bar's +/- buttons, clamped by the same range the
   * wheel and pinch use.
   */
  public setCameraZoom(zoom: number) {
    this.cameraControl.setZoom(zoom);
  }

  /** One zoom step for the touch bar: `1` in, `-1` out. */
  public zoomByStep(steps: number) {
    this.cameraControl.zoomBySteps(steps);
  }

  /** MOB-05: arm attack-move / patrol, exactly like `A` / `P` on desktop. */
  public armOrder(mode: 'ATTACK_MOVE' | 'PATROL') {
    this.commands.armOrder(mode);
  }

  /** MOB-05: arm the contextual (right-click equivalent) order for the next tap. */
  public armContextualOrder() {
    this.commands.armContextualOrder();
  }

  public cancelArmedOrder() {
    this.commands.cancelPendingOrder();
  }

  /** What the command bar should highlight: an explicit mode, the contextual arm, or none. */
  public get armedOrder(): ArmedOrder | null {
    if (this.commands.pendingOrder) return this.commands.pendingOrder;
    return this.commands.contextualArmed ? 'CONTEXT' : null;
  }

  /**
   * MOB-05: publishes the armed order to React whenever it changes.
   *
   * The command bar owns the arm/cancel buttons, so it has to know when a tap or a
   * committed order cleared the arm; there is no other React-visible signal for it.
   */
  public publishArmedOrder() {
    this.onArmedOrderChange?.(this.armedOrder);
  }

  /** CMB-01: cycle the stance of the selection, the touch `D` key. */
  public cycleSelectedStance() {
    this.commands.cycleSelectedStance();
  }

  /** MOB-05: the touch "Nhà chính" button — the same jump as pressing `H`. */
  public centerOnBase() {
    const townCenter = this.findOwnTownCenter();
    if (!townCenter) return;
    this.panTo(townCenter.gridX + townCenter.sizeX / 2, townCenter.gridY + townCenter.sizeY / 2);
  }

  /**
   * MOB-04: arm a one-shot box selection. Arming replaces interaction with the
   * map for exactly one drag; `TouchController` clears it when that drag ends.
   */
  public setBoxSelectMode(armed: boolean) {
    if (armed === this.boxSelectArmed) return;
    this.boxSelectArmed = armed;
    if (!armed && this.touchBoxActive) {
      this.isDragSelecting = false;
      this.touchBoxActive = false;
      this.dragSelectionGraphics.clear();
    }
    this.onBoxSelectChange?.(this.boxSelectArmed);
  }

  public get isBoxSelectArmed(): boolean {
    return this.boxSelectArmed;
  }

  /**
   * MOB-04: a finger landed. There is no hover on touch, so this is the only
   * chance to show the placement ghost where it will be dropped.
   */
  public touchPressPointer(pointer: Phaser.Input.Pointer) {
    this.touchMode = true;
    // A road tool takes the finger: the press starts a one-tile stroke and a
    // drag extends it, instead of panning the camera.
    if (this.roadController?.active) {
      this.roadController.begin(pointer);
      return;
    }
    if (!this.buildingToPlace) return;

    const grid = pointerWorldGrid(this.cameras.main, pointer);
    this.placement.updateGhost(grid.gridX, grid.gridY);
  }

  /**
   * MOB-04: what a tap does, in priority order.
   *
   * Mirrors the desktop click dispatch (placement, armed order, select, move) with
   * one deliberate difference: an empty-ground tap while units are selected is a
   * move order, because on a phone that is the whole point of tapping the map (D5).
   */
  public touchTapPointer(pointer: Phaser.Input.Pointer) {
    // A tap with the road tool is one tile: `TouchController.begin` already
    // started the stroke on press, so this only commits it. Starting one here
    // would paint the tile under the release instead of the one pressed.
    if (this.roadController?.active) {
      if (this.roadController.isDrawing) this.roadController.end();
      return;
    }

    // A tap in armed box mode is a back-out, not a selection: the player picked a
    // drag mode and tapped instead of dragging.
    if (this.boxSelectArmed) {
      this.setBoxSelectMode(false);
      return;
    }

    if (this.buildingToPlace) {
      this.placement.commit(pointer);
      return;
    }

    if (this.commands.pendingOrder || this.commands.contextualArmed) {
      this.commands.commitPendingOrder(pointer);
      return;
    }

    if (this.selection.hasTargetAt(pointer, TOUCH_PICK_SLACK)) {
      this.selection.handleClick(pointer, false, false, TOUCH_PICK_SLACK);
      return;
    }

    if (this.selectedUnitIds.size > 0) {
      const grid = pointerWorldGrid(this.cameras.main, pointer);
      this.commands.commandMoveTo(grid.gridX, grid.gridY);
      return;
    }

    // Nothing to command: an empty-ground tap still drops a selected building or
    // resource, so the panel does not stay open on a stale selection.
    if (this.selectedBuildingId || this.selectedResourceId) this.selection.clear();
  }

  /**
   * MOB-04: the long-press, i.e. the right-click equivalent.
   *
   * With an order already armed it backs out instead of firing (the same
   * "cancel with the other button" gesture desktop players expect); otherwise it
   * runs the full contextual dispatch, so attack / harvest / travel / rally all
   * behave exactly as a right click would.
   */
  public touchLongPressPointer(pointer: Phaser.Input.Pointer) {
    // A long press while the road tool owns the glass is part of the same
    // stroke: firing a contextual order here would move the army mid-road.
    if (this.roadController?.isDrawing) return;
    if (this.buildingToPlace) return;

    if (this.commands.pendingOrder || this.commands.contextualArmed) {
      this.commands.cancelPendingOrder();
      return;
    }

    this.commands.handleRightClick(pointer, false);
  }

  /**
   * MOB-04: a one-finger drag began.
   *
   * @returns true when the drag paints a box selection (armed from the bar), so
   *   the caller pans the camera only when this is false.
   */
  public beginTouchDrag(pointer: Phaser.Input.Pointer): boolean {
    // The road tool consumes the drag: returning true routes every subsequent
    // pan sample into `updateTouchDrag` instead of the camera.
    if (this.roadController?.active) {
      this.roadController.begin(pointer);
      return true;
    }

    if (!this.boxSelectArmed) return false;

    this.touchBoxActive = true;
    this.isDragSelecting = true;
    // Start at the press point, not at the sample that crossed the threshold: the
    // rectangle must include the tiles the finger already covered.
    this.dragStartScreen = { x: pointer.downX, y: pointer.downY };
    this.dragSelectionGraphics.clear();
    return true;
  }

  public updateTouchDrag(pointer: Phaser.Input.Pointer) {
    if (this.roadController?.isDrawing) {
      this.roadController.drag(pointer);
      return;
    }
    if (!this.touchBoxActive) return;
    this.drawDragBox({ x: pointer.x, y: pointer.y });
  }

  /** MOB-04: finishes the armed box selection and disarms the mode (one shot). */
  public endTouchDrag(pointer: Phaser.Input.Pointer) {
    if (this.roadController?.isDrawing) {
      this.roadController.end();
      return;
    }
    if (!this.touchBoxActive) return;

    this.touchBoxActive = false;
    this.isDragSelecting = false;
    this.dragSelectionGraphics.clear();
    this.selection.handleBoxSelect(this.dragStartScreen, { x: pointer.x, y: pointer.y }, false, 'all');
    // One shot by design: leaving it armed would make the next pan paint a box.
    this.setBoxSelectMode(false);
  }

  /** MOB-04: a pinch took over, so the half-drawn rectangle is dropped unseen. */
  public cancelTouchDrag() {
    // A pinch is a camera gesture: it drops the half-drawn stroke unseen, the
    // same way it drops a box selection.
    if (this.roadController?.isDrawing) this.roadController.abort();
    if (!this.touchBoxActive) return;
    this.touchBoxActive = false;
    this.isDragSelecting = false;
    this.dragSelectionGraphics.clear();
    // D9: a pinch is a camera gesture, so the armed mode does not survive it.
    this.setBoxSelectMode(false);
  }

  // The old camera wrappers (`zoomTo`, `zoomBySteps`, `saveCameraBookmark`,
  // `recallCameraBookmark`) were pass-throughs to `cameraControl`; removed so
  // there is one handle, not two layers claiming ownership of the zoom range.

  /**
   * Publishes the current selection to React and lets the cursor follow it.
   *
   * An armed order belongs to the units selected when it was given. Once they
   * are all gone (killed, or replaced by a building) the next click would be
   * swallowed with nothing to command, so the order is dropped first.
   */
  public notifySelectionChange() {
    if (this.selectedUnitIds.size === 0) this.commands.cancelPendingOrder();

    // UIX-06: one scan answers both the placement guard below and the payload
    // React receives, so the two can never disagree.
    const villagerSelected = this.hasVillagerSelected();

    // UIX-06: a placement belongs to the villager that started it. The card
    // survives the selection being kept, so the only way to reach this state is
    // that villager dying (or being dropped from the selection) while the ghost
    // is out. Left alone the ghost follows the cursor with nothing able to build.
    if (this.buildingToPlace && !villagerSelected) this.placement.cancel();

    // Selection fingerprints the cursor (harvest needs an all-villager selection,
    // attack needs units), so recompute even when no React callback is wired.
    this.cursor.refresh();

    if (!this.onSelectionChange) return;

    if (this.selectedUnitIds.size > 0) {
      const firstId = Array.from(this.selectedUnitIds)[0];
      const unit = this.room?.state?.units.get(firstId);
      if (unit) {
        this.onSelectionChange({
          id: firstId,
          type: 'unit',
          name: `${unit.type} (${this.selectedUnitIds.size})`,
          subType: unit.type,
          hp: unit.hp,
          maxHp: unit.maxHp,
          level: unit.level,
          maxLevel: MAX_UNIT_LEVEL,
          isOwner: unit.ownerId === this.myOwnerId,
          carryingAmount: unit.carryingAmount,
          carryingResourceType: unit.carryingResourceType,
          stance: unit.stance,
          villagerSelected
        });
        return;
      }
    }

    if (this.selectedBuildingId) {
      const b = this.room?.state?.buildings.get(this.selectedBuildingId);
      if (b) {
        const bp = BUILDING_BLUEPRINTS[b.type as BuildingType];
        const tier = buildingTierInfo(b.type as BuildingType, b.level, (key) =>
          this.textures.exists(key)
        );
        this.onSelectionChange({
          id: this.selectedBuildingId,
          type: 'building',
          name: bp ? bp.name : b.type,
          subType: b.type,
          hp: b.hp,
          maxHp: b.maxHp,
          level: b.level,
          maxLevel: getBuildingMaxLevel(b.type as BuildingType),
          visualTier: tier.tier,
          visualTierCount: tier.count,
          visualTierName: tier.name,
          nextVisualTierLevel: tier.nextLevel,
          upgradeProgressMs: b.upgradeProgressMs,
          upgradeTimeMs: b.upgradeTimeMs,
          ...(b.ownerId === this.myOwnerId
            ? {
                ...this.playerResearchDetails(b.ownerId),
                ...this.upgradeContext(b.ownerId)
              }
            : {}),
          isOwner: b.ownerId === this.myOwnerId,
          isPortal: b.type === 'PORTAL',
          trainingQueue: Array.from(b.trainingQueue),
          isConstructed: b.isConstructed,
          constructionProgress: b.constructionProgress,
          // ECO-01: what is left to gather from a farm, shown with the same
          // "remaining / max" block a resource node uses.
          remainingAmount: b.resourceCapacity > 0 ? b.resourceAmount : undefined,
          maxAmount: b.resourceCapacity > 0 ? b.resourceCapacity : undefined
        });
        return;
      }
    }

    if (this.selectedResourceId) {
      const res = this.room?.state?.resourceNodes.get(this.selectedResourceId);
      if (res) {
        this.onSelectionChange({
          id: this.selectedResourceId,
          type: 'resource',
          name: `${res.resourceType.toUpperCase()} Node`,
          subType: res.type,
          remainingAmount: res.remainingAmount,
          maxAmount: res.maxAmount
        });
        return;
      }
    }

    this.onSelectionChange(null);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  update(time: number, delta: number) {
    if (this.worldFrozen) return;

    // Spread the ~1.3k resource containers over frames instead of one long
    // synchronous burst right after a map switch.
    this.flushResourceSpawns();

    if (this.roadsDirty) {
      this.roadsDirty = false;
      this.refreshPlayerRoads();
    }

    this.terrain.render();
    this.decor.render();
    this.decor.update(time);

    // Fallback: keep trying to focus this player's Town Center until the snapshot
    // (or a delayed ownership sync) exposes it. Bounded so it stops after ~5s.
    if (!this.hasCenteredOnSpawn) {
      this.retryCenterOnBase();
    }

    const dtSeconds = delta / 1000;
    const cameraSpeed = (600 / this.cameras.main.zoom) * dtSeconds;

    // Pan camera via arrow keys and screen edges. WASD is deliberately unused
    // because W/A/S/D double as build hotkeys in App.tsx.
    if (this.cursors.left.isDown) this.cameras.main.scrollX -= cameraSpeed;
    if (this.cursors.right.isDown) this.cameras.main.scrollX += cameraSpeed;
    if (this.cursors.up.isDown) this.cameras.main.scrollY -= cameraSpeed;
    if (this.cursors.down.isDown) this.cameras.main.scrollY += cameraSpeed;

    applyEdgeScroll({
      camera: this.cameras.main,
      pointer: this.input.activePointer,
      viewWidth: this.scale.width,
      viewHeight: this.scale.height,
      pointerInsideCanvas: this.pointerInsideCanvas,
      cameraSpeed,
      // MOB-03: a finger has no "parked at the edge" state — it lifts and leaves
      // `activePointer` there — so touch pans by dragging and never edge-scrolls.
      enabled: !this.touchMode
    });

    // MOB-02: long-press needs the clock advancing, not another event.
    this.touch.tick(time);

    this.commands.updateWaypointPreview();
    this.commands.updateRallyMarkers();
    this.roadController?.render();

    this.updateUnitSprites(time, dtSeconds);

    // CMB-03 after the lerp: the marker is drawn on the sprite's current screen
    // position, so reading it before interpolation would leave the ring one
    // frame behind a moving target.
    this.focus.render();

    this.syncSelectedUnitDetails();
    this.syncSelectedBuildingDetails();
    this.publishIdleVillagerCount(time);
  }

  /**
   * MOV-01: draw every unit at the authoritative position interpolated one
   * snapshot behind wall-clock time.
   *
   * The server steps 20 times a second, so a replicated position jumps by ~0.11
   * tiles every 50 ms; drawing that directly stutters, and chasing the newest
   * sample with a per-frame lerp made the smoothness depend on the machine's frame
   * rate. The rule itself lives in `UnitMotion`; this loop only projects and
   * paints it.
   */
  private updateUnitSprites(time: number, dtSeconds: number) {
    const renderTime = time - RENDER_DELAY_MS;
    this.unitMotion.forEach((motion, unitId) => {
      const container = this.unitSprites.get(unitId);
      const unit = this.room?.state?.units.get(unitId);
      if (!container || !unit) return;

      // Sampled once per frame from the snapshot rather than from per-property
      // change callbacks: a patch that touches x and y fires those separately, so
      // a callback can observe a half-updated position.
      const step = motion.update(unit.x, unit.y, time, renderTime, dtSeconds);

      // Inline isometric projection: `gridToScreen` allocates an object, and this
      // runs for every unit on every frame.
      container.x = (step.x - step.y) * HALF_TILE_WIDTH;
      container.y = (step.x + step.y) * HALF_TILE_HEIGHT;

      // Assigning `depth` queues a display-list sort in Phaser even when the value
      // is unchanged, and parked units keep the same depth frame after frame, so
      // only touch it when it actually moves.
      const depth = getIsoDepth(step.x, step.y, 25);
      if (container.depth !== depth) container.setDepth(depth);

      const unitDisplay = container.getData('unitDisplay') as
        | Phaser.GameObjects.Sprite
        | Phaser.GameObjects.Image;
      if (!unitDisplay) return;

      if (container.getData('hasDirectionalSheet') === true) {
        unitDisplay.setFlipX(false);
      } else {
        // Single-facing art has no rows to pick from, so it is mirrored instead.
        unitDisplay.setFlipX(Math.cos(step.heading) < 0);
      }
      if (container.getData('facingDirection') !== step.facing) {
        container.setData('facingDirection', step.facing);
      }

      // Drive animation from the unit's own type/action state. Never hardcode a
      // key here: `updateVisualState` knows `${type}_walk|idle|attack|harvest`.
      const updateVisualState = container.getData('updateVisualState') as
        | ((actionState: string, direction?: number, speed?: number) => void)
        | undefined;
      if (updateVisualState) {
        // While the sprite is gliding it is walking, whatever the server has
        // already moved on to (arrival, harvest, build).
        const effectiveState = step.gliding ? 'MOVING' : unit.actionState;
        updateVisualState(effectiveState, step.facing, unit.speed);
      }
    });
  }

  /**
   * ECO-02: publishes this player's idle-villager count when it changes.
   *
   * Only a bare `IDLE` villager counts: one walking home, harvesting or building
   * is working, and flagging it would make the number impossible to clear. The
   * scan is throttled (see `IDLE_VILLAGER_SCAN_MS`) and the callback only fires
   * on an actual change, so React does not re-render four times a second on a
   * steady number.
   */
  private publishIdleVillagerCount(time: number) {
    if (!this.onIdleVillagersChange || !this.room) return;
    if (time < this.nextIdleVillagerScanAt) return;
    this.nextIdleVillagerScanAt = time + IDLE_VILLAGER_SCAN_MS;

    let count = 0;
    this.room?.state?.units?.forEach((unit: any) => {
      if (unit.type !== 'VILLAGER') return;
      if (unit.actionState !== 'IDLE') return;
      if (!this.isOwnBuilding(unit.ownerId)) return;
      count++;
    });

    if (count === this.lastIdleVillagerCount) return;
    this.lastIdleVillagerCount = count;
    this.onIdleVillagersChange(count);
  }

  /**
   * LVL: research lives on `PlayerState`, so the selected-building panel needs
   * its own live signature. Building `onChange` covers level/HP, but it never
   * fires while a player-wide research ticks, and the panel would freeze.
   */
  private syncSelectedBuildingDetails() {
    if (!this.selectedBuildingId) return;

    const building = this.room?.state?.buildings?.get(this.selectedBuildingId);
    if (!building) return;

    // Only the owner's research drives the panel; reading a foreign player's
    // timer would republish the panel on every tick for no visible change.
    const owned = building.ownerId === this.myOwnerId;
    const player = owned
      ? this.room?.state?.players?.get(building.ownerId)
      : undefined;
    // LVL2: the gate rows and the slot counter follow the whole empire, so a
    // core building leveling up (or another upgrade starting) must republish the
    // panel even though the selected building itself did not change.
    const context = owned ? this.upgradeContext(building.ownerId) : undefined;
    const signature = [
      building.hp,
      building.maxHp,
      building.level,
      building.upgradeProgressMs,
      building.upgradeTimeMs,
      building.constructionProgress,
      building.trainingQueue.length,
      player?.researchUnitType ?? '',
      player?.researchProgressMs ?? 0,
      player?.researchTimeMs ?? 0,
      context
        ? CORE_BUILDING_TYPES.map((type) => context.coreLevels?.[type] ?? 0).join(',')
        : '',
      context?.activeUpgrades ?? 0
    ].join('|');

    if (signature === this.lastBuildingDetailSignature) return;

    this.lastBuildingDetailSignature = signature;
    this.notifySelectionChange();
  }

  private playerResearchDetails(ownerId: string): Pick<
    SelectedEntityData,
    'unitLevels' | 'researchUnitType' | 'researchProgressMs' | 'researchTimeMs'
  > {
    const player = this.room?.state?.players?.get(ownerId);
    return {
      unitLevels: player?.unitLevels
        ? Array.from(player.unitLevels as ArrayLike<number>)
        : undefined,
      researchUnitType: player?.researchUnitType ?? '',
      researchProgressMs: player?.researchProgressMs ?? 0,
      researchTimeMs: player?.researchTimeMs ?? 0
    };
  }

  /**
   * LVL2: looks at the whole empire, not one building.
   *
   * The Town Center gate is a condition on four other buildings, and the slot
   * limit counts every upgrade the player has running, so both are aggregated
   * here and published with whichever owned building is selected. Foundations
   * are skipped for the gate — they are not a level yet — but still hold a slot
   * if their (impossible) timer is set, which keeps the panel honest about what
   * the server counts.
   */
  private upgradeContext(
    ownerId: string
  ): Pick<SelectedEntityData, 'coreLevels' | 'activeUpgrades'> {
    const coreLevels: Partial<Record<BuildingType, number>> = {};
    let activeUpgrades = 0;

    this.room?.state?.buildings?.forEach((b: any) => {
      if (b.ownerId !== ownerId) return;
      if (b.upgradeTimeMs > 0) activeUpgrades += 1;
      if (!b.isConstructed) return;

      const type = b.type as BuildingType;
      if (!CORE_BUILDING_TYPES.includes(type)) return;
      coreLevels[type] = Math.max(coreLevels[type] ?? 0, b.level);
    });

    return { coreLevels, activeUpgrades };
  }

  /**
   * Re-publishes the entity panel while a single unit is selected and something
   * the panel shows has changed (hp, the load it is hauling, its action).
   *
   * The panel used to be published on selection changes only, so a villager's
   * `carryingAmount` and a unit's hp went stale the moment they moved. The
   * signature keeps the React update to actual value changes instead of one
   * render per frame.
   */
  private syncSelectedUnitDetails() {
    if (this.selectedUnitIds.size !== 1) return;

    const unitId = Array.from(this.selectedUnitIds)[0];
    const unit = this.room?.state?.units.get(unitId);
    if (!unit) return;

    const signature = `${unit.hp}|${unit.maxHp}|${unit.level}|${unit.carryingAmount}|${unit.carryingResourceType}|${unit.actionState}|${unit.stance}`;
    if (signature === this.lastUnitDetailSignature) return;

    this.lastUnitDetailSignature = signature;
    this.notifySelectionChange();
  }
}
