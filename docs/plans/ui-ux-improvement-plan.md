# 2D Game UI/UX Improvement Plan

- **Date:** 2026-11-08
- **Project / engine:** Phaser 3 (Canvas/WebGL) + React 18 (HUD/Overlays) + Tailwind CSS + Colyseus.js
- **Audit scope:** Client frontend components (`apps/client/src/components/*`), input controllers (`apps/client/src/game/input/*`), scenes (`WorldScene.ts`), stylesheets (`index.css`), mobile interactions (`MobileCommandBar.tsx`, `useInputMode.ts`), and localization files (`apps/client/src/i18n/*`).
- **Limitations:** Backend server runtime and real multiplayer connection were not actively spun up with real player traffic during this audit. Live gameplay verification was conducted by static inspection of rendering logic, event handlers, and unit tests rather than interactive human sessions.

---

## Executive summary

The 2D MMO RTS web game *Chiến Quốc* delivers a classic *Age of Empires*-inspired experience with isometric rendering, responsive HUD elements, multi-unit drag selection, and touch controls. However, auditing the UI/UX architecture revealed several key friction points:
1. **Critical Feedback Gaps:** Left-click and right-click ground clicks lack immediate audio-visual ground markers (e.g. green animated movement waypoints, red attack reticles), leaving players uncertain if an order was received before server state syncs.
2. **Readability & Information Hierarchy:** Sub-10px font sizes in dense desktop tooltips and mobile HUD badges (`text-[8px]`, `text-[9px]`, `text-[10px]`) cause eye strain on high-DPI and mobile screens.
3. **Accessibility & Color Reliance:** Crucial gameplay states (e.g. population limit warning, low health, under attack, world map difficulty) rely heavily on red/green hues without distinct secondary symbols or patterns.
4. **Mobile & Touch Friction:** On compact viewports, the BuildMenu sheet closes immediately upon selecting a building without clarifying that a placement tap is now required on the ground canvas.

Addressing these issues will significantly increase clarity, reduce input uncertainty, and improve accessibility across both desktop and mobile platforms.

---

## Current experience and evidence

### Player Flows & Codebase Mapping
- **Game Launch & Session Recovery:** `apps/client/src/App.tsx` handles session restoration, authentication, and reconnection gates (`SessionBlocked.tsx`, `AuthScreen.tsx`).
- **Resource & Status Monitoring:** `apps/client/src/components/HUD.tsx` tracks wood, food, gold, stone, population, idle villagers, and citadel status.
- **Unit & Building Inspection:** `apps/client/src/components/EntityDetails.tsx` dynamically renders combat stats, research queues, construction bars, and upgrade buttons.
- **Construction & Base Building:** `apps/client/src/components/BuildMenu.tsx` provides grid-based construction buttons with hotkey tags and hover tooltips.
- **Minimap Navigation:** `apps/client/src/components/Minimap.tsx` renders ground rasters, forest clusters, entity blips, and camera viewport rectangles.
- **Touch / Mobile Bar:** `apps/client/src/components/mobile/MobileCommandBar.tsx` replaces keyboard shortcuts with 44px+ touch targets on compact viewports.

---

## Prioritized improvements

### [P1] Add Click-to-Move and Attack-Order Visual Ground Decals
- **Status:** Proposed
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** `apps/client/src/game/scenes/WorldScene.ts` processes `handleRightClickCommand`, but ground clicks only emit network messages or internal path recalculations without spawning transient animated decals (such as pulsing green concentric circles for move, or red crosshairs for attack).
- **Player Impact:** Players frequently double- or triple-click because there is no immediate visual confirmation that their command was registered before server replication moves the units.
- **Recommendation:**
  - Create a transient particle/sprite effect in `WorldScene.ts` (e.g., green ring for move order, red ring/cross for attack, yellow ring for harvest/gather) that animates and scales down over 300ms at the clicked world coordinate.
  - Play an immediate, subtle auditory acknowledgment click sound.
- **Acceptance criteria:**
  - [ ] Right-clicking the map ground produces an animated ground ring at pointer location.
  - [ ] Right-clicking an enemy unit/building displays a red attack marker.
  - [ ] Decal scales down and fades out within 300ms without leaking memory or texture objects.
- **Validation:** Click on 10 random terrain points and verify immediate marker appearance and cleanup.
- **Effort:** S (Phaser tween or custom temporary graphics object).
- **Dependencies / risks:** Must ensure marker renders in the isometric world space beneath units/buildings.

---

### [P1] Minimum Legibility Threshold for Fonts (Eliminate Sub-11px Typography)
- **Status:** Proposed
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** Multiple UI components use sub-10px fonts (`text-[8px]`, `text-[9px]`, `text-[10px]` in `BuildMenu.tsx`, `HUD.tsx`, `Minimap.tsx`, `MobileCommandBar.tsx`).
- **Player Impact:** On high-DPI mobile screens and 1080p+ monitors, text is difficult to read and fails standard WCAG legibility guidelines.
- **Recommendation:**
  - Standardize minimum font size to 11px (`text-[11px]`) for auxiliary labels and 12px (`text-xs`) for regular text across all HUD panels.
  - Increase padding/spacing slightly where necessary or truncate labels with clean ellipsis and clear tooltips.
- **Acceptance criteria:**
  - [ ] No font sizes below `11px` across `HUD.tsx`, `BuildMenu.tsx`, `Minimap.tsx`, and `EntityDetails.tsx`.
  - [ ] All labels fit comfortably without clipping within their parent containers.
- **Validation:** Visual audit on standard resolutions (1366x768, 1920x1080, and mobile 390x844).
- **Effort:** S
- **Dependencies / risks:** Component container heights may need minor adjustments to avoid overflow.

---

### [P1] Visual Placement Mode Banner and Dismissal Affordance
- **Status:** Proposed
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** In `BuildMenu.tsx` (compact mode), selecting a building automatically closes the sheet (`setOpen(false)`), leaving the screen with only the semi-transparent building ghost under cursor/finger without an explicit placement prompt.
- **Player Impact:** Players, especially new mobile players, get confused about why their menu closed and whether they are in placement mode or normal mode.
- **Recommendation:**
  - Display a floating top/bottom toast banner when placement mode is active: "Placing [Building Name] - Tap ground to construct or tap Cancel".
  - Provide an easily reachable floating cancel floating button (`X`) near the center-bottom or top-center of the screen.
- **Acceptance criteria:**
  - [ ] Banner appears whenever `activeBuildingType !== null` or `roadMode !== null`.
  - [ ] Banner contains building name, cost reminder, and explicit "Cancel" button.
  - [ ] Banner disappears immediately upon placement or cancellation.
- **Validation:** Test on desktop and touch mode: select house to build, verify banner displays, press Cancel, verify ghost disappears.
- **Effort:** XS
- **Dependencies / risks:** None.

---

### [P2] High-Contrast & Colorblind-Safe Indicator for Population Capped and Alerts
- **Status:** Proposed
- **Confidence:** Medium
- **Type:** Observed issue
- **Evidence:** `apps/client/src/components/HUD.tsx` displays population cap in red text (`text-red-400 font-bold`) when capped, and under-attack alert relies solely on red pulsing badges.
- **Player Impact:** Players with protanopia/deuteranopia cannot easily distinguish red warning states from standard white/amber text.
- **Recommendation:**
  - Add a dedicated warning icon (e.g. `AlertTriangle`) alongside the population text when `population >= populationCap`.
  - Add text or icon cues in addition to color transitions for Citadel HP and World Map difficulty tags.
- **Acceptance criteria:**
  - [ ] An `AlertTriangle` icon flashes next to the population counter when capped.
  - [ ] World Map difficulty badges include text indicators ("-2", "Lv ==", "+3") rather than color-only hex polygons.
- **Validation:** Check in grayscale or with colorblind simulation browser tooling.
- **Effort:** XS
- **Dependencies / risks:** None.

---

### [P2] Drag-Selection Audio & Visual Box Contrast Polish
- **Status:** Proposed
- **Confidence:** Medium
- **Type:** Observed issue
- **Evidence:** `SelectionController.ts` draws selection boxes, but contrast against bright sand, dirt, and road tiles can wash out depending on the tile under the selection box.
- **Player Impact:** Group-selecting units during chaotic combat over roads or bright areas causes the selection boundary to blend into the ground.
- **Recommendation:**
  - Add a 1px dark outer stroke around the glowing selection marquee (dual-tone border: inner bright green/gold, outer dark outline) ensuring visibility on both dark grass and bright dirt/sand.
  - Add a subtle sound cue when a group selection box is completed and selects more than 1 unit.
- **Acceptance criteria:**
  - [ ] Selection box is clearly visible over green grass, light dirt, stone quarries, and water boundaries.
  - [ ] Unit selection sound plays when multi-selection completes.
- **Validation:** Drag-select units across different ground terrain types and observe contrast.
- **Effort:** S
- **Dependencies / risks:** None.

---

### [P3] Entity Details Quick Hotkey & Production Tooltips
- **Status:** Proposed
- **Confidence:** Medium
- **Type:** Observed issue
- **Evidence:** In `EntityDetails.tsx`, unit training buttons show unit name and image, but train hotkeys (e.g., `V` for Villager, `S` for Spearman) are not displayed directly on the buttons.
- **Player Impact:** Players who prefer keyboard shortcuts must guess or memorize hotkeys without in-game visual reminders.
- **Recommendation:**
  - Overlay keyboard shortcut badges on unit production buttons in `EntityDetails.tsx` (desktop mode).
- **Acceptance criteria:**
  - [ ] Production buttons show badge with assigned hotkey in the top-right corner.
- **Validation:** Select Town Center and Barracks; verify hotkey badges match actual keyboard triggers.
- **Effort:** XS
- **Dependencies / risks:** Keyboard binding configuration mapping must be exposed to React UI.

---

## Implementation phases

### Phase 1: Immediate Clarity & Feedback (Now)
- P1: Add Click-to-Move and Attack-Order Visual Ground Decals.
- P1: Visual Placement Mode Banner and Dismissal Affordance.

### Phase 2: Readability & Accessibility (Next)
- P1: Minimum Legibility Threshold for Fonts (Eliminate Sub-11px Typography).
- P2: High-Contrast & Colorblind-Safe Indicator for Population Capped and Alerts.

### Phase 3: Selection & Desktop Hotkey Polish (Later)
- P2: Drag-Selection Audio & Visual Box Contrast Polish.
- P3: Entity Details Quick Hotkey & Production Tooltips.

---

## Validation checklist

- **Desktop (1920x1080 & 1366x768):**
  - [ ] HUD elements fit without vertical overlap.
  - [ ] Ground click reticles align precisely with cursor tip.
  - [ ] Entity details text is comfortably legible from normal viewing distance.
- **Mobile / Touch (390x844 landscape):**
  - [ ] Minimum tap targets remain >= 44px.
  - [ ] Placement banner is clearly dismissible.
  - [ ] Minimap toggle remains accessible without blocking bottom dock commands.
- **Colorblindness & Contrast:**
  - [ ] Population limit, under-attack state, and citadel damage readable under grayscale filter.

---

## Open questions

1. *Audio assets availability:* Do we have suitable short SFX clips in `public/assets/audio/` for click-to-move reticles, or should synthetic Web Audio API beeps/clicks be generated?
2. *RTS Hotkey scheme:* Does the team want classic AoE grid hotkeys (Q/W/E/A/S/D) or legacy mnemonic hotkeys (V for Villager, S for Swordsman)?

---

## Out of scope

- Backend protocol changes, Colyseus room refactoring, or database schema migrations.
- Complete overhaul of pixel art assets or redesign of core game mechanics.
- Replacing Phaser 3 canvas renderer or Tailwind CSS design framework.

---

## Completion criteria

- Comprehensive findings based on codebase evidence documented in `docs/plan/ui-ux-improvement-plan.md`.
- Prioritized with clear criteria, effort estimates, and validation procedures.
