# Phase 19 — Nhà đổi hình dạng theo cấp Nhà chính (visual tiers)

Status: **SPEC ĐÃ SỬA — code chưa cập nhật theo; bản đang chạy vẫn đổi hình theo cấp của
chính căn nhà**
Ngày: 2026-11-05 (rev. đổi nguồn cấp sang Nhà chính + hạ cap toàn bộ xuống 10)

## 1. Mục tiêu

Công trình `HOUSE` leo tới cấp 10 nhưng chỉ có **một** sprite. Phase này cho nhà đổi
**hình dạng** theo cấp: 5 bậc, mỗi bậc một PNG riêng. Chỉ số, giá và thời gian nâng cấp
không đổi — phase này thuần visual.

**Nguồn cấp là Nhà chính, không phải cấp của chính nhà đó.** Một `HOUSE` cấp 1 vẫn hiện
Manor khi Nhà chính của chủ sở hữu đã đạt cấp 8. Nhờ vậy cả vương quốc đổi diện mạo cùng
lúc với Nhà chính, và người chơi không phải nâng từng căn nhà để thấy thay đổi.

Hệ quả: bậc không còn là hàm thuần của `BuildingState.level`. Nó là hàm của
`(ownerId, level Nhà chính của ownerId)` — client phải tra Nhà chính của **đúng chủ sở
hữu** của từng căn nhà, kể cả nhà của người khác trong cùng map.

Ngoài phạm vi: Barracks/Farm/Tower (bảng bậc viết dạng map theo `BuildingType` nên mở
rộng sau chỉ cần thêm art + một dòng mốc).

## 2. Quyết định

| Chủ đề | Quyết định |
| --- | --- |
| Phạm vi | Chỉ `HOUSE`; 4 trụ cột còn lại giữ 1 sprite |
| Cách đổi hình | Thêm PNG riêng cho từng bậc (không scale, không tint, không ghép Graphic) |
| Số bậc | 5 |
| Mốc cấp | `1 / 2 / 4 / 6 / 8` áp lên **cấp Nhà chính**; từ cấp 8 trở lên giữ bậc cuối |
| Cấp dùng để tra bậc | `level` của `TOWN_CENTER` cùng `ownerId`; **không** dùng `level` của chính căn nhà |
| Nguồn art | Series Medieval Building của Bleed trên OpenGameArt (CC-BY 3.0) + hovel hiện tại cho bậc 1 |
| Nguồn sự thật mốc bậc | `packages/shared/src/utils/levels.ts` (`HOUSE_VISUAL_TIER_LEVELS`) |
| Server | Không đổi. Chiều tra cứu là "cấp → bậc" của `HOUSE`; `TOWN_CENTER.level` đã replicate sẵn |
| DB / protocol | Không đổi |

## 3. Bảng bậc

| Bậc | Cấp Nhà chính | Tên | File | Canvas |
| --- | --- | --- | --- | --- |
| 1 | 1 | Thatched Hut | `house.png` (hovel `60000`, giữ nguyên) | 256×220 |
| 2 | 2–3 | Timber Cottage | `house_2.png` | 318×232 |
| 3 | 4–5 | Stone Cottage | `house_3.png` | 341×256 |
| 4 | 6–7 | Town House | `house_4.png` | 379×280 |
| 5 | 8–10 | Manor | `house_5.png` | 405×304 |

Cả năm bậc đều nằm trong cap 10 của Nhà chính, nên không bậc nào là art chết.

Tên hiển thị ở panel là tiếng Anh (cùng quy ước với `BUILDING_BLUEPRINTS`); nhãn UI
("Hình 3/5 · …", "đổi ở Lv 6") là tiếng Việt.

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
- `buildingArt(type, hasTexture, tier = 1)` nhận **bậc đã giải sẵn**, không nhận level
  (nhận level sẽ mời gọi truyền nhầm cấp của căn nhà).
  Với bậc N > 1 thử `building_<TYPE>_<N>`, lùi dần về N−1 khi thiếu, cuối cùng rơi về
  `building_<TYPE>` rồi texture procedural. Nhờ vậy một sheet load lỗi làm nhà **giữ hình
  cũ**, không thành ô xanh.
- `buildingTierForLevel(townCenterLevel)` là **một** hàm duy nhất đổi cấp Nhà chính sang
  bậc; cả sprite, panel và preload đều đi qua nó.
- `drawnTier()` là **một** vòng lặp duy nhất quyết định bậc nào thực sự được vẽ; cả
  sprite lẫn panel dùng chung nó. Nếu PNG bậc 4 mất, cả hai cùng báo bậc 3 — không có
  chuyện nhà vẽ cottage mà nhãn ghi "Manor".
- `buildingVisualTierCount(type)` đếm **sheet art** có thật, tách hẳn khỏi
  `getBuildingVisualTierCount` của shared (đếm **mốc game**). Preload và panel đọc bản
  art, nên một mốc mới trong shared chưa có ảnh sẽ không làm preload 404.
- `buildingTierInfo(type, townCenterLevel, hasTexture)` trả `{tier, count, name, nextLevel}`
  trong một lần gọi, để panel không phải clamp lại từng trường. `nextLevel` là cấp **Nhà
  chính** kế tiếp, không phải cấp của căn nhà.
- `buildingHpBarY(type, tier = 1)` suy ra `offsetY − canvasHeight/2 + topInset − 8` cho
  type có bảng bậc; type khác giữ bảng `HP_BAR_Y` cũ.
- `offsetY = 40 − canvasHeight/2`, công thức này tái tạo đúng `−70` của sheet 220 px.

**`scenes/WorldScene.ts`**

- `preload()` nạp `building_HOUSE_2..5` bằng vòng lặp trên `buildingVisualTierCount('HOUSE')`
  (số sheet art, không phải số mốc game); cache-buster `v` từ `v=9` lên `v=10`.
- `townCenterLevelFor(ownerId)` tra `TOWN_CENTER` **của đúng chủ sở hữu** trong
  `room.state.buildings`, trả `0` khi chủ đó chưa có Nhà chính (bậc 1).
- `SelectedEntityData` thêm `visualTier`, `visualTierCount`, `visualTierName`,
  `nextVisualTierLevel`; `resolveSelectedEntity` điền từ `buildingTierInfo` với
  `townCenterLevelFor(building.ownerId)`.

**`render/EntityRenderer.ts`**

- `createBuildingSprite` và `applyBuildingTier` đều đọc cấp Nhà chính qua
  `scene.townCenterLevelFor(building.ownerId)` rồi mới gọi `buildingArt`.
- `applyBuildingTier(container, building)` chạy trong `cb.onChange`: nếu **texture key**
  khác key đang vẽ thì `setTexture` + `setY(offsetY)` + `setScale` + dời `levelBadge` +
  cập nhật `visualCenterY` (hit-test đọc key này). Texture key là cache: nó phản ánh cả
  "vừa lên bậc" lẫn "sheet thiếu nên đã lùi", nên patch HP/tài nguyên là no-op.
- **Mọi căn nhà của một chủ nghe `level` của Nhà chính chủ đó**, không chỉ nghe `level`
  của chính nó. Thêm listener trên `TOWN_CENTER.level` gọi `applyBuildingTier` cho toàn
  bộ `HOUSE` cùng `ownerId` — thiếu bước này, nhà chỉ đổi hình khi có patch đụng vào nó.
- `updateBuildingBar` dùng `buildingHpBarY(type, tier)` với `tier` lấy từ cùng phép giải
  bậc, để thanh HP không lơ lửng khi Nhà chính lên cấp.

**`input/SelectionController.ts`**

- `buildingAt` trước đây dùng hộp cao cố định `sizeY*32+60`. Nhà bậc 4–5 cao tới 304 px
  nên hộp được mở theo `image.displayHeight`/`displayWidth`, và số magic `64`/`32` được
  thay bằng `TILE_WIDTH`/`TILE_HEIGHT` của shared.

**`components/UpgradePanels.tsx` + `EntityDetails.tsx`**

- Dòng `Hình N/5 · <Tier name>` và "đổi ở Lv M (Nhà chính)" khi `visualTierCount > 1`.
  Type một hình không render block này. `M` là cấp **Nhà chính**, nên nhãn phải ghi rõ
  "Nhà chính" — nếu không người chơi sẽ tưởng phải nâng căn nhà đang chọn.

## 6. Test

- `apps/server/src/rooms/upgrades.test.ts` → `describe('visual tiers (LVL3)')`: mốc bậc,
  clamp cấp 0/âm/100000, type khác luôn bậc 1, tên bậc và mốc kế tiếp, `getBuildingVisualTierNameForTier`
  (index ngoài range → `null`). Bảng mốc vẫn là hàm thuần của số cấp; phép "cấp nào" do
  client chọn, nên shared không cần biết về Nhà chính.
- `apps/client/src/game/render/assetManifest.test.ts` → `describe('house visual tiers')`:
  mỗi `building.house*` phải có trong lock, đúng texture key theo **cấp Nhà chính** (nhà
  cấp 1 ở mọi mốc vẫn đổi hình), HP bar tính lại từ `canvas[1]`/`topInset` của chính sheet
  đó, bottom-anchored ≤ 3 px, và **hai case mất sheet**: lùi từng bậc một, không bao giờ
  trả key không tồn tại, và panel báo đúng bậc đang vẽ.
- Case mới: hai chủ có Nhà chính lệch cấp trong cùng map → nhà của chủ A vẽ bậc theo Nhà
  chính A, nhà của chủ B theo Nhà chính B; chủ chưa có Nhà chính → bậc 1.
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

Kết quả lần cuối (sau khi hạ cap xuống 10): `asset check OK: 33 targets, 11 sources, 50 legacy`;
client 422 test xanh; server 209 test xanh; cả hai `tsc --noEmit` sạch.

Đã kiểm chứng test bằng mutation: đổi `for (let candidate = tier; …)` thành
`candidate = 1` làm 5 test bậc fail, rồi khôi phục — nên các test mới thực sự bắt lỗi
chứ không chỉ chạy qua.

Kiểm tra tay:

1. Đặt một House → hình nhà tranh, không badge.
2. Nâng **Nhà chính** lên Lv 2 → mọi House của mình đổi sang Timber Cottage ngay khi tick
   xong; badge của House vẫn là `Lv 1` (badge đọc cấp của nhà, hình đọc cấp Nhà chính).
3. Nâng Nhà chính tiếp Lv 4 / 6 / 8 → đổi hình đúng bậc; panel của House hiện `Hình N/5`
   và mốc kế tiếp ghi rõ "(Nhà chính)". Cap 10 nên bậc cuối đạt được trước khi hết cấp.
4. Nâng một House riêng lẻ → **không** đổi hình, chỉ đổi badge.
5. Hai người chơi cùng map, Nhà chính lệch cấp → nhà mỗi bên theo Nhà chính bên đó.
6. Chủ chưa dựng Nhà chính → House của họ ở bậc 1.
7. Thanh HP và badge luôn nằm trên đỉnh mái của **sheet đang vẽ**, không lơ lửng.
8. Click vào phần mái cao của nhà bậc 4–5 → vẫn chọn trúng.
9. F5 giữa lúc nâng Nhà chính → vào lại đúng hình theo cấp Nhà chính đã lưu.
10. Ghost đặt nhà và thumbnail trong Build Menu vẫn là bậc 1.
11. Nhà chủ khác lên bậc khi mình đang xem → chỉ nhà của họ đổi, không đổi nhà mình.

## 8. Rủi ro đã xử lý

- **Sheet thiếu/load lỗi** → `buildingArt` lùi bậc, không bao giờ trả key không tồn tại.
- **Nhà đổi hình sai lúc** → `applyBuildingTier` nghe `TOWN_CENTER.level` của đúng chủ sở
  hữu; nếu chỉ nghe `level` của chính căn nhà, hình sẽ đứng yên tới lần patch sau.
- **Nhà chủ khác đổi theo Nhà chính của mình** → chiều tra là `(ownerId, cấp Nhà chính
  của ownerId)`; không dùng "Nhà chính đầu tiên tìm thấy" trong `room.state.buildings`.
- **Chủ chưa có Nhà chính** → `townCenterLevelFor` trả `0`, rơi về bậc 1 thay vì `NaN`.
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
