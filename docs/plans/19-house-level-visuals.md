# Phase 19 — Nhà đổi hình dạng theo cấp (visual tiers)

Status: **IMPLEMENTED — chờ verify tay trong game**
Ngày: 2026-11-05

## 1. Mục tiêu

Công trình `HOUSE` leo tới cấp 100 nhưng chỉ có **một** sprite. Phase này cho nhà đổi
**hình dạng** theo cấp: 5 bậc, mỗi bậc một PNG riêng. Chỉ số, giá và thời gian nâng cấp
không đổi — phase này thuần visual.

Ngoài phạm vi: Barracks/Farm/Tower (bảng bậc viết dạng map theo `BuildingType` nên mở
rộng sau chỉ cần thêm art + một dòng mốc).

## 2. Quyết định

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Chỉ `HOUSE`; 4 trụ cột còn lại giữ 1 sprite |
| Cách đổi hình | Thêm PNG riêng cho từng bậc (không scale, không tint, không ghép Graphic) |
| Số bậc | 5 |
| Mốc cấp | `1 / 2 / 5 / 10 / 25`; từ cấp 25 trở lên giữ bậc cuối |
| Nguồn art | Series Medieval Building của Bleed trên OpenGameArt (CC-BY 3.0) + hovel hiện tại cho bậc 1 |
| Nguồn sự thật mốc bậc | `packages/shared/src/utils/levels.ts` (`HOUSE_VISUAL_TIER_LEVELS`) |
| Server | Không đổi. `BuildingState.level` đã replicate sẵn; bậc là hàm thuần của level |
| DB / protocol | Không đổi |

## 3. Bảng bậc

| Bậc | Cấp | Tên | File | Canvas |
| --- | --- | --- | --- | --- |
| 1 | 1 | Thatched Hut | `house.png` (hovel `60000`, giữ nguyên) | 256×220 |
| 2 | 2–4 | Timber Cottage | `house_2.png` | 318×232 |
| 3 | 5–9 | Stone Cottage | `house_3.png` | 341×256 |
| 4 | 10–24 | Town House | `house_4.png` | 379×280 |
| 5 | 25+ | Manor | `house_5.png` | 405×304 |

Tên hiển thị ở panel là tiếng Anh (cùng quy ước với `BUILDING_BLUEPRINTS`); nhãn UI
("Hình 3/5 · …", "đổi ở Lv 10") là tiếng Việt.

## 4. Asset pipeline

`scripts/assets/manifest.json` thêm 4 source `oga.bleed-medieval-01/04/05/06` (Bleed,
CC-BY 3.0) và 4 target `building.house-2..5`.

Op chain mỗi target:

```json
{ "alphaFloor": 96, "crop": "alpha", "fit": true, "matchLum": 107.3, "anchor": "bottom-center" }
```

`alphaFloor` là op mới trong `ops.py` (`floor_alpha`), chạy **hai lần**: trước `crop` và
sau `fit`.

Lý do: ba trong bốn sheet Bleed có **bóng đổ bake sẵn**, kéo dài về một phía. Cổng
`iso_base` của `build.py --check` đo hàng opaque cuối cùng so với tâm bbox art, nên bóng
đổ làm góc trước lệch 12–17% bề ngang và bị chặn — dù toà nhà vẫn đứng đúng góc iso.
Hạ alpha dưới ngưỡng 96 rồi giãn phần còn lại về 0–255 giữ silhouette sắc mà cắt bóng mờ.
Lần thứ hai sau `fit` vì resample lanczos sinh lại pixel alpha rất mờ ở hàng đáy và
chính chúng làm lệch lại phép đo.

Giới hạn đã biết: `iso_base` so góc trước với **tâm bbox**, nên source có silhouette bất
đối xứng (tháp/chái một bên) không thể đạt offset ≤ 10% dù đặt thế nào. Hai ứng viên
`mb01`/`mb03` vì thế bị loại và thay bằng bộ Bleed khác, không nới ngưỡng.

## 5. Client

**`render/buildingArt.ts`**

- `HOUSE_TIERS: TierArtSpec[]` lưu `canvasHeight` và `topInset` của sheet đã ship.
- `buildingArt(type, hasTexture, level = 1)`: với bậc N > 1 thử `building_<TYPE>_<N>`,
  lùi dần về N−1 khi thiếu, cuối cùng rơi về `building_<TYPE>` rồi texture procedural.
  Nhờ vậy một sheet load lỗi làm nhà **giữ hình cũ**, không thành ô xanh.
- `drawnTier()` là **một** vòng lặp duy nhất quyết định bậc nào thực sự được vẽ; cả
  sprite lẫn panel dùng chung nó. Nếu PNG bậc 4 mất, cả hai cùng báo bậc 3 — không có
  chuyện nhà vẽ cottage mà nhãn ghi "Manor".
- `buildingVisualTierCount(type)` đếm **sheet art** có thật, tách hẳn khỏi
  `getBuildingVisualTierCount` của shared (đếm **mốc game**). Preload và panel đọc bản
  art, nên một mốc mới trong shared chưa có ảnh sẽ không làm preload 404.
- `buildingTierInfo(type, level, hasTexture)` trả `{tier, count, name, nextLevel}` trong
  một lần gọi, để panel không phải clamp lại từng trường.
- `buildingHpBarY(type, level = 1)` suy ra `offsetY − canvasHeight/2 + topInset − 8` cho
  type có bảng bậc; type khác giữ bảng `HP_BAR_Y` cũ.
- `offsetY = 40 − canvasHeight/2`, công thức này tái tạo đúng `−70` của sheet 220 px.

**`scenes/WorldScene.ts`**

- `preload()` nạp `building_HOUSE_2..5` bằng vòng lặp trên `buildingVisualTierCount('HOUSE')`
  (số sheet art, không phải số mốc game); cache-buster `v` từ `v=9` lên `v=10`.
- `SelectedEntityData` thêm `visualTier`, `visualTierCount`, `visualTierName`,
  `nextVisualTierLevel`; `resolveSelectedEntity` điền từ `buildingTierInfo`.

**`render/EntityRenderer.ts`**

- `applyBuildingTier(container, building)` chạy trong `cb.onChange`: nếu **texture key**
  khác key đang vẽ thì `setTexture` + `setY(offsetY)` + `setScale` + dời `levelBadge` +
  cập nhật `visualCenterY` (hit-test đọc key này). Texture key là cache: nó phản ánh cả
  "vừa lên bậc" lẫn "sheet thiếu nên đã lùi", nên patch HP/tài nguyên là no-op.
- `updateBuildingBar` dùng `buildingHpBarY(type, level)`.

**`input/SelectionController.ts`**

- `buildingAt` trước đây dùng hộp cao cố định `sizeY*32+60`. Nhà bậc 4–5 cao tới 304 px
  nên hộp được mở theo `image.displayHeight`/`displayWidth`, và số magic `64`/`32` được
  thay bằng `TILE_WIDTH`/`TILE_HEIGHT` của shared.

**`components/UpgradePanels.tsx` + `EntityDetails.tsx`**

- Dòng `Hình N/5 · <Tier name>` và "đổi ở Lv M" khi `visualTierCount > 1`. Type một hình
  không render block này.

## 6. Test

- `apps/server/src/rooms/upgrades.test.ts` → `describe('visual tiers (LVL3)')`: mốc bậc,
  clamp cấp 0/âm/100000, type khác luôn bậc 1, tên bậc và mốc kế tiếp, `getBuildingVisualTierNameForTier`
  (index ngoài range → `null`).
- `apps/client/src/game/render/assetManifest.test.ts` → `describe('house visual tiers')`:
  mỗi `building.house*` phải có trong lock, đúng texture key theo cấp, HP bar tính lại
  từ `canvas[1]`/`topInset` của chính sheet đó, bottom-anchored ≤ 3 px, và **hai case
  mất sheet**: lùi từng bậc một, không bao giờ trả key không tồn tại, và panel báo đúng
  bậc đang vẽ.
- `portalArt.test.ts` giữ nguyên hình dạng object trả về (`BuildingArt` không thêm field).

## 7. Kiểm chứng

```bash
python scripts/assets/build.py --check
pnpm --filter @chien-quoc/shared build
cd apps/client && ../../node_modules/.bin/tsc --noEmit
cd apps/server && ../../node_modules/.bin/tsc --noEmit
pnpm --filter @chien-quoc/client test
pnpm --filter @chien-quoc/server test
```

Kết quả lần cuối: `asset check OK: 33 targets, 11 sources, 50 legacy`;
client 418 test xanh; server 189 test xanh; cả hai `tsc --noEmit` sạch.

Đã kiểm chứng test bằng mutation: đổi `for (let candidate = tier; …)` thành
`candidate = 1` làm 5 test bậc fail, rồi khôi phục — nên các test mới thực sự bắt lỗi
chứ không chỉ chạy qua.

Kiểm tra tay:

1. Đặt một House → hình nhà tranh, không badge.
2. Nâng lên Lv 2 → đổi sang Timber Cottage ngay khi tick xong; badge `Lv 2`.
3. Nâng tiếp Lv 5 / 10 / 25 → đổi hình đúng bậc; panel hiện `Hình N/5` và mốc kế tiếp.
4. Thanh HP và badge luôn nằm trên đỉnh mái của **sheet đang vẽ**, không lơ lửng.
5. Click vào phần mái cao của nhà bậc 4–5 → vẫn chọn trúng.
6. F5 giữa lúc nâng → vào lại đúng hình theo level đã lưu.
7. Ghost đặt nhà và thumbnail trong Build Menu vẫn là bậc 1.

## 8. Rủi ro đã xử lý

- **Sheet thiếu/load lỗi** → `buildingArt` lùi bậc, không bao giờ trả key không tồn tại.
- **HP bar lơ lửng khi art đổi chiều cao** → bar suy ra từ `canvasHeight` + `topInset`
  của chính sheet, bị test chặn nếu lệch.
- **Badge neo sai** → `applyBuildingTier` dời badge theo `displayHeight` sau `setTexture`.
- **Hit-test bỏ sót mái cao** → hộp click theo `displayHeight`.
- **Bóng đổ bake làm fail `--check`** → op `alphaFloor` (hai lượt), không nới ngưỡng
  `iso_base`.
- **Client/Server lệch mốc bậc** → cả hai đọc `HOUSE_VISUAL_TIER_LEVELS` từ shared.
- **Panel ghi sai hình khi sheet thiếu** → `drawnTier()` dùng chung cho sprite và panel,
  và tên bậc lấy theo **bậc đang vẽ** qua `getBuildingVisualTierNameForTier`.
- **Preload 404 khi shared thêm mốc trước khi có art** → preload đếm theo
  `buildingVisualTierCount` (số sheet), không theo `getBuildingVisualTierCount` (số mốc).
