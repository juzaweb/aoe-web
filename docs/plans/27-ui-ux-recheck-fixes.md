# Phase 27 — Sửa phát hiện mới từ recheck UI/UX

**Status: `DRAFT`** (2026-11-09) — chưa chốt. Tài liệu gom các phát hiện của lần recheck UI/UX
sau commit `d50fa9d` ("feat: improve UI/UX accessibility, placement banner, unit hotkeys") và đề
xuất cách sửa.

Phạm vi: `apps/client/src` (+ `docs/plans`). **Không** đổi `packages/shared`, `apps/server`,
schema, DB, protocol. `docs/plans/README.md` thêm một dòng index.

Baseline đo tại `d50fa9d`, working tree sạch:

```bash
pnpm --filter @chien-quoc/client test   # 40 file, 535/535 pass
```

Lần recheck trước (`ui-ux-improvement-plan.md`) có 6 mục và **cả 6 đã có code + test**. Phase này
chỉ xử lý lớp vấn đề còn lại sau khi 6 mục đó vào.

---

## 1. Hiện trạng đo được

| # | Hiện trạng | Bằng chứng |
| --- | --- | --- |
| 1 | Toast từ chối lệnh và banner under-attack **không** được screen reader đọc | `RejectNotification.tsx:46` (`div` trần), `App.tsx:1168` (banner `div`, không `role`/`aria-live`). Toàn `src` chỉ có 1 `aria-live`, nằm ở banner placement (`PlacementBanner.tsx:143`) |
| 2 | `role="status"` đang bọc cả nút Cancel | `PlacementBanner.tsx:142-143`: live region chứa `button` → mỗi lần mở mode, vùng được thông báo gồm cả nhãn nút Cancel |
| 3 | 4 overlay không có ngữ nghĩa dialog, không quản focus | `WorldMapOverlay.tsx:93`, `SpectatorOverlay.tsx:41`, `BuildMenu.tsx:317`, `Minimap.tsx:477`; `grep 'role="dialog"\|aria-modal'` → 0 hit; không có `focus()` nào trong 4 file |
| 4 | Banner placement đè toast | banner `top-20` (`PlacementBanner.tsx:140`), toast từ chối `top-16` + `animate-bounce` (`rejectVisuals.ts:10`), under-attack `top-16`/`top-24` (`App.tsx:1168`); cả ba căn giữa ngang |
| 5 | i18n rò rỉ ở HUD | `HUD.tsx:76` tooltip `Thành trì: … máu`, `HUD.tsx:82` nhãn `THÀNH TRÌ`; không có key `hud.citadel` trong `en.ts` |
| 6 | Contrast dưới AA ở chữ 11px | `#64748b` trên `#020617` = 4,24:1; trên `#0f172a` = 3,75:1; trên `aoe-panel` `#1e293b` = 3,07:1. 19 chỗ `text-slate-500` trong 7 file |
| 7 | Không tôn trọng giảm chuyển động | `grep prefers-reduced-motion` → 0 hit; có `animate-bounce` (`rejectVisuals.ts:10`), `animate-pulse` (11 chỗ `HUD.tsx` + banner under-attack `App.tsx:1168`), `animate-spin` (world map loading), tween decal 300 ms (`orderFeedback.ts`) |
| 8 | Tap target < 44px trên mobile | `Minimap.tsx:491`, `BuildMenu.tsx:327` là `h-9 w-9` (36px); `WorldMapOverlay.tsx:304,315` là `min-h-[42px]` |
| 9 | Tooltip chỉ mở bằng hover | `BuildMenu.tsx:197` (`group-hover`), `EntityDetails.tsx:538` (`group-hover/train`), 0 hit `focus-within`/`group-focus` → bàn phím và cảm ứng không xem được giá/stat |
| 10 | SFX không tắt được | `setCommandSoundEnabled` (`commandSound.ts:48`) không có call site; `alertSound` cũng không có công tắc |
| 11 | Focus-visible không thống nhất | `grep focus-visible` → 0 hit; `AuthScreen.tsx:109,127,146` dùng `focus:outline-none` + đổi màu viền |
| 12 | Doc còn 9 checkbox verify tay | `ui-ux-improvement-plan.md` dòng 66, 120, 181–189; "Completion criteria" còn trỏ `docs/plan/…` (thư mục số ít) |

Không tính là lỗi (đã kiểm): test xanh 535/535; `aria-pressed` của `MobileCommandBar`; safe-area
`env()`; toast tự tắt 3,5 s; key i18n mới (`placement.*`, `hud.populationCapped`, `details.hotkey`,
`worldMap.legendDelta`) đủ `en` + `vi`; `documentElement.lang` sync ở `i18n/index.ts:57`; font
thấp nhất là 11px (0 hit `text-[8|9|10px]`).

## 2. Quyết định đề xuất

| Mã | Quyết định | Vì sao |
| --- | --- | --- |
| D1 | Toast từ chối: `role="status"` + `aria-live="polite"`. Under-attack: `role="alert"` + `aria-live="assertive"` | Từ chối lệnh là phản hồi duy nhất của server; under-attack khẩn cấp hơn nên `assertive` |
| D2 | Mỗi toast mang `seq` tăng dần, dùng làm `key` của node live region | Cùng câu "Không đủ gỗ" lặp lại sẽ không được đọc lại nếu DOM không đổi |
| D3 | `role="status"` của banner placement chỉ bọc **khối chữ**, nút Cancel nằm ngoài | Live region chỉ nên chứa nội dung được thông báo, không chứa control |
| D4 | 4 overlay nhận `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; focus vào nút đóng khi mở, trap `Tab`, trả focus về phần tử mở khi đóng | Hiện `Tab` chạy vào HUD sau lớp phủ `z-[60]`; `Esc` đã có nhưng mới là một nửa hành vi modal |
| D5 | Hook dùng chung `useModalFocus(ref, open, onClose)` trong `apps/client/src/components/` | 4 overlay cùng hành vi; chép tay sẽ lệch nhau ở lần sửa thứ hai |
| D6 | Gom toast + banner placement + under-attack vào **một cột stack** top-center (`TopOverlayStack`), thứ tự: under-attack → từ chối lệnh → placement | Sửa gốc của chồng lớp thay vì dịch từng `top-*`; thêm banner thứ tư sau này không tái phát |
| D7 | i18n: thêm `hud.citadel`, `hud.citadelTitle` (`{{hp}}`/`{{maxHp}}`) vào `en.ts` + `vi.ts`, xoá chuỗi hardcode | `THÀNH TRÌ` là nhãn thường trực duy nhất còn tiếng Việt khi chọn EN |
| D8 | Contrast: `text-slate-500` → `text-slate-400` ở chỗ **mang thông tin**; giữ `slate-500`/`slate-600` cho disabled | `slate-400` = 7,87:1 trên `#020617`, 5,9:1 trên `#1e293b`; `slate-500` chỉ 3,07–4,24:1 |
| D9 | Reduced motion: `@media (prefers-reduced-motion: reduce)` tắt `animate-pulse`/`animate-bounce`/`animate-spin`; `drawOrderFeedback` bỏ tween (vẽ tĩnh, `delayedCall(150)` xoá) | Decal 300 ms là phản hồi chứ không phải trang trí: vẫn phải thấy dấu, chỉ bỏ co/giãn |
| D10 | Tap target: nút đóng sheet/panel lên `h-11 w-11` (44px) **khi compact**; 2 nút world map lên `min-h-[44px]` | 44px là ngưỡng `MOBILE_MIN_TAP_PX` đã dùng cho hàng nút chính |
| D11 | Tooltip: thêm `group-focus-within:opacity-100` + `aria-describedby` trỏ tới nội dung tooltip; trên touch, tooltip của nút train hiện bằng `active:`/long-press thay vì hover | Bàn phím và điện thoại hiện không xem được giá/stat; `title` không đủ |
| D12 | Âm thanh: module `audioSettings.ts` (localStorage `cq.sound`, mặc định bật) + nút loa ở HUD (cả 2 layout), áp cho `alertSound` và `commandSound` | Hai nguồn SFX, không công tắc nào; một công tắc chung rẻ hơn hai |
| D13 | Focus-visible: rule toàn cục trong `index.css` (`:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px }`), bỏ `focus:outline-none` ở `AuthScreen` | Đang phụ thuộc outline mặc định của UA, không khớp palette |
| D14 | **Không** bỏ `maximum-scale=1, user-scalable=no` (`index.html:10`) | Canvas cần chặn pinch của trình duyệt (`TouchController` tự xử lý camera); đổi sẽ vỡ zoom. Ghi nhận là tradeoff, không phải việc của phase này |

## 3. Slice

Mỗi slice merge độc lập được. Thứ tự dưới đây là thứ tự làm.

### UIX-08 (P1) — Live region cho toast và under-attack

- **Bằng chứng:** mục 1, 2 ở §1.
- **Việc phải làm:** `RejectNotification` nhận `seq` (từ `showNotification`) → `role="status"`,
  `aria-live="polite"`, `key={seq}`; banner under-attack → `role="alert"`, `aria-live="assertive"`;
  icon trang trí `aria-hidden="true"`; tách nút Cancel ra khỏi live region của `PlacementBanner`
  (D3).
- **AC:**
  - [ ] Toast có `role="status"` + `aria-live="polite"` + `key={seq}`; từ chối lặp lại vẫn được đọc.
  - [ ] Under-attack có `role="alert"` + `aria-live="assertive"`.
  - [ ] Banner placement: live region chỉ còn khối chữ; Cancel là sibling, vẫn bấm được.
  - [ ] Icon trong cả ba `aria-hidden="true"`.
- **Verify:** DevTools accessibility tree; đọc thủ công bằng VoiceOver/NVDA.
- **Effort:** XS. **Rủi ro:** `assertive` lặp lại gây spam — chỉ dùng cho under-attack, có cooldown sẵn ở `UnderAttackTracker`.

### UIX-09 (P1) — Dialog semantics và quản focus cho 4 overlay

- **Bằng chứng:** mục 3 ở §1.
- **Việc phải làm:** hook `useModalFocus` (D5): lưu `document.activeElement`, focus phần tử đầu tiên
  trong ref khi mở, chặn `Tab` vòng trong ref, trả focus khi đóng; gắn `role="dialog"`,
  `aria-modal="true"`, `aria-labelledby` trỏ heading thật cho `WorldMapOverlay`, `SpectatorOverlay`,
  sheet `BuildMenu` compact, panel `Minimap` compact; giữ `Esc` hiện có.
- **AC:**
  - [ ] Mỗi overlay có `role="dialog"`, `aria-modal="true"`, `aria-labelledby` trỏ heading thật.
  - [ ] Mở overlay: focus ở trong; `Tab`/`Shift+Tab` không ra ngoài.
  - [ ] `Esc` và nút đóng đều trả focus về phần tử đã mở overlay.
  - [ ] Sheet build + panel minimap vẫn đóng được bằng chuột/tap như cũ.
- **Verify:** bàn phím: mở world map → `Tab` 10 lần → không ra khỏi hộp; `Esc` → focus về nút mở.
- **Effort:** S. **Rủi ro:** trap sai làm kẹt `Tab` — hook một chỗ, test tay cả 4.

### UIX-10 (P1) — Một cột stack cho lớp phủ top-center

- **Bằng chứng:** mục 4 ở §1.
- **Việc phải làm:** `TopOverlayStack` (flex column, `gap-1.5`, `pointer-events-none`, `z-50`) với
  3 slot theo D6; bỏ `absolute top-*` khỏi từng phần tử con; compact đặt cột dưới `CitadelBar`.
- **AC:**
  - [ ] Bật cả ba (placement + từ chối + under-attack): xếp dọc, không chồng.
  - [ ] Không khối nào che nút Cancel của banner placement.
  - [ ] Compact: cột bắt đầu dưới `CitadelBar` — dùng lại mốc `top-[calc(env(safe-area-inset-top)+4.75rem)]` đang có ở banner (`PlacementBanner.tsx:140`).
  - [ ] Vùng trống vẫn xuyên click xuống map.
- **Verify:** bật cả ba trạng thái, chụp 390×844 và 1920×1080.
- **Effort:** S.

### UIX-11 (P1) — Dịch nhãn thành trì ở HUD

- **Bằng chứng:** mục 5 ở §1.
- **Việc phải làm:** thêm `hud.citadel` + `hud.citadelTitle` vào `en.ts`/`vi.ts`; thay hai chuỗi
  hardcode ở `HUD.tsx:76,82` bằng `t()`.
- **AC:**
  - [ ] EN hiện "CITADEL", VI hiện "THÀNH TRÌ".
  - [ ] Tooltip dịch theo locale và có HP/maxHP.
  - [ ] `grep` chuỗi có dấu trong `components/*.tsx` chỉ còn comment.
- **Effort:** XS.

### UIX-12 (P2) — Contrast chữ phụ 11px

- **Bằng chứng:** mục 6 ở §1 (`UpgradePanels.tsx` 8 chỗ, `WorldMapOverlay.tsx` 5, `HUD.tsx` 2,
  `EntityDetails.tsx:384`, `App.tsx:1224`, `SessionBlocked.tsx:60`, `AuthScreen.tsx:181`).
- **Việc phải làm:** đổi các chỗ mang thông tin sang `text-slate-400`; giữ `slate-500`/`slate-600`
  cho disabled (`BuildMenu.tsx:143`, `EntityDetails.tsx:511`, `MobileCommandBar.tsx:72`).
- **AC:**
  - [ ] Mọi `text-slate-500` còn lại đều nằm trên phần tử disabled/`aria-disabled`.
  - [ ] Cặp chữ mang thông tin đạt ≥ 4,5:1 trên nền thật.
  - [ ] Không đổi cỡ chữ (11px) và layout.
- **Verify:** đo lại bằng công thức WCAG; ảnh chụp panel nâng cấp.
- **Effort:** XS.

### UIX-13 (P2) — Tôn trọng `prefers-reduced-motion`

- **Bằng chứng:** mục 7 ở §1.
- **Việc phải làm:** block `@media (prefers-reduced-motion: reduce)` trong `index.css` tắt animation
  của `.animate-bounce/.animate-pulse/.animate-spin` (giữ trạng thái cuối, không ẩn); thêm
  `prefersReducedMotion()` trong `game/render/` (guard `typeof window`), cho `drawOrderFeedback`
  vẽ tĩnh + `delayedCall(150)` xoá khi bật.
- **AC:**
  - [ ] Bật Reduce motion ở OS: không còn bounce/pulse/spin, trạng thái vẫn đọc được.
  - [ ] Decal order vẫn hiện rồi mất, không tween, có test cho nhánh này.
  - [ ] Tắt reduced motion: hành vi y hiện tại.
- **Verify:** macOS/Windows reduced motion + `matchMedia` stub trong test.
- **Effort:** S. **Rủi ro:** tắt animation bằng `!important` toàn cục — chỉ nhắm 3 class.

### UIX-14 (P2) — Tap target 44px cho nút đóng/hành động phụ

- **Bằng chứng:** mục 8 ở §1.
- **Việc phải làm:** khi compact đặt `style={{ minHeight: 44, minWidth: 44 }}` (đúng pattern
  `PlacementBanner.tsx:158` và HUD đang dùng), desktop giữ 36px; 2 nút world map lên `min-h-[44px]`.
- **AC:**
  - [ ] Mọi nút đóng panel/sheet trên compact ≥ 44×44 px.
  - [ ] 2 nút world map ≥ 44px trên compact.
  - [ ] Dock compact không cao thêm quá 4px.
- **Verify:** 390×844 landscape, đo bounding box trong DevTools.
- **Effort:** XS.

### UIX-15 (P2) — Tooltip đọc được bằng bàn phím và cảm ứng

- **Bằng chứng:** mục 9 ở §1.
- **Việc phải làm:** thêm `group-focus-within:opacity-100` cho 2 tooltip; gắn `id` +
  `aria-describedby` trên nút để SR đọc nội dung (giá, stat); trên touch, cho tooltip của nút train
  hiện bằng `active:` (hoặc long-press đã có ở `TouchController`) thay vì chỉ hover.
- **AC:**
  - [ ] `Tab` vào nút Chọn nhà / Train lính: tooltip hiện.
  - [ ] SR đọc được tên + giá + mô tả qua `aria-describedby`.
  - [ ] Trên mobile, tap giữ vào nút train thấy được cost/stat.
  - [ ] Không đổi hành vi hover trên desktop.
- **Effort:** S.

### UIX-16 (P3) — Công tắc âm thanh dùng chung

- **Bằng chứng:** mục 10 ở §1.
- **Việc phải làm:** `game/audio/audioSettings.ts` (get/set + localStorage `cq.sound`, phát event
  `cq:sound`); nút loa (`Volume2`/`VolumeX`) cạnh chip kết nối trong HUD (cả 2 layout); subscribe
  để gọi `setCommandSoundEnabled` và công tắc của `UnderAttackSound`.
- **AC:**
  - [ ] Tắt loa → không còn tiếng order/alert; mở lại → có ngay, không reload.
  - [ ] Lựa chọn sống qua reload.
  - [ ] Không đổi payload/hành vi server.
- **Effort:** S. **Rủi ro:** audio context khoá tới gesture đầu — nút loa chỉ có sau khi join.

### UIX-17 (P3) — Focus-visible thống nhất

- **Bằng chứng:** mục 11 ở §1.
- **Việc phải làm:** rule toàn cục trong `index.css` (D13); bỏ `focus:outline-none` ở input auth,
  giữ đổi màu viền như phụ hoạ.
- **AC:**
  - [ ] `Tab` qua HUD, nút build, overlay đều thấy ring 2px amber, offset 2.
  - [ ] Ring không bị `overflow-hidden` của panel cắt.
  - [ ] Chuột không kích hoạt ring (chỉ `:focus-visible`).
- **Effort:** XS.

### UIX-18 (P3) — Đóng sổ tài liệu

- **Bằng chứng:** mục 12 ở §1.
- **Việc phải làm:** tick 9 checkbox verify tay trong `ui-ux-improvement-plan.md` sau khi UIX-08…17
  merge và đã chạy checklist; sửa `docs/plan/` → `docs/plans/` trong "Completion criteria". (Dòng
  index cho phase 27 trong `README.md` đã thêm cùng tài liệu này.)
- **AC:**
  - [ ] 0 checkbox chưa tick trừ mục thực sự chưa đạt.
  - [ ] Đường dẫn trong "Completion criteria" đúng.
- **Effort:** XS. **Phụ thuộc:** làm sau cùng.

## 4. Không làm trong phase này

- Không làm canvas/Phaser accessible (screen reader cho bản đồ, điều khiển unit bằng bàn phím).
  Giới hạn engine, cần phase riêng.
- Không bỏ `maximum-scale=1, user-scalable=no` (D14).
- Không đổi palette, font, bố cục dock, không thay `slate` bằng design token mới.
- Không thêm SFX asset thật; vẫn Web Audio tổng hợp (`synthVoice.ts`).
- Không đổi `CommandController` production.

## 5. Thứ tự và phụ thuộc

```
UIX-08 ──► UIX-10          (stack dùng lại vị trí toast)
UIX-09                     (độc lập, hook focus)
UIX-11, UIX-12, UIX-14     (độc lập, làm song song được)
UIX-13, UIX-15, UIX-16, UIX-17  (độc lập)
UIX-18 sau cùng
```

## 6. Verify chung

```bash
pnpm --filter @chien-quoc/client test      # kỳ vọng: 535/535 + test mới của UIX-13/15
pnpm --filter @chien-quoc/server test      # không đổi, phải xanh
pnpm build
```

Checklist tay:

- [ ] 1920×1080 và 1366×768: placement + toast + under-attack cùng bật, không chồng.
- [ ] 390×844 landscape: nút đóng sheet/panel ≥ 44px; banner Cancel bấm được.
- [ ] Bật Reduce motion: không bounce/pulse/spin; decal vẫn hiện rồi mất.
- [ ] Bàn phím: `Esc` đóng overlay, `Tab` không ra sau lớp phủ, focus trả về nút mở, tooltip mở khi focus.
- [ ] Screen reader: nghe được câu từ chối, banner under-attack, và giá/stat trong tooltip.
- [ ] EN locale: không còn chuỗi tiếng Việt trong HUD.
- [ ] Tắt loa: im; reload: vẫn tắt.

## 7. Rủi ro

| Rủi ro | Ảnh hưởng | Cách giảm |
| --- | --- | --- |
| Focus trap sai làm kẹt `Tab` | Không thoát overlay bằng bàn phím | Hook một chỗ, test tay 4 overlay, luôn giữ `Esc` + nút đóng |
| `aria-live` phát lại mỗi 3,5 s | SR spam khi bị từ chối liên tục | `polite` cho toast, `assertive` chỉ cho under-attack, `key={seq}` chỉ tăng khi có message mới |
| Đổi `top-*` → stack làm lệch HUD compact | Banner đè thanh thành trì | Đo `CitadelBar` rồi đặt cột dưới nó; kiểm 390×844 |
| `text-slate-400` tràn lan mất phân cấp | Chữ phụ trông như chữ chính | Chỉ đổi chỗ mang thông tin; giữ `slate-300` cho nhãn chính |
| Tooltip mở bằng `focus-within` bị cắt bởi panel `overflow-y-auto` | Không đọc được nội dung | Kiểm `EntityDetails` (đang `overflow-y-auto`) — có thể cần `overflow-visible` cho hàng nút train |
| Tắt animation toàn cục bằng `!important` | Ảnh hưởng animation Phaser DOM khác | Chỉ nhắm 3 class |

## 8. Câu hỏi mở

1. Toast xếp hàng hay chỉ hiện cái mới nhất khi bị từ chối liên tiếp? Đề xuất: giữ cái mới nhất —
   cột stack đã tránh chồng.
2. Nút loa đặt ở HUD hay trong menu settings (repo chưa có menu settings)? Đề xuất: HUD, cạnh chip
   kết nối.
3. `SessionBlocked`/`AuthScreen` (lớp phủ toàn màn hình) có áp `useModalFocus` luôn không? Đề xuất:
   có, cùng hook, nhưng tách slice nếu UIX-09 phình.
