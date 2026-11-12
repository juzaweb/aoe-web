import React, { useState, useEffect, useRef } from 'react';
import { Client, Room } from '@colyseus/sdk';
import { Callbacks } from '@colyseus/schema';
import * as Phaser from 'phaser';
import {
  BuildingType,
  INITIAL_PLAYER_RESOURCES,
  INITIAL_POPULATION_CAP,
  NetworkMessage,
  RaidEndedPayload,
  RejectCode,
  ErrorNotificationPayload,
  Resources,
  SESSION_REPLACED_CLOSE,
  UnitType,
  WorldMapEntry,
  type CitadelStatus
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
import { PlacementBanner } from './components/PlacementBanner.js';
import type { RoadMode } from './game/input/RoadController.js';
import type { WallMode } from './game/input/WallController.js';
import { EntityDetails } from './components/EntityDetails.js';
import { Minimap } from './components/Minimap.js';
import { ControlGroups } from './components/ControlGroups.js';
import { DockBar } from './components/dock/DockBar.js';
import {
  selectionDisplayName,
  type DockCommandHandlers
} from './components/dock/commandPages.js';
import { AuthScreen } from './components/AuthScreen.js';
import { SessionBlocked } from './components/SessionBlocked.js';
import { WorldMapOverlay } from './components/WorldMapOverlay.js';
import { SpectatorOverlay } from './components/SpectatorOverlay.js';
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
  isAuthRejection,
  retreatRaid,
  startRaid
} from './auth/api.js';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { playUnderAttackAlert } from './game/audio/alertSound.js';
import { RejectNotification } from './components/RejectNotification.js';
import { TopOverlayStack } from './components/TopOverlayStack.js';
import { UnderAttackBanner } from './components/UnderAttackBanner.js';
import {
  type RaidSession,
  clearStoredRaid,
  getStoredRaid,
  storeRaid
} from './game/raid/session.js';
import { LANGUAGE_CHANGED_EVENT } from './i18n/index.js';

export const App: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isJoined, setIsJoined] = useState<boolean>(false);
  /** The live raid this account is attacking with, if any. */
  const [raidSession, setRaidSession] = useState<RaidSession | null>(null);
  const raidSessionRef = useRef<RaidSession | null>(null);
  /** The world map overlay is open. */
  const [worldMapOpen, setWorldMapOpen] = useState<boolean>(false);
  /** A raid order is being committed to the server. */
  const [raidBusy, setRaidBusy] = useState<boolean>(false);
  /**
   * The empire being watched in the second window. `room` is null while the
   * spectator join is in flight; the overlay shows its loading state.
   */
  const [spectator, setSpectator] = useState<{
    target: WorldMapEntry;
    room: Room | null;
  } | null>(null);
  /** A spectator join is in flight. */
  const [spectateBusy, setSpectateBusy] = useState<boolean>(false);
  /** MAPS: a room switch is being applied (enter a raid, or go home). */
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
  /** Phase 25: own capital level, mirrored from the buildings collection. */
  const [townCenterLevel, setTownCenterLevel] = useState<number>(1);
  /** Account id of the joined player, used to filter the buildings collection. */
  const myPlayerIdRef = useRef<string | null>(null);
  const [population, setPopulation] = useState<number>(0);
  const [populationCap, setPopulationCap] = useState<number>(INITIAL_POPULATION_CAP);
  /** Aggregate health of the player's kingdom citadel, or null off-kingdom. */
  const [citadelStatus, setCitadelStatus] = useState<CitadelStatus | null>(null);
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
  /** Kingdom-only road paint tool; null when the tool is not open. */
  const [roadMode, setRoadMode] = useState<RoadMode | null>(null);
  /** Kingdom-only wall brush; build mode also drives `activeBuildingType`. */
  const [wallMode, setWallMode] = useState<WallMode | null>(null);

  // Notifications
  const [notification, setNotification] = useState<{
    message: string;
    code: RejectCode | null;
    /**
     * UIX-08: bumped for every notification so the live region remounts. A
     * polite region whose markup is identical is not re-announced, and the same
     * rejection twice in a row ("insufficient wood") is a normal thing to do.
     */
    seq: number;
  } | null>(null);
  const notificationSeqRef = useRef(0);
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
  /** The separate read-only room, kept apart from the player's own room. */
  const spectateRoomRef = useRef<Room | null>(null);
  /**
   * In-flight leave of the spectator room. A new join must wait for it: the
   * server allows one watcher window per account, and a join that beats the
   * leave would be refused for no reason the player can see.
   */
  const spectateLeaveRef = useRef<Promise<unknown> | null>(null);
  /** Bumped on every open/close, so a slow join cannot resurrect a closed window. */
  const spectateRequestRef = useRef(0);
  /** True while a room switch is being applied; suppresses the leave banner. */
  const switchingRef = useRef<boolean>(false);
  /** The switch being applied (null = going home), kept so a failure can be retried. */
  const pendingRaidRef = useRef<RaidSession | null>(null);
  /** MOB-08: one resume join at a time; two sockets for one account is a conflict. */
  const resumingRef = useRef(false);

  const showNotification = (msg: string, code: RejectCode | null = null) => {
    const next = { message: msg, code, seq: ++notificationSeqRef.current };
    setNotification(next);
    setTimeout(() => {
      setNotification((curr) => (curr === next ? null : curr));
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

  /**
   * I18N: the live room is told the active language, and a switcher action is
   * forwarded as `SET_LOCALE` so server messages follow without a reconnect.
   */
  useEffect(() => {
    if (!room) return;
    room.send('SET_LOCALE', { locale: i18n.language });
    const onLanguageChanged = () => room.send('SET_LOCALE', { locale: i18n.language });
    window.addEventListener(LANGUAGE_CHANGED_EVENT, onLanguageChanged);
    return () => window.removeEventListener(LANGUAGE_CHANGED_EVENT, onLanguageChanged);
  }, [room, i18n.language]);

  /**
   * The own map keeps simulating while a spectator window is open, but it must
   * not keep listening to the keyboard: Phaser binds keys at the window level,
   * so `A`/`P`/`Q`… would still order the player's own army from behind the
   * overlay. Input is restored when the viewer closes the window.
   */
  const spectateOpen = spectator !== null;
  /**
   * UIX-10: everything that lives in the top-centre column, in priority order.
   * Placement is a steady state, a rejection is transient feedback, and
   * under-attack is the one that cannot wait.
   */
  const placementActive =
    isJoined && (activeBuildingType !== null || roadMode !== null || wallMode !== null);
  const hasTopOverlays = notification !== null || underAttack || placementActive;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setInputEnabled(!spectateOpen);
    return () => scene.setInputEnabled(true);
  }, [spectateOpen]);

  // Restore a previous session on load so a refresh drops straight back in.
  useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then((user) => {
        if (cancelled || !user) return;
        setAuthUser(user);
        // Session is still valid. A raid in flight is resumed first: the
        // server still has the army in the defender's kingdom until it ends.
        const raid = getStoredRaid(user.id);
        if (raid) {
          raidSessionRef.current = raid;
          setRaidSession(raid);
        }
        void connectToZone(user, { raid }).then((joined) => {
          if (joined || !raid) return;
          // The raid had already ended: drop the stale session and go home.
          clearStoredRaid(user.id);
          raidSessionRef.current = null;
          setRaidSession(null);
          void connectToZone(user, { quiet: true });
        });
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
   * Joins the kingdom room.
   *
   * Phase 23 has two entry paths into the same room: the player's own kingdom
   * (`ownerId` = self) and a raid on somebody else's (`ownerId` = defender plus
   * `raidId`). The server verifies the raid against the database, so the
   * options here are only a hint. Returns false instead of throwing so a room
   * switch can retry without unwinding its own overlay.
   */
  const connectToZone = async (
    user: AuthUser,
    opts: {
      force?: boolean;
      attempt?: number;
      quiet?: boolean;
      /** Join the defender's kingdom as the attacker of this live raid. */
      raid?: RaidSession | null;
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
      if (!opts.quiet) showNotification(t('app.sessionExpired'));
      return false;
    }

    setIsJoining(true);
    try {
      const client = clientRef.current ?? new Client(getServerUrl());
      clientRef.current = client;
      // Sent as `_authToken` on the room socket; the room's `onAuth` verifies it.
      client.auth.token = token;

      const roomName = 'kingdom_room';
      // SESS-06/D2: `force` is only ever true after the player pressed the
      // takeover button, never as an automatic retry. A raid join names the
      // defender instead and carries the raid id the server verifies.
      const options = opts.raid
        ? { ownerId: opts.raid.defenderId, raidId: opts.raid.raidId, locale: i18n.language }
        : { ownerId: user.id, force: opts.force === true, locale: i18n.language };

      const joinedRoom = await client.joinOrCreate(roomName, options);

      roomRef.current = joinedRoom;
      setRoom(joinedRoom);
      setIsConnected(true);
      setIsJoined(true);
      setSessionTaken(false);

      // Listen to room error messages
      joinedRoom.onMessage(NetworkMessage.ERROR_NOTIFICATION, (data: ErrorNotificationPayload) => {
        showNotification(data.message, data.code);
      });

      // The defender's side of a raid: the server announces the result here
      // (loot taken, attack repelled, retreat).
      joinedRoom.onMessage(
        NetworkMessage.SYSTEM_ANNOUNCEMENT,
        (data: { message?: string }) => {
          if (data?.message) showNotification(data.message);
        }
      );

      // A raid that closes while this client is in the fight: leave the
      // defender's kingdom and go home. The server has already moved the army.
      joinedRoom.onMessage(NetworkMessage.RAID_ENDED, (data: RaidEndedPayload) => {
        clearStoredRaid(user.id);
        raidSessionRef.current = null;
        setRaidSession(null);
        showNotification(raidResultText(data, i18n.t));
        void switchToRoom(user, null);
      });

      const cb = Callbacks.get(joinedRoom);

      // Phase 25: the build menu needs the own capital level, and the buildings
      // collection is the only live source. A TC added before the player row is
      // re-read by `refreshOwnTownCenterLevel` once the owner id is known.
      myPlayerIdRef.current = null;
      setTownCenterLevel(1);
      const refreshOwnTownCenterLevel = () => {
        const ownerId = myPlayerIdRef.current;
        if (!ownerId) return;
        let level = 1;
        joinedRoom.state.buildings?.forEach((b: any) => {
          if (b.ownerId === ownerId && b.type === 'TOWN_CENTER') {
            level = Math.max(level, b.level);
          }
        });
        setTownCenterLevel(level);
      };

      cb.onAdd('buildings', (b: any) => {
        // Only the capital changes this value; keeping a listener on every
        // building would re-run the owner check on every HP/queue update.
        if (b.type !== 'TOWN_CENTER') return;
        const apply = () => {
          if (b.ownerId === myPlayerIdRef.current) {
            setTownCenterLevel(Math.max(1, b.level));
          }
        };
        apply();
        cb.onChange(b, apply);
      });

      // Listen to player state
      cb.onAdd('players', (p: any) => {
        if (p.name === user.displayName) {
          myPlayerIdRef.current = p.id;
          refreshOwnTownCenterLevel();
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
          showNotification(i18n.t('app.sessionReplaced'));
          return;
        }
        if (isLeavingRef.current) {
          isLeavingRef.current = false;
          return;
        }
        showNotification(i18n.t('app.connectionLost'));
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
          showNotification(t('app.invalidSession'));
        }
      } else if (!opts.quiet) {
        showNotification(t('app.connectFailed'));
      }
      return false;
    } finally {
      setIsJoining(false);
    }
  };

  /**
   * Leaves a spectator room and tracks the in-flight close.
   *
   * The server allows one watcher window per account, so a join that starts
   * before the previous socket has finished closing would be refused. Tracking
   * the promise lets the next open wait instead of surfacing a false error.
   */
  const leaveSpectateRoom = async (active: Room | null) => {
    if (!active) return;
    const leaving = active.leave().catch((err) => {
      console.warn('[SPECTATE] Leave failed.', err);
    });
    spectateLeaveRef.current = leaving;
    await leaving;
    if (spectateLeaveRef.current === leaving) spectateLeaveRef.current = null;
  };

  /**
   * Leaves the spectator room, if one is open.
   *
   * The viewer's own room is untouched: watching is a second socket, so closing
   * it never disturbs the empire the player is actually playing. Resolves once
   * the server has processed the leave, which is what lets `handleSpectate` swap
   * targets without tripping the one-window-per-account guard.
   */
  const closeSpectate = async () => {
    spectateRequestRef.current += 1;
    const active = spectateRoomRef.current;
    spectateRoomRef.current = null;
    setSpectator(null);
    setSpectateBusy(false);
    await leaveSpectateRoom(active);
  };

  /**
   * Opens a read-only view of another empire.
   *
   * A new room is joined next to the player's own one; the server recognises
   * `spectate: true` and skips every owner join step, so no session is claimed
   * and no starter base is created. The world map closes so the target is
   * visible immediately.
   */
  const handleSpectate = async (entry: WorldMapEntry) => {
    if (!authUser || spectateBusy) return;
    if (entry.userId === authUser.id) return;

    // Switching targets reuses the same slot. Wait for the old socket to close
    // first: the server allows one watcher window per account, and a join that
    // beats the leave would be refused.
    setSpectateBusy(true);
    setWorldMapOpen(false);
    spectateRequestRef.current += 1;
    const request = spectateRequestRef.current;
    const previous = spectateRoomRef.current;
    spectateRoomRef.current = null;
    setSpectator({ target: entry, room: null });
    await leaveSpectateRoom(previous);
    // A close started by a room switch may still be in flight; the join would
    // race the one-window-per-account cap if it went out now.
    if (spectateLeaveRef.current) await spectateLeaveRef.current;
    // Closed (or retargeted) while the old room was going away.
    if (spectateRequestRef.current !== request) return;

    try {
      const client = clientRef.current;
      if (!client) throw new Error(i18n.t('app.connectionLost'));

      const joined = await client.joinOrCreate('kingdom_room', {
        ownerId: entry.userId,
        spectate: true,
        locale: i18n.language
      });
      // The viewer closed the window (or picked another target) while the join
      // was in flight: drop the room instead of resurrecting the overlay.
      if (spectateRequestRef.current !== request) {
        void joined.leave().catch(() => undefined);
        return;
      }
      spectateRoomRef.current = joined;

      joined.onMessage(NetworkMessage.ERROR_NOTIFICATION, (data: ErrorNotificationPayload) => {
        showNotification(data.message, data.code);
      });
      // The target's map closing (they left, or the room was released) ends the
      // view instead of leaving a frozen canvas behind.
      joined.onLeave(() => {
        if (spectateRoomRef.current !== joined) return;
        spectateRoomRef.current = null;
        setSpectator(null);
      });

      setSpectator({ target: entry, room: joined });
    } catch (err) {
      if (spectateRequestRef.current === request) {
        spectateRoomRef.current = null;
        setSpectator(null);
        showNotification((err as Error).message || i18n.t('app.cannotSpectate'));
        // The map was hidden to show the target; bring it back so another
        // empire can be picked without reopening the panel from the HUD.
        setWorldMapOpen(true);
      }
    } finally {
      if (spectateRequestRef.current === request) setSpectateBusy(false);
    }
  };

  /**
   * Leaves the current room and joins another one.
   *
   * Used for both directions of a raid: entering the defender's kingdom
   * (`raid` set) and going home after the fight (`raid` null). The army is
   * already safe in SQLite by the time this runs — `/raid/start` moved it, and
   * `settleRaid` moved it back — so a failed join can be retried without loss.
   */
  const switchToRoom = async (user: AuthUser, raid: RaidSession | null) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setIsSwitchingZone(true);
    setSwitchError(null);
    pendingRaidRef.current = raid;
    // A raid replaces the map this client is playing; a watcher would be left
    // looking at a kingdom the player no longer has a reason to see.
    void closeSpectate();
    // Freeze the old map instead of clearing it, so the player keeps seeing the
    // map they left while the destination syncs.
    sceneRef.current?.pauseWorld();

    try {
      const current = roomRef.current;
      if (current) {
        // Do not wait for the leave: the raid commit already persisted the army,
        // so the destination join may take the account over immediately.
        void current.leave().catch((err) => {
          console.warn('[RAID] Old room leave failed; the hand-off join continues.', err);
        });
      }
      roomRef.current = null;

      let joined = false;
      for (let attempt = 0; attempt < 3 && !joined; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500));
        joined = await connectToZone(user, { quiet: true, raid });
      }

      if (joined) {
        pendingRaidRef.current = null;
        if (raid) {
          raidSessionRef.current = raid;
          setRaidSession(raid);
          storeRaid(user.id, raid);
          setWorldMapOpen(false);
        } else {
          raidSessionRef.current = null;
          setRaidSession(null);
          clearStoredRaid(user.id);
        }
      } else {
        setRoom(null);
        setIsJoined(false);
        setIsConnected(false);
        setSwitchError(
          raid
            ? t('app.switchToEnemyFailed')
            : t('app.switchHomeFailed')
        );
      }
    } catch (err) {
      console.error('Failed to switch rooms:', err);
      setRoom(null);
      setSwitchError(t('app.switchMapFailed'));
    } finally {
      // On success `setRoom(newRoom)` already resumed; this also restores the
      // canvas behind the error overlay when the join failed.
      sceneRef.current?.resumeWorld();
      setIsSwitchingZone(false);
      switchingRef.current = false;
    }
  };

  /** Retries the pending room switch without re-sending the raid order. */
  const retrySwitchZone = () => {
    if (!authUser || switchingRef.current) return;
    void switchToRoom(authUser, pendingRaidRef.current);
  };

  /**
   * Commits a raid and enters the defender's kingdom.
   *
   * The HTTP call is the only place an army is moved before the room switch; if
   * it fails nothing has left the player's kingdom.
   */
  const handleAttack = async (entry: WorldMapEntry, unitIds: string[]) => {
    if (!authUser || raidBusy) return;
    setRaidBusy(true);
    try {
      const result = await startRaid(entry.userId, unitIds);
      await switchToRoom(authUser, {
        raidId: result.raidId,
        defenderId: result.defenderId
      });
    } catch (err) {
      showNotification((err as Error).message);
      // The map may have been blocked by another raid in the meantime.
      setWorldMapOpen(true);
    } finally {
      setRaidBusy(false);
    }
  };

  /**
   * Retreats from the current raid.
   *
   * The room message is the primary path: the server orders the army to march
   * back to the retreat gate and answers with `RAID_ENDED` once the whole army
   * has arrived. The HTTP fallback covers a client whose socket is already
   * gone, so the army is never stranded.
   */
  const handleRetreat = () => {
    const raid = raidSessionRef.current;
    if (!raid || !authUser) return;

    if (roomRef.current) {
      roomRef.current.send(NetworkMessage.RAID_RETREAT, {});
      return;
    }
    void retreatRaid(raid.raidId)
      .then(() => switchToRoom(authUser, null))
      .catch((err: Error) => showNotification(err.message));
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
        raid: raidSessionRef.current,
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
  }, [authUser, isJoined, isJoining, sessionTaken, isSwitchingZone, switchError]);

  /** MOB-08: manual retry from the disconnect panel (no tolerated refusals). */
  const handleReconnect = () => {
    if (!authUser || isJoining) return;
    void connectToZone(authUser, { raid: raidSessionRef.current });
  };

  /** Opens or closes the world map overlay. */
  const handleToggleWorldMap = () => setWorldMapOpen((open) => !open);

  const handleAuthenticated = (user: AuthUser) => {
    setAuthUser(user);
    void connectToZone(user, { raid: getStoredRaid(user.id) });
  };

  /** SESS-06/D2: the player explicitly chose to take the account over. */
  const handleTakeoverSession = () => {
    setSessionTaken(false);
    if (authUser) void connectToZone(authUser, { force: true, raid: raidSessionRef.current });
  };

  /** SESS-06: drop the stored token and fall back to the auth screen. */
  const handleUseAnotherAccount = () => {
    clearStoredToken();
    setAuthUser(null);
    setSessionTaken(false);
  };

  const handleLeaveGame = () => {
    // The spectator socket is separate, so it must be closed explicitly.
    void closeSpectate();
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
    // A raider may only fight: the server rejects building orders there, so the
    // hotkey must not even arm a ghost the player cannot place.
    if (raidSessionRef.current) return;
    // The three tools are mutually exclusive: one click cannot mean more than one.
    if (roadMode) {
      setRoadMode(null);
      sceneRef.current?.cancelRoadMode();
    }

    // WALL is a paint brush, not a footprint. Picking it opens the same stroke
    // tool the road uses, and picking it again backs out.
    if (type === 'WALL') {
      if (sceneRef.current && sceneRef.current.terrainLayout.kind !== 'kingdom') return;
      const next = activeBuildingType === 'WALL' && wallMode === 'build' ? null : 'build';
      // Enter the brush before touching React state: leaving a placement ghost
      // fires `onPlacementCancelled`, which would otherwise clear the WALL
      // highlight we are about to set.
      if (next) sceneRef.current?.setWallMode(next);
      else sceneRef.current?.cancelWallMode();
      setActiveBuildingType(next ? 'WALL' : null);
      setWallMode(next);
      return;
    }

    if (wallMode) {
      setWallMode(null);
      sceneRef.current?.cancelWallMode();
    }
    setActiveBuildingType(type);
    if (sceneRef.current) {
      sceneRef.current.setBuildingMode(type);
    }
  };

  const handleCancelBuilding = () => {
    setActiveBuildingType(null);
    setWallMode(null);
    if (sceneRef.current) {
      sceneRef.current.cancelBuildingPlacement();
    }
  };

  /** Opens or closes the road tool. Picking the active mode again closes it. */
  const handleSelectRoad = (mode: RoadMode) => {
    const next = roadMode === mode ? null : mode;
    setRoadMode(next);
    if (!sceneRef.current) return;
    if (next) {
      setActiveBuildingType(null);
      setWallMode(null);
      sceneRef.current.setRoadMode(next);
    } else {
      sceneRef.current.cancelRoadMode();
    }
  };

  /** Opens or closes the wall erase brush. Picking it again closes it. */
  const handleSelectWallErase = () => {
    if (raidSessionRef.current) return;
    if (sceneRef.current && sceneRef.current.terrainLayout.kind !== 'kingdom') return;
    const next = wallMode === 'erase' ? null : 'erase';
    setWallMode(next);
    setActiveBuildingType(null);
    if (roadMode) {
      setRoadMode(null);
      sceneRef.current?.cancelRoadMode();
    }
    if (!sceneRef.current) return;
    if (next) sceneRef.current.setWallMode(next);
    else sceneRef.current.cancelWallMode();
  };

  /**
   * The scene backs the wall brush out from the map (right-click, map switch),
   * so React mirrors it. Build mode also owns the highlighted WALL tile.
   */
  const handleWallModeChange = (mode: WallMode | null) => {
    setWallMode(mode);
    setActiveBuildingType(mode === 'build' ? 'WALL' : null);
  };

  /**
   * UIX-02: one exit point for whichever placement mode is live. It delegates to
   * the handler the matching toolbar button already uses, so the banner's Cancel
   * and the button can never drift apart.
   */
  const handleCancelPlacement = () => {
    if (roadMode) {
      handleSelectRoad(roadMode);
    } else if (wallMode === 'erase') {
      handleSelectWallErase();
    } else {
      handleCancelBuilding();
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
    if (sceneRef.current?.selectedRoadId === buildingId) {
      const road = (room?.state as any)?.roads?.get(buildingId);
      if (road) {
        room?.send(NetworkMessage.REMOVE_ROAD, {
          tiles: [{ x: road.gridX, y: road.gridY }]
        });
        sceneRef.current.selectedRoadId = null;
        sceneRef.current.notifySelectionChange();
        return;
      }
    }
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

  /**
   * DOCK-02: the command card is a view over the handlers this screen already
   * had, so touch, keyboard and mouse keep sharing one implementation per
   * action. Assembled here instead of inside the dock to keep the dock a pure
   * presenter that a test can render without a scene.
   */
  const dockHandlers: DockCommandHandlers = {
    onSelectBuilding: handleSelectBuilding,
    onSelectRoad: handleSelectRoad,
    onSelectWallErase: handleSelectWallErase,
    onTrainUnit: handleTrainUnit,
    onCancelTrain: handleCancelTrain,
    onUpgradeBuilding: handleUpgradeBuilding,
    onCancelBuildingUpgrade: handleCancelBuildingUpgrade,
    onUpgradeUnitType: handleUpgradeUnitType,
    onCancelUnitUpgrade: handleCancelUnitUpgrade,
    onArmAttackMove: handleArmAttackMove,
    onArmPatrol: handleArmPatrol,
    onStopUnits: handleStopUnits,
    onCycleStance: handleCycleStance,
    onClearSelection: handleClearSelection,
    onCenterBase: handleCenterBase,
    onCancelBuilding: handleCancelFoundation,
    onRetreat: handleRetreat
  };

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
          onCitadelStatusChange={setCitadelStatus}
          onControlGroupsChange={setControlGroups}
          onArmedOrderChange={setArmedOrder}
          onBoxSelectChange={setBoxSelectArmed}
          onRoadModeChange={setRoadMode}
          onWallModeChange={handleWallModeChange}
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
          zoneLabel={raidSession ? t('app.zoneRaid') : t('app.zoneKingdom')}
          inRaid={raidSession !== null}
          raidStartedAt={raidSession?.startedAt}
          onOpenWorldMap={handleToggleWorldMap}
          onRetreat={handleRetreat}
          wood={resources.wood}
          food={resources.food}
          gold={resources.gold}
          stone={resources.stone}
          population={population}
          citadelStatus={citadelStatus}
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
                  inRaid={raidSession !== null}
                  onRetreat={handleRetreat}
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

              {!raidSession &&
                (activeBuildingType !== null ||
                  selectedEntity?.villagerSelected === true) && (
                <BuildMenu
                  playerResources={resources}
                  activeBuildingType={activeBuildingType}
                  onSelectBuilding={handleSelectBuilding}
                  onCancelBuilding={handleCancelBuilding}
                  showRoadTools
                  roadMode={roadMode}
                  onSelectRoad={handleSelectRoad}
                  wallMode={wallMode}
                  onSelectWallErase={handleSelectWallErase}
                  townCenterLevel={townCenterLevel}
                />
              )}
            </div>
          </div>
        ) : (
          // DOCK-01: one fixed 156 px band (radar + summary + 5x3 command grid).
          // Nothing selected collapses it to the radar, so the map keeps the
          // bottom of the screen whenever no card is needed (UIX-07).
          <DockBar
            entity={selectedEntity}
            displayName={selectedEntity ? selectionDisplayName(selectedEntity) : ''}
            resources={resources}
            townCenterLevel={townCenterLevel}
            inRaid={raidSession !== null}
            armedOrder={armedOrder}
            activeBuildingType={activeBuildingType}
            roadMode={roadMode}
            wallMode={wallMode}
            room={room}
            sceneRef={sceneRef}
            onPanToGrid={handlePanToGrid}
            onCommandAtGrid={handleCommandAtGrid}
            handlers={dockHandlers}
          />
        )
      )}

      {/* UIX-08 + UIX-10: one column for the top-centre banners. Under-attack is
          `assertive` because it is the only one where a missed message costs
          the player a castle; the reject toast stays polite so a burst of
          failed commands does not talk over the game. */}
      {hasTopOverlays && (
        <TopOverlayStack compact={isCompact}>
          {/* ATK-05: under-attack banner (separate from the error notification). */}
          {underAttack && <UnderAttackBanner />}

          {/* In-game Notification Banner */}
          {notification && (
            <RejectNotification
              message={notification.message}
              code={notification.code}
              seq={notification.seq}
            />
          )}

          {/* UIX-02: name the placement mode and keep a Cancel button in reach
              while the build sheet is closed over the map. */}
          {placementActive && (
            <PlacementBanner
              compact={isCompact}
              buildingType={activeBuildingType}
              roadMode={roadMode}
              wallMode={wallMode}
              resources={resources}
              onCancel={handleCancelPlacement}
            />
          )}
        </TopOverlayStack>
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
                <span className="font-medieval text-sm font-bold tracking-wider">{t('app.disconnectTitle')}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-300">
                {t('app.disconnectBody', { name: playerName })}
              </p>
              <div className="mt-1 flex w-full gap-2">
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="min-h-[46px] flex-1 rounded border border-amber-400 bg-gradient-to-r from-amber-600 to-amber-700 text-xs font-bold uppercase tracking-wider text-slate-950"
                >
                  {t('app.reconnect')}
                </button>
                <button
                  type="button"
                  onClick={handleLeaveGame}
                  className="min-h-[46px] flex-1 rounded border border-slate-700 bg-slate-900 text-xs font-bold uppercase tracking-wider text-slate-300"
                >
                  {t('app.logout')}
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
            <span className="text-sm text-slate-300">{t('app.switchingMap')}</span>
            <span className="text-[11px] text-slate-400">{t('app.switchingMapDetail')}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1 rounded border border-slate-600 text-[11px] text-slate-300 hover:border-slate-400"
            >
              {t('app.reload')}
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
                {t('app.retry')}
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded border border-slate-600 text-slate-300 text-sm hover:border-slate-400"
              >
                {t('app.reload')}
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
              {isRestoringSession ? t('app.restoreSession') : t('app.connectingWorld')}
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
          {t('app.logout')}
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

      {/* Phase 23: world map + raid targeting. */}
      <WorldMapOverlay
        open={worldMapOpen}
        selfName={playerName}
        selectedUnitIds={sceneRef.current ? Array.from(sceneRef.current.selectedUnitIds) : []}
        busy={raidBusy || isSwitchingZone || spectateBusy}
        onClose={() => setWorldMapOpen(false)}
        onAttack={handleAttack}
        onSpectate={handleSpectate}
      />

      {/* Read-only second window: the player's own room keeps running behind it. */}
      {spectator && (
        <SpectatorOverlay
          room={spectator.room}
          target={{
            userId: spectator.target.userId,
            name: spectator.target.name,
            color: spectator.target.color,
            townCenterLevel: spectator.target.townCenterLevel
          }}
          onClose={closeSpectate}
        />
      )}

      {/* MOB-02: landscape-only layout; the game keeps running behind the gate. */}
      <OrientationGate visible={showOrientationGate} />
    </div>
  );
};


/** One line for the end of a raid, shown as a normal notification. */
function raidResultText(
  payload: RaidEndedPayload,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (payload.outcome === 'ATTACKER_WON') {
    const { wood, food, gold, stone } = payload.loot;
    return t('app.raidWinLoot', { wood, food, gold, stone });
  }
  if (payload.outcome === 'DEFENDER_WON') {
    return t('app.raidDefeat');
  }
  return t('app.raidRetreated');
}
