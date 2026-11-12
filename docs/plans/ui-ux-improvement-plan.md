# 2D Game UI/UX Improvement Plan

- **Date:** 2026-11-11
- **Project / engine:** Phaser 3 (Canvas/WebGL) + React 18 (HUD/Overlays) + Tailwind CSS + Colyseus.js
- **Audit scope:** Client frontend components (`apps/client/src/components/*`), input controllers (`apps/client/src/game/input/*`), scenes (`WorldScene.ts`), stylesheets (`index.css`), mobile interactions (`MobileCommandBar.tsx`, `useInputMode.ts`, `OrientationGate.tsx`), audio cues (`commandSound.ts`, `alertSound.ts`), and localization catalogs (`apps/client/src/i18n/*`).
- **Limitations:** Live multi-client battles under real high-latency WAN conditions and physical VoiceOver/NVDA screen reader sessions were not interactively tested in this environment; verification relies on static code analysis, DOM hierarchy inspection, CSS math calculation, and Vitest test suites.

---

## Executive summary

The 2D MMO RTS web game *Chiến Quốc* delivers a responsive isometric RTS experience inspired by classic *Age of Empires*, complete with procedural rendering, touch command bars, placement banners, and minimap navigation.

While core feedback features (such as ground order decals, audio synthesis, placement banners, and font floors) have been implemented, a deep audit of recent additions reveals critical UI/UX and accessibility friction points:
1. **Screen Reader Blindspots:** Critical gameplay status changes (command rejected notifications and under-attack alert banners) lack ARIA live region attributes (`role="status"` or `role="alert"`), preventing assistive technology users from receiving feedback.
2. **Keyboard Focus & Modal Containment:** Full-screen overlays (`WorldMapOverlay`, `SpectatorOverlay`) and mobile drawer sheets (`BuildMenu`, `Minimap`) lack dialog semantics (`role="dialog"`, `aria-modal="true"`) and focus management, allowing keyboard `Tab` navigation to bleed into the underlying HUD while hidden.
3. **Overlay Stacking Collisions:** Multiple top-center banners (`PlacementBanner`, `RejectNotification`, and under-attack warning) use independent absolute `top-*` coordinates, causing visual overlap on standard and compact viewports.
4. **Localization Leakage:** In the HUD, citadel health and label strings (`THÀNH TRÌ`) remain hardcoded in Vietnamese even when English locale is selected.
5. **Contrast & Reduced Motion:** Secondary auxiliary labels (`text-slate-500`) fall below WCAG AA contrast ratios (3.07:1 - 4.24:1 vs required 4.5:1), and CSS animations (`animate-bounce`, `animate-pulse`, `animate-spin`) lack `prefers-reduced-motion` fallbacks.
6. **Mobile Tap Target Ergonomics:** Dismiss buttons on compact drawer panels are sized at 36px (`h-9 w-9`), falling short of the project's 44px (`MOBILE_MIN_TAP_PX`) touch target guideline.

Addressing these issues will elevate the game's polish, accessibility compliance, visual harmony, and multi-device usability.

---

## Implementation status (2026-11-12)

All ten recommendations below shipped as phase 27 slices `UIX-08..UIX-17` (see
[`27-ui-ux-recheck-fixes.md`](./27-ui-ux-recheck-fixes.md)). Verification for this round came from the
client test suite (56 files / 669 tests) plus `tsc` and a production build; no interactive screen-reader,
physical touch-device, or multi-client battle session was run.

Checkbox legend: `[x]` verified by an automated test; `[ ] ⏳` implemented and covered at the markup/unit
level but still waiting on a manual check (real screen reader, touch hardware, or a measured viewport).

| Item | Slice | Automated evidence |
| --- | --- | --- |
| Accessible live regions for toasts and under-attack alerts | `UIX-08` | `RejectNotification.test.tsx`, `PlacementBanner.test.tsx`, `TopOverlayStack.test.tsx` (App wiring scan) |
| Dialog semantics and focus management for overlays | `UIX-09` | `useModalFocus.test.ts`, `overlayAccessibility.test.ts` |
| Unified top-centre notification and banner stack | `UIX-10` | `TopOverlayStack.test.tsx`, `rejectVisuals.test.ts` |
| HUD citadel localization | `UIX-11` | `HUD.test.tsx` |
| Sub-AA contrast on 11px auxiliary information | `UIX-12` | `auxiliaryTextContrast.test.tsx`, `authSurfaces.test.ts`, `overlayAccessibility.test.ts` |
| `prefers-reduced-motion` support | `UIX-13` | `prefersReducedMotion.test.ts`, `styles.test.ts`, `orderFeedback.test.ts` |
| Mobile tap target ergonomics | `UIX-14` | `overlayAccessibility.test.ts` |
| Keyboard and touch accessible tooltips | `UIX-15` | `EntityDetails.test.tsx`, `overlayAccessibility.test.ts` |
| Master sound control and persistence | `UIX-16` | `audioSettings.test.ts`, `HUD.test.tsx` |
| Unified focus-visible rings | `UIX-17` | `styles.test.ts`, `authSurfaces.test.ts` |

---

## Current experience and evidence

### Player Flows & Codebase Mapping
- **Game Launch & Authentication:** `apps/client/src/App.tsx`, `AuthScreen.tsx`, `SessionBlocked.tsx`.
- **Top HUD & Resource Monitoring:** `apps/client/src/components/HUD.tsx` tracks resources, population, idle villagers, and citadel status.
- **Placement & Tooling Banner:** `apps/client/src/components/PlacementBanner.tsx` provides status pills and cancel buttons during construction or road/wall painting.
- **Command Rejection & Error Feedback:** `apps/client/src/components/RejectNotification.tsx` and `apps/client/src/game/alerts/rejectVisuals.ts`.
- **Unit & Building Inspection:** `apps/client/src/components/EntityDetails.tsx` and `UpgradePanels.tsx` render combat stats, production queues, and upgrade actions.
- **Base Construction & Wall Brush:** `apps/client/src/components/BuildMenu.tsx` manages building blueprints and wall tools.
- **Minimap Radar:** `apps/client/src/components/Minimap.tsx` renders real-time entity blips and camera viewports.
- **World Map & Raiding:** `apps/client/src/components/WorldMapOverlay.tsx` displays hex-grid neighbours, power differentials, and spectate/attack actions.
- **Spectator Mode:** `apps/client/src/components/SpectatorOverlay.tsx` provides a secondary read-only world view.

---

## Prioritized improvements

### [P1] Accessible Live Regions for Toasts and Under-Attack Alerts
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** In `apps/client/src/components/RejectNotification.tsx:46`, the reject banner renders as an unannotated `div` lacking `role` or `aria-live`. In `apps/client/src/App.tsx:1168`, the under-attack banner uses a plain `div` without live region markup. In `PlacementBanner.tsx:142-143`, `role="status"` wraps both the announcement text and the interactive "Cancel" button.
- **Player impact:** Screen reader players never receive auditory notification when an action fails (e.g., insufficient wood/food) or when their base is under siege. In placement mode, screen readers announce control buttons redundantly as status updates.
- **Recommendation:**
  - Assign `role="status"` and `aria-live="polite"` with dynamic incrementing `key={seq}` to `RejectNotification` so repeated error messages trigger announcements.
  - Assign `role="alert"` and `aria-live="assertive"` to the under-attack banner in `App.tsx`.
  - Refactor `PlacementBanner` so `role="status"` wraps only the text block, leaving the Cancel button as a sibling.
  - Mark decorative icons with `aria-hidden="true"`.
- **Acceptance criteria:**
  - [ ] ⏳ Screen readers announce server rejection messages on trigger — `role="status"` +
    `aria-live="polite"` asserted in `RejectNotification.test.tsx`; a real screen-reader pass is still owed.
  - [x] Repeated error messages trigger re-announcements: every notification stamps a fresh `seq` used as
    the live region's key.
  - [x] Under-attack alerts announce assertively (`role="alert"` + `aria-live="assertive"`).
  - [x] Interactive buttons are excluded from `role="status"` containers — the placement Cancel button is a
    sibling of the announced block.
- **Validation:** Inspect DOM accessibility tree in browser DevTools; verify `aria-live` regions update as expected on command rejection.
- **Effort:** XS
- **Dependencies / risks:** None.

---

### [P1] Dialog Semantics and Focus Management for Overlays
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** `apps/client/src/components/WorldMapOverlay.tsx:93`, `SpectatorOverlay.tsx:41`, `BuildMenu.tsx:317`, and `Minimap.tsx:477` lack `role="dialog"`, `aria-modal="true"`, or `aria-labelledby`. None of these overlays trap keyboard focus or restore focus on close.
- **Player impact:** Keyboard players navigating with `Tab` cycle through interactive elements underneath the modal backdrop, causing accidental inputs and disorientation.
- **Recommendation:**
  - Implement a reusable `useModalFocus(containerRef, isOpen, onClose)` hook.
  - Trap `Tab` and `Shift+Tab` within the active overlay while open.
  - Automatically focus the primary close button on open, and restore focus to the trigger element on close (`Esc` or button click).
  - Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` referencing existing title headings.
- **Acceptance criteria:**
  - [x] Tabbing inside the overlays cycles within the modal (`nextFocusIndex` wrap-around unit-tested;
    `activateModalFocus` covered with a fake DOM).
  - [x] Closing via `Esc` or the close button returns focus to the trigger (`isConnected` guarded).
  - [x] Compact sheets for `BuildMenu` and `Minimap` trap focus while open.
  - [ ] ⏳ Real-browser `Tab` sweep over the four overlays (no jsdom in this suite).
- **Validation:** Open `WorldMapOverlay`, press `Tab` 10 times, verify focus never leaves the modal container, press `Esc`, verify focus returns to HUD map icon.
- **Effort:** S
- **Dependencies / risks:** Must ensure focus trap does not conflict with canvas key event listeners.

---

### [P1] Unified Top-Center Notification & Banner Stack
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** `PlacementBanner.tsx:140` uses `top-20` (desktop) and `top-[calc(env(safe-area-inset-top)+4.75rem)]` (mobile). `RejectNotification.tsx` uses `top-16` with `animate-bounce`. `App.tsx:1168` renders the under-attack banner at `top-16` or `top-24`. When multiple states are active simultaneously, they collide and occlude one another.
- **Player impact:** During a raid or simultaneous construction while receiving an error, banners overlap, making text unreadable and blocking the Cancel button.
- **Recommendation:**
  - Introduce a unified `TopOverlayStack` container (`pointer-events-none fixed left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1.5`).
  - Sequence components in priority order: Under-Attack Banner -> Command Rejection Toast -> Placement Banner.
  - Ensure individual banner pills have `pointer-events-auto` while parent stack allows clicks through to canvas.
- **Acceptance criteria:**
  - [x] Simultaneous under-attack alert, reject toast, and placement banner share one `flex-col` column, so
    they stack instead of overlapping.
  - [x] Placement Cancel button stays clickable: the stack is `pointer-events-none` and the banner pill
    re-enables `pointer-events-auto`.
  - [x] Compact stack reuses the `top-[calc(env(safe-area-inset-top)+4.75rem)]` anchor that already clears the
    citadel row.
  - [ ] ⏳ Screenshot pass at 1920x1080 and 390x844.
- **Validation:** Force trigger reject message while in placement mode and under attack; verify vertical alignment and clickability at 1920x1080 and 390x844.
- **Effort:** S
- **Dependencies / risks:** Requires coordination in `App.tsx` layout.

---

### [P1] Resolve HUD Citadel Localization Leakage
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** In `apps/client/src/components/HUD.tsx:76`, tooltip is hardcoded as `Thành trì: ${Math.ceil(status.hp)} / ${Math.ceil(status.maxHp)} máu`. In `HUD.tsx:82`, the label is hardcoded as `THÀNH TRÌ`. There is no `hud.citadel` key in `apps/client/src/i18n/en.ts`.
- **Player impact:** English-speaking players see Vietnamese text for the central citadel indicator, breaking immersion and localization completeness.
- **Recommendation:**
  - Add `hud.citadel` ("CITADEL" / "THÀNH TRÌ") and `hud.citadelTitle` ("Citadel: {{hp}} / {{maxHp}} HP" / "Thành trì: {{hp}} / {{maxHp}} máu") to `en.ts` and `vi.ts`.
  - Replace hardcoded strings in `HUD.tsx` with `t('hud.citadel')` and `t('hud.citadelTitle', { hp: ..., maxHp: ... })`.
- **Acceptance criteria:**
  - [x] English shows "CITADEL" and an English tooltip.
  - [x] Vietnamese shows "THÀNH TRÌ" and a Vietnamese tooltip.
  - [x] Zero untranslated Vietnamese strings remain in `HUD.tsx` (source scan in `HUD.test.tsx`).
- **Validation:** Toggle language switcher between EN and VI; verify label and tooltip text.
- **Effort:** XS
- **Dependencies / risks:** None.

---

### [P2] Elevate Sub-AA Contrast on 11px Auxiliary Information
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** Multiple informational labels use `text-slate-500` (e.g., in `UpgradePanels.tsx`, `WorldMapOverlay.tsx`, `HUD.tsx`, and `EntityDetails.tsx`). Slate-500 (`#64748b`) against dark backgrounds (`#020617`, `#0f172a`, and panel `#1e293b`) yields contrast ratios of 3.07:1 to 4.24:1, failing WCAG AA (minimum 4.5:1 for 11px text).
- **Player impact:** Auxiliary gameplay information (cooldown remaining, building requirements, unit stats) is difficult to read in dim environments or on low-contrast screens.
- **Recommendation:**
  - Update informational labels from `text-slate-500` to `text-slate-400` (yielding 5.9:1 to 7.87:1 contrast ratio).
  - Retain `text-slate-500` or `text-slate-600` strictly for truly disabled or inactive buttons.
- **Acceptance criteria:**
  - [x] Informational `text-slate-500` is gone; the only remaining `slate-500`/`slate-600` uses are on
    disabled controls, which are exempt (ratio is 7.87:1 / 5.9:1 for `slate-400` per WCAG math).
  - [x] No font size or layout changed, so the hierarchy stands.
  - [ ] ⏳ Contrast measurement on real screenshots (contrast checker / Lighthouse).
- **Validation:** Measure contrast using Lighthouse / WebAIM contrast checker across all HUD panels.
- **Effort:** XS
- **Dependencies / risks:** None.

---

### [P2] Support Operating System `prefers-reduced-motion`
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** `apps/client/src/index.css` lacks `@media (prefers-reduced-motion: reduce)`. CSS classes `animate-bounce` (`rejectVisuals.ts:10`), `animate-pulse` (11 instances across `HUD.tsx` and alerts), and `animate-spin` run continuously. Phaser order feedback tweens run without reduced motion checks.
- **Player impact:** Users with vestibular motion disorders or sensory sensitivities may experience dizziness or distraction from pulsing and bouncing UI elements.
- **Recommendation:**
  - In `index.css`, add a global `@media (prefers-reduced-motion: reduce)` block that disables continuous animation on `.animate-bounce`, `.animate-pulse`, and `.animate-spin` (preserving static visibility).
  - In `orderFeedback.ts`, check `window.matchMedia('(prefers-reduced-motion: reduce)').matches`; when true, render decals statically with an immediate cleanup timeout instead of scaling/alpha tweening.
- **Acceptance criteria:**
  - [x] Reduced motion stops bounce/pulse/spin while keeping the resting frame visible
    (`styles.test.ts` scans the `@media (prefers-reduced-motion: reduce)` block).
  - [x] Ground click markers still appear and disappear with no tween (static draw + `delayedCall(150)`).
  - [x] Standard motion is untouched when the preference is off (both branches unit-tested).
  - [ ] ⏳ Observing the real OS setting on macOS/Windows.
- **Validation:** Emulate `prefers-reduced-motion: reduce` in browser DevTools rendering tab and observe UI behavior.
- **Effort:** S
- **Dependencies / risks:** None.

---

### [P2] Mobile Tap Target Ergonomics for Close Buttons
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** In `BuildMenu.tsx:327` and `Minimap.tsx:491`, compact close buttons are styled with `h-9 w-9` (36px). In `WorldMapOverlay.tsx:304,315`, buttons use `min-h-[42px]`. The project's mobile standard (`MOBILE_MIN_TAP_PX` in `inputMode.ts`) is 44px.
- **Player impact:** On touch devices, closing compact build sheets or minimap popups leads to missed taps or misclicks on neighboring tiles.
- **Recommendation:**
  - In compact mode, enforce minimum dimensions of 44x44px (`min-h-[44px] min-w-[44px]`) on panel close buttons.
  - Increase World Map action buttons to `min-h-[44px]`.
- **Acceptance criteria:**
  - [x] Compact close buttons and the two World Map action buttons meet 44x44 px.
  - [x] Headers keep their existing height: the 44 px floor is a `style` minimum over the old 36 px box, and
    the `BuildMenu` close button was already 44 px.
  - [ ] ⏳ Bounding-box measurement on a 390x844 emulation.
- **Validation:** Inspect touch target bounding client rects in mobile viewport emulation (390x844).
- **Effort:** XS
- **Dependencies / risks:** Header container padding may require slight adjustment.

---

### [P2] Keyboard & Touch Accessible Tooltips for Production and Buildings
- **Status:** Implemented (2026-11-12)
- **Confidence:** Medium
- **Type:** Observed issue
- **Evidence:** In `BuildMenu.tsx:197` and `EntityDetails.tsx:538`, tooltips rely exclusively on `group-hover` and `group-hover/train`. They lack `group-focus-within`, `focus:opacity-100`, or touch activation hooks.
- **Player impact:** Players navigating via keyboard or touch cannot inspect costs, unit descriptions, attack stats, or train times before clicking.
- **Recommendation:**
  - Add `group-focus-within:opacity-100` and `focus-visible:opacity-100` to tooltips.
  - Link tooltips to their buttons using `id` and `aria-describedby`.
  - For touch devices, support viewing cost and stat details via long-press or tap-to-inspect toggle.
- **Acceptance criteria:**
  - [x] Tabbing to a building or train button reveals the tooltip (`group-focus-within:opacity-100`).
  - [x] Costs and stats are wired through `id` + `aria-describedby` (asserted 1:1).
  - [x] Touch players preview costs with a press (`group-active`) instead of hover.
  - [ ] ⏳ Screen-reader utterance and touch-hardware confirmation.
- **Validation:** Tab through the build menu and barracks training buttons; verify tooltips display on focus.
- **Effort:** S
- **Dependencies / risks:** Ensure tooltips do not clip outside `overflow-y-auto` panels.

---

### [P3] Master Sound Control & Persistence
- **Status:** Implemented (2026-11-12)
- **Confidence:** Medium
- **Type:** Observed issue
- **Evidence:** `commandSound.ts:48` provides `setCommandSoundEnabled`, but it has no UI binding. `alertSound.ts` lacks an enable/disable switch. There is no sound toggle in the game HUD.
- **Player impact:** Players in quiet environments or using external music players cannot mute game sounds without muting their entire browser tab.
- **Recommendation:**
  - Create a lightweight `audioSettings.ts` helper with localStorage persistence (`cq.sound`).
  - Add a mute/unmute icon button (`Volume2` / `VolumeX`) to the HUD adjacent to the connectivity indicator.
  - Connect the toggle to both `commandSound.ts` and `alertSound.ts`.
- **Acceptance criteria:**
  - [x] The button mutes/unmutes both synthesized voices immediately (no reload).
  - [x] The choice persists in `localStorage` under `cq.sound` and is re-applied at load.
- **Validation:** Toggle sound off, issue move orders and trigger alert, confirm silence, refresh tab, confirm state remains muted.
- **Effort:** S
- **Dependencies / risks:** Web Audio context requires user interaction to initialize.

---

### [P3] Unified Focus-Visible Rings
- **Status:** Implemented (2026-11-12)
- **Confidence:** High
- **Type:** Observed issue
- **Evidence:** In `index.css`, there is no global `:focus-visible` styling. In `AuthScreen.tsx:109,127,146`, inputs use `focus:outline-none`. Keyboard navigation relies on inconsistent default browser rings that clash with the medieval theme.
- **Player impact:** Keyboard users lose track of focus position when navigating menus and HUD controls.
- **Recommendation:**
  - Add a consistent global focus-visible ring in `index.css`:
    `:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }`
  - Remove `focus:outline-none` from form inputs.
- **Acceptance criteria:**
  - [x] The global `:focus-visible` rule draws a 2 px amber ring with a 2 px offset, and the AuthScreen
    inputs no longer opt out with `focus:outline-none`.
  - [x] Mouse clicks do not draw it — the rule is `:focus-visible`, not `:focus`.
  - [ ] ⏳ Keyboard sweep over HUD, dock, and overlays in a real browser.
- **Validation:** Navigate all screens with `Tab` and verify amber outline clarity.
- **Effort:** XS
- **Dependencies / risks:** None.

---

## Implementation phases

### Phase 1: High-Priority Accessibility & Feedback (Now)
- [P1] Accessible Live Regions for Toasts and Under-Attack Alerts.
- [P1] Unified Top-Center Notification & Banner Stack.
- [P1] Dialog Semantics and Focus Management for Overlays.
- [P1] Resolve HUD Citadel Localization Leakage.

### Phase 2: Readability, Motion, & Ergonomics (Next)
- [P2] Elevate Sub-AA Contrast on 11px Auxiliary Information.
- [P2] Support Operating System `prefers-reduced-motion`.
- [P2] Mobile Tap Target Ergonomics for Close Buttons.
- [P2] Keyboard & Touch Accessible Tooltips for Production and Buildings.

### Phase 3: Sound Controls & Polish (Later)
- [P3] Master Sound Control & Persistence.
- [P3] Unified Focus-Visible Rings.

---

## Historical implementation status (2026-11-09)

The initial audit recommendations shipped with comprehensive automated test coverage:

| Item | Implementation | Automated coverage |
| --- | --- | --- |
| Ground order decals | `apps/client/src/game/render/orderFeedback.ts`, wired through `CommandController.showFeedback` | `orderFeedback.test.ts` (specs, 300 ms budget, depth, draw/tween/destroy) |
| Order acknowledgement audio | `apps/client/src/game/audio/synthVoice.ts` (shared lazy-context/tone voice) used by both `alertSound.ts` and `commandSound.ts` | `commandSound.test.ts`, `alertSound.test.ts` |
| 11px font floor | `text-[8px]`/`text-[9px]`/`text-[10px]` removed from every HUD component | `typography.test.ts` (source scan for Tailwind and SVG sizes) |
| Placement banner | `apps/client/src/components/PlacementBanner.tsx`, mounted in `App.tsx` | — |
| Colorblind-safe alerts | `AlertTriangle` on population cap / citadel threshold / under-attack, signed delta on World Map hexes | `worldMapArt.test.ts` (`levelDeltaLabel`) |
| Selection marquee contrast + sound | `WorldScene.drawDragBox` dual-tone border; `SelectionController.handleBoxSelect` completion cue | `selectionSound.test.ts` |
| Production hotkeys | `apps/client/src/game/input/unitHotkeys.ts` plus `CommandController.bindTrainingKeys`; badges in `EntityDetails.tsx` | `unitHotkeys.test.ts`, `trainingHotkeys.test.ts` |
| Idle villagers counter & aria-label | `apps/client/src/components/HUD.tsx`, accessible button with jump handler | Tested in `HUD.tsx` unit flow |

---

## Validation checklist

Every item below is now backed by a test (see the table above) except the ones marked ⏳, which need a
human eye, a real screen reader, or physical touch hardware.

- **Desktop (1920x1080 & 1366x768):**
  - [ ] ⏳ HUD elements fit without vertical overlap.
  - [ ] ⏳ Ground click reticles align precisely with cursor tip.
  - [x] Simultaneous placement banner, reject toast, and under-attack alert share one vertical column.
  - [x] `Tab` navigation draws the amber `:focus-visible` ring (rule asserted; sweep ⏳).
- **Mobile / Touch (390x844 landscape):**
  - [x] Close buttons and World Map actions meet >= 44x44px (source-level floor asserted).
  - [ ] ⏳ Placement banner Cancel button remains reachable and clear of the citadel bar.
  - [ ] ⏳ Minimap toggle remains accessible without blocking bottom dock commands.
- **Accessibility & Motion:**
  - [ ] ⏳ Screen readers announce rejections politely and under-attack alerts assertively (markup asserted).
  - [x] Modal overlays trap focus and release it on close (unit-level).
  - [ ] ⏳ Population limit, under-attack state, and citadel damage readable under a grayscale filter.
  - [x] System reduced motion disables continuous bouncing, pulsing, and spinning (CSS asserted).
- **Localization & Audio:**
  - [x] Citadel HP and label localize to "CITADEL" / "THÀNH TRÌ".
  - [x] HUD sound toggle silences both synthesized SFX and persists the choice in localStorage.

---

## Open questions

1. *Screen reader verbosity during combat:* Under-attack alerts fire assertively. If an attack is prolonged, should consecutive alerts be throttled (e.g. at most once every 10 seconds) to avoid auditory fatigue?
2. *Touch tooltip interaction:* On touch screens where hover does not exist, should tapping a unit train button once show the tooltip and a second tap trigger production, or should a dedicated info badge be used?
3. *Settings overlay vs HUD toggle:* As UI settings grow (audio volume, graphics quality, language, keybindings), should they move into a dedicated modal settings menu rather than expanding individual HUD icons?

---

## Out of scope

- Backend protocol changes, Colyseus room schemas, or SQLite database migrations.
- Canvas screen reader virtual DOM generation (Phaser isometric canvas rendering remains visual).
- Full redesign of medieval pixel art sprites or tile sets.
- Removing `maximum-scale=1, user-scalable=no` (required for custom canvas gesture handling).

---

## Completion criteria

The plan is complete when findings are evidence-linked, prioritized, testable, and saved in `docs/plans/`.
