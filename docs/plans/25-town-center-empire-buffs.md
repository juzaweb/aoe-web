# Phase 25 — Nhà chính buff toàn đế chế

**Status: `IMPLEMENTED`** — các quyết định D1–D9 đã chốt ngày 2026-11-07; code + test đã xong, chờ verify tay.

Phạm vi: `packages/shared`, `apps/server`, `apps/client`, `docs/plans/README.md`.
**Không** đổi schema, **không** migration, **không** thêm `NetworkMessage`, **không** đổi payload.
Cột `players.town_center_level` đã tồn tại từ phase 23 và được dùng lại làm cache cho phòng
không chứa Nhà chính của chủ quân (raid guest).

## 1. Vấn đề

Hiện tại nâng Nhà chính chỉ cho thêm dân và HP của chính nó:

| Hiệu ứng hiện tại | Nguồn |
| --- | --- |
| `populationProvided` +1/cấp | `levels.ts:275-278` |
| `maxHp` +2%/cấp (2400 → 2832) | `levels.ts:258-281` |
| Cấp quốc gia cho world map / raid ±5 | `RaidService.ts:138-152` |

Nâng TC không tác động gì tới nhà khác, quân, tốc độ train hay mở khoá công trình.
Phase này biến cấp TC thành một **aura toàn đế chế** để mỗi bước nâng có giá trị rõ ràng.

## 2. Quyết định

| Mã | Quyết định |
| --- | --- |
| D1 | Aura HP và tốc độ train tuyến tính **+2% mỗi cấp**: hệ số `A(L) = 1 + 0,02 × (L − 1)`. Cấp 0 hoặc không có TC → `A = 1,0`. Cap 10 → `A = 1,18`. |
| D2 | Aura HP áp cho **mọi công trình của chủ sở hữu**, gồm chính TC, nhà đang xây (chỉ `maxHp`; foundation vẫn `hp = 1`), trừ `PORTAL` (hạ tầng server, không phải công trình người chơi). |
| D3 | Aura HP áp cho **toàn bộ unit**: Villager, Spearman, Archer, Cavalry. Mỗi unit dùng aura của **đúng chủ sở hữu**, không dùng TC đầu tiên tìm thấy. |
| D4 | Tốc độ train: thời gian hiệu dụng `trainTimeMs × (1 − 0,02 × (L − 1))`. Giảm tối đa 18% ở Lv10. Không đổi giá train, không đổi dân số. |
| D5 | Mở khoá công trình: `LUMBER_CAMP` cần TC Lv1, `MILL` Lv2, `MINING_CAMP` Lv3. Sáu trụ cột (`HOUSE`, `BARRACKS`, `STABLE`, `ARCHERY_RANGE`, `FARM`, `TOWER`) **luôn mở từ Lv1** vì gate TC yêu cầu chúng — khoá chúng sẽ tạo vòng lặp không thể phá. |
| D6 | Aura là **hàm suy ra**, không lưu thành nguồn sự thật. Server cache cấp TC theo owner trong room; TC của chủ trong room được đọc từ building đã restore; raid guest đọc cột `players.town_center_level` một lần rồi cache. Thiếu dữ liệu → cấp 1. |
| D7 | Mọi thay đổi aura chạy **event-driven**, không quét mỗi tick: join/restore, TC nâng cấp, công trình xây xong, công trình nâng cấp, unit spawn, unit research xong. Khi tính lại, **giữ nguyên lượng HP đã mất** (không hồi máu miễn phí). |
| D8 | UI: công trình bị khoá hiện ổ khoá + "Cần Nhà chính Lv N"; panel TC hiện bảng aura hiện tại / sau nâng cấp; panel train hiện thời gian train hiệu dụng. HP bar không cần sửa vì đọc `maxHp` đã replicate. |
| D9 | Attack lính: `attackPower` hiệu dụng của **mọi unit** được nhân thêm `1 + 0,01 × (L − 1)` (Lv10 = +9%). Áp cho cả đánh unit và đánh công trình; **không** áp cho Tower hay damage của công trình. Cộng dồn với research lính (research vẫn +5%/cấp). |

## 3. Công thức và số cụ thể

```ts
// packages/shared/src/utils/levels.ts
export const TOWN_CENTER_AURA_PER_LEVEL = 0.02;
export const TOWN_CENTER_UNIT_ATTACK_PER_LEVEL = 0.01;

townCenterAuraMultiplier(tcLevel)      // 1 + 0.02 * (clamp(tcLevel, 0..10) - 1)
townCenterUnitAttackMultiplier(tcLevel) // 1 + 0.01 * (clamp(tcLevel, 0..10) - 1)
getEffectiveBuildingMaxHp(type, level, tcLevel)
getEffectiveUnitMaxHp(type, level, tcLevel)
getEffectiveUnitAttackPower(type, level, tcLevel) // round2(stats.attackPower * mult)
getEffectiveTrainTimeMs(unitType, tcLevel)
getBuildingUnlockLevel(type)           // blueprint.requiredTownCenterLevel ?? 1
isBuildingUnlocked(type, tcLevel)
```

Bảng hệ số:

| Cấp TC | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hệ số HP/train | 1,00 | 1,02 | 1,04 | 1,06 | 1,08 | 1,10 | 1,12 | 1,14 | 1,16 | 1,18 |
| Train time | 100% | 98% | 96% | 94% | 92% | 90% | 88% | 86% | 84% | 82% |
| Attack lính | 100% | 101% | 102% | 103% | 104% | 105% | 106% | 107% | 108% | 109% |

Ví dụ ở Lv10 (chưa cộng cấp công trình / cấp lính):

| Đối tượng | Gốc | Có aura |
| --- | --- | --- |
| Town Center HP | 2400 | 2832 |
| House HP | 450 | 531 |
| Watch Tower HP | 1020 | 1204 |
| Drop-off camp HP | 600 | 708 |
| Villager HP | 50 | 59 |
| Spearman HP | 90 | 106 |
| Archer HP | 65 | 77 |
| Cavalry HP | 140 | 165 |
| Villager attack | 3 | 3,27 |
| Spearman attack | 8 | 8,72 |
| Archer attack | 7 | 7,63 |
| Cavalry attack | 14 | 15,26 |
| Train Villager | 5,0s | 4,1s |
| Train Spearman | 7,0s | 5,74s |
| Train Archer | 8,0s | 6,56s |
| Train Cavalry | 10,0s | 8,2s |

Aura **cộng dồn** với cấp công trình và cấp lính: `maxHp = base(level) × aura(TC)`,
`attackPower = stats(level).attackPower × attackMultiplier(TC)`. Không đổi
`populationProvided`, không đổi speed, carry capacity, build power hay giá.

## 4. Thay đổi code

### 4.1 `packages/shared`

| File | Thay đổi |
| --- | --- |
| `src/constants/index.ts` | `BuildingBlueprint` thêm `requiredTownCenterLevel?: number`; gán `LUMBER_CAMP: 1`, `MILL: 2`, `MINING_CAMP: 3`. Các type khác bỏ trống (mặc định 1). |
| `src/utils/levels.ts` | Thêm hằng số + 8 hàm ở §3. Tất cả clamp cấp về `0..MAX_BUILDING_LEVEL`; cấp 0 trả hệ số 1. Docstring ghi rõ aura của TC không thay thế cấp công trình. |
| `src/utils/levels.test.ts` (hoặc test hiện có của shared) | Test thuần cho công thức, clamp và làm tròn. |

### 4.2 `apps/server`

| File | Thay đổi |
| --- | --- |
| `src/rooms/WorldRoom.ts` | Thêm `townCenterLevelByOwner: Map<string, number>` + `townCenterLevelOf(ownerId)` (fallback 1). Thêm `setTownCenterLevel(ownerId, level)` và `refreshTownCenterAura(ownerId)` quét building/unit của owner, tính lại `maxHp`, giữ `missingHp = oldMax − hp`. Gọi ở: restore xong, xây xong, nâng cấp xong, spawn unit, research xong. Sửa restore (`:642-644`, `:670-672`) dùng hàm hiệu dụng thay vì stats gốc. Threshold train (`:1552`) dùng `getEffectiveTrainTimeMs`. Thêm `townCenterLevelOf` vào port của `CommandSystem`. |
| `src/rooms/townCenterAura.ts` | Rule aura tách khỏi room: `findTownCenterLevel`, `ownedBuildingMaxHp` (miễn trừ `PORTAL`) và `applyTownCenterAura` (giữ lượng HP đã mất). |
| `src/rooms/upgrades.ts` | `applyBuildingUpgrade(building, aura = 1)` dùng `round(stats.maxHp × aura)`. `applyUnitResearch(..., tcLevel = 1)` dùng `getEffectiveUnitMaxHp`. Mọi call site cũ mặc định 1, không phá test hiện có. |
| `src/rooms/CommandSystem.ts` | Khi đặt nhà: kiểm tra `isBuildingUnlocked(type, tcLevel)` → từ chối bằng `RejectCode.PREREQUISITE` với thông điệp "Requires Town Center level N". `maxHp` khởi tạo dùng `getEffectiveBuildingMaxHp(type, 1, tcLevel)`. |
| `src/rooms/CombatSystem.ts` | Hai chỗ trừ máu (`:287` đánh unit, `:310` đánh building) dùng `getEffectiveUnitAttackPower(type, unit.level, townCenterLevelOf(unit.ownerId))` thay cho `getUnitLevelStats(...).attackPower`. Damage của Tower (`:358`) giữ nguyên. |
| `src/rooms/KingdomRoom.ts` | `onBuildingUpgraded` cập nhật cache TC của owner **trước** khi gọi `refreshTownCenterAura`. `restoreRaiderArmy` nạp cấp TC của guest từ DB rồi mới restore unit. |
| `src/services/DatabaseService.ts` | Thêm `loadTownCenterLevel(userId): Promise<number>` đọc cột có sẵn `players.town_center_level`; trả 0 khi không có row. **Không đổi schema.** |
| `src/rooms/WorldRoom.test.ts`, `upgrades.test.ts` | Test mới theo §6. |

### 4.3 `apps/client`

| File | Thay đổi |
| --- | --- |
| `src/App.tsx` | Theo dõi cấp TC của mình từ `room.state.buildings` (cùng listener đang cập nhật `resources`), truyền `townCenterLevel` xuống `BuildMenu`. |
| `src/components/BuildMenu.tsx` | Prop `townCenterLevel`; tile bị khoá khi `!isBuildingUnlocked(type, level)`: icon ổ khoá, tooltip "Cần Nhà chính Lv N", `disabled`. Không khoá vì lý do tài nguyên nữa nếu chưa mở. |
| `src/game/scenes/WorldScene.ts` | `SelectedEntityData` thêm `ownerTownCenterLevel: number`, điền bằng `townCenterLevelFor(building.ownerId)` khi chọn building. Dùng cho panel train/aura. |
| `src/components/EntityDetails.tsx` | Dòng "Huấn luyện" dùng `getEffectiveTrainTimeMs` với `ownerTownCenterLevel`; dòng attack/HP của unit dùng `getEffectiveUnitAttackPower` / `maxHp` replicate; panel TC render khối aura. |
| `src/components/UpgradePanels.tsx` | Panel TC hiện "Buff hiện tại" và "Sau nâng cấp" (HP công trình, HP quân, train). Panel công trình khác không đổi. |
| `src/game/input/CommandController.ts` (hoặc handler hotkey) | Hotkey `E/Q/...` cũng phải chặn type chưa mở, tái dùng `isBuildingUnlocked`, để không lách được qua bàn phím. |

Không sửa renderer: HP bar đọc `maxHp` từ state nên tự đúng sau khi server cập nhật.

## 5. Edge case

| Edge | Xử lý |
| --- | --- |
| TC nâng cấp giữa lúc công trình đang xây | `refreshTownCenterAura` cập nhật `maxHp` của foundation nhưng giữ `hp = 1`; xây xong set `hp = maxHp` hiệu dụng. |
| Công trình đang mất máu khi aura đổi | Giữ `missingHp = oldMax − hp`, đặt `hp = max(0, newMax − missingHp)`. Full máu vẫn full, không thành heal. |
| Unit đang ở phòng khác (raid guest) | Aura lấy từ `players.town_center_level` của chủ, cache theo room; không lấy TC của defender. |
| Guest không có row DB / cột = 0 | Hệ số 1,0; không crash, không NaN. |
| Nhiều TC của cùng chủ | Lấy `max(level)`; hiện tại luật chơi chỉ cho một TC nhưng hàm không phụ thuộc điều đó. |
| TC bị xoá / chưa dựng | Cấp 0 → aura 1,0; camp Lv1 vẫn mở, Lv2–3 khoá. |
| Nâng TC khi đang train | Threshold giảm; `trainingProgressMs` giữ nguyên, nếu đã vượt threshold mới thì unit ra ở tick kế tiếp. Không hoàn tiền, không nhân đôi. |
| Nâng cấp research lính xong | `applyUnitResearch` dùng aura hiện tại; unit đang sống giữ `missingHp`. Attack đọc live mỗi đòn nên tự cập nhật. |
| Tower bắn | Damage của Tower là damage công trình, **không** nhân attack aura của lính. |
| Unit của hai chủ đánh nhau | Mỗi bên dùng aura TC của chủ mình; không dùng chung một hệ số. |
| Restore save cũ | `maxHp` lưu trong DB bị bỏ qua, luôn suy lại từ level + aura; tránh buff hai lần sau khi đổi công thức. |
| Công trình `PORTAL` | Không áp aura (owner là player nhưng là hạ tầng server, `attackable: false`). |
| Khoá camp đè lên hướng dẫn cũ | README/help text phải ghi cấp mở khoá; nếu không người chơi mới tưởng game thiếu công trình. |

## 6. Test

### Shared

- `townCenterAuraMultiplier`: cấp 0/âm/1/10/100000 clamp đúng; hệ số Lv10 = 1,18.
- `getEffectiveBuildingMaxHp` / `getEffectiveUnitMaxHp`: Lv1 = base, Lv10 = round(base × 1,18).
- `getEffectiveTrainTimeMs`: Lv1 = gốc, Lv10 = 82%; không âm, clamp cấp.
- `getEffectiveUnitAttackPower`: Lv1 = base, Lv10 = round2(base × 1,09); cộng dồn đúng với cấp research; cấp 0/âm/100000 clamp.
- `getBuildingUnlockLevel` / `isBuildingUnlocked`: 3 camp đúng mốc 1/2/3; 6 trụ cột luôn mở; type lạ fallback 1.

### Server

- Đặt nhà mới ở TC Lv10 có `maxHp` = base × 1,18.
- Nâng TC: toàn bộ building + unit của owner tăng `maxHp`, giữ `missingHp`; TC của chủ khác trong cùng room không đổi.
- Nâng công trình khi có aura: `maxHp` = stats cấp mới × aura; HP đang thiếu vẫn thiếu.
- Research unit khi có aura: unit đang sống nhận đúng `maxHp`; unit chủ khác không đổi.
- Spawn unit mới (train) nhận aura.
- Attack: unit đánh unit và đánh building dùng đúng hệ số TC của chủ; research Lv10 + TC Lv10 cộng dồn (Spearman 8 → 12,64); Tower damage không đổi; unit hai chủ khác aura trong cùng room.
- Train: giảm threshold theo cấp TC; nâng TC giữa queue làm unit ra sớm hơn ở tick kế tiếp.
- Unlock: đặt `MILL` ở TC Lv1 bị từ chối `PREREQUISITE`; TC Lv2 đặt được; `MINING_CAMP` cần Lv3; `HOUSE`/`TOWER`/... luôn đặt được.
- Restore own kingdom: save có `maxHp` cũ vẫn được tính lại theo TC level đã restore, không buff hai lần.
- Raid guest: unit của attacker trong phòng defender dùng cấp TC của attacker lấy từ DB; defender dùng cấp TC của defender.
- Foundation: `maxHp` đổi theo aura nhưng `hp` vẫn 1; xây xong `hp = maxHp`.

### Client

- `BuildMenu`: tile camp bị khoá/disable ở cấp thấp, mở đúng mốc; tooltip đúng số cấp.
- Hotkey không vào được type chưa mở.
- `EntityDetails`: thời gian train hiển thị theo aura (5s → 4,1s ở Lv10).
- Panel TC hiện đúng buff hiện tại và buff sau nâng cấp.
- HP bar vẫn đúng sau khi `maxHp` đổi (không sửa renderer).

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
| 1 | Shared: hằng số, công thức aura, mốc mở khoá camp, test | `feat(shared): add town center aura and camp unlock levels` |
| 2 | Server: cache cấp TC, refresh aura cho building/unit | `feat(server): derive building and unit max hp from town center aura` |
| 3 | Server: train time + attack lính theo cấp TC | `feat(server): scale training time and unit attack by town center level` |
| 4 | Server: chặn đặt camp chưa mở khoá | `feat(server): gate drop-off camps behind town center levels` |
| 5 | Server: restore + raid guest + test tích hợp | `test(server): cover town center aura on restore and raids` |
| 6 | Client: khoá công trình, panel aura, thời gian train | `feat(client): show town center aura and locked buildings` |
| 7 | Docs: cập nhật README index | `docs(plans): index phase 25 town center empire buffs` |

## 9. Verify tay

1. TC Lv1: đặt House → `maxHp` 450; đặt Mill → bị chặn "Cần Nhà chính Lv2"; Lumber Camp đặt được.
2. Nâng TC lên Lv2 → toàn bộ nhà của mình tăng HP theo hệ số 1,02; nhà đang mất máu vẫn thiếu đúng lượng cũ; panel TC hiện buff mới.
3. Nâng TC lên Lv10 → House 531 HP, Villager 59 HP, train Villager 4,1s.
4. Nâng một House lên cấp cao → HP = stats cấp đó × aura, không mất buff.
5. Research Spearman → lính đang sống tăng HP đúng, không hồi đầy; damage đánh quân/nhà tăng theo research + aura TC.
6. Nhà của người khác trong cùng map (raid) không hưởng aura của mình.
7. F5 giữa lúc nâng TC → vào lại đúng HP/aura, không buff chồng.
8. Raid: quân attacker vào phòng defender vẫn dùng cấp TC của attacker; defender dùng cấp TC của defender.
9. Xây Mill ở TC Lv2 → xong có `maxHp` 600 × aura, không phải 600 gốc.
10. Hotkey đặt Mining Camp ở TC Lv2 → bị chặn, không vào chế độ đặt.
11. TC Lv1 vs Lv10: Spearman đánh cùng một villager, damage 8 → 8,72 (chưa research); Tower bắn vẫn đúng damage gốc.

## 10. Rủi ro / cân bằng

- **Cộng dồn quá mạnh:** Lv10 cho +18% HP, +9% attack lính và −18% thời gian train, cộng với research lính (+45%) và cấp công trình có thể làm late game lệch. Hằng số nằm một chỗ trong shared để retune; attack là biến riêng nên có thể hạ về 0,5%/cấp nếu cần.
- **Khoá camp sớm:** `MINING_CAMP` tới Lv3 nghĩa là early game phải mang đá về TC. TC vẫn nhận mọi loại nên không bị chặn tiến trình, chỉ chậm hơn; nếu playtest thấy nặng, hạ `MILL`/`MINING_CAMP` xuống Lv1/Lv2.
- **Restore sai thứ tự:** phải nạp cấp TC trước khi tính `maxHp` cho unit/building, nếu không sẽ strip buff của raid guest hoặc buff hai lần. Test restore/raid bắt buộc.
- **UI lệch số:** mọi phép tính đi qua hàm shared; client không tự nhân hệ số.
