# Plans — Index

Thư mục này thay cho `docs/plan/` (số ít) đã bị xoá ở commit `94cc557` sau khi các phase
`BUG-*` / `CTL-*` / `CMD-*` / `SIM-*` / `ECO-*` / `UIX-*` đóng xong. Quy ước giữ nguyên như cũ.

## Danh sách phase

| Phase | Chủ đề | Status |
| --- | --- | --- |
| [`01-owner-visibility.md`](./01-owner-visibility.md) | Nhìn ra quân / nhà nào của ai trên chiến trường (`OWN-01..OWN-05`; `OWN-06` DEFERRED) | APPROVED — chờ code |
| [`02-single-session.md`](./02-single-session.md) | Một tài khoản một phiên: chặn tab/thiết bị thứ hai, cưỡng chiếm phiên có xác nhận (`SESS-01..SESS-07`) | DONE — code + test |
| [`03-level-upgrades.md`](./03-level-upgrades.md) | Nâng cấp công trình (TC 100 cấp, còn lại 10) và nghiên cứu lính toàn cục (10 cấp) (`LVL-00..LVL-07`) | IMPLEMENTED — chờ verify tay |
| [`04-kingdoms-battlefield.md`](./04-kingdoms-battlefield.md) | Kinh thành riêng mỗi tài khoản + cổng ra chiến trường chung, travel mang quân, persistence theo zone (`MAPS-01..MAPS-10`) | IMPLEMENTED — chờ verify tay UI |
| [`05-map-realism.md`](./05-map-realism.md) | Map tự nhiên hơn: nền cỏ/tint, đường đất, decor PNG + rừng viền, minimap cụm rừng + glyph (`VIS-01..VIS-10`) | IMPLEMENTED — chờ verify tay |
| [`06-aoe-asset-rebuild.md`](./06-aoe-asset-rebuild.md) | Tạo lại art công trình/cây/tài nguyên/terrain từ collection "AoE like Assets" (`ART-01..ART-12`) | IMPLEMENTED (một phần) — 8 sprite đã thay; terrain bỏ vì atlas không cắt được; chờ verify tay |
| [`07-smaller-kingdom-map.md`](./07-smaller-kingdom-map.md) | Kingdom riêng nhỏ lại 110×110, TC ở giữa map, map size theo zone (`D1–D8`) | IMPLEMENTED — chờ verify tay UI |
| [`08-progression-curve.md`](./08-progression-curve.md) | Đường cong nâng cấp dài hạn: 1-10 tính bằng phút, từ 11 tính bằng giờ (×1,05/cấp), gate TC ↔ 4 trụ cột, 2 slot (`LVL2-00..LVL2-07`) | IMPLEMENTED — chờ verify tay |
| [`09-road-and-gate-assets.md`](./09-road-and-gate-assets.md) | Thay art đường đất + cổng bằng 2 ảnh AI gen, bỏ tint tím mượn tower (`GATE-01..ROAD-02`) | IMPLEMENTED — chờ verify tay |
| [`10-persistence-scaling.md`](./10-persistence-scaling.md) | Chi phí autosave theo zone, tải theo số user, dirty tracking + batch upsert + resource delta (`SAVE-01..SAVE-07`) | DRAFT |
| [`11-mobile-touch.md`](./11-mobile-touch.md) | Chơi trên mobile: touch gesture (pan/pinch/tap/long-press), thanh lệnh, HUD compact landscape, join lại khi resume (`MOB-01..MOB-10`) | IMPLEMENTED — chờ verify máy thật |
| [`12-under-attack-alert.md`](./12-under-attack-alert.md) | Cảnh báo khi bị tấn công: banner + ping minimap (`ATK-01..ATK-05`) | APPROVED — chờ code |
Status: `DRAFT` (chưa chốt quyết định) → `APPROVED` (bắt đầu code) → `DONE`.

Phase 01 đã chốt 4 quyết định D1–D4 ngày 2026-11-01 (xem §11 của file phase); chưa có dòng code nào
được viết.

Phase 02 đã chốt 6 quyết định (policy "phiên cũ thắng", force takeover thủ công, dùng state RAM thay
vì DB khi takeover, heartbeat/`allowReconnection` để backlog) ngày 2026-11-01 và đã code xong ngày
2026-11-02: `SessionRegistry` ở server, join gate + close code 4004/4009/4011 trong
`@chien-quoc/shared`, màn chặn + nút cưỡng chiếm ở client. Verify tay 2 phiên cùng account đã chạy
(join thứ hai bị 4009, force takeover đá tab cũ bằng 4004, F5 không bị chặn).

Phase 05 (map realism) là phase **visual-only**: chỉ sửa client + thêm asset PNG CC-BY, không đụng
server/shared/schema/DB. Nguồn asset free pack được chọn vì local ComfyUI không truy cập được lúc
lập plan; xem `05-map-realism.md` §2 và §4 để biết quyết định D1–D8 và license/attribution.

Phase 06 (asset rebuild) thay **file PNG đang ship** bằng art lấy từ collection
[AoE like Assets](https://opengameart.org/content/aoe-like-assets), thay vì đổi cách vẽ map như phase
05. Hai phase không trùng file: 05 sửa `TerrainLayer`/`DecorLayer`/`Minimap`, 06 sửa
`apps/client/public/assets` + `buildingArt.ts` + preload. Đã implement ngày 2026-11-03 với D1 = B
(chấp nhận công trình Tây Âu), D5 = A (asset thiếu giữ art cũ): 8 sprite (4 cây + barracks, house,
town centre, lumber camp) được dựng lại bằng `scripts/assets/build.py`, có lock hash và test. Tertiary
`ART-03` (terrain) đã bị bỏ vì `grassland_tiles.png` là atlas đóng gói, không phải lưới 64×32, và
được render unlit (tối hơn palette client ~2×) — D2 vì thế không áp dụng; lý do đo được ở
`06-aoe-asset-rebuild.md` §16.3. Danh sách asset **không có nguồn** trong collection (farm, tower,
portal, gold mine, cavalry, icon, cursor) nằm ở §5 và `scripts/assets/README.md`.

Phase 07 tách kích thước map khỏi hằng toàn cục: kingdom **110×110**, battlefield giữ **220×220**,
TC luôn ở tâm kingdom, và `WorldState.mapWidth/mapHeight` (field có sẵn nhưng chưa dùng) trở
thành nguồn sự thật cho server + client. Phase này **có** migration dữ liệu một lần: xoá
`buildings`/`units`/`world_resource_nodes` của zone `kingdom:%` và sinh lại TC ở tâm, giữ row
`players` (tài nguyên, level, research); chi tiết và edge case ở `07-smaller-kingdom-map.md` §4.5
và §5. Không đổi schema bảng, không cần reset DB, nhưng nên backup `apps/server/database/dev.db`
trước lần boot đầu tiên. Đã code xong ngày 2026-11-03 (chưa commit): migration đã chạy trên
`apps/server/database/dev.db`, probe SDK thật xác nhận kingdom 110×110 với TC `(53,53)`/portal
`(103,54)` và battlefield vẫn 220×220.

Phase 08 (progression curve) thay **đường cong thời gian/giá** của phase 03 bằng hai giai đoạn: cấp
1-10 tính bằng phút, từ cấp 11 tính bằng giờ và nhân **1,05** mỗi cấp, cộng thêm gate cấp TC ↔ 4
công trình trụ cột (House/Barracks/Farm/Tower) mỗi 5 cấp và giới hạn 2 slot nâng cùng lúc. Đường đi
tối thiểu tới TC 100 là **4.129h** (≈3,8 năm ở 3h/ngày); nhà phụ vẫn cap 10 và không thuộc gate.
Timer **chỉ chạy khi online** và cộng dồn qua các phiên (D7), nên "giờ" trong doc là giờ chơi thật,
không phải lịch. Đã code xong ngày 2026-11-03: `levels.ts` hai giai đoạn + `getRequiredCoreLevel`/
`getCoreLevelGaps`, cap 100 cho 4 trụ cột, gate + slot trong `handleUpgradeBuilding`, panel client có
khối trụ cột + `Slot n/2` + format `45s/12m/6h42/73h`; test server/client đều xanh. Còn verify tay
§10. Xem `08-progression-curve.md` §2, §4 và §11.

Phase 09 (road + gate assets) thay nốt 2 chỗ art còn là placeholder: 4 stamp đường lặp motif và cổng
đang mượn sheet tower + tint tím. Nguồn là 2 ảnh AI gen trong `Downloads/games`, xử lý bằng
`scripts/process_generated_assets.py` (không đưa vào `manifest.json` vì không phải third-party).
Quyết định đáng chú ý: căn cổng bottom-center theo bbox (tâm lối đi lệch 17 px, đã đo), `offsetY`
`-140`, bỏ tint, và chuẩn hoá 4 crop đường về mean 150. Đã implement ngày 2026-11-03: `portal.png`
320×360 (topInset 4 → `HP_BAR_Y.PORTAL = -326`), 4 road stamp 120×60 mean 150, `--check` của script
mới và `build.py --check` đều xanh; còn verify tay §7.2. Xem `09-road-and-gate-assets.md` §3 và §6.

Phase 10 (persistence scaling) không sửa gameplay: nó ghi lại chi phí thật của autosave 30 s theo
zone (mỗi user một kingdom room, battlefield dùng chung) và đề xuất 4 bước giảm tải — dirty tracking,
batch upsert entity, resource delta, throttle tick của room rỗng. Kết luận hiện tại: 1 request/30 s
mỗi user là **không đáng kể**; nút thắt là số statement bên trong mỗi request (mỗi entity một upsert)
và SQLite một writer, cộng thêm 20 Hz tick cho mỗi room. Số đo trên dev DB: battlefield 1258 resource
node, kingdom ~260 node. **Chưa có dòng code nào**, các quyết định D1–D7 còn ở trạng thái ĐỀ XUẤT; xem
`10-persistence-scaling.md` §2–§5.

Phase 11 (mobile) chuyển input từ chuột/phím sang touch: Phaser hiện chỉ nhận 1 pointer và mọi lần
chạm bị đọc thành chuột trái (⇒ box-select), nên phase này thêm máy trạng thái gesture thuần
(pan / pinch / tap / long-press), nhánh touch riêng trong `WorldScene`, một thanh lệnh nút 46×48 px
dưới màn hình, HUD compact landscape và cơ chế join lại khi mở lại app (khoá màn hình). Chốt ngày
2026-11-03 với user: full touch RTS, landscape bắt buộc, **không** PWA, chưa làm gán nhóm quân trên
mobile. Đã implement cùng ngày, **không** đổi server/shared/schema/DB, không migration: 5 module mới
có test thuần (36 test), `tsc` sạch 2 app, vitest 336/336, và kiểm chứng tay bằng Chrome headless
CDP (chọn / pan / pinch / đặt nhà / giữ lâu thu hoạch / tap move đều pass). Vòng review sau đó sửa
6 lỗi (radar compact trống, chuột phải minimap nhảy camera, timer long-press sống sót khi đóng
panel, arm "Ra lệnh" bị phím `A` ghi đè, ghost bị ngón thứ hai kéo, sheet Xây tràn 12 px) và nâng
tap target HUD lên 44 px — chi tiết ở §12. Còn verify trên máy thật (iOS Safari page-zoom,
safe-area, reconnect sau khoá màn hình). Xem `11-mobile-touch.md` §2 (D1–D10), §4 (bảng cử chỉ),
§11 (kết quả đo) và §12 (review & fix).

## Quy ước

1. **Mỗi task = 1 commit** (hoặc 1 PR). Không gộp 2 task khác phase vào một commit.
2. Task nào chạm protocol (`NetworkMessage`) phải cập nhật **cả 3 chỗ**:
   `packages/shared/src/types/index.ts` → `apps/server/src/rooms/WorldRoom.ts` → `apps/client/src/game/scenes/WorldScene.ts`.
3. Thay đổi `@type()` trong schema (`apps/server/src/schema/*`) là **breaking** với snapshot đã lưu
   trong `apps/server/database/dev.db` → phải ghi rõ bước reset DB trong task.
4. Trước khi đánh dấu xong: `tsc --noEmit` cho cả `apps/server` và `apps/client`, và `vitest run`
   cho package bị chạm.
5. Không commit/push khi chưa được phép. Commit message **tiếng Anh**.
6. Chat, giải thích logic và tài liệu (file này) viết **tiếng Việt**; code, docstring, comment
   trong code và commit message viết **tiếng Anh**.

## Definition of Done (chung)

- [ ] `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `pnpm --filter @chien-quoc/client test` và `pnpm --filter @chien-quoc/server test` xanh
- [ ] Thao tác chạy được trong game thật (không chỉ typecheck)
- [ ] Không tạo message mới nếu có thể tái dùng message sẵn có
- [ ] Task có sửa schema → đã ghi chú reset DB
