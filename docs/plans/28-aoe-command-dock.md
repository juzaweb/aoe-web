# Phase 28 — Dock lệnh kiểu AoE: bỏ bảng Xây chiếm màn hình

**Status: `IMPLEMENTED`** (2026-11-12) — code + doc xong, `tsc`/`vitest`/`vite build` xanh, đã đo
trên browser thật (§9.1). Phase này thay bảng Xây nổi ở desktop bằng **một dải lệnh cố định 156 px**
ở đáy màn hình theo bố cục AoE: radar bên trái, dải thông tin mỏng, lưới lệnh 5×3 bên phải, toàn bộ
phần chi tiết dài (HP, chỉ số, hậu phương, nâng cấp) đẩy vào popover.

Phạm vi: `apps/client` (+ `docs/plans`). **Không** đổi `apps/server`, `packages/shared`, schema,
protocol, DB, và không đổi `NetworkMessage` nào. `docs/plans/README.md` thêm một dòng index.

## 1. Mục tiêu

Mục tiêu là **giành lại màn hình cho bản đồ**. Bảng Xây hiện tại cao theo nội dung nên khi chọn
một dân, đáy màn hình bị hai panel nổi chiếm gần một phần ba chiều cao ở 1920×1080 và gần một nửa
ở 1366×768. Dock lệnh đặt trần cứng: mọi thứ trong dock cao đúng 156 px, không thành phần nào bên
trong được phép làm dải cao thêm.

| # | Trước | Sau |
| --- | --- | --- |
| 1 | Bảng Xây desktop ~308×336 px, cao theo nội dung (`BuildMenu.tsx:370` lưới `grid-cols-4`, ô `h-16 w-16` ở `BuildMenu.tsx:138`) | Dock cao cố định **156 px** (`DOCK_HEIGHT_PX`), không phụ thuộc selection/queue |
| 2 | Dải đáy chiếm **31,1%** chiều cao màn 1920×1080 | **14,4%** |
| 3 | Dải đáy chiếm **43,8%** chiều cao màn 1366×768 | **20,3%** |
| 4 | 15 lệnh xây chia lưới 4 cột (4 hàng), hàng cuối lẻ 3 ô | Lưới **5×3 = 15 ô**, đủ đúng 15 lệnh, không cần trang phụ, không có ô trống |
| 5 | Panel chi tiết `w-80` (320 px) đứng cạnh bảng Xây | Dải thông tin mỏng (tên + HP + cấp) + popover Chi tiết khi bấm |
| 6 | Nhãn tên công trình in dưới từng ô 64×64, badge phím tắt trong ô | Ô 38 px không in nhãn; tên + giá hiện ở header của card khi hover/focus |
| 7 | Ba khối `justify-between` (radar · chi tiết · xây) tự do nổi trên map | Một dải duy nhất `data-command-dock`, ba cột cố định trong cùng khung 156 px |

15 lệnh xây = 12 công trình theo thứ tự phím **Q W E R T Y U I C B N G** (`BUILDING_HOTKEYS`) +
`Đường` + `Xoá đường` + `Phá tường`. Đây là lý do lưới là 5×3 chứ không phải 4×4: con số 15 khớp
chính xác, nên toàn bộ menu xây nằm gọn một trang.

## 2. Hiện trạng đo được

Số dòng dưới đây đo tại baseline `5bc6c21` ("docs: remove obsolete plan file") — tức trạng thái
**trước** khi phase này chạm vào các file đó.

| # | Hiện trạng | Bằng chứng |
| --- | --- | --- |
| 1 | Bảng Xây desktop là lưới 4 cột, mỗi ô 64×64 px kèm nhãn chữ và badge phím tắt | `BuildMenu.tsx:370` (`grid grid-cols-4 gap-2`); `BuildMenu.tsx:138` (`compactTiles ? 'h-12 w-12 p-0.5' : 'h-16 w-16 p-1'`); khối return desktop `BuildMenu.tsx:354-374`; nhãn `BuildMenu.tsx:177`; badge phím `BuildMenu.tsx:183-189` |
| 2 | Panel chi tiết desktop rộng 320 px và cao tới 72% viewport | `EntityDetails.tsx:154` (`'w-80 min-h-[144px] max-h-[72vh] p-3'`); nhánh `compact` cho mobile nằm ngay trên, trong cùng khối `className` (`EntityDetails.tsx:152-155`: `'w-full max-w-[420px] max-h-[28dvh] …'`) |
| 3 | Dải đáy desktop là **ba khối `justify-between`**, mỗi khối tự quyết chiều cao | `App.tsx:1116` (`absolute bottom-3 left-3 right-3 flex items-end justify-between`); `App.tsx:1118` `Minimap`; `App.tsx:1122-1136` `EntityDetails`; `App.tsx:1141-1156` `BuildMenu` |
| 4 | Tiêu đề radar là một hàng trong panel, đẩy canvas 140 px xuống dưới | `Minimap.tsx:517-518` (`aoe-panel … flex flex-col items-center rounded-lg p-2`); `Minimap.tsx:519-525` (`div` tiêu đề `text-[11px]`); `Minimap.tsx:526-538` canvas `MINIMAP_CSS_SIZE` = 140 (`minimapArt.ts:14`) |
| 5 | Tooltip của ô xây chỉ mở bằng hover, bàn phím và cảm ứng không xem được giá | `BuildMenu.tsx:197` (`group-hover:opacity-100`), 0 hit `group-focus-within` trong `BuildMenu.tsx` |
| 6 | Chưa có khung đo nào cho dải đáy: không attribute, không hằng số chiều cao dùng chung | Trước phase: `grep -rn "data-command-dock" apps/client/src` → 0 hit; chiều cao các panel suy ra từ class Tailwind rời rạc |
| 7 | Trang lệnh (dừng, đội hình, tập kích, tuần tra) và panel nâng cấp vẫn là JSX nằm trong panel chi tiết | `EntityDetails.tsx:46-77` (props), `EntityDetails.tsx:147-155` (khung panel); không có lớp dữ liệu nào mô tả "lệnh nào đang bấm được" |

Không tính là lỗi (đã kiểm): dock mobile (`MobileCommandBar` + sheet compact) không thuộc phạm vi
phase này; `BUILDING_HOTKEYS` đã đúng thứ tự Q W E R T Y U I C B N G; `buildingThumbnail` đã có
fallback icon vector cho công trình thiếu PNG.

## 3. Quyết định

| Mã | Quyết định | Vì sao | Nguồn |
| --- | --- | --- | --- |
| D1 | Dock cao **cố định 156 px** (`DOCK_HEIGHT_PX`), mọi thành phần bên trong ép theo đúng chiều cao này | Cao theo nội dung là nguyên nhân gốc: bảng Xây phình bao nhiêu thì map mất bấy nhiêu. Một con số duy nhất dùng chung cho component, test hình học và phép đo trên browser | user |
| D2 | Lưới **5×3**, ô **38 px**, **không in nhãn dưới ô**; tên + giá hiện ở header của card khi hover/focus | 15 ô khớp đúng 15 lệnh xây; bỏ nhãn là điều kiện để ô xuống 38 px và 3 hàng vẫn nằm trong 156 px. Nhãn chuyển lên header vì header là chỗ duy nhất đọc được mà không phình ô | user (5×3, 38 px) · suy ra (nhãn → header) |
| D3 | Thay panel chi tiết thường trực bằng **dải thông tin mỏng** + **popover Chi tiết** mở theo yêu cầu | Panel 320 px luôn hiện là thứ chiếm chỗ nhiều thứ hai sau bảng Xây; phần lớn thời gian người chơi chỉ cần biết đang chọn cái gì và còn bao nhiêu máu | user |
| D4 | Dock áp cho **cả ba** loại selection: dân (trang Xây), công trình (trang Train/Nâng cấp), lính (trang Lệnh) | Một cơ chế duy nhất cho mọi selection; nếu chỉ dân có dock thì hai bề mặt lệnh vẫn tồn tại song song và tốn chỗ như cũ | user |
| D5 | `BuildMenu` **chỉ còn nhánh `compact`** (mobile); nhánh desktop bị bỏ | Nhánh desktop là bảng 336 px đang được thay; giữ lại sẽ thành code chết hoặc bề mặt thứ hai không ai kiểm | suy ra |
| D6 | Popover đang mở thì `setInputEnabled(false)`, và `Esc` **chỉ đóng popover**, không xoá selection | Người chơi đang đọc bảng chi tiết mà lỡ tay bấm xuống map thì không nên ra lệnh di chuyển; `Esc` đóng lớp trên cùng là quy ước đã dùng cho 4 overlay ở phase 27 (D4) | suy ra |
| D7 | Đang tập kích thì trang Xây **disable kèm lý do** (`dock.raidBlocked`), **không ẩn trang** | Ẩn trang làm người chơi tưởng mất tính năng; disable + lý do là cùng cách các phase trước xử lý điều kiện chặn (gate TC, thiếu tài nguyên) | suy ra |
| D8 | **Không chọn gì thì dock không render card** (chỉ còn radar) | Khớp hành vi đã chốt ở `UIX-06`/`UIX-07`: không vẽ khung rỗng trên map | suy ra |
| D9 | **Mobile giữ nguyên**: `MobileCommandBar` + sheet compact + `BuildMenu compact` + `Minimap compact` | 156 px chrome đúng là thứ `MOB-06` đã loại trên điện thoại; đổi cả hai layout trong một phase là hai rủi ro không liên quan | user |
| D10 | **Không** đổi `apps/server`, `packages/shared`, schema, protocol, DB | Dock là bề mặt hiển thị của các lệnh đã có; mọi handler đã tồn tại trong `App.tsx`, không có message mới | user |

## 4. Kiến trúc / API

### 4.1 `apps/client/src/components/dock/dockMetrics.ts` — hình học

Toàn bộ con số nằm ở một chỗ, export ra để component, test và phép đo trên browser đọc cùng một
ngân sách:

| Hằng số | Giá trị | Vai trò |
| --- | --- | --- |
| `DOCK_HEIGHT_PX` | 156 | Chiều cao duy nhất của cả dải |
| `DOCK_COLUMNS` / `DOCK_ROWS` | 5 / 3 | Lưới lệnh; `DOCK_SLOT_CAPACITY` = 15 |
| `DOCK_SLOT_PX` | 38 | Cạnh một ô lệnh |
| `DOCK_GAP_PX` | 4 | Khe giữa các ô |
| `DOCK_PADDING_PX` / `DOCK_BORDER_PX` / `DOCK_HEADER_PX` | 6 / 2 / 14 | Ngân sách dọc còn lại sau lưới; `DOCK_CARD_INNER_HEIGHT_PX` và `DOCK_GRID_HEIGHT_PX` suy ra từ đây |
| `DOCK_CARD_WIDTH_PX` | suy ra | `5*38 + 4*4 + 2*(6+2)` — không có số magic |
| `DOCK_MINIMAP_PX` / `DOCK_MINIMAP_PADDING_PX` | 140 / 6 | Radar giữ raster 140 px, pad cho khớp chiều cao dock |
| `DOCK_INSET_PX` | 12 | Lề ngoài giữa dock và mép viewport |

### 4.2 `apps/client/src/components/dock/commandPages.ts` — dữ liệu lệnh

Tách "lệnh nào đang bấm được" khỏi JSX để test được bằng dữ liệu thuần. Dock **không** thêm luật
mới: mọi luật ở đây phản chiếu `BuildMenu`, `EntityDetails`, `UpgradePanels`.

- `DockPageId` = `'BUILD' | 'ORDERS' | 'TRAIN' | 'UPGRADE'`.
- `DockCommand`: `id` (cũng là DOM id của ô, ví dụ `build:HOUSE`), `label`, `title` (tên + giá +
  lý do chặn), `hotkey?`, `thumbnail` (PNG, `null` thì dùng glyph vector), `art`, `disabled`,
  `active` (order đang armed / placement đang mở / brush đang bật), `lockedLevel?`, `cost?`,
  `action()`.
- `DockPage`: `{ id, label, commands }`.
- `DockCommandHandlers`: 15 handler, **tất cả đã tồn tại trong `App.tsx`** — dock không tự gọi scene.
- `DockPageInput`: `entity`, `resources`, `townCenterLevel`, `inRaid`, `armedOrder`,
  `activeBuildingType`, `roadMode`, `wallMode`, `showRoadTools`, `handlers`.
- `buildDockPages(input): DockPage[]` — thứ tự trang: dân → `BUILD` + `ORDERS`; công trình →
  `TRAIN` + `UPGRADE`; không selection hoặc không sở hữu → `[]` (đó là cách dock ẩn card).
- `selectionDisplayName(entity)` — tên hiển thị dùng chung cho dải thông tin và tiêu đề popover, để
  hai chỗ không thể nói khác nhau.
- `costText(cost)` — `Gỗ 30 · Thịt 10`, chỉ liệt kê tài nguyên thật sự tốn.
- `unitThumbnail(type)` — `/assets/units/<type>_idle.png?v=3`, cùng art scene preload.

Mọi trang đều `slice(0, DOCK_SLOT_CAPACITY)` trước khi trả về, nên không trang nào đòi nhiều hơn 15
ô.

### 4.3 Component

- `dock/CommandCard.tsx` — card lệnh: header (tên trang, tên + giá của ô đang hover/focus, nút
  chuyển trang) + lưới 5×3. Chỉ giữ **chỉ số trang**, không cache `commands`, nên giá và queue đổi
  là thấy ngay. Ô render `thumbnail` nếu có, fallback `dockCommandIcon(art)`; `disabled` là thuộc
  tính `disabled` thật của `button` + `title` giải thích, `active` phát ra `aria-pressed`. Trang ít
  lệnh vẫn render đủ 15 ô (ô trống `aria-hidden`), nhờ vậy lưới không nhảy khi đổi trang.
- `dock/dockIcons.tsx` — glyph cho lệnh không có PNG (brush, lệnh quân, huỷ/nâng cấp); thứ tự tra:
  bảng lệnh → bảng lính → `buildingIcon` → `Hammer`, nên một `art` lạ không bao giờ ra ô trống.
- `dock/SelectionStrip.tsx` — dải mỏng: tên selection, HP, cấp, nút mở/đóng Chi tiết.
- `dock/DetailsPopover.tsx` — popover neo `bottom-full` vào wrapper của dock, chứa `EntityDetails`.
- `dock/DockBar.tsx` — dải 156 px: `data-command-dock`, `left/right/bottom = DOCK_INSET_PX`,
  `height = DOCK_HEIGHT_PX`; cột trái `Minimap`, cột giữa `SelectionStrip` + `CommandCard`, popover
  neo vào wrapper giữa. Dải thông tin bị chặn `max-w-[460px]` và wrapper dùng `justify-between`, nên
  khoảng giữa dock là **map nhìn thấy được**, không phải một panel kín hết bề ngang. `entity === null`
  thì chỉ còn radar.
- `buildingIcons.tsx` — một glyph lucide cho mỗi `BuildingType`; `buildingIcon(type, size)` trả
  `null` nếu type lạ. Sheet mobile gọi ở 20 px; ô dock dùng lại qua `dockCommandIcon` khi công trình
  không có PNG.
- `EntityDetails.tsx` — thêm `variant?: 'panel' | 'popover'` (mặc định `'panel'`, giữ nguyên class
  cũ; `'popover'` bỏ `w-80`/`min-h-[144px]`/`max-h-[72vh]` để `DetailsPopover` quyết kích thước và
  cuộn). Sections, handler và props không đổi, nên sheet mobile và popover desktop không lệch nhau.
  `compact` của mobile giữ nguyên.
- `Minimap.tsx` — tiêu đề thành chip overlay trên radar thay vì một hàng chiếm chỗ trong panel.

## 5. Thay đổi theo file

| File | Thay đổi |
| --- | --- |
| `apps/client/src/components/dock/dockMetrics.ts` | Mới — toàn bộ hằng số hình học của dock, kèm ngân sách dọc suy ra |
| `apps/client/src/components/dock/commandPages.ts` | Mới — kiểu dữ liệu + `buildDockPages`, `selectionDisplayName`, `costText`, `unitThumbnail` |
| `apps/client/src/components/dock/commandPages.test.ts` | Mới — test dữ liệu thuần cho 4 trang lệnh, phím tắt, giá, gate, quyền sở hữu |
| `apps/client/src/components/dock/dockMetrics.test.ts` | Mới — chốt hình học: 156 px, 5×3, ô 38 px, radar khớp chiều cao dock |
| `apps/client/src/components/dock/CommandCard.tsx` | Mới — card lệnh 5×3 + header + chuyển trang |
| `apps/client/src/components/dock/SelectionStrip.tsx` | Mới — dải tên/HP/cấp + nút Chi tiết |
| `apps/client/src/components/dock/DetailsPopover.tsx` | Mới — popover neo trên dock, chứa `EntityDetails` |
| `apps/client/src/components/dock/dockIcons.tsx` | Mới — glyph cho lệnh không có PNG (brush, lệnh quân, huỷ/nâng cấp) |
| `apps/client/src/components/dock/DockBar.tsx` | Mới — dải 156 px (`data-command-dock`), ghép radar + strip (cap 460 px) + card + popover |
| `apps/client/src/components/dock/DockBar.test.tsx` | Mới — render SSR: 15 ô khi chọn dân, chỉ radar khi không chọn, popover khi mở, nhãn đổi theo ngôn ngữ |
| `apps/client/src/components/buildingIcons.tsx` | Mới — bảng glyph lucide cho mọi `BuildingType`, fallback cho ô thiếu PNG |
| `apps/client/src/components/resourceThumbnails.ts` | Mới — một bảng art resource dùng chung cho dải thông tin và popover (trước là hai bản sao) |
| `apps/client/src/components/BuildMenu.tsx` | Bỏ nhánh desktop; chỉ còn nhánh `compact` cho mobile |
| `apps/client/src/components/EntityDetails.tsx` | Thêm `variant='popover'`; `compact` của mobile giữ nguyên |
| `apps/client/src/components/Minimap.tsx` | Tiêu đề thành chip overlay để radar dùng hết chiều cao panel |
| `apps/client/src/App.tsx` | Nhánh desktop đổi sang `DockBar`; thêm state `detailsOpen`; popover mở thì `setInputEnabled(false)`; `Esc` đóng popover trước |
| `apps/client/src/i18n/locales/en.ts`, `vi.ts` | Nhóm key `dock.*` (tên trang, nút lệnh, lý do chặn, nút Chi tiết); xoá `minimap.title` vì tiêu đề radar đã thành chip overlay |
| `docs/plans/README.md` | Thêm một dòng index cho phase 28 |

## 6. Edge case

| # | Tình huống | Hành vi |
| --- | --- | --- |
| 1 | Không chọn gì | `buildDockPages` trả `[]` → `DockBar` chỉ render radar, không có khung card rỗng (D8) |
| 2 | Đổi selection khi popover đang mở | Popover **tự đóng** (`App` có effect theo `selectedEntity?.id`), vì một bảng chi tiết của entity cũ nổi trên selection mới là thông tin sai |
| 3 | Đơn vị chết khi đang chọn | Scene phát selection `null` → card biến mất, dock còn radar; popover phải đóng để không hiện bảng của entity đã chết |
| 4 | Chọn lẫn dân + lính (`villagerSelected` cùng lính) | `villagerSelected === true` thì trang `BUILD` đứng đầu, `ORDERS` đứng sau — dân được chọn là lý do mở card xây; không có hai lưới xây |
| 5 | Đang tập kích | Trang `BUILD` vẫn hiện nhưng mọi lệnh `disabled`, `title` kèm `dock.raidBlocked` (D7) |
| 6 | Công trình khoá cấp Nhà chính | Ô `disabled` + `lockedLevel` + title `build.lockedAtLevel`; **không** ẩn ô, để người chơi biết cần nâng TC |
| 7 | Thiếu tài nguyên | Ô `disabled` nhưng vẫn in giá; brush đường/xoá đường **không** bị chặn bởi giá (chúng không tốn tài nguyên để chọn) |
| 8 | Công trình không có PNG thumbnail | Ô dùng `buildingIcon(art)` làm glyph vector; `thumbnail === null` không được vẽ `<img>` rỗng |
| 9 | `Esc` | Đóng popover nếu đang mở; popover đã đóng thì `Esc` mới xoá selection như hành vi cũ (D6) |
| 10 | Cửa sổ hẹp 1024×600 | Dock vẫn giữ 156 px (khoảng một phần tư chiều cao cửa sổ); card 5×3 vẫn đủ chỗ vì bề rộng card suy ra từ ô 38 px, không phải phần trăm viewport |
| 11 | Mobile | Không đổi: `MobileCommandBar`, `BuildMenu compact`, `Minimap compact`, `EntityDetails compact` giữ nguyên (D9) |

## 7. Test

**`dock/commandPages.test.ts`** — dữ liệu thuần, không cần scene:

- Không selection và selection là resource node → `[]` (card không render).
- Dân: trang `['BUILD', 'ORDERS']`; `BUILD` có đúng 15 lệnh theo thứ tự `build:<type>` của
  `BUILDING_HOTKEYS` rồi `tool:ROAD`, `tool:ROAD_ERASE`, `tool:WALL_ERASE`.
- Phím tắt trên ô khớp `BUILDING_HOTKEYS` và `UNIT_TRAINING_HOTKEY_BY_TYPE`.
- Khoá cấp: `MINING_CAMP` `lockedLevel = 3` ở TC Lv1, mở ở TC Lv3.
- Thiếu tài nguyên: mọi ô `build:*` disabled, brush vẫn bật.
- `active`: placement đang mở, `roadMode = 'erase'`, `wallMode = 'erase'` cùng lúc.
- `showRoadTools = false` (battlefield) → bỏ 3 brush, còn 12 ô.
- Tập kích: 15 ô đều disabled và title chứa `dock.raidBlocked`.
- Lính: `ORDERS` đủ 6 lệnh S/D/A/P + Clear + Home; armed order hiện `active`; lính không sở hữu →
  không trang nào.
- Công trình: `BARRACKS` → `['TRAIN', 'UPGRADE']`; đang nâng cấp → `upgrade:CANCEL` thay
  `upgrade:START`; hết 2 slot → disabled + `dock.slotsFull`; TC thiếu trụ cột → `dock.gateBlocked`;
  công trình địch → `[]`; foundation vẫn có `TRAIN`.
- Handler: click ô gọi đúng `onSelectBuilding` / `onSelectRoad` / `onSelectWallErase` /
  `onTrainUnit` / `onUpgradeBuilding`.
- Mọi trang ≤ `DOCK_SLOT_CAPACITY`.
- Giá train: thiếu tài nguyên → ô `train:<type>` disabled.
- Hàng đợi: `trainingQueue` khác rỗng → thêm `train:CANCEL` và bấm gọi `onCancelTrain`.
- Nghiên cứu đang chạy (`researchUnitType`) → `research:CANCEL` thay ô nghiên cứu, bấm gọi
  `onCancelUnitUpgrade`.
- `selectionDisplayName`: dân nhiều con → `Tên (3)`; công trình → nhãn theo type; resource → nhãn node.
- `costText`: chỉ in tài nguyên có giá > 0.

**`dock/dockMetrics.test.ts`** — hình học là hợp đồng, không phải khẩu vị:

- `DOCK_HEIGHT_PX` ≤ 168, và tỉ lệ chiều cao `< 0,21` ở 768 px, `< 0,15` ở 1080 px (tức 20,3% và
  14,4%).
- Radar khớp đúng chiều cao dock: `140 + 2*(6+2) === 156`.
- Header + gap + 3 hàng ô vừa trong `DOCK_CARD_INNER_HEIGHT_PX`.
- `5 * 3 === 15`.
- Ô trong khoảng 36–42 px.
- `DOCK_CARD_WIDTH_PX` bằng công thức suy ra (không phải số magic) và ≤ 260.
- `DOCK_MINIMAP_PX === MINIMAP_CSS_SIZE`: bề rộng radar được **suy ra**, không chép lại, nên raster
  đổi là test đỏ ngay.

**`dock/DockBar.test.tsx`** — render SSR (`renderToString`, cùng pattern `AuthScreen.test.tsx`):
dải có `data-command-dock` + style `height:156px` và đúng 15 `data-command-slot`; `entity = null` →
không có `data-command-card`, vẫn còn `data-minimap-desktop`; `detailsOpen` → có
`data-details-popover` với `role="dialog"`; dân (2 trang) có mũi tên chuyển trang, nhà ở (1 trang)
không có; nhãn đổi theo `en`/`vi`.

**`typography.test.ts`** — vẫn phải xanh: nó quét mọi `.tsx`/`.ts` trong `src` (bỏ file `.test.ts`)
và chặn `text-[<11px]`. Ô 38 px dễ bị cám dỗ hạ cỡ chữ, nên floor 11 px áp cho cả dock.

## 8. Acceptance criteria

- [x] `document.querySelector('[data-command-dock]').getBoundingClientRect().height === 156` ở
      1920×1080 và 1366×768.
- [x] Dải đáy đo được không quá 14,4% chiều cao ở 1920×1080 và 20,3% ở 1366×768.
- [x] Chọn dân → trang Xây có đủ 15 lệnh trong lưới 5×3, đúng thứ tự phím Q W E R T Y U I C B N G
      + đường + xoá đường + phá tường.
- [x] Chọn công trình → có trang Train và/hoặc Nâng cấp; chọn lính → có trang Lệnh.
- [x] Không chọn gì → dock chỉ còn radar, không có khung card rỗng.
- [x] Không in nhãn tên dưới ô; tên + giá hiện ở header khi hover **và** khi focus bằng `Tab`.
- [x] Popover Chi tiết mở/đóng được; đang mở thì map không nhận lệnh; `Esc` chỉ đóng popover.
- [x] Đang tập kích: trang Xây disable kèm lý do, không bị ẩn.
- [x] Mobile (390×844 landscape) không đổi so với trước phase.
- [x] `tsc --noEmit`, `vitest run`, `pnpm --filter @chien-quoc/client build` đều sạch.

## 9. Verify

```bash
cd apps/client && ./node_modules/.bin/tsc --noEmit
cd apps/client && ./node_modules/.bin/vitest run
pnpm --filter @chien-quoc/client build
```

Đo hình học trên browser đang chạy (DevTools console hoặc CDP):

```js
document.querySelector('[data-command-dock]').getBoundingClientRect().height === 156
```

### 9.1 Kết quả đo (2026-11-12, Chrome + dev server `:5173`)

| Viewport | `data-command-dock` | % chiều cao | Radar | Strip | Card | Ô lệnh |
| --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | 1896×**156** | **14,4%** | 156×156 | 460×156 | 222×156 | 15 |
| 1440×799 | 1416×**156** | 19,5% | 156×156 | 460×156 | 222×156 | 15 |
| 1366×768 | 1342×**156** | **20,3%** | 156×156 | 460×156 | 222×156 | 15 |

Chiều cao là **hằng số**: chỉ phần trăm đổi theo viewport, đúng như thiết kế (D1). Các bước đã kiểm
tay: chọn dân → 15 ô đúng thứ tự Q W E R T Y U I C B N G + 3 brush; bấm
"Nhà ở" → banner đặt nhà + ô `aria-pressed=true`; `Esc` → huỷ đặt, vẫn giữ selection; chọn Nhà chính
→ trang `TRAIN` (1 ô Villager) + trang `UPGRADE` (nâng cấp bị chặn bởi gate 3/6 trụ cột, nghiên cứu
Villager bấm được); nút Chi tiết → popover 360×479 (`max-h: 60vh`), cuộn được, có `[data-upgrade]`
và `[data-research]`, dock vẫn 156 px; `Esc` → đóng popover, giữ selection; mobile (emulate
844×390 touch) → **không** có `data-command-dock`, có `data-minimap-compact` + `data-mobile-command-bar`
+ nút sheet Xây.

## 10. Ngoài phạm vi

- Không đổi `MobileCommandBar`, sheet build compact, `Minimap compact`, HUD compact (D9).
- Không đổi gameplay, giá, thời gian, công thức cân bằng; dock chỉ hiển thị lại lệnh đã có.
- Không đổi `CommandController`: phím tắt vẫn là nguồn sự thật, dock chỉ in lại cùng ký tự.
- Không thêm `NetworkMessage`, không đổi schema/DB, không migration.
- Không làm dock cho spectator (cửa sổ quan sát vẫn read-only, không có lệnh).
- Không đổi palette/font; giữ `aoe-panel`, `font-medieval`, `text-amber-*` như các bề mặt khác.

## 11. Definition of Done

- [x] `cd apps/client && ./node_modules/.bin/tsc --noEmit` sạch.
- [x] `cd apps/client && ../../node_modules/.bin/vitest run` xanh, gồm `commandPages.test.ts`,
      `dockMetrics.test.ts`, render test của `DockBar`, và `typography.test.ts`.
- [x] `pnpm --filter @chien-quoc/client build` sạch.
- [x] `grep -rn "data-command-dock" apps/client/src` trả đúng 1 hit (component `DockBar`).
- [x] Nhánh desktop của `BuildMenu` đã bị bỏ; file chỉ còn nhánh `compact`.
- [x] `App.tsx` không còn khối `absolute bottom-3 … justify-between` ba panel ở nhánh desktop.
- [x] Đo tay `data-command-dock` = 156 px ở 1920×1080 và 1366×768.
- [x] Không file nào ngoài `apps/client` và `docs/plans` bị đổi (`git status`).
- [x] `docs/plans/README.md` có dòng index của phase 28.

## 12. Review & fix (2026-11-12)

Rà soát 5 trục (correctness · readability · architecture · security · performance) cộng mutation
testing trên suite `dock/`. Không có vấn đề bảo mật (không thêm input người dùng, không `innerHTML`,
không secret, không lệnh SQL) và không có vấn đề hiệu năng (mỗi trang ≤ 15 lệnh, lưới dựng lại ~15
phần tử mỗi render, listener chỉ gắn khi popover mở).

| # | Mức | Phát hiện | Sửa |
| --- | --- | --- | --- |
| 1 | Required | `canCommand` trong `orderCommands` luôn `true` (trang chỉ được tạo cho lính của mình) → 5 nhánh `disabled: !canCommand` là code chết | Bỏ biến + 5 nhánh; `disabled: false` kèm comment lý do |
| 2 | Required | Ba literal brush gần trùng nhau, luật "cấm khi tập kích" lặp 3 lần | Một bảng dữ liệu + một projection (`blockedTitle` một chỗ) |
| 3 | Required | `trainCommands`/`upgradeCommands` kiểm `isOwner` lần thứ hai; mutation "enemy building offers training" sống sót vì test chỉ chứng minh dispatcher | Bỏ bản sao, dispatcher giữ luật, test cũ vẫn phủ |
| 4 | Required | Mutation lộ 4 lỗ hổng test: giá train, huỷ hàng đợi, huỷ nghiên cứu, mũi tên trang | Thêm 4 test; sau sửa **10/10 mutation bị giết** |
| 5 | Required | `DOCK_MINIMAP_PX = 140` chép tay từ `MINIMAP_CSS_SIZE` | Suy ra từ `MINIMAP_CSS_SIZE` + assert bằng nhau |
| 6 | Required | Bảng art resource lặp ở `SelectionStrip` và `EntityDetails` (comment cũ tự thừa nhận) | `resourceThumbnails.ts` dùng chung |
| 7 | Required | Sheet mobile: brush phá tường bị đổi thành `Eraser`, trùng icon nút xoá đường | Trả lại `BrickWall` |
| 8 | Required (a11y) | Đóng popover không trả focus về nút đã mở nó | Lưu `activeElement` khi mở, focus lại khi đóng (guard `isConnected`) |
| 9 | Optional | `detailsOpen` là boolean + effect đồng bộ → một frame có thể hiện sheet của selection cũ | Đổi sang `detailsEntityId`; `detailsOpen` suy ra; bỏ effect |
| 10 | Optional | Header giữ nguyên object command đã hover → giá có thể cũ sau một tick | Giữ `hoveredId`, tra lại trong trang hiện tại |
| 11 | Nit | Key `minimap.title` chết sau khi tiêu đề radar thành chip | Xoá khỏi `en.ts` + `vi.ts` |
| 12 | FYI | Nhánh `variant='panel'` non-compact của `EntityDetails` hiện không được mount (chỉ còn mobile `compact` + `popover`) | Giữ làm mặc định của component; phase 27 sẽ dùng lại khi làm dialog semantics |

Kích thước sau khi sửa: `dock/commandPages.ts` 506 dòng — file lớn nhất của dock, vẫn dưới ngưỡng
1000; lần mở rộng tiếp theo nên tách phần BUILD khỏi phần công trình thay vì cộng dồn.

Kết quả kiểm lại: `tsc --noEmit` sạch; **574** test xanh (43 file); `vite build` OK; mutation 10/10 bị
giết (raid, khoá cấp, giá, hàng đợi, nghiên cứu, gate TC, slot nâng cấp, quyền sở hữu, mũi tên trang,
radar). Kiểm tay lại trên browser: header đổi `Build → House — Wood 50` khi hover, mũi tên trang
`TRAIN → UPGRADE`, đổi selection lúc popover mở → popover tự đóng, `Esc` trả focus về nút Chi tiết,
sheet mobile có 3 brush với 3 icon khác nhau, dock vẫn **156 px**.
