import React, { useState, useEffect, useRef } from 'react';
import { Client, Room } from '@colyseus/sdk';
import { Callbacks } from '@colyseus/schema';
import * as Phaser from 'phaser';
import {
  BuildingType,
  INITIAL_PLAYER_RESOURCES,
  INITIAL_POPULATION_CAP,
  MapZoneKind,
  NetworkMessage,
  Resources,
  SESSION_REPLACED_CLOSE,
  TravelReadyPayload,
  UnitType
} from '@chien-quoc/shared';
import {
  WorldScene,
  SelectedEntityData,
  ControlGroupSummary,
  type ArmedOrder
} from './game/scenes/WorldScene.js';
import { PhaserGame } from './game/PhaserGame.js';
import { HUD } from './components/HUD.js';
import { BuildMenu } from './components/BuildMenu.js';
import { EntityDetails } from './components/EntityDetails.js';
import { Minimap } from './components/Minimap.js';
import { ControlGroups } from './components/ControlGroups.js';
import { AuthScreen } from './components/AuthScreen.js';
import { SessionBlocked } from './components/SessionBlocked.js';
import { OrientationGate } from './components/mobile/OrientationGate.js';
import { MobileCommandBar } from './components/mobile/MobileCommandBar.js';
import { useInputMode, useIsPortrait } from './device/useInputMode.js';
import { RESUME_ATTEMPTS, RESUME_RETRY_DELAY_MS, shouldAutoReconnect } from './device/resume.js';
import {
  AuthUser,
  classifySessionJoinError,
  clearStoredToken,
  fetchCurrentUser,
  getServerUrl,
  getStoredToken,
  isAuthRejection
} from './auth/api.js';
import { AlertCircle } from 'lucide-react';
import { playUnderAttackAlert } from './game/audio/alertSound.js';

const LAST_ZONE_PREFIX = 'cq_last_zone';

function lastZoneKey(userId: string): string {
  return `${LAST_ZONE_PREFIX}:${userId}`;
}

/** Where this account was last playing; a refresh rejoins the same map. */
function getStoredZone(userId: string): MapZoneKind {
  try {
    return localStorage.getItem(lastZoneKey(userId)) === 'battlefield'
      ? 'battlefield'
      : 'kingdom';
  } catch {
    return 'kingdom';
  }
}

function storeZone(userId: string, zone: MapZoneKind): void {
  try {
    localStorage.setItem(lastZoneKey(userId), zone);
  } catch {
    // Private-mode storage failures only cost the refresh convenience.
  }
}

export const App: React.FC = () => {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isJoined, setIsJoined] = useState<boolean>(false);
  /** Which map the live room simulates; drives labels and the portal button. */
  const [zoneKind, setZoneKind] = useState<MapZoneKind>('kingdom');
  /** MAPS: a travel ack is being applied (leave + join the other room). */
  const [isSwitchingZone, setIsSwitchingZone] = useState<boolean>(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  /** SESS-06: the account is in use elsewhere, or another device took it over. */
  const [sessionTaken, setSessionTaken] = useState<boolean>(false);
  const playerName = authUser?.displayName ?? '';

  /** MOB-01: `'touch'` swaps the desktop HUD for the compact mobile one. */
  const inputMode = useInputMode();
  const isCompact = inputMode === 'touch';
  /** MOB-02: a touch device held upright shows the rotate overlay. */
  const isPortrait = useIsPortrait();
  const showOrientationGate = isCompact && isPortrait;

  // Player state
  const [playerColor, setPlayerColor] = useState<string>('#3b82f6');
  const [resources, setResources] = useState<Resources>(INITIAL_PLAYER_RESOURCES);
  const [population, setPopulation] = useState<number>(0);
  const [populationCap, setPopulationCap] = useState<number>(INITIAL_POPULATION_CAP);
  /** ECO-02: idle villagers, published by the scene when the count changes. */
  const [idleVillagers, setIdleVillagers] = useState<number>(0);
  /** UIX-03: `Ctrl+1..9` rosters, published by the scene on every change. */
  const [controlGroups, setControlGroups] = useState<ControlGroupSummary[]>([]);
  /** MOB-05: which order the touch bar has armed, mirrored from the scene. */
  const [armedOrder, setArmedOrder] = useState<ArmedOrder | null>(null);
  /** MOB-04: the touch box-selection mode is armed for the next drag. */
  const [boxSelectArmed, setBoxSelectArmed] = useState<boolean>(false);

  // Selection & Placement
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityData | null>(null);
  const [activeBuildingType, setActiveBuildingType] = useState<BuildingType | null>(null);

  // Notifications
  const [notification, setNotification] = useState<string | null>(null);
  // ATK-05: under-attack banner state.
  const [underAttack, setUnderAttack] = useState<boolean>(false);
  const underAttackTimerRef = useRef<number | null>(null);

  // References
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  // Distinguishes an intentional logout from a dropped connection, so logging
  // out does not show a "lost connection" banner.
  const isLeavingRef = useRef<boolean>(false);
  /**
   * One SDK client for the whole session. Travel leaves one room and joins the
   * other, and creating a fresh client each time would throw away the auth
   * token plumbing that is already set up.
   */
  const clientRef = useRef<Client | null>(null);
  const roomRef = useRef<Room | null>(null);
  /** True while a travel ack is being applied; suppresses the leave banner. */
  const switchingRef = useRef<boolean>(false);
  /** The ack being applied, kept so a failed switch can be retried. */
  const pendingTravelRef = useRef<TravelReadyPayload | null>(null);
  /** MOB-08: one resume join at a time; two sockets for one account is a conflict. */
  const resumingRef = useRef(false);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification((curr) => (curr === msg ? null : curr));
    }, 3500);
  };

  const triggerUnderAttack = () => {
    setUnderAttack(true);
    playUnderAttackAlert();
    if (underAttackTimerRef.current !== null) window.clearTimeout(underAttackTimerRef.current);
    underAttackTimerRef.current = window.setTimeout(() => setUnderAttack(false), 4000);
  };

  // Cleanup the under-attack timer on unmount.
  useEffect(() => {
    return () => {
      if (underAttackTimerRef.current !== null) window.clearTimeout(underAttackTimerRef.current);
    };
  }, []);

  // Dev-only handle, like `__worldScene`, so browser checks can inspect the
  // active room through a map switch.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __room?: Room | null }).__room = room;
  }, [room]);

  // Restore a previous session on load so a refresh drops straight back in.
  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((user) => {
        if (cancelled || !user) return;
        setAuthUser(user);
        // Session is still valid: go straight back to the map they were on.
        void connectToZone(user, { zone: getStoredZone(user.id) });
      })
      .finally(() => {
        if (!cancelled) setIsRestoringSession(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Joins one map's room.
   *
   * A kingdom room is addressed by `ownerId` (the server filters its matchmaker
   * cache by it and re-validates it against the token); the battlefield is one
   * shared room. Returns false instead of throwing so a travel switch can retry
   * without unwinding its own overlay.
   */
  const connectToZone = async (
    user: AuthUser,
    opts: {
      zone?: MapZoneKind;
      force?: boolean;
      attempt?: number;
      quiet?: boolean;
      /**
       * MOB-08: how many times a "session in use" refusal is retried before the
       * takeover screen appears. A phone coming back from a lock screen races the
       * server's release of the socket it just lost, and that is not a conflict.
       */
      tolerateTakenAttempts?: number;
    } = {}
  ): Promise<boolean> => {
    const token = getStoredToken();
    if (!token) {
      setAuthUser(null);
      if (!opts.quiet) showNotification('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      return false;
    }

    const zone = opts.zone ?? getStoredZone(user.id);
    setIsJoining(true);
    try {
      const client = clientRef.current ?? new Client(getServerUrl());
      clientRef.current = client;
      // Sent as `_authToken` on the room socket; the room's `onAuth` verifies it.
      client.auth.token = token;

      const roomName = zone === 'kingdom' ? 'kingdom_room' : 'battlefield_room';
      // SESS-06/D2: `force` is only ever true after the player pressed the
      // takeover button, never as an automatic retry.
      const options =
        zone === 'kingdom'
          ? { ownerId: user.id, force: opts.force === true }
          : { force: opts.force === true };

      const joinedRoom = await client.joinOrCreate(roomName, options);

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setIsConnected(true);
      setIsJoined(true);
      setSessionTaken(false);
      setZoneKind(zone);
      storeZone(user.id, zone);

      // Listen to room error messages
      joinedRoom.onMessage(NetworkMessage.ERROR_NOTIFICATION, (data: { message: string }) => {
        showNotification(data.message);
      });

      // A travel ack is the only signal that the server already moved the units
      // to SQLite, so the room may only be left now.
      joinedRoom.onMessage(NetworkMessage.TRAVEL_READY, (data: TravelReadyPayload) => {
        pendingTravelRef.current = data;
        void switchZone(data, user);
      });

      const cb = Callbacks.get(joinedRoom);

      // Listen to player state
      cb.onAdd('players', (p: any) => {
        if (p.name === user.displayName) {
          setPlayerColor(p.color);
          setResources({ wood: p.wood, food: p.food, gold: p.gold, stone: p.stone });
          setPopulation(p.population);
          setPopulationCap(p.populationCap);

          cb.onChange(p, () => {
            setResources({ wood: p.wood, food: p.food, gold: p.gold, stone: p.stone });
            setPopulation(p.population);
            setPopulationCap(p.populationCap);
          });
        }
      });

      joinedRoom.onLeave((code) => {
        // A leave from a room this session no longer owns (the one we just
        // switched away from) must not tear down the new one.
        if (roomRef.current !== joinedRoom) return;
        if (switchingRef.current) return;

        setIsConnected(false);
        setIsJoined(false);
        setRoom(null);
        roomRef.current = null;

        if (code === SESSION_REPLACED_CLOSE) {
          setSessionTaken(true);
          showNotification('Phiên đã được đăng nhập ở thiết bị khác.');
          return;
        }
        if (isLeavingRef.current) {
          isLeavingRef.current = false;
          return;
        }
        showNotification('Mất kết nối với máy chủ.');
      });

      return true;
    } catch (err: any) {
      console.error('Failed to connect to game server:', err);

      const retry = opts.attempt ?? 0;

      // SESS-06: a refused join is a session conflict, not an auth or network
      // failure, so it must not clear the token or show the generic banner.
      const sessionError = classifySessionJoinError(err);
      if (sessionError === 'taken') {
        if (retry < (opts.tolerateTakenAttempts ?? 0)) {
          await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_DELAY_MS));
          return connectToZone(user, { ...opts, attempt: retry + 1 });
        }
        setSessionTaken(true);
        return false;
      }
      if (sessionError === 'busy' && retry < 3) {
        // Another join for this account is still in flight; retry quietly
        // instead of showing the blocked screen for a millisecond conflict.
        await new Promise((resolve) => setTimeout(resolve, 500));
        return connectToZone(user, { ...opts, attempt: retry + 1 });
      }

      if (isAuthRejection(err)) {
        clearStoredToken();
        setAuthUser(null);
        if (!opts.quiet) {
          showNotification('Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.');
        }
      } else if (!opts.quiet) {
        showNotification(
          'Không thể kết nối đến máy chủ game. Hãy kiểm tra server đã chạy ở port 2567!'
        );
      }
      return false;
    } finally {
      setIsJoining(false);
    }
  };

  /**
   * Applies a travel ack: leave the current room (the server has already saved
   * the remaining state by the time `leave()` resolves), then join the target
   * map. Units are safe in `travel_transfers` between the two steps, so a failed
   * join can be retried without losing them.
   */
  const switchZone = async (travel: TravelReadyPayload, user: AuthUser) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIsSwitchingZone(true);
    setSwitchError(null);
    // Freeze the old map instead of clearing it; the user keeps seeing the
    // battlefield/kingdom they clicked from while the destination syncs.
    sceneRef.current?.pauseWorld();

    try {
      const current = roomRef.current;
      if (current) {
        // Do not wait for the old room to finish leaving. The travel commit has
        // already persisted the units and the account row, and the destination
        // join carries the hand-off token, so it can take the account over
        // immediately. Waiting here used to keep the dark switch overlay up for
        // as long as the server's save queue was busy (often ~15s).
        void current.leave().catch((err) => {
          console.warn('[MAPS] Old room leave failed; the hand-off join continues.', err);
        });
      }
      roomRef.current = null;
      // Keep the old Room bound (and its last frame paused) until the new room
      // arrives. Detaching it immediately was what left a blank/dark canvas for
      // the whole join.

      let joined = false;
      for (let attempt = 0; attempt < 3 && !joined; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
        joined = await connectToZone(user, { zone: travel.destination, quiet: true });
      }

      if (joined) {
        pendingTravelRef.current = null;
      } else {
        setRoom(null);
        setIsJoined(false);
        setIsConnected(false);
        setSwitchError(
          'Không thể vào bản đồ đích. Quân của bạn đang chờ ở cổng; hãy thử lại.'
        );
      }
    } catch (err) {
      console.error('Failed to switch maps:', err);
      setRoom(null);
      setSwitchError('Không thể chuyển bản đồ. Vui lòng thử lại.');
    } finally {
      // On success `setRoom(newRoom)` already resumed; this also restores the
      // canvas behind the error overlay when the join failed.
      sceneRef.current?.resumeWorld();
      setIsSwitchingZone(false);
      switchingRef.current = false;
    }
  };

  /** Retries the pending travel join without re-sending TRAVEL. */
  const retrySwitchZone = () => {
    const travel = pendingTravelRef.current;
    if (!travel || !authUser || switchingRef.current) return;
    void switchZone(travel, authUser);
  };

  /**
   * MOB-08: rejoin after the app comes back to the foreground.
   *
   * A locked phone suspends the socket, the server releases the account session and
   * the tab is left with no room. Rejoining quietly turns that into "the game
   * paused"; `tolerateTakenAttempts` covers the race where the server has not yet
   * processed the old socket's close.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      const visible = !document.hidden;
      if (!authUser || resumingRef.current) return;

      const shouldReconnect = shouldAutoReconnect({
        hasUser: true,
        isJoined,
        isJoining,
        sessionTaken,
        isLeaving: isLeavingRef.current,
        isVisible: visible,
        isSwitchingZone,
        hasSwitchError: switchError !== null
      });
      if (!shouldReconnect) return;

      const user = authUser;
      resumingRef.current = true;
      void connectToZone(user, {
        zone: zoneKind,
        quiet: true,
        tolerateTakenAttempts: RESUME_ATTEMPTS - 1
      }).finally(() => {
        resumingRef.current = false;
      });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // `connectToZone` is recreated on every render, so it is not a dep: every piece
    // of state it reads is listed instead, which re-registers the listener exactly
    // when the decision could change.
  }, [authUser, isJoined, isJoining, sessionTaken, isSwitchingZone, switchError, zoneKind]);

  /** MOB-08: manual retry from the disconnect panel (no tolerated refusals). */
  const handleReconnect = () => {
    if (!authUser || isJoining) return;
    void connectToZone(authUser, { zone: zoneKind });
  };

  /** Solo portal interaction from the entity panel; right-click carries units. */
  const handleTravel = (portalId: string) => {
    roomRef.current?.send(NetworkMessage.TRAVEL, { portalId, unitIds: [] });
  };

  const handleAuthenticated = (user: AuthUser) => {
    setAuthUser(user);
    void connectToZone(user, { zone: getStoredZone(user.id) });
  };

  /** SESS-06/D2: the player explicitly chose to take the account over. */
  const handleTakeoverSession = () => {
    setSessionTaken(false);
    if (authUser) void connectToZone(authUser, { force: true, zone: zoneKind });
  };

  /** SESS-06: drop the stored token and fall back to the auth screen. */
  const handleUseAnotherAccount = () => {
    clearStoredToken();
    setAuthUser(null);
    setSessionTaken(false);
  };

  const handleLeaveGame = () => {
    // Only suppress the disconnect banner when a live room is being closed;
    // setting the flag with no room would swallow the next real disconnect.
    const active = roomRef.current;
    if (active) {
      isLeavingRef.current = true;
      active.leave();
      // The leave callback returns early because `roomRef` no longer points at
      // this room, so it will not clear the flag itself.
      roomRef.current = null;
      isLeavingRef.current = false;
    }
    clearStoredToken();
    setRoom(null);
    setIsJoined(false);
    setIsConnected(false);
    setSelectedEntity(null);
    setControlGroups([]);
    setSwitchError(null);
    setAuthUser(null);
  };

  // Keyboard hotkeys live in the Phaser input layer (see CommandController):
  // `S`, `A`/`P`, `H`, `.`, Delete, `+`/`-`, `Ctrl+F2..F4` + `F2..F4` camera
  // bookmarks, `Ctrl+1..9`, `Q/W/E/R/T` and Escape all route through one place
  // that guards modifiers and Phaser's key re-emit. React only receives the two
  // things it owns: the selection and the building being placed.

  const handleSelectBuilding = (type: BuildingType) => {
    setActiveBuildingType(type);
    if (sceneRef.current) {
      sceneRef.current.setBuildingMode(type);
    }
  };

  const handleCancelBuilding = () => {
    setActiveBuildingType(null);
    if (sceneRef.current) {
      sceneRef.current.cancelBuildingPlacement();
    }
  };

  const handleTrainUnit = (buildingId: string, unitType: UnitType) => {
    if (room) {
      room.send(NetworkMessage.TRAIN_UNIT, {
        buildingId,
        unitType
      });
    }
  };

  const handlePanToGrid = (gx: number, gy: number) => {
    if (sceneRef.current) {
      sceneRef.current.panTo(gx, gy);
    }
  };

  // CMD-04a: cancel the head of a building's training queue. The server reads
  // which unit that is from its own snapshot, so only the id is sent.
  const handleCancelTrain = (buildingId: string) => {
    if (room) {
      room.send(NetworkMessage.CANCEL_TRAIN, { buildingId });
    }
  };

  const handleUpgradeBuilding = (buildingId: string) => {
    if (room) {
      room.send(NetworkMessage.UPGRADE_BUILDING, { buildingId });
    }
  };

  const handleCancelBuildingUpgrade = (buildingId: string) => {
    if (room) {
      room.send(NetworkMessage.CANCEL_BUILDING_UPGRADE, { buildingId });
    }
  };

  const handleUpgradeUnitType = (unitType: UnitType) => {
    if (room) {
      room.send(NetworkMessage.UPGRADE_UNIT_TYPE, { unitType });
    }
  };

  const handleCancelUnitUpgrade = (unitType: UnitType) => {
    if (room) {
      room.send(NetworkMessage.CANCEL_UNIT_UPGRADE, { unitType });
    }
  };

  // CMD-04b: tear down a foundation that is still under construction. Named
  // separately from handleCancelBuilding, which exits placement mode.
  const handleCancelFoundation = (buildingId: string) => {
    // FND-03: mark locally so the removal is not reported as an attack.
    sceneRef.current?.markFoundationCancelled(buildingId);
    if (room) {
      room.send(NetworkMessage.CANCEL_BUILDING, { buildingId });
    }
  };

  // CTL-07: right-click on the minimap is a move order, not a camera pan.
  const handleCommandAtGrid = (gx: number, gy: number) => {
    sceneRef.current?.commandMoveTo(gx, gy);
  };

  // MOB-05: the touch command bar. Every handler is a one-liner on top of an API
  // the desktop input path already had, so touch and mouse can never drift.
  const handleArmContextual = () => sceneRef.current?.armContextualOrder();
  const handleArmAttackMove = () => sceneRef.current?.armOrder('ATTACK_MOVE');
  const handleArmPatrol = () => sceneRef.current?.armOrder('PATROL');
  const handleStopUnits = () => sceneRef.current?.stopSelectedUnits();
  const handleCycleStance = () => sceneRef.current?.cycleSelectedStance();
  const handleToggleBoxSelect = () => sceneRef.current?.setBoxSelectMode(!boxSelectArmed);
  const handleClearSelection = () => sceneRef.current?.clearSelection();
  const handleZoomIn = () => sceneRef.current?.zoomByStep(1);
  const handleZoomOut = () => sceneRef.current?.zoomByStep(-1);
  const handleCenterBase = () => sceneRef.current?.centerOnBase();

  /**
   * MOB-08: the two gate screens (login, and "your account is still signed in")
   * differ only in whether a user is resolved, and both must stand down while a
   * restore, a join, a map switch or its error panel owns the overlay slot.
   */
  const gatesIdle = !isRestoringSession && !isJoining && !isSwitchingZone && !switchError;
  const showAuthGate = !isJoined && !sessionTaken && authUser === null && gatesIdle;
  const showDisconnectGate = !isJoined && !sessionTaken && authUser !== null && gatesIdle;

  return (
    <div className="app-shell bg-slate-950 font-sans">
      {/* Phaser Canvas — stays mounted during a map switch so the new Room can
          reset the existing scene instead of rebuilding Phaser from scratch. */}
      {(isJoined || isSwitchingZone || switchError !== null) && (
        <PhaserGame
          room={room}
          playerName={playerName}
          onSelectionChange={(entity) => setSelectedEntity(entity)}
          onPlacementCancelled={() => setActiveBuildingType(null)}
          onBuildingHotkey={handleSelectBuilding}
          onIdleVillagersChange={setIdleVillagers}
          onControlGroupsChange={setControlGroups}
          onArmedOrderChange={setArmedOrder}
          onBoxSelectChange={setBoxSelectArmed}
          gameRef={gameRef}
          sceneRef={sceneRef}
          onUnderAttack={triggerUnderAttack}
        />
      )}

      {/* Top HUD */}
      {isJoined && (
        <HUD
          playerName={playerName}
          playerColor={playerColor}
          zoneLabel={zoneKind === 'battlefield' ? 'CHIẾN TRƯỜNG' : 'VƯƠNG QUỐC'}
          wood={resources.wood}
          food={resources.food}
          gold={resources.gold}
          stone={resources.stone}
          population={population}
          populationCap={populationCap}
          isConnected={isConnected}
          idleVillagers={idleVillagers}
          onSelectIdleVillager={() => sceneRef.current?.cycleToIdleUnit('villager')}
          underAttack={underAttack}
          compact={isCompact}
          onLeaveGame={handleLeaveGame}
        />
      )}

      {/* Bottom dock. Desktop keeps the AoE-style three-column bar; touch stacks
          the command bar above a tighter row, because a 390 px landscape phone has
          no room for a 140 px minimap, a 320 px card and an 8-button build panel
          side by side (MOB-06). */}
      {isJoined && (
        isCompact ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] select-none">
            {/* The card floats above the controls so the dock row underneath stays
                ~50 px tall; a permanently docked 320x144 panel would cover half a
                landscape phone (MOB-06). */}
            {selectedEntity && (
              <div className="flex justify-center">
                <EntityDetails
                  compact
                  interactionHint="long-press"
                  entity={selectedEntity}
                  playerResources={resources}
                  zoneKind={zoneKind}
                  onTravel={handleTravel}
                  onTrainUnit={handleTrainUnit}
                  onCancelTrain={handleCancelTrain}
                  onCancelBuilding={handleCancelFoundation}
                  onUpgradeBuilding={handleUpgradeBuilding}
                  onCancelBuildingUpgrade={handleCancelBuildingUpgrade}
                  onUpgradeUnitType={handleUpgradeUnitType}
                  onCancelUnitUpgrade={handleCancelUnitUpgrade}
                />
              </div>
            )}

            <div className="flex items-end gap-1.5">
              <Minimap
                compact
                room={room}
                sceneRef={sceneRef}
                onPanToGrid={handlePanToGrid}
                onCommandAtGrid={handleCommandAtGrid}
              />

              <div className="min-w-0 flex-1">
                <MobileCommandBar
                  hasUnits={selectedEntity?.type === 'unit'}
                  hasOwnBuilding={
                    selectedEntity?.type === 'building' && selectedEntity.isOwner === true
                  }
                  armed={armedOrder}
                  boxSelectArmed={boxSelectArmed}
                  onArmContextual={handleArmContextual}
                  onArmAttackMove={handleArmAttackMove}
                  onArmPatrol={handleArmPatrol}
                  onStop={handleStopUnits}
                  onCycleStance={handleCycleStance}
                  onToggleBoxSelect={handleToggleBoxSelect}
                  onClearSelection={handleClearSelection}
                  onZoomIn={handleZoomIn}
                  onZoomOut={handleZoomOut}
                  onCenterBase={handleCenterBase}
                  onCancelArmed={() => sceneRef.current?.cancelArmedOrder()}
                />
              </div>

              {(activeBuildingType !== null ||
                selectedEntity?.villagerSelected === true) && (
                <BuildMenu
                  compact
                  playerResources={resources}
                  activeBuildingType={activeBuildingType}
                  onSelectBuilding={handleSelectBuilding}
                  onCancelBuilding={handleCancelBuilding}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between pointer-events-none select-none z-20 gap-3">
            {/* Left: Minimap */}
            <Minimap room={room} sceneRef={sceneRef} onPanToGrid={handlePanToGrid} onCommandAtGrid={handleCommandAtGrid} />

            {/* Center: Selected Entity Info & Unit Training. Nothing selected
                means no card at all (UIX-07), matching the build dock. */}
            {selectedEntity && (
              <EntityDetails
                entity={selectedEntity}
                playerResources={resources}
                zoneKind={zoneKind}
                onTravel={handleTravel}
                onTrainUnit={handleTrainUnit}
                onCancelTrain={handleCancelTrain}
                onCancelBuilding={handleCancelFoundation}
                onUpgradeBuilding={handleUpgradeBuilding}
                onCancelBuildingUpgrade={handleCancelBuildingUpgrade}
                onUpgradeUnitType={handleUpgradeUnitType}
                onCancelUnitUpgrade={handleCancelUnitUpgrade}
              />
            )}

            {/* Right: Building Construction Dock — villagers only (UIX-06). Nothing
                selected means no card at all, exactly like AoE, so the empty-state
                placeholder is gone rather than being drawn as blank slots. */}
            {(activeBuildingType !== null ||
              selectedEntity?.villagerSelected === true) && (
              <BuildMenu
                playerResources={resources}
                activeBuildingType={activeBuildingType}
                onSelectBuilding={handleSelectBuilding}
                onCancelBuilding={handleCancelBuilding}
              />
            )}
          </div>
        )
      )}

      {/* In-game Notification Banner */}
      {notification && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-950/90 border border-red-500/80 text-red-200 px-4 py-2 rounded shadow-2xl backdrop-blur-md flex items-center gap-2 z-50 text-sm animate-bounce">
          <AlertCircle size={16} className="text-red-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* ATK-05: under-attack banner (separate from the error notification). */}
      {underAttack && (
        <div className={`absolute ${notification ? 'top-24' : 'top-16'} left-1/2 -translate-x-1/2 bg-red-950/90 border border-red-500/80 text-red-200 px-4 py-2 rounded shadow-2xl backdrop-blur-md flex items-center gap-2 z-50 text-sm animate-pulse`}>
          <AlertCircle size={16} className="text-red-400" />
          <span>Đang bị tấn công!</span>
        </div>
      )}

      {/* SESS-06: the account is in use elsewhere (or was taken over) */}
      {sessionTaken && !isJoined && (
        <SessionBlocked
          onTakeover={handleTakeoverSession}
          onUseAnotherAccount={handleUseAnotherAccount}
        />
      )}

      {/* Auth Gate: register / login before entering the world */}
      {showAuthGate && <AuthScreen onAuthenticated={handleAuthenticated} />}

      {/* MOB-08: the account is still logged in but the room is gone (phone locked,
          tab suspended, server restarted). Offering a retry beats silently showing
          the login screen with a token that is still valid. */}
      {showDisconnectGate && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-3 backdrop-blur-md">
            <div className="aoe-panel flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border-2 border-amber-600 p-5 text-center shadow-2xl">
              <div className="flex items-center gap-2 text-amber-400">
                <AlertCircle size={22} />
                <span className="font-medieval text-sm font-bold tracking-wider">MẤT KẾT NỐI</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">
                Tài khoản <span className="text-amber-300">{playerName}</span> vẫn đang đăng nhập.
                Kết nối lại để tiếp tục đế chế và quân đang chơi.
              </p>
              <div className="mt-1 flex w-full gap-2">
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="min-h-[46px] flex-1 rounded border border-amber-400 bg-gradient-to-r from-amber-600 to-amber-700 text-xs font-bold uppercase tracking-wider text-slate-950"
                >
                  Kết nối lại
                </button>
                <button
                  type="button"
                  onClick={handleLeaveGame}
                  className="min-h-[46px] flex-1 rounded border border-slate-700 bg-slate-900 text-xs font-bold uppercase tracking-wider text-slate-300"
                >
                  Đăng xuất
                </button>
              </div>
            </div>
          </div>
        )}

      {/* MAPS: travel is in flight (leave + join the other room) */}
      {isSwitchingZone && (
        <div className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px] flex items-center justify-center z-50 p-4">
          <div className="aoe-panel px-8 py-6 rounded-xl flex flex-col items-center gap-3 shadow-2xl border-2 border-violet-500">
            <div className="w-8 h-8 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-300">Đang chuyển bản đồ...</span>
            <span className="text-[11px] text-slate-500">Bản đồ đích đang được tải.</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1 rounded border border-slate-600 text-[11px] text-slate-300 hover:border-slate-400"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      )}

      {/* MAPS: the destination room could not be joined; units are safe. */}
      {!isSwitchingZone && switchError && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="aoe-panel px-8 py-6 rounded-xl flex flex-col items-center gap-3 shadow-2xl border-2 border-red-600 max-w-sm text-center">
            <AlertCircle size={28} className="text-red-400" />
            <span className="text-sm text-slate-200">{switchError}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={retrySwitchZone}
                className="px-4 py-2 rounded border border-amber-600 bg-amber-950/60 text-amber-200 text-sm hover:border-amber-400"
              >
                Thử lại
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded border border-slate-600 text-slate-300 text-sm hover:border-slate-400"
              >
                Tải lại trang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session restore / world connection spinner */}
      {(isRestoringSession || (isJoining && !isSwitchingZone)) && (
        <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-40 p-4">
          <div className="aoe-panel px-8 py-6 rounded-xl flex flex-col items-center gap-3 shadow-2xl border-2 border-amber-600">
            <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            <span className="text-sm text-slate-300">
              {isRestoringSession ? 'Đang khôi phục phiên đăng nhập...' : 'Đang kết nối vào thế giới...'}
            </span>
          </div>
        </div>
      )}

      {/* Leave game. Touch renders the same action inside the compact HUD row. */}
      {isJoined && !isCompact && (
        <button
          type="button"
          onClick={handleLeaveGame}
          className="absolute top-16 right-2 z-30 px-3 py-1.5 rounded bg-slate-900/90 border border-slate-700 text-[11px] text-slate-300 hover:border-amber-500 hover:text-amber-300 transition-colors cursor-pointer"
        >
          Đăng xuất
        </button>
      )}

      {/* UIX-03: control-group rosters, click to recall. On touch they tuck under
          the compact top bar, which is only ~44 px tall (MOB-06). */}
      {isJoined && (
        <div
          className={`absolute right-2 z-20 ${
            // The compact HUD row is 44 px tall (touch targets), so the rosters
            // start below it instead of under it.
            isCompact ? 'top-[calc(env(safe-area-inset-top)+3.9rem)]' : 'top-28'
          }`}
        >
          <ControlGroups
            compact={isCompact}
            groups={controlGroups}
            onSelectGroup={(index) => sceneRef.current?.selectControlGroup(index)}
          />
        </div>
      )}

      {/* MOB-02: landscape-only layout; the game keeps running behind the gate. */}
      <OrientationGate visible={showOrientationGate} />
    </div>
  );
};

