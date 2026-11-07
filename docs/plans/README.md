# Plans — Index

Thư mục này thay cho `docs/plan/` (số ít) đã bị xoá ở commit `94cc557` sau khi các phase
`BUG-*` / `CTL-*` / `CMD-*` / `SIM-*` / `ECO-*` / `UIX-*` đóng xong. Quy ước giữ nguyên như cũ.

## Danh sách phase

| Phase | Chủ đề | Status |
| --- | --- | --- |
| [`01-owner-visibility.md`](./01-owner-visibility.md) | Nhìn ra quân / nhà nào của ai trên chiến trường (`OWN-01..OWN-05`; `OWN-06` DEFERRED) | IMPLEMENTED — chờ verify tay |
| [`02-single-session.md`](./02-single-session.md) | Một tài khoản một phiên: chặn tab/thiết bị thứ hai, cưỡng chiếm phiên có xác nhận (`SESS-01..SESS-07`) | DONE — code + test |
| [`03-level-upgrades.md`](./03-level-upgrades.md) | Nâng cấp công trình (mọi công trình 10 cấp) và nghiên cứu lính toàn cục (10 cấp) (`LVL-00..LVL-07`) | IMPLEMENTED — chờ verify tay |
| [`04-kingdoms-battlefield.md`](./04-kingdoms-battlefield.md) | Kinh thành riêng mỗi tài khoản + cổng ra chiến trường chung, travel mang quân, persistence theo zone (`MAPS-01..MAPS-10`) | IMPLEMENTED — chờ verify tay UI |
| [`05-map-realism.md`](./05-map-realism.md) | Map tự nhiên hơn: nền cỏ/tint, đường đất, decor PNG + rừng viền, minimap cụm rừng + glyph (`VIS-01..VIS-10`) | IMPLEMENTED — chờ verify tay |
| [`06-aoe-asset-rebuild.md`](./06-aoe-asset-rebuild.md) | Tạo lại art công trình/cây/tài nguyên/terrain từ collection "AoE like Assets" (`ART-01..ART-12`) | IMPLEMENTED (một phần) — 8 sprite đã thay; terrain bỏ vì atlas không cắt được; chờ verify tay |
| [`07-smaller-kingdom-map.md`](./07-smaller-kingdom-map.md) | Kingdom riêng nhỏ lại 110×110, TC ở giữa map, map size theo zone (`D1–D8`) | IMPLEMENTED — chờ verify tay UI |
| [`08-progression-curve.md`](./08-progression-curve.md) | Thang 10 cấp, thời gian ×3/cấp, giá ×1,3/cấp, gate TC ↔ 4 trụ cột **mỗi cấp**, 2 slot (`LVL2-00..LVL2-07`) | RETUNED 2026-11-05 |
| [`09-road-and-gate-assets.md`](./09-road-and-gate-assets.md) | Thay art đường đất + cổng bằng 2 ảnh AI gen, bỏ tint tím mượn tower (`GATE-01..ROAD-02`) | IMPLEMENTED — chờ verify tay |
| [`10-persistence-scaling.md`](./10-persistence-scaling.md) | Chi phí autosave theo zone, tải theo số user, dirty tracking + batch upsert + resource delta (`SAVE-01..SAVE-07`) | DRAFT |
| [`11-mobile-touch.md`](./11-mobile-touch.md) | Chơi trên mobile: touch gesture (pan/pinch/tap/long-press), thanh lệnh, HUD compact landscape, join lại khi resume (`MOB-01..MOB-10`) | IMPLEMENTED — chờ verify máy thật |
| [`12-under-attack-alert.md`](./12-under-attack-alert.md) | Cảnh báo khi bị tấn công: banner + ping minimap (`ATK-01..ATK-05`) | IMPLEMENTED — chờ verify |
| [`13-autosave-timing-log.md`](./13-autosave-timing-log.md) | Log thời gian + số statement mỗi lần autosave (`SAVE-01`) | DONE — code + test |
| [`14-under-attack-audio-status.md`](./14-under-attack-audio-status.md) | Âm thanh cảnh báo + trạng thái "đang bị đánh" trong panel (`ALERT-02`) | IMPLEMENTED — chờ verify |
| [`15-foundation-under-attack-alert.md`](./15-foundation-under-attack-alert.md) | Cảnh báo khi công trình foundation bị phá: fallback onRemove cho foundation + phân biệt huỷ của chính mình (`FND-01..FND-03`) | APPROVED — chờ code |
| [`16-autosave-benchmark.md`](./16-autosave-benchmark.md) | Benchmark autosave: spawn N client giả, đo p95 thời gian lưu (`SAVE-06`) | IMPLEMENTED — chờ verify |
| [`17-persistence-direct-tests.md`](./17-persistence-direct-tests.md) | Test trực tiếp cho persistence: `saveFullWorldState`, `saveZoneResources`, `initializeWorldPersistence` (`TEST-01`) | IMPLEMENTED — chờ verify |
| [`18-doc-plan-status.md`](./18-doc-plan-status.md) | Sửa status trong `docs/plans/` (README + file plan) (`DOC-01`) | APPROVED — awaiting code |
| [`19-rejected-command-classification.md`](./19-rejected-command-classification.md) | Bảng "lệnh bị từ chối" có phân loại (`FLOW-01`) | IMPLEMENTED — chờ verify |
| [`20-kingdom-resource-density-regrow.md`](./20-kingdom-resource-density-regrow.md) | Tài nguyên kingdom dồn vành rìa, mật độ ~2×, hồi đầy theo loại và lưu mốc vào SQLite (`RES-01..RES-03`) | IMPLEMENTED — chờ verify tay |
| [`21-house-level-visuals.md`](./21-house-level-visuals.md) | Nhà đổi hình dạng theo **cấp Nhà chính**: 5 bậc art (Lv 1 / 2 / 4 / 6 / 8 áp lên TOWN_CENTER), PNG riêng mỗi bậc (`LVL3-00..LVL3-05`) | SPEC ĐÃ SỬA — code chưa theo (đang đổi theo cấp của chính nhà) |
| [`22-economy-gather-rates.md`](./22-economy-gather-rates.md) | Nhịp thu hoạch chậm lại theo loại (wood 2/s, food 2,5/s, stone 1,5/s, gold 1,25/s) và nông trại 250 → 600 food (`ECO-02`) | IMPLEMENTED — chờ verify tay |
| [`22-player-built-roads.md`](./22-player-built-roads.md) | Bỏ đường mặc định ở kingdom, cho người chơi kéo vẽ đường (2 gỗ/ô, +30% tốc độ, lưu SQLite) | IMPLEMENTED |
| [`23-world-map-raids.md`](./23-world-map-raids.md) | Bỏ cổng chiến trường; bản đồ thế giới lục giác lọc ±5 cấp Nhà chính; tập kích vương quốc địch (cướp 20%, khiên 72 h, khoá 3 ngày) (`RD-01..RD-12`) | IMPLEMENTED — chờ verify tay UI |
| [`24-spectator-mode.md`](./24-spectator-mode.md) | Quan sát vương quốc khác ở cửa sổ thứ hai: join read-only vào `kingdom_room`, chặn mọi lệnh, camera tự do, ẩn danh (`SPEC-01..SPEC-06`) | IMPLEMENTED — chờ verify tay UI |
| [`24-military-buildings-split.md`](./24-military-buildings-split.md) | Tách nhà lính làm 3: `BARRACKS` bộ binh / `STABLE` kỵ binh / `ARCHERY_RANGE` cung thủ; nghiên cứu cấp lính theo đúng nhà train; 6 trụ cột gate TC (`MIL-01a..j`) | IMPLEMENTED — chờ verify tay, art 2 nhà mới đã sinh |
| [`25-town-center-empire-buffs.md`](./25-town-center-empire-buffs.md) | Nhà chính buff toàn đế chế: +2%/cấp HP công trình + HP quân, +1%/cấp attack lính, −2%/cấp thời gian train, mở khoá 3 camp theo Lv1/2/3 (`D1–D9`) | APPROVED — chờ code |
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
`(108,54)` (sát mép phải, cập nhật 2026-11-05) và battlefield vẫn 220×220.

Phase 08 (progression curve) đặt **đường cong thời gian/giá** cho nâng cấp. Bản 2026-11-05 rút thang
xuống **10 cấp cho mọi công trình** và dùng một đường cong duy nhất: thời gian **×3**/cấp, giá
**×1,3**/cấp. Gate cấp TC ↔ 4 công trình trụ cột (House/Barracks/Farm/Tower) nay chạy **mỗi cấp** —
nâng TC từ `L` lên `L+1` đòi cả bốn đạt đúng `L` — cộng giới hạn 2 slot nâng cùng lúc. Tổng công
việc cả 5 công trình là 35,5h, nhưng 2 slot chạy song song nên đồng hồ chỉ trôi **~22,5h** chơi thật.
Timer **chỉ chạy khi
online** và cộng dồn qua các phiên (D7). Code: `levels.ts` (`timeScale`/`costScale` mới,
`getRequiredCoreLevel` = cấp TC, cap 10), gate + slot trong `handleUpgradeBuilding`, panel client có
khối trụ cột + `Slot n/2` + format `45s/12m/6h42/13h40`; test server/client đều xanh. Xem
`08-progression-curve.md` §2, §4 và §11.

Phase 09 (road + gate assets) thay nốt 2 chỗ art còn là placeholder: 4 stamp đường lặp motif và cổng
đang mượn sheet tower + tint tím. Nguồn là 2 ảnh AI gen trong `Downloads/games`, xử lý bằng
`scripts/process_generated_assets.py` (không đưa vào `manifest.json` vì không phải third-party).
Quyết định đáng chú ý: căn cổng bottom-center theo bbox (tâm lối đi lệch 17 px, đã đo), `offsetY`
`-140`, bỏ tint, và chuẩn hoá 4 crop đường về mean 150. Đã implement ngày 2026-11-03: `portal.png`
320×360 (topInset 4), 4 road stamp 120×60 mean 150, `--check` của script mới và `build.py --check`
đều xanh. Cập nhật 2026-11-05: cổng vẽ ở **scale 1,5** (`SHEET_SCALE.PORTAL`), nên `offsetY = -230`
và `HP_BAR_Y.PORTAL = -502`; cổng kingdom đặt **sát mép phải** (`x = width - sizeX`, trên map 110 là
`(108, 54)`). Xem `09-road-and-gate-assets.md` §3 và §6.

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
