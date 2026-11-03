import * as Phaser from 'phaser';
import { Room } from '@colyseus/sdk';
import { Callbacks } from '@colyseus/schema';
import {
  BUILDING_BLUEPRINTS,
  BuildingType,
  MAP_GRID_HEIGHT,
  MAP_GRID_WIDTH,
  MAX_UNIT_LEVEL,
  TILE_HEIGHT,
  TILE_WIDTH,
  getBuildingMaxLevel,
  getIsoDepth,
  gridToScreen,
  screenToGrid
} from '@chien-quoc/shared';
import { generateProceduralTextures } from '../renderers/ProceduralSprites.js';
import { CommandController } from '../input/CommandController.js';
import { CursorController } from '../input/CursorController.js';
import { PlacementController } from '../input/PlacementController.js';
import { SelectionController } from '../input/SelectionController.js';
import type { BoxSelectFilter } from '../input/SelectionController.js';
import { applyEdgeScroll, installCanvasPresence } from '../input/cameraInput.js';
import { CameraController, ZOOM_MIN } from '../input/CameraController.js';
import { installHudPointerGuard } from '../input/hudPointerGuard.js';
import { EntityRenderer } from '../render/EntityRenderer.js';
import { FocusIndicator } from '../render/FocusIndicator.js';
import { TerrainLayer } from '../render/TerrainLayer.js';
import { OwnerColorRegistry, colorToCss } from '../render/ownerColor.js';
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
  /** LVL: player-wide research levels, indexed by UNIT_UPGRADE_ORDER. */
  unitLevels?: number[];
  researchUnitType?: string;
  researchProgressMs?: number;
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
   * ECO-02: published whenever the number of this player's idle villagers
   * changes, so the HUD can show the AoE idle-counter without scanning state.
   */
  public onIdleVillagersChange: ((count: number) => void) | null = null;
  /**
   * UIX-03: published whenever the `Ctrl+1..9` rosters change (assign, recall,
   * a member dying), so the right-hand group panel mirrors the real groups.
   */
  public onControlGroupsChange: ((groups: ControlGroupSummary[]) => void) | null = null;
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
  public commands!: CommandController;
  public entityRenderer!: EntityRenderer;
  public terrain!: TerrainLayer;
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
    // v=4: OpenGameArt pass (barracks, house, town centre, lumber camp). Bump the
    // key whenever a PNG under public/assets/buildings or /resources changes.
    const v = 'v=4';
    this.load.image('building_TOWN_CENTER', `/assets/buildings/town_center.png?${v}`);
    this.load.image('building_BARRACKS', `/assets/buildings/barracks.png?${v}`);
    this.load.image('building_HOUSE', `/assets/buildings/house.png?${v}`);
    this.load.image('building_FARM', `/assets/buildings/farm.png?${v}`);
    this.load.image('building_TOWER', `/assets/buildings/tower.png?${v}`);
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
    const tv = 'v=7';
    this.load.image('tile_grass_1', `/assets/terrain/grass_1.png?${tv}`);
    this.load.image('tile_grass_2', `/assets/terrain/grass_2.png?${tv}`);
    this.load.image('tile_grass_3', `/assets/terrain/grass_3.png?${tv}`);
    this.load.image('tile_grass', `/assets/terrain/grass.png?${tv}`);

    // Preload Age of Empires 2 Dirt Road Terrain textures & organic road stamps
    this.load.image('tile_dirt_1', `/assets/terrain/dirt_1.png?${tv}`);
    this.load.image('tile_dirt_2', `/assets/terrain/dirt_2.png?${tv}`);
    this.load.image('tile_dirt_3', `/assets/terrain/dirt_3.png?${tv}`);
    this.load.image('tile_dirt', `/assets/terrain/dirt.png?${tv}`);
    this.load.image('road_stamp', `/assets/terrain/road_stamp.png?${tv}`);
    this.load.image('road_stamp_1', `/assets/terrain/road_stamp_1.png?${tv}`);
    this.load.image('road_stamp_2', `/assets/terrain/road_stamp_2.png?${tv}`);
    this.load.image('road_stamp_3', `/assets/terrain/road_stamp_3.png?${tv}`);
  }

  create() {
    // Disable right click context menu in browser
    this.input.mouse?.disableContextMenu();

    // Natural AoE grass background clear color (eliminates any sub-pixel black seam line)
    this.cameras.main.setBackgroundColor('#58752d');

    // Register unit animations if spritesheets are loaded
    this.entityRenderer = new EntityRenderer(this);
    this.entityRenderer.initUnitAnimations();

    // 1. Terrain: pre-allocated tile and road-stamp pools, rendered per viewport
    // across a 220x220 map.
    this.terrain = new TerrainLayer(this);
    this.terrain.create();

    // 2. Building placement ghost
    this.placement = new PlacementController(this);
    this.placement.create();

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
    const center = gridToScreen(MAP_GRID_WIDTH / 2, MAP_GRID_HEIGHT / 2);
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
        } else if (this.commands.pendingOrder) {
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

    // OWN-05: the cache belongs to the previous Room's snapshot. A reconnect may
    // restore a different profile colour, so re-resolve before repainting.
    this.ownerColorRegistry.invalidateAll();

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

  /** Freezes the last rendered frame while a travel swaps rooms. */
  public pauseWorld() {
    this.worldFrozen = true;
  }

  public resumeWorld() {
    this.worldFrozen = false;
  }

  /** Default view for a map with no known anchor yet: the whole terrain. */
  private centerCameraOnMap() {
    const center = gridToScreen(MAP_GRID_WIDTH / 2, MAP_GRID_HEIGHT / 2);
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
    this.cameraControl?.resetBookmarks();
    // The pool is repositioned only when the viewport moves; a new map can start
    // at a very different corner, so force the next frame to repaint it.
    this.terrain?.invalidateViewport();

    this.hasCenteredOnSpawn = false;
    this.centerAttempts = 0;
    this.cachedOwnerId = '';
    this.ownerColorRegistry.invalidateAll();

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

  public bindRoomEvents(room: Room) {
    // Called from create(), setRoom() and PhaserGame effects; binding the same
    // Room twice would register duplicate schema callbacks (duplicate sprites).
    if (this.eventsBoundRoom === room) return;
    this.eventsBoundRoom = room;

    const cb = Callbacks.get(room);
    this.roomCallbacks = cb;
    this.pendingResources = [];
    this.pendingResourceKeys.clear();

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
    });

    // 2. Synchronize Buildings
    cb.onAdd('buildings', (building: any, key: any) => {
      if (this.buildingSprites.has(key)) return;
      this.entityRenderer.createBuildingSprite(key, building, cb);
      this.centerOnOwnBaseIfNeeded();
    });

    cb.onRemove('buildings', (building: any, key: any) => {
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

    // Placement ghost follows the pointer while the mode is active
    this.placement.updateGhost(hoverGridCoord.gridX, hoverGridCoord.gridY);

    // Drag selection rendering
    if (this.isDragSelecting) {
      this.dragSelectionGraphics.clear();
      this.dragSelectionGraphics.lineStyle(1.5, 0x38bdf8, 1);
      this.dragSelectionGraphics.fillStyle(0x0284c7, 0.2);

      const start = this.dragStartScreen;
      const current = { x: pointer.x, y: pointer.y };

      const minX = Math.min(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const width = Math.abs(current.x - start.x);
      const height = Math.abs(current.y - start.y);

      // Draw in camera-fixed screen space
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

    this.cursor.refresh();
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer) {
    const native = pointer.event as MouseEvent | undefined;
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
    if (
      this.commands.pendingOrder &&
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
      } else if (this.commands.pendingOrder) {
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
        this.placement.commit(pointer);
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
    this.placement.enter(type);
  }

  public cancelBuildingPlacement() {
    this.placement.cancel();
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
        this.onSelectionChange({
          id: this.selectedBuildingId,
          type: 'building',
          name: bp ? bp.name : b.type,
          subType: b.type,
          hp: b.hp,
          maxHp: b.maxHp,
          level: b.level,
          maxLevel: getBuildingMaxLevel(b.type as BuildingType),
          upgradeProgressMs: b.upgradeProgressMs,
          upgradeTimeMs: b.upgradeTimeMs,
          ...(b.ownerId === this.myOwnerId ? this.playerResearchDetails(b.ownerId) : {}),
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

    this.terrain.render();

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
      cameraSpeed
    });

    this.commands.updateWaypointPreview();
    this.commands.updateRallyMarkers();

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
    const player =
      building.ownerId === this.myOwnerId
        ? this.room?.state?.players?.get(building.ownerId)
        : undefined;
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
      player?.researchTimeMs ?? 0
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
