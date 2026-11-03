# Phase 11 — Hỗ trợ chơi trên mobile (touch + landscape)

Status: **IMPLEMENTED** (2026-11-03). Code + doc xong; kiểm chứng tự động xanh, kiểm chứng tay
bằng Chrome headless CDP xong phần lớn (xem §11). Còn lại: checklist trên máy thật (§9).
Phạm vi: `apps/client` (+ `docs/plans/README.md`). **Không** đổi `apps/server`, `packages/shared`,
schema, protocol hay DB.

Xuất phát từ yêu cầu "plan support chơi trên mobile". Hiện tại game chỉ chơi được bằng chuột + phím:
mọi lệnh đi qua chuột phải, zoom bằng wheel, pan bằng phím mũi tên + edge scroll, và HUD là layout
ngang 3 khối của desktop.

## 1. Mục tiêu

Chơi được trận RTS đầy đủ trên điện thoại/tablet ở **landscape**, không cần chuột/phím, không đổi
server và không đổi protocol.

Tiêu chí thành công (đo được):

1. Trên viewport 844×390 và 667×375 (touch emulation): HUD không chồng lấn, không phần tử nào bị
   browser chrome che, mọi nút bấm chính ≥ 44×44 CSS px. Ngoại lệ có chủ ý (đo lại ở §11.3): hàng
   roster trong `ControlGroups` cao 34 px (9 nhóm × 44 px = 396 px, không vừa màn 390 px) và nút
   đóng panel 36 px (góc panel, cách control khác ≥ 8 px).
2. Thao tác chạm chạy trọn vòng lặp: chọn dân → chọn công trình → đặt nhà → chọn dân → thu hoạch →
   chọn lính → attack-move → về cổng đổi map.
3. Pan / pinch zoom / chọn vùng / long-press order hoạt động; zoom luôn trong `0.4..2.2`.
4. Desktop **không đổi hành vi**: nhánh chuột giữ nguyên; test cũ xanh; checklist chuột pass tay.
5. `pnpm --filter @chien-quoc/client test` xanh, `tsc --noEmit` sạch cho `apps/client`.
   Không migration DB, không reset DB.

Không thuộc mục tiêu: PWA/offline, gán nhóm quân trên mobile, joystick ảo, chơi portrait, đổi art,
tối ưu simulation server.

## 2. Quyết định

| # | Quyết định | Nguồn |
| --- | --- | --- |
| D1 | Full touch RTS: kéo 1 ngón = pan, chạm = chọn, chụm 2 ngón = zoom, giữ ~350 ms = lệnh ngữ cảnh, thanh lệnh dưới màn hình | user |
| D2 | Landscape bắt buộc: portrait hiện overlay "Xoay ngang máy" (chỉ trên thiết bị touch); không dùng `screen.orientation.lock` | user |
| D3 | Không PWA/manifest/service worker | user |
| D4 | Chưa làm gán nhóm quân trên mobile; panel `ControlGroups` hiện có vẫn bấm để nhớ nhóm | user |
| D5 | Chạm nền trống khi có quân đang chọn = **move** (một chạm, giống mobile RTS); bỏ chọn bằng nút "Bỏ chọn" | suy ra từ D1 |
| D6 | Chạm vào thực thể = **chọn/inspect**, không ra lệnh; lệnh ngữ cảnh (đánh/thu hoạch/vào cổng/rally) = **giữ lâu** hoặc nút "Ra lệnh" rồi chạm | suy ra từ D1 |
| D7 | Box-select là **chế độ một lần**: bật nút → kéo 1 lần → tự tắt (để pan không bị khoá) | suy ra từ D1 |
| D8 | Ranh giới desktop/touch: nhánh touch quyết định bằng `pointer.wasTouch`; UI compact quyết định bằng `detectInputMode()` (`(pointer: coarse)` / `maxTouchPoints`), không dùng breakpoint Tailwind | suy ra từ D1 |
| D9 | Pinch zoom quanh midpoint + pan theo midpoint; pinch **huỷ** box-select và tap đang chờ, **không** huỷ placement/armed order | suy ra từ D1 |
| D10 | Không đổi `NetworkMessage`: dùng lại `MOVE_UNITS`, `ATTACK_MOVE`, `PATROL`, `ATTACK_TARGET`, `HARVEST_RESOURCE`, `BUILD_TARGET`, `TRAVEL`, `SET_RALLY_POINT`, `PLACE_BUILDING` | ràng buộc |

## 3. Hiện trạng (đọc từ code)

- Phaser mặc định `input.activePointers = 1` → tổng 2 pointer (mouse + 1 touch);
  [`PhaserGame.tsx:50`](../../apps/client/src/game/PhaserGame.tsx#L50) chưa cấu hình. Touch được
  Phaser gán `buttons = 1` (`Pointer#touchstart`), nên `pointer.leftButtonDown()` **true** ⇒ một
  lần chạm rơi vào nhánh **box-select** ở
  [`WorldScene.ts:1082`](../../apps/client/src/game/scenes/WorldScene.ts#L1082). Không có
  right-click trên touch.
- Lệnh = chuột phải ([`CommandController.ts:534`](../../apps/client/src/game/input/CommandController.ts#L534)),
  zoom = wheel / `+` / `-` ([`WorldScene.ts:493`](../../apps/client/src/game/scenes/WorldScene.ts#L493),
  [`CameraController.ts:52`](../../apps/client/src/game/input/CameraController.ts#L52)),
  pan = phím mũi tên + edge scroll
  ([`WorldScene.ts:1322`](../../apps/client/src/game/scenes/WorldScene.ts#L1322),
  [`cameraInput.ts:27`](../../apps/client/src/game/input/cameraInput.ts#L27)).
- `applyEdgeScroll` pan liên tục sau khi nhấc ngón: `activePointer` giữ nguyên toạ độ cuối, nên một
  ngón nhấc sát mép sẽ khoá camera vào mép đó.
- Cursor là CSS tuỳ biến ([`CursorController.ts:102`](../../apps/client/src/game/input/CursorController.ts#L102));
  tooltip `group-hover` (`BuildMenu.tsx:106`) và câu "Chuột phải…" trong
  [`EntityDetails.tsx:179`](../../apps/client/src/components/EntityDetails.tsx#L179) vô nghĩa trên touch.
- Dock dưới ([`App.tsx:513`](../../apps/client/src/App.tsx#L513)): minimap 140 px
  ([`minimapArt.ts:14`](../../apps/client/src/components/minimapArt.ts#L14)), card `w-80`
  ([`EntityDetails.tsx:83`](../../apps/client/src/components/EntityDetails.tsx#L83)), 8 nút 64 px
  ([`BuildMenu.tsx:80`](../../apps/client/src/components/BuildMenu.tsx#L80)) ⇒ vỡ ở 390 px.
- `index.html` thiếu `viewport-fit=cover`; CSS thiếu `dvh`, safe-area, `touch-action: none`,
  `overscroll-behavior`.
- Hộp thân trong hit-test là 36×40 world px
  ([`hitTest.ts:37-52`](../../apps/client/src/game/input/hitTest.ts#L37-L52)) — ngón tay cần dung sai
  rộng hơn.
- Không có join lại khi app bị background/khoá màn hình: chỉ `room.onLeave` → banner đỏ
  ([`App.tsx:222`](../../apps/client/src/App.tsx#L222)).
- Server không cần sửa: `RateLimiter` chỉ áp `/auth/*`; `WorldRoom.onLeave`
  ([`WorldRoom.ts:1546`](../../apps/server/src/rooms/WorldRoom.ts#L1546)) release session nên join
  lại cùng token được chấp nhận.

## 4. Bảng quyết định cử chỉ (hợp đồng hành vi)

| Cử chỉ | Điều kiện | Hành động |
| --- | --- | --- |
| Chạm (nhấc < 400 ms, di < 12 px, 1 ngón) | đang placement | `placement.commit(pointer)` |
| | đang arm `ATTACK_MOVE` / `PATROL` | `commands.commitPendingOrder` |
| | đang arm "Ra lệnh" | `commands.handleRightClick` (contextual) |
| | chạm trúng thực thể | `selection.handleTap` (chọn; chạm 2 lần < 350 ms = chọn cùng loại) |
| | chạm nền trống, có quân chọn | `commands.commandMoveTo` |
| | nền trống, không chọn gì | không làm gì |
| Giữ ≥ 350 ms | đang arm order | huỷ arm (thoát an toàn) |
| | đang placement | không làm gì |
| | còn lại | `commands.handleRightClick` + feedback + `navigator.vibrate(10)` |
| Kéo 1 ngón > 12 px | box-select đang bật | vẽ rect, nhấc → `selection.handleBoxSelect`, tự tắt mode |
| | còn lại | pan camera |
| 2 ngón | luôn | pinch zoom + pan midpoint; huỷ tap/long-press/box-select, giữ placement & armed order |
| `pointercancel` | luôn | reset gesture, `cameraControl.endMiddleDrag()`, đóng rect không chọn |

## 5. Thay đổi theo subsystem

### A. Nền tảng viewport / layout (`MOB-01`)

- [`index.html`](../../apps/client/index.html): viewport `width=device-width, initial-scale=1.0,
  maximum-scale=1.0, user-scalable=no, viewport-fit=cover`; thêm `<meta name="theme-color">`.
  `maximum-scale`/`user-scalable` là bổ sung so với plan gốc: chặn double-tap zoom và pinch-zoom
  của Safari iOS khi ngón chạm vào HUD (DOM), nơi `touch-action: none` của canvas không với tới.
- [`index.css`](../../apps/client/src/index.css): `html, body, #root { height: 100dvh }` (fallback
  `100vh`); `overscroll-behavior: none`; `-webkit-tap-highlight-color: transparent`;
  `-webkit-touch-callout: none`; `canvas { touch-action: none }`; class `.safe-top/.safe-bottom/.safe-x`
  dùng `env(safe-area-inset-*)`; dưới `@media (hover: none)` tắt tooltip `group-hover`.
- [`App.tsx`](../../apps/client/src/App.tsx): `w-screen h-screen` → `.app-shell` dùng dvh; mount
  `OrientationGate` (chỉ khi touch + portrait) và `MobileCommandBar`.

### B. Nhận diện chế độ nhập (`MOB-01`)

- Mới `apps/client/src/device/inputMode.ts` (thuần): `detectInputMode({ maxTouchPoints, coarsePointer, width })`
  → `'touch' | 'mouse'`; `isPortraitViewport(w, h)`; hằng `MOBILE_MIN_TAP_PX = 44`,
  `TOUCH_PICK_SLACK = 1.5`.
- Mới `apps/client/src/device/useInputMode.ts`: hook đọc `matchMedia('(pointer: coarse)')` +
  `orientationchange`, giữ mode ổn định trong phiên.

### C. Lớp gesture touch (`MOB-02`)

- [`PhaserGame.tsx`](../../apps/client/src/game/PhaserGame.tsx): thêm `input: { activePointers: 3 }`
  (2 ngón chạm đồng thời + mouse).
- Mới `apps/client/src/game/input/touchGesture.ts` — máy trạng thái **thuần**, không import Phaser:
  - `begin/move/end/cancel(id, x, y, t)` → `{ kind: 'none' | 'pan' | 'pinch' | 'tap' | 'long-press' }`.
  - Hằng: `TAP_MAX_MOVE_PX = 12`, `TAP_MAX_MS = 400`, `LONG_PRESS_MS = 350`,
    `PINCH_MIN_SPAN_PX = 24`.
  - Hàm thuần `zoomFromPinch(currentZoom, factor, min, max)` (đổi tên so với `pinchZoom` trong
    bản plan đầu, giữ nguyên ngữ nghĩa: nhân theo tỉ lệ span, clamp biên).

### D. Glue Phaser + scene (`MOB-02`, `MOB-03`)

- Mới `apps/client/src/game/input/TouchController.ts`: đẩy sự kiện `pointer1..3` vào máy trạng thái,
  áp pan (`camera.scrollX/Y -= delta / zoom`), pinch (`cameraControl.setZoom` + dời camera theo
  midpoint), tap/long-press (gọi API ở §5.E).
- [`WorldScene.ts`](../../apps/client/src/game/scenes/WorldScene.ts): rẽ nhánh đầu tiên trong
  `handlePointerMove/Down/Up` (`:1026`, `:1098`, `:1174`): `if (pointer.wasTouch) { this.touchMode = true;
  this.touch.move|begin|end(pointer); return; }` ⇒ nhánh chuột không đổi. Mọi nhánh chuột đặt
  `this.touchMode = false` để máy hybrid trả lại cursor + edge scroll ngay khi có chuột.
- [`cameraInput.ts`](../../apps/client/src/game/input/cameraInput.ts): `EdgeScrollOptions` thêm
  `enabled: boolean`; call site truyền `!this.touchMode`. Cập nhật `cameraInput.test.ts`.
- `CursorController.set` no-op khi `scene.touchMode`.

### E. API scene cho HUD + touch (`MOB-03`, `MOB-04`)

Thêm vào `WorldScene`, tất cả đều mỏng và uỷ quyền cho controller sẵn có:

- Nhóm lệnh: `armOrder('ATTACK_MOVE'|'PATROL')`, `armContextualOrder()`, `cancelArmedOrder()`,
  `get armedOrder()`, `publishArmedOrder()` (đẩy trạng thái sang `onArmedOrderChange`),
  `cycleSelectedStance()`, `centerOnBase()`, `setCameraZoom(zoom)`, `zoomByStep(n)`.
- Nhóm box-select: `setBoxSelectMode(armed)`, `get isBoxSelectArmed`, `onBoxSelectChange`.
- Nhóm gesture: `touchPressPointer` (ghost placement tại điểm chạm), `touchTapPointer`,
  `touchLongPressPointer`, `beginTouchDrag/updateTouchDrag/endTouchDrag/cancelTouchDrag`.
- [`PlacementController`](../../apps/client/src/game/input/PlacementController.ts) tách `showGhostAt`
  để ghost hiện ngay tại điểm chạm (`touchPressPointer`).
- [`SelectionController.handleClick(pointer, additive, selectSameType, pickSlack = 1)`](../../apps/client/src/game/input/SelectionController.ts)
  và `hasTargetAt(pointer, pickSlack = 1)`; [`hitTest.ts`](../../apps/client/src/game/input/hitTest.ts):
  `getUnitBodyBox(container, slack = 1)`, `hitTestUnit(..., slack = 1)`,
  `findUnitAt(..., ownerFilter, slack = 1)`, bán kính resource `38 * slack`. Mặc định `1` ⇒
  desktop y nguyên.

### F. Thanh lệnh mobile (`MOB-05`)

Mới `apps/client/src/components/mobile/MobileCommandBar.tsx` (nút 46×48 px, icon lucide + nhãn
ngắn, `data-mobile-command-bar`, cuộn ngang khi thiếu chỗ): `Huỷ lệnh` (chỉ hiện khi armed) ·
`Ra lệnh` (contextual) · `Đánh` (ATTACK_MOVE) · `Tuần tra` (PATROL) · `Dừng` · `Thế trận` ·
`Chọn vùng` · `Bỏ chọn` · `−`/`+` zoom · `Nhà chính`. Nút disable theo ngữ cảnh; đang arm thì nút
tương ứng sáng và hiện thêm `Huỷ lệnh`.

### G. HUD compact (`MOB-06`)

Thêm prop `compact?: boolean`, không tách bản sao component:

- `HUD.tsx`: một hàng, tên cắt `max-w-[72px]`, 4 chip tài nguyên + dân số + idle + icon ONLINE +
  nút đăng xuất, padding safe-top; thêm prop `onLeaveGame` (trước đây nút logout là phần tử nổi
  riêng trong `App.tsx`, desktop giữ nguyên chỗ đó).
- `Minimap.tsx`: không thu nhỏ radar mà thu về **một nút "Bản đồ" 48 px**; bấm mở panel nổi chứa
  radar 96 px + hint. Chạm radar = pan, **giữ 350 ms** = `onCommandAtGrid`. Lý do đổi so với plan:
  radar 96 px nằm thường trực ở dock dưới đã che mất vùng chạm của canvas (đo được: cử chỉ pinch
  rơi vào panel thay vì canvas), và panel nổi chỉ chiếm chỗ khi người chơi cần.
- `EntityDetails.tsx`: `w-full max-w-[420px] max-h-[28dvh]`; prop `interactionHint` để đổi
  "Chuột phải…" → "Giữ lâu…"; `[&_button]:min-h-[38px]` cho nút trong card.
- `BuildMenu.tsx`: sheet mở bằng nút `Xây`, lưới 4×2 ô 48 px, ẩn nhãn hotkey và tooltip hover,
  nút `Huỷ đặt`.
- `ControlGroups.tsx`: `w-32`, hàng `min-h-[34px]`, thu về cột phải.

### H. Auth / overlay (`MOB-07`)

`AuthScreen.tsx`: `useInputMode()` → `isTouch`; input `text-base min-h-[44px]` (16 px, tránh iOS
zoom khi focus), container `max-h-[94dvh] overflow-y-auto`, `.safe-x`; tab `min-h-[44px]`, submit
`min-h-[48px]`; danh sách điều khiển đổi sang bản touch ("Giữ lâu = lệnh", "Chạm = chọn") thay cho
bảng phím tắt desktop. `SessionBlocked.tsx`: `max-h-[94dvh]` + nút `min-h-[48px]`.
`OrientationGate` mới: overlay `data-orientation-gate`, "XOAY NGANG MÁY", chỉ render khi
`inputMode === 'touch' && isPortrait`.

### I. Join lại khi quay về app (`MOB-08`)

- Mới `apps/client/src/device/resume.ts` (thuần): `shouldAutoReconnect({ hasUser, isJoined, isJoining,
  sessionTaken, isLeaving, isVisible })`, `RESUME_ATTEMPTS = 3`, `RESUME_RETRY_DELAY_MS = 700`.
- `App.tsx`: `visibilitychange` → khi visible và predicate đúng, join lại **tối đa 3 lần cách 700 ms**;
  nhánh `taken` được thử lại (tham số `tolerateTakenAttempts` của `connectToZone`) vì sau khi khoá
  màn hình server có thể chưa kịp release session cũ; hết lượt vẫn `force: false` và để
  `SessionBlocked`/panel "MẤT KẾT NỐI" xử lý, **không tự takeover**.
- Panel "MẤT KẾT NỐI" (z-40) có `Kết nối lại` và `Đăng xuất`, chỉ hiện khi đã login mà chưa vào room.

### J. Hiệu năng touch (`MOB-09`)

- Không set CSS cursor khi touch.
- `Minimap` dừng `requestAnimationFrame` khi `document.hidden`.
- Canvas giữ `resolution` mặc định (1) — ưu tiên pin/fps; HUD là DOM nên vẫn sắc. Chỉ đổi nếu đo
  trên máy thật thấy mờ.
- `orientationchange` / `visualViewport.resize` / `resize` → `game.scale.resize`; canvas lấy
  `container.clientWidth/Height` (fallback `window`) để không phụ thuộc `window.innerHeight` khi
  thanh địa chỉ của mobile đang ẩn/hiện. `orientationchange` được hoãn 1 tick vì Safari báo kích
  thước cũ ở lần đo đầu.

## 6. Edge case & failure mode

1. **Edge scroll dính ngón** — tắt bằng `enabled: false` khi touch; có test.
2. **iOS page-zoom khi pinch** — `touch-action: none` trên canvas + `input.touch.capture = true`
   của Phaser (listener non-passive, đã `preventDefault`); verify máy thật, fallback
   `gesturestart` preventDefault nếu cần.
3. **Tap vs long-press biên** — long-press phát đúng 1 lần ở 350 ms và đánh dấu gesture đã tiêu thụ;
   nhấc sau đó không sinh tap. Có test.
4. **Pinch khi đang kéo box** — box huỷ, không chọn gì; armed order/placement giữ nguyên.
5. **Placement trên touch** — pointerdown chỉ cập nhật ghost, **chỉ tap** mới `commit` ⇒ kéo để pan
   không đặt nhầm công trình.
6. **Chạm HUD không lọt vào canvas** — `installHudPointerGuard`
   ([`hudPointerGuard.ts:42`](../../apps/client/src/game/input/hudPointerGuard.ts#L42)) đã chặn;
   bấm nút thanh lệnh không được làm mất selection.
7. **Ngón to / run tay** — `TAP_MAX_MOVE_PX = 12` + `TOUCH_PICK_SLACK = 1.5`; nếu vẫn khó chọn thì
   tăng slack (hằng riêng, có test).
8. **Xoay máy khi đang pinch/pan** — `pointercancel`/`blur` reset gesture; `OrientationGate` không
   làm rơi room.
9. **Background lâu → session bị release** — join lại cùng token; nếu bị `taken` thì hiện
   `SessionBlocked`, không tự cướp phiên.
10. **Hybrid touch laptop** — quyết định theo từng event (`wasTouch`) nên chuột vẫn desktop dù UI compact.
11. **Không đổi** `MAX_SELECTION`, schema, `NetworkMessage` ⇒ không cần reset DB.

## 7. Test

| File mới/sửa | Nội dung |
| --- | --- |
| `device/inputMode.test.ts` | touch/desktop/hybrid/tablet; portrait detect |
| `game/input/touchGesture.test.ts` | toàn bộ bảng §4 ở mức state machine + clamp zoom |
| `game/input/hitTest.test.ts` | slack mở rộng hit, mặc định 1 không đổi, depth order giữ nguyên |
| `game/input/cameraInput.test.ts` (sửa) | `enabled: false` không pan ở mọi vị trí |
| `device/resume.test.ts` | predicate reconnect: đúng/không khi logout, đang join, sessionTaken, tab hidden |

Mọi logic mới nằm trong module thuần (node env, giống `cameraInput.test.ts`); glue Phaser mỏng và
verify tay.

## 8. Task list

Mỗi task = 1 commit (message tiếng Anh).

| Task | Nội dung | File chính |
| --- | --- | --- |
| `MOB-01` | Viewport + CSS foundation + `inputMode` + `OrientationGate` | `index.html`, `index.css`, `device/*`, `components/mobile/OrientationGate.tsx`, `App.tsx` |
| `MOB-02` | `touchGesture.ts` + test + `activePointers` + `TouchController` | `input/touchGesture.ts(.test)`, `input/TouchController.ts`, `PhaserGame.tsx` |
| `MOB-03` | Rẽ nhánh touch trong scene, tắt edge scroll + CSS cursor, tap slack | `WorldScene.ts`, `cameraInput.ts(.test)`, `CursorController.ts`, `SelectionController.ts`, `hitTest.ts(.test)` |
| `MOB-04` | Placement/box-select/armed-order trên touch + API scene | `PlacementController.ts`, `CommandController.ts`, `WorldScene.ts` |
| `MOB-05` | `MobileCommandBar` + nối handler | `components/mobile/MobileCommandBar.tsx`, `App.tsx` |
| `MOB-06` | HUD compact | `HUD.tsx`, `Minimap.tsx`, `EntityDetails.tsx`, `BuildMenu.tsx`, `ControlGroups.tsx`, `App.tsx` |
| `MOB-07` | Auth/overlay/session mobile polish | `AuthScreen.tsx`, `SessionBlocked.tsx`, `App.tsx` |
| `MOB-08` | Reconnect on resume + nút "Kết nối lại" | `device/resume.ts(.test)`, `App.tsx` |
| `MOB-09` | Touch perf: cursor, minimap hidden, orientation resize | `CursorController.ts`, `Minimap.tsx`, `PhaserGame.tsx` |
| `MOB-10` | Doc phase + README index + checklist verify tay | `docs/plans/11-mobile-touch.md`, `docs/plans/README.md` |

Tất cả `MOB-01..MOB-10` đã xong (xem §11). Chưa commit — chờ user cho phép.

## 9. Verification

Tự động:

```bash
cd apps/client && ../../node_modules/.bin/tsc --noEmit
pnpm --filter @chien-quoc/client test
```

Tay — máy thật (LAN): `pnpm dev:server` + `pnpm dev:client`, mở `http://<LAN-IP>:5173`
(Vite đã `host: true`, server dùng `cors()`, `getServerUrl` lấy `window.location.hostname:2567`).

Checklist mobile (landscape):

1. Đăng nhập bằng bàn phím ảo: không bị iOS zoom, không bị bàn phím che nút Submit.
2. Xoay dọc → overlay "Xoay ngang"; xoay lại → game tiếp tục.
3. Kéo 1 ngón pan, không tạo selection box; chạm dân → chọn đúng (thử cả cạnh mép thân).
4. Chụm 2 ngón zoom vào/ra, dừng ở biên 0.4/2.2; zoom xong vẫn pan được.
5. `Xây` → chọn Nhà → kéo map không đặt; chạm ô hợp lệ → công trình xuất hiện; chạm ô đỏ → feedback
   đỏ, vẫn ở mode đặt.
6. Chọn dân → giữ lâu vào rừng → thu hoạch; chạm nền → đi.
7. Chọn lính → `Đánh` → chạm đích; `Tuần tra` tương tự; `Dừng` dừng.
8. `Chọn vùng` → kéo chọn nhiều dân → tự tắt mode; pan lại được ngay.
9. Minimap: chạm = pan; giữ lâu = move order.
10. Vào cổng đổi map bằng nút trong card; quay lại vương quốc OK.
11. Khoá màn hình 30–60 s rồi mở lại → tự kết nối lại (hoặc nút `Kết nối lại` hoạt động), quân và
    tài nguyên còn nguyên.
12. Không còn scrollbar/bounce của trang; HUD không lọt dưới notch.

Checklist desktop regression: click chọn, kéo box, chuột phải move/attack/harvest, wheel zoom, `+`/`-`,
arrow/edge pan, `Q/W/E/R/T/Y/U/I`, `S`, `.`, `D`, `Delete`, `Ctrl+1..9`, `F2..F4`, middle-drag,
minimap trái/phải.

## 10. Giả định & ngoài phạm vi

- Trình duyệt mục tiêu: Chrome Android ≥ 120, Safari iOS ≥ 16 (Pointer Events + `dvh`).
- Không làm: PWA/offline, gán nhóm quân trên mobile (D4), joystick ảo, chơi portrait (D2), đổi
  server/protocol/schema/DB, đổi art, haptics ngoài `navigator.vibrate` best-effort.
- `git status` đang có thay đổi chưa commit ở `WorldScene.ts`, `docs/plans/*` và asset house — làm
  trên nền đó, không revert.
- Code/comment/commit message tiếng Anh; doc plan và chat tiếng Việt.

## 11. Kết quả triển khai (2026-11-03)

### 11.1 File

Mới:

| File | Vai trò |
| --- | --- |
| `apps/client/src/device/inputMode.ts` (+`.test.ts`) | `InputMode`, `detectInputMode`, `isPortraitViewport`, `isCoarsePointer`, `MOBILE_MIN_TAP_PX = 44`, `TOUCH_PICK_SLACK = 1.5` |
| `apps/client/src/device/useInputMode.ts` | hook `useInputMode` / `useIsPortrait` |
| `apps/client/src/device/resume.ts` (+`.test.ts`) | predicate + hằng số reconnect on resume |
| `apps/client/src/game/input/touchGesture.ts` (+`.test.ts`) | máy trạng thái gesture thuần |
| `apps/client/src/game/input/TouchController.ts` | glue Phaser: pan / pinch / tap / long-press / box drag |
| `apps/client/src/game/input/hitTest.test.ts` | test slack hit-test |
| `apps/client/src/components/mobile/OrientationGate.tsx` | overlay xoay ngang |
| `apps/client/src/components/mobile/MobileCommandBar.tsx` | thanh lệnh touch |

Sửa: `index.html`, `index.css`, `App.tsx`, `PhaserGame.tsx`, `game/scenes/WorldScene.ts`,
`game/input/{cameraInput,hitTest,SelectionController,CursorController,CommandController}.ts`,
`components/{HUD,Minimap,BuildMenu,EntityDetails,ControlGroups,AuthScreen,SessionBlocked}.tsx`,
`components/minimapArt.ts`, `game/input/cameraInput.test.ts`, `docs/plans/README.md`.

Không đổi: `apps/server/**`, `packages/shared/**`, schema, `NetworkMessage`, DB. Không migration.

### 11.2 Kiểm chứng tự động

```text
apps/client  tsc --noEmit   → 0 error
apps/server  tsc --noEmit   → 0 error
vitest (client)             → 17 files / 346 tests pass
```

46 test mới: `inputMode` 7, `touchGesture` 15, `hitTest` 6, `resume` 8, `commandArm` 10; `cameraInput`
+1 (`enabled: false`).

### 11.3 Kiểm chứng tay bằng Chrome headless (CDP)

Môi trường: Chrome 156 headless, `Emulation.setDeviceMetricsOverride` 844×390 @2x landscape,
`setTouchEmulationEnabled` 5 điểm chạm, `Input.dispatchTouchEvent` (không dùng puppeteer/playwright).
Dev server Vite `:5173` + game server `:2567` có sẵn.

| Kiểm tra | Kết quả đo |
| --- | --- |
| Nhận diện input | `(pointer: coarse)` true, `maxTouchPoints` 5 → `inputMode: 'touch'` |
| HUD compact | HUD 1 hàng + thanh lệnh render; `document.scrollHeight = 390` (không scrollbar) |
| Kích thước nút | 10/10 nút thanh lệnh ≥ 44×44 px; thanh không tràn (`scrollWidth <= clientWidth`) |
| Trang trí dock | `barTop 324` / `barBottom 386` trên 390 px; `elementFromPoint(giữa map) === CANVAS` |
| Kéo 1 ngón | pan: `camera.scrollX -422 → -122`, `touchMode: true`, không tạo selection box |
| Pinch 2 ngón | zoom `0.4 → 1.12` quanh midpoint |
| Portrait | cổng xoay hiện, xoay lại thì mất |
| Chạm dân | `selected: 1`, card chi tiết hiện |
| `Đánh` → chạm đích | armed `ATTACK_MOVE` → tap → `armed: null` |
| `Xây` → Nhà → chạm | sheet mở, 8 ô; `buildings 2 → 3` |
| Giữ lâu vào cây | `HARVESTING` ngay sau 600 ms, selection giữ nguyên (`selected: 1`) |
| Chạm nền khi có dân chọn | đơn vị chuyển `MOVING`, selection vẫn `1` |
| Nút HUD compact (idle, đăng xuất) | đo được đúng 44×44 px sau khi sửa rev-1 |
| Panel "Bản đồ" compact | mở → canvas render (`opaqueRatio 1`, 70 mẫu màu khác nhau); đóng → unmount |
| Chuột phải trên minimap | `scroll` delta `0/0` (chỉ ra lệnh, không nhảy camera) |
| Chuột trái trên minimap | `scroll` delta `0/1497` (vẫn nhảy camera) |
| Console | không error |

Ghi chú: một lần đo trước đó báo giữ lâu không thu hoạch — nguyên nhân là script đo dùng toạ độ
dân đã cũ (dân vừa đi khỏi chỗ cũ sau lệnh trước) nên lần chạm thứ hai trúng nhà mới xây. Đo lại
với toạ độ tính tươi trước mỗi cử chỉ thì pass.

Trong lúc đo cũng phát hiện một lỗi thiết kế đã sửa: radar 96 px nằm thường trực ở dock dưới che
vùng chạm của canvas khiến pinch rơi vào panel minimap (zoom đứng yên). Vì vậy minimap compact
đổi thành nút "Bản đồ" mở panel nổi (§5.G).

### 11.4 Chưa kiểm chứng (cần máy thật)

- Safari iOS: pinch có bị page-zoom không (đã đặt `user-scalable=no` + `touch-action: none` làm
  hai lớp chặn, chưa thử máy), `dvh` khi thanh địa chỉ co giãn, safe-area inset ở máy có notch.
- `navigator.vibrate` khi giữ lâu (iOS Safari không hỗ trợ).
- Khoá màn hình 30–60 s rồi mở lại: join lại + retry `taken` (mới chỉ kiểm bằng logic test).
- Độ mượt pan/pinch thật (fps) trên máy tầm trung; nếu mờ thì xét `resolution` (§5.J).

## 12. Vòng review & fix (rev-2, 2026-11-03)

Review 5 trục trên commit `7d74cdb` (correctness / readability / architecture / security /
performance). Security và performance không có phát hiện: không thêm input người dùng, không query,
không N+1; chi phí mới chỉ là vài listener và một vòng `requestAnimationFrame` đã có từ trước.

### 12.1 Lỗi đã sửa (correctness)

| # | Lỗi | Vì sao | Fix |
| --- | --- | --- | --- |
| R1 | Panel "Bản đồ" compact mở ra nhưng radar trống vĩnh viễn | `canvas` chỉ mount khi `open=true`, mà `useEffect` khởi động vòng vẽ chỉ phụ thuộc `[room, sceneRef]` → lần mount đầu `canvasRef.current` là `null` và không bao giờ chạy lại | thêm `open` vào dependency; effect vẽ chạy lại khi panel mở |
| R2 | Chuột phải trên minimap vừa ra lệnh vừa nhảy camera (regression desktop) | handler đổi từ `onClick` sang `onPointerUp`, mà `pointerup` phát cho **mọi** button; `contextmenu` mới là chỗ ra lệnh | `handlePointerUp` bỏ qua `pointerType === 'mouse' && button !== 0` |
| R3 | Đóng panel khi ngón còn đang giữ → timer 350 ms vẫn bắn lệnh move từ radar đã biến mất | timer chỉ được clear khi unmount component | effect riêng trên `open` clear timer + reset cờ |
| R4 | Arm "Ra lệnh" rồi bấm phím `A`/`P`: `contextualArmed` không bị xoá ⇒ lần chạm sau chạy nhánh right-click và **mất lệnh attack-move** vừa chọn | nhánh bàn phím gán `pendingOrder` trực tiếp, bỏ qua logic của `armOrder` | gom mọi thay đổi arm vào `setArmed()` / `dropArmed()`; có test hồi quy `commandArm.test.ts` (đã kiểm: test fail trên code cũ) |
| R5 | Ngón thứ hai (bắt đầu pinch) kéo ghost đặt nhà tới điểm chạm của nó | `begin()` gọi `touchPressPointer` cho mọi ngón | chỉ gọi cho ngón bắt đầu gesture; `pointer` vẫn cập nhật để handover sau pinch đúng |
| R6 | Sheet "Xây" hẹp hơn lưới 4×48 px ⇒ 4 ô tràn khỏi panel 12 px | `w-[214px]` với padding 8 px chỉ còn 198 px cho lưới 210 px | `w-[230px]` |

### 12.2 Dọn dẹp (readability / dead code)

- `MobileCommandBar`: prop `title` có comment copy-paste sai; bỏ `snap-x` không có `snap-*` con.
- `HUD`: xoá prop `danger` của `ResourceChip` (không call site nào truyền) và dùng
  `MOBILE_MIN_TAP_PX` cho hai control của hàng compact (trước đó hằng này chỉ xuất hiện trong test).
- `touchGesture.ts`: sửa tiêu đề file ("Charcoal gesture recogniser"), bỏ tham số `_time` không dùng
  của `move()`, bỏ `isPinching` (không nơi nào đọc).
- `TouchController`: bỏ `isPinching` passthrough; comment `pointer` mô tả đúng hành vi handover.
- `WorldScene`: comment `touchMode` nói "latched for the session" trong khi code clear mỗi khi có
  chuột — sửa comment; `endTouchDrag` gọi `setBoxSelectMode(false)` thay vì tự gán + publish.
- `App.tsx`: thụt lề props `MobileCommandBar`; gom 6 điều kiện lặp của Auth gate và panel "MẤT KẾT
  NỐI" vào `gatesIdle` / `showAuthGate` / `showDisconnectGate`; bỏ comment `eslint-disable` (repo
  không có eslint) và giải thích dependency thật.
- `CommandController`: ba khối "clear + refresh + publish" trùng nhau → `setArmed()` và `dropArmed()`.

### 12.3 Tap target

Trước rev-2: nút idle và nút đăng xuất của HUD compact cao 16 px và 28 px, nút trong `EntityDetails`
38 px — đều dưới ngưỡng 44 px mà chính plan đặt ra. Sau rev-2: idle + đăng xuất đúng 44×44 (đo bằng
CDP), `EntityDetails` 44 px, nút đóng panel 36 px, roster `ControlGroups` giữ 34 px. Hai ngoại lệ
được ghi rõ trong tiêu chí §1 kèm lý do không thể tăng (chiều cao màn hình).
