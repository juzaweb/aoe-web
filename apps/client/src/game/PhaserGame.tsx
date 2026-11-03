import React, { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { Room } from '@colyseus/sdk';
import {
  WorldScene,
  SelectedEntityData,
  ControlGroupSummary,
  type ArmedOrder
} from './scenes/WorldScene.js';
import { BuildingType } from '@chien-quoc/shared';

interface PhaserGameProps {
  room: Room | null;
  playerName: string;
  onSelectionChange: (entity: SelectedEntityData | null) => void;
  onPlacementCancelled: () => void;
  /** A build hotkey (`Q/W/E/R/T`) was pressed; opens React's placement state. */
  onBuildingHotkey: (type: BuildingType) => void;
  /** ECO-02: the number of this player's idle villagers changed. */
  onIdleVillagersChange: (count: number) => void;
  /** UIX-03: the `Ctrl+1..9` rosters changed. */
  onControlGroupsChange: (groups: ControlGroupSummary[]) => void;
  /** MOB-05: the armed order changed (armed, committed or cancelled). */
  onArmedOrderChange: (armed: ArmedOrder | null) => void;
  /** MOB-04: the one-shot box-selection mode was armed or consumed. */
  onBoxSelectChange: (armed: boolean) => void;
  /** ATK-05: raised when the player's entities lose HP. */
  onUnderAttack: () => void;
  gameRef: React.MutableRefObject<Phaser.Game | null>;
  sceneRef: React.MutableRefObject<WorldScene | null>;
}

export const PhaserGame: React.FC<PhaserGameProps> = ({
  room,
  playerName,
  onSelectionChange,
  onPlacementCancelled,
  onBuildingHotkey,
  onIdleVillagersChange,
  onControlGroupsChange,
  onArmedOrderChange,
  onBoxSelectChange,
  onUnderAttack,
  gameRef,
  sceneRef
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest props for the one-time Phaser bootstrap closure
  const playerNameRef = useRef(playerName);
  const roomRef = useRef(room);
  const onBuildingHotkeyRef = useRef(onBuildingHotkey);
  const onIdleVillagersRef = useRef(onIdleVillagersChange);
  const onControlGroupsRef = useRef(onControlGroupsChange);
  const onArmedOrderRef = useRef(onArmedOrderChange);
  const onBoxSelectRef = useRef(onBoxSelectChange);
  const onUnderAttackRef = useRef(onUnderAttack);
  playerNameRef.current = playerName;
  roomRef.current = room;
  onBuildingHotkeyRef.current = onBuildingHotkey;
  onIdleVillagersRef.current = onIdleVillagersChange;
  onControlGroupsRef.current = onControlGroupsChange;
  onArmedOrderRef.current = onArmedOrderChange;
  onBoxSelectRef.current = onBoxSelectChange;
  onUnderAttackRef.current = onUnderAttack;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // MOB-01: size the canvas from the container, not the window. The shell is
    // `100dvh`, which is shorter than `innerHeight` on a phone with a collapsing
    // URL bar; sizing to the window would leave the canvas taller than its box.
    const initialWidth = container.clientWidth || window.innerWidth;
    const initialHeight = container.clientHeight || window.innerHeight;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: container,
      width: initialWidth,
      height: initialHeight,
      backgroundColor: '#0a0f1d',
      pixelArt: true,
      roundPixels: true,
      // MOB-02: Phaser creates one touch pointer by default, which cannot express a
      // two-finger pinch. Three gives the mouse plus two simultaneous touches and a
      // spare slot for a third finger landing mid-gesture.
      input: {
        activePointers: 3
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [WorldScene]
    };

    let disposed = false;
    let bootTimer = 0;

    const destroyGame = (game: Phaser.Game) => {
      if (gameRef.current === game) gameRef.current = null;
      // `true` removes the canvas Phaser attached to the container.
      try {
        game.destroy(true);
      } catch {
        // Already torn down; nothing to do.
      }
    };

    // React StrictMode mounts, unmounts and remounts the component in the same
    // tick. Constructing Phaser.Game synchronously would start an async boot
    // whose canvas lands in the DOM after cleanup already ran, leaving a second,
    // orphaned canvas stacked below the live one. Deferring by a tick means the
    // throwaway mount is cancelled before any Game exists.
    bootTimer = window.setTimeout(() => {
      if (disposed) return;

      const game = new Phaser.Game(config);
      gameRef.current = game;

      game.events.once('ready', () => {
        // The component unmounted while Phaser was still booting.
        if (disposed) {
          destroyGame(game);
          return;
        }

        const scene = game.scene.getScene('WorldScene') as WorldScene;
        sceneRef.current = scene;
        scene.onSelectionChange = onSelectionChange;
        scene.onPlacementCancelled = onPlacementCancelled;
        // Read through a ref: the scene outlives every React render, and this
        // bootstrap closure only runs once.
        scene.onBuildingHotkey = (type) => onBuildingHotkeyRef.current(type);
        scene.onIdleVillagersChange = (count) => onIdleVillagersRef.current(count);
        scene.onControlGroupsChange = (groups) => onControlGroupsRef.current(groups);
        scene.onArmedOrderChange = (armed) => onArmedOrderRef.current(armed);
        scene.onBoxSelectChange = (armed) => onBoxSelectRef.current(armed);
        scene.onUnderAttack = () => onUnderAttackRef.current();

        // Dev-only handle so browser tests can inspect state that the React HUD
        // does not expose (selection sets, camera, sprites).
        if (import.meta.env.DEV) {
          (window as unknown as { __worldScene?: WorldScene }).__worldScene = scene;
        }

        if (playerNameRef.current) {
          scene.setPlayerName(playerNameRef.current);
        }
        if (roomRef.current) {
          scene.setRoom(roomRef.current);
        }
      });
    }, 0);

    const handleResize = () => {
      if (!gameRef.current) return;
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      gameRef.current.scale.resize(width, height);
    };
    window.addEventListener('resize', handleResize);
    // MOB-09: a phone that rotates fires `orientationchange` before the browser
    // has settled the new size, so the `resize` above can arrive late or with the
    // old dimensions. Re-applying on the next frame is cheap and keeps the canvas
    // from staying letterboxed after a rotation.
    const handleOrientationChange = () => {
      window.setTimeout(handleResize, 0);
    };
    window.addEventListener('orientationchange', handleOrientationChange);
    window.visualViewport?.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      window.clearTimeout(bootTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.visualViewport?.removeEventListener('resize', handleResize);
      sceneRef.current = null;

      const game = gameRef.current;
      if (game) {
        if (game.isBooted) {
          destroyGame(game);
        } else {
          // Boot still in flight: destroy once it finishes, otherwise its canvas
          // is appended after this cleanup has already run.
          game.events.once('ready', () => destroyGame(game));
        }
      }

      // Belt and braces: drop anything Phaser may have already attached.
      container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    };
  }, []);

  // Update room when room is connected or changed. Passing null detaches the
  // scene while a travel swaps rooms, so its update loop never reads a state
  // that `leave()` has already torn down.
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setRoom(room);
    }
  }, [room]);

  // Keep the scene aware of the stable player name so the camera can find the base
  useEffect(() => {
    if (sceneRef.current && playerName) {
      sceneRef.current.setPlayerName(playerName);
    }
  }, [playerName, room]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full overflow-hidden" />;
};

