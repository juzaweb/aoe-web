# Phase 26 — Hiệu ứng cấp công trình

**Status: `IMPLEMENTED` (2026-11-07)** — D1–D10 đã code đủ shared/server/client, test xanh
(shared build OK, server 379 test, client 460 test). Còn lại: verify tay §9 trong game đang chạy.
Đây là phần mở rộng của phase 03 (building levels): phase 03 vẫn giữ giá/thời gian nâng cấp và HP
theo cấp, phase 26 chỉ thêm hiệu ứng hành vi (train/gather/radius) suy ra từ `buildings.level`.

Phạm vi: `packages/shared`, `apps/server`, `apps/client`, `docs/plans/README.md`.
**Không** đổi schema, **không** migration, **không** thêm `NetworkMessage`, **không** đổi payload.
Mọi hiệu ứng đều **suy ra** từ cấp công trình đã lưu (`buildings.level`), không thêm cột.

## 1. Vấn đề

Hiện nâng công trình ngoài Nhà chính gần như chỉ tăng HP:

| Công trình | Hiệu ứng hiện tại |
| --- | --- |
| Mọi công trình | `maxHp` +2%/cấp (`levels.ts:270-293`) |
| `TOWER` | Damage +2%/cấp (cùng công thức) |
| `HOUSE` | Dân số +2%/cấp, làm tròn |
| `FARM` | Trữ lượng +10%/cấp |
| `BARRACKS` / `STABLE` / `ARCHERY_RANGE` | Chỉ HP |
| `LUMBER_CAMP` / `MILL` / `MINING_CAMP` | Chỉ HP |

Phase này thêm 4 hiệu ứng để mỗi bậc nâng của từng loại nhà có giá trị rõ ràng:

1. Nhà train giảm thời gian train loại lính của nó.
2. Nhà train buff HP + attack cho đúng loại lính nó train.
3. Camp tăng tốc độ gom resource mà nó nhận.
4. Camp tăng bán kính dỡ hàng.

## 2. Quyết định

| Mã | Quyết định |
| --- | --- |
| D1 | **Tốc độ train**: `BARRACKS` → Spearman, `STABLE` → Cavalry, `ARCHERY_RANGE` → Archer. Mỗi cấp giảm **3%** thời gian train: `T(L) = 1 − 0,03 × (L − 1)`; Lv10 = 73%. |
| D2 | `TOWN_CENTER` **không** nhận thêm bonus trainer: Villager vẫn chỉ chịu aura TC −2%/cấp (phase 25). Train time cuối = `trainTimeMs × TC × trainer`, hai hệ số **nhân**, không cộng. |
| D3 | **Buff lính**: nhà train buff **HP +3%/cấp** và **attack +3%/cấp** cho đúng loại lính nó train. Lv10 = +27%. Villager không nhận buff trainer (chỉ aura TC). |
| D4 | Buff lính **nhân** với research lính (+5%/cấp) và aura TC (HP +2%/cấp, attack +1%/cấp). Không cộng tuyến tính. |
| D5 | Buff lính áp **ngay cho lính đang sống** khi nhà train nâng cấp xong, giữ nguyên lượng HP đã mất (không hồi máu miễn phí). Lính train sau nhận ngay từ lúc spawn. |
| D6 | **Tốc độ gom**: `LUMBER_CAMP` → wood, `MILL` → food, `MINING_CAMP` → gold + stone. Mỗi cấp **+5%**: `G(L) = 1 + 0,05 × (L − 1)`; Lv10 = +45%. |
| D7 | Tốc độ gom áp **toàn đế chế theo resource**, lấy **cấp cao nhất** trong các camp đã xây xong của owner nhận resource đó. Không phụ thuộc khoảng cách, không phụ thuộc villager đang dỡ ở camp nào. TC không cho bonus gom. |
| D8 | **Bán kính drop-off**: chỉ 3 camp, **+0,25 tile/cấp**; nền 1,5 → Lv10 = 3,75 tile. TC giữ 1,5 tile. Bán kính dùng **cấp của chính building đang dỡ hàng**, không lấy camp khác. |
| D9 | **Nhiều nhà cùng loại**: mọi hiệu ứng theo owner dùng **cấp cao nhất của loại nhà đó**; nhiều nhà **không cộng dồn**. Riêng bán kính (D8) dùng cấp của chính building. |
| D10 | Hiệu ứng là **hàm suy ra**, không lưu DB. Server cache cấp cao nhất theo `ownerId + BuildingType` trong room; guest raid đọc từ bảng `buildings` của kingdom họ một lần rồi cache; thiếu dữ liệu → cấp 1 (không buff). |

### Không làm trong phase này

- Không đổi giá nâng cấp, thời gian nâng cấp, slot nâng, gate TC ↔ trụ cột.
- Không đổi damage của Tower (Tower vẫn chỉ +2%/cấp từ cấp của chính nó).
- Không đổi `carryCapacity`, tốc độ di chuyển, `buildPower`, dân số, trữ lượng farm, tốc độ hồi node.
- Không thêm buff trainer cho Villager.
- Không thêm dropdown/chỉ số mới vào payload mạng.

## 3. Công thức và số cụ thể

```ts
// packages/shared/src/utils/levels.ts
export const TRAINER_SPEED_PER_LEVEL = 0.03;
export const TRAINER_UNIT_BUFF_PER_LEVEL = 0.03;
export const DROP_OFF_GATHER_PER_LEVEL = 0.05;
export const DROP_OFF_RANGE_PER_LEVEL = 0.25;
export const BASE_DROP_OFF_RANGE = 1.5;

trainerSpeedMultiplier(rawLevel)          // 1 - 0.03 * (clamp(level, 1..10) - 1)
trainerUnitBuffMultiplier(rawLevel)       // 1 + 0.03 * (clamp(level, 1..10) - 1)
dropOffGatherMultiplier(rawLevel)         // 1 + 0.05 * (clamp(level, 1..10) - 1)
dropOffRange(rawLevel)                    // 1.5 + 0.25 * (clamp(level, 1..10) - 1)

getUnitTrainerBuilding(unitType)          // BARRACKS | STABLE | ARCHERY_RANGE | TOWN_CENTER
unitTrainerBuffMultiplier(unitType, level) // 1 với VILLAGER, ngược lại trainerUnitBuffMultiplier(level)

getEffectiveTrainTimeMs(type, tcLevel, trainerLevel = 1)
getEffectiveUnitMaxHp(type, level, tcLevel, trainerLevel = 1)
getEffectiveUnitAttackPower(type, level, tcLevel, trainerLevel = 1)
dropOffRangeFor(type, level)  // camp: dropOffRange(level); còn lại: BASE_DROP_OFF_RANGE

// packages/shared/src/constants/index.ts
gatherIntervalMs(resourceType, multiplier = 1)  // 1000 / (rate * multiplier)
getUnitTrainerBuilding(unitType)
getGatherBuildingType(resourceType)
```

`getUnitTrainerBuilding` suy từ `BUILDING_BLUEPRINTS[type].trainableUnits` để không khai báo trùng
mapping. `unitTrainerBuffMultiplier` trả `1` cho `VILLAGER` dù trainer là TC, tránh cộng đôi với aura.

Bảng hệ số theo cấp:

| Cấp nhà | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Train time | 100% | 97% | 94% | 91% | 88% | 85% | 82% | 79% | 76% | 73% |
| Buff lính | 100% | 103% | 106% | 109% | 112% | 115% | 118% | 121% | 124% | 127% |
| Tốc độ gom | 100% | 105% | 110% | 115% | 120% | 125% | 130% | 135% | 140% | 145% |
| Bán kính camp | 1,50 | 1,75 | 2,00 | 2,25 | 2,50 | 2,75 | 3,00 | 3,25 | 3,50 | 3,75 |

Ví dụ ở TC Lv10 + nhà train Lv10 + research Lv10:

| Đối tượng | Gốc | Hiệu dụng |
| --- | --- | --- |
| Train Spearman | 7,0s | `7000 × 0,82 × 0,73` = 4,19s |
| Train Archer | 8,0s | 4,79s |
| Train Cavalry | 10,0s | 5,99s |
| Train Villager | 5,0s | 4,10s (chỉ aura TC) |
| Spearman HP | 90 | `90 × 1,18 × 1,27 × 1,45` ≈ 196 |
| Spearman attack | 8 | `8 × 1,09 × 1,27 × 1,45` ≈ 16,05 |
| Cavalry HP | 140 | ≈ 304 |
| Archer attack | 7 | ≈ 14,05 |
| Gom gỗ (camp Lv10) | 2,0/s | 2,9/s |
| Gom vàng (camp Lv10) | 1,25/s | 1,8125/s |

## 4. Thay đổi code

### 4.1 `packages/shared`

| File | Thay đổi |
| --- | --- |
| `src/constants/index.ts` | Thêm `getUnitTrainerBuilding(unitType)` suy từ `trainableUnits`; thêm `getGatherBuildingType(resourceType)` (`wood → LUMBER_CAMP`, `food → MILL`, `gold/stone → MINING_CAMP`). Đổi `gatherIntervalMs(resourceType, multiplier = 1)`; call site cũ không đổi hành vi. |
| `src/utils/levels.ts` | Thêm 4 hằng số + các hàm ở §3. `getEffectiveTrainTimeMs`, `getEffectiveUnitMaxHp`, `getEffectiveUnitAttackPower` nhận thêm tham số `trainerLevel = 1` để mọi call site/test cũ giữ nguyên. |
| `src/utils/levels.test.ts` (hoặc file test hiện có) | Test thuần cho công thức, clamp cấp 0/âm/1/10/100000, làm tròn, mapping trainer và resource. |

### 4.2 `apps/server`

| File | Thay đổi |
| --- | --- |
| `src/rooms/townCenterAura.ts` | `applyTownCenterAura` nhận thêm callback `trainerLevelOf(unitType) => number` (mặc định `() => 1`), dùng `getEffectiveUnitMaxHp` 4 tham số. Đổi tên module thành `empireAura.ts` nếu thấy rõ hơn; giữ export cũ để không phá import. |
| `src/rooms/buildingLevels.ts` (mới) | Rule thuần, tách khỏi room: `findBuildingLevel(state, ownerId, type)` lấy `max(level)` của building **đã xây xong**; `trainerLevelFor(levels, unitType)`; `gatherMultiplierFor(levels, resourceType)`; `dropOffRangeForBuilding(building)`. |
| `src/rooms/WorldRoom.ts` | Thêm cache `buildingLevelsByOwner: Map<string, Partial<Record<BuildingType, number>>>`, `buildingLevelOf(ownerId, type)` (fallback 1) và `setBuildingLevel(ownerId, type, level)` (lấy max, rồi refresh unit buff). Gọi `setBuildingLevel` khi xây xong và khi nâng cấp xong. Thay các call site `getEffectiveUnitMaxHp` (`:711`, `:1386`, `:1936`) và `getEffectiveTrainTimeMs` (`:1683`) để truyền cấp trainer. Threshold train giảm ngay khi nhà train lên cấp giữa queue. |
| `src/rooms/upgrades.ts` | `applyBuildingUpgrade(building, tcLevel, trainerLevelOf?)`: sau khi tăng cấp, nếu là nhà train thì refresh HP cho lính cùng loại. `applyUnitResearch(..., tcLevel, trainerLevel)` dùng công thức mới. Mặc định tham số giữ test cũ xanh. |
| `src/rooms/CombatSystem.ts` | Attack lính (`:271`) truyền thêm cấp nhà train của owner. Damage Tower giữ nguyên. |
| `src/rooms/CommandSystem.ts` | Foundation `maxHp` (`:348`) dùng công thức mới; trainer level của foundation = 1. |
| `src/rooms/EconomySystem.ts` | `EconomyPorts` thêm `gatherSpeedMultiplier(ownerId, resourceType)` và `dropOffRange(building)`. `harvestTick` nhận multiplier; `processReturning` dùng `dropOffRange(dropOff)` thay hằng `DROP_OFF_RANGE`. Xoá hằng cục bộ `DROP_OFF_RANGE`. |
| `src/rooms/KingdomRoom.ts` | `onBuildingUpgraded` cập nhật cache `buildingLevelsByOwner` trước khi refresh aura. `restoreRaiderArmy` nạp cấp building của guest từ DB trước khi restore unit. |
| `src/services/DatabaseService.ts` | Thêm `loadBuildingLevels(ownerId): Promise<Partial<Record<BuildingType, number>>>` đọc `SELECT type, MAX(level) FROM buildings WHERE owner_id = ? AND zone = 'kingdom:' || owner_id AND is_constructed = 1 GROUP BY type`. **Không đổi schema.** |
| `src/rooms/*.test.ts` | Test mới theo §6; cập nhật kỳ vọng cũ nếu công thức chồng lấn. |

### 4.3 `apps/client`

Không cần thêm dữ liệu mạng: panel đang chọn building đã có `level`, `ownerTownCenterLevel`, `unitLevels`.

| File | Thay đổi |
| --- | --- |
| `src/components/EntityDetails.tsx` | Panel nhà train: thêm dòng "Thời gian train −X%" và "Lính +Y% HP/attack". Tooltip train dùng `entity.level` làm `trainerLevel`. Panel camp: thêm "Tốc độ gom +X%" và "Bán kính dỡ hàng Z tile". |
| `src/components/UpgradePanels.tsx` | Khối "Sau nâng cấp" hiện thêm hiệu ứng của cấp kế tiếp cho nhà train và camp; TC giữ nguyên như phase 25. |
| `src/components/EntityDetails.test.tsx` (nếu có) | Test render số liệu ở Lv1 và Lv10. |

Không sửa renderer: HP bar và damage đọc state server đã tính.

## 5. Edge case

| Edge | Xử lý |
| --- | --- |
| Nhiều nhà cùng loại | Lấy `max(level)`; không cộng dồn (D9). |
| Nhà đang xây | Không tham gia cache hiệu ứng; cấp 1 (không buff). |
| Nhà train bị phá | Cache refresh: cấp giảm còn cấp cao nhất còn lại; HP lính đang sống giữ `missingHp`, có thể giảm `maxHp`. |
| Camp bị phá | Tốc độ gom/bán kính giảm ngay tick kế tiếp; không hoàn tài nguyên đã gom. |
| Nâng nhà train khi lính đang đánh | HP/attack đọc live hoặc refresh event-driven; không hồi máu miễn phí. |
| Nâng camp khi villager đang đi | Bán kính mới có hiệu lực ngay; villager có thể dỡ sớm hơn ở tick kế tiếp; không đổi đường đi. |
| Nâng camp khi villager đang gom | Interval mới áp từ lần trả unit kế tiếp; phần lẻ timer giữ nguyên, không nhân đôi. |
| TC + trainer + research | Nhân với nhau; không cộng tuyến tính (D2, D4). |
| Villager | Không nhận buff trainer; chỉ aura TC như cũ. |
| Guest raid | Cấp building của guest đọc từ DB kingdom của họ, cache trong room; DB trễ tối đa 30s (autosave) — chấp nhận, cùng mức với `town_center_level`. |
| Guest không có row DB | Cấp 1, hệ số 1, không NaN. |
| Cấp 0 / âm / phi số | Clamp về 1, hệ số 1. |
| Train time | Luôn `Math.max(0, ...)`; không âm. |
| Gom số lẻ | Vẫn trả theo đơn vị nguyên; interval là số thực, timer giữ phần lẻ như hiện tại. |
| Damage Tower | Không nhận buff trainer (chỉ damage công trình). |

## 6. Test

### Shared

- `trainerSpeedMultiplier` / `trainerUnitBuffMultiplier` / `dropOffGatherMultiplier` / `dropOffRange`:
  Lv1 = nền, Lv10 = 0,73 / 1,27 / 1,45 / 3,75; clamp 0/âm/100000.
- `getUnitTrainerBuilding`: 4 loại lính map đúng; type lạ trả `null`.
- `unitTrainerBuffMultiplier('VILLAGER', 10)` = 1; Spearman với trainer Lv10 = 1,27.
- `getEffectiveTrainTimeMs`: TC Lv10 + trainer Lv10 = 0,5986; Villager bỏ qua trainer.
- `getEffectiveUnitMaxHp` / `getEffectiveUnitAttackPower`: cộng dồn TC × trainer × research đúng thứ tự nhân.
- `gatherIntervalMs('wood', 1,45)` = `1000 / 2,9`; multiplier 1 giữ nguyên hành vi cũ.
- `getGatherBuildingType`: wood/food/gold/stone map đúng.
- `dropOffRangeFor`: camp theo cấp; TC/HOUSE/TOWER = 1,5.

### Server

- Nâng `BARRACKS` lên Lv10: Spearman đang sống tăng `maxHp` đúng, giữ `missingHp`; Archer/Cavalry/Villager không đổi; attack Spearman live tăng.
- Train Spearman ở barracks Lv10 ra đúng `maxHp`/attack; threshold giảm còn 73% × TC.
- Nâng TC giữa queue + nâng barracks giữa queue: unit ra ở tick kế tiếp nếu đã vượt threshold, không nhân đôi.
- Research Spearman Lv10 + barracks Lv10 + TC Lv10: attack = `round2(8 × 1,45 × 1,27 × 1,09)`.
- 2 barracks Lv2 + Lv8: dùng Lv8, không cộng dồn.
- Phá barracks cao nhất: cache tụt về cấp còn lại; HP lính giữ `missingHp`.
- Gom: camp Lv10 cho wood 2,9/s; camp bị phá về Lv1 → 2,0/s; Mill Lv10 cũng tăng tốc gom farm.
- Bán kính: camp Lv10 cho dỡ hàng ở 3,7 tile; TC vẫn chặn ở 1,5; camp Lv1 vẫn 1,5.
- Raid guest: unit attacker dùng cấp barracks từ DB của attacker; defender dùng cấp của defender.
- Restore save: `maxHp` suy lại từ level + TC + trainer, không buff hai lần.

### Client

- Panel barracks hiện đúng `−27%` train và `+27%` lính ở Lv10.
- Panel camp hiện đúng `+45%` gom và `3,75 tile` ở Lv10.
- Tooltip train trong barracks dùng cấp của chính barracks; trong TC không cộng trainer.
- Panel nâng cấp hiện đúng hiệu ứng cấp kế tiếp.

## 7. Kiểm chứng

```bash
pnpm --filter @chien-quoc/shared build
cd apps/server && ../../node_modules/.bin/tsc --noEmit
cd apps/client && ../../node_modules/.bin/tsc --noEmit
pnpm --filter @chien-quoc/shared test
pnpm --filter @chien-quoc/server test
pnpm --filter @chien-quoc/client test
```

## 8. Task breakdown

Mỗi task một commit, message tiếng Anh:

| # | Task | Commit message |
| --- | --- | --- |
| 1 | Shared: hằng số, công thức trainer/camp, mapping, test | `feat(shared): add building level effect formulas` |
| 2 | Server: cache cấp building + buff lính khi nâng nhà train | `feat(server): apply trainer levels to unit stats and training` |
| 3 | Server: tốc độ gom + bán kính drop-off theo cấp camp | `feat(server): scale gather speed and drop-off radius by camp level` |
| 4 | Server: guest raid đọc cấp building từ DB + test tích hợp | `test(server): cover building level effects on restore and raids` |
| 5 | Client: panel hiệu ứng nhà train/camp + preview nâng cấp | `feat(client): show building level effects and upgrade previews` |
| 6 | Docs: index phase 26 + ghi chú phase 03 | `docs(plans): index phase 26 building level effects` |

## 9. Verify tay

1. Barracks Lv1 train Spearman 7,0s; nâng Lv10 → 5,11s (chưa có TC cao); kiểm tra tooltip khớp.
2. Spearman đang sống trước/sau khi barracks lên cấp: HP tăng, lượng máu đã mất giữ nguyên.
3. Research Spearman Lv10 + barracks Lv10 + TC Lv10 → damage đánh villager đúng ~16,05.
4. Villager không được buff trainer: HP/attack chỉ đổi khi TC nâng.
5. Lumber Camp Lv1 gom gỗ 2,0/s; Lv10 → 2,9/s (đo bằng thời gian đầy 10 gỗ).
6. Mill Lv10 tăng tốc gom food từ farm; camp bị phá → tốc độ trở lại theo camp còn lại.
7. Camp Lv10 cho dỡ hàng từ ~3,7 tile; TC vẫn 1,5 tile.
8. Xây 2 barracks cấp khác nhau → buff lấy cấp cao nhất; phá nhà cao → buff tụt.
9. Raid: quân attacker vào kingdom defender dùng đúng cấp barracks của attacker.
10. F5 giữa lúc nâng barracks/camp → vào lại đúng hiệu ứng, không buff chồng.

## 10. Rủi ro / cân bằng

- **Cộng dồn mạnh:** Lv10 đủ bộ cho Spearman ≈ ×2,14 HP và ×2,0 attack so với gốc (TC × trainer × research). Hằng số tách riêng trong shared để hạ về 2%/cấp nếu playtest thấy lệch.
- **Bán kính lớn:** 3,75 tile có thể cho dỡ hàng qua tường/rừng. Chỉ kiểm tra khoảng cách, không kiểm tra line-of-sight; nếu thành vấn đề, hạ `DROP_OFF_RANGE_PER_LEVEL` hoặc cap bán kính.
- **Cache lệch khi guest:** DB trễ tối đa 30s; chấp nhận vì cùng cơ chế với `town_center_level`. Không đọc DB mỗi đòn đánh.
- **Thay đổi chỉ số đang sống:** buff HP event-driven có thể làm lính đang siege khỏe lên giữa trận; đúng thiết kế (giống research) và giữ `missingHp`.
- **UI lệch số:** mọi phép tính đi qua hàm shared; client không tự nhân hệ số.
