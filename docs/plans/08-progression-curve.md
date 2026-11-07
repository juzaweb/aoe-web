# Phase 08 — Đường cong nâng cấp dài hạn (thang 10 cấp, ×3 thời gian mỗi cấp)

Status: **RETUNED — thang 10 cấp** (2026-11-05: hạ cap TC/trụ cột xuống 10, gate mỗi cấp, thay
đường cong hai giai đoạn bằng một đường cong duy nhất).

## 1. Mục tiêu

Phase 03 cho TC 1→100 chỉ mất **7,54h** (đường cong bậc hai `0,5 + 0,1i + 0,004i²`). Với một game
online nhiều năm, mốc đó bị chạm trần trong vài ngày. Phase 08 thay toàn bộ đường cong nâng cấp
công trình; bản 2026-11-05 rút thang xuống 10 cấp và dùng **một đường cong duy nhất**:

- **Thang 10 cấp**: mọi công trình dừng ở cấp 10, không còn nhánh "từ cấp 11 tính bằng giờ".
- **Một đường cong duy nhất** cho cả 9 bước: thời gian `×3` mỗi cấp (TC 7,5s → 13h40), giá `×1,3`
  mỗi cấp (138 → 1.458 gỗ).
- **Ràng buộc cấp**: mỗi bước của TC đòi 4 trụ cột đạt **đúng cấp hiện tại** của TC, nên không có
  bước nào miễn phí.
- **Giới hạn 2 slot** nâng cùng lúc, để ràng buộc ở trên biến thành thời gian thật thay vì chỉ là
  thao tác song song.

Kết quả: TC 1→10 mất **20,5h** (chuỗi bắt buộc, không song song được). Tổng công việc cả 5 công
trình là **35,5h**, nhưng với 2 slot và gate mỗi cấp thì thời gian trôi qua thực tế là **~22,5h**
(mô phỏng lịch trình 2 slot, TC ưu tiên khi gate đã đạt).

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | Thời gian: `0,5 × 3^(L−1)` nhân `buildTimeMs` của blueprint (TC 15s → 7,5s ở cấp 1, 13h40 ở bước 9→10). |
| D2 | Giá: `0,5 × 1,3^(L−1)` nhân `cost` của blueprint. |
| D3 | Hệ số thời gian **3/cấp** — chọn theo nhịp "nặng": leo trọn thang TC 1→10 mất khoảng 20,5h. |
| D4 | Cap: **10** cho mọi công trình (TC, 4 trụ cột, nhà phụ). Không còn ngoại lệ 100. |
| D5 | Gate: nâng TC từ `L` lên `L+1` cần **House, Barracks, Farm, Tower** đều ≥ `L`. Bước đầu tiên đã cần cấp 1, nên phải dựng đủ 4 trụ cột trước khi TC lên cấp. **Cập nhật phase 24 (`MIL-01`)**: tách nhà lính làm 3 → danh sách trụ cột nay là **6** (`House, Barracks, Stable, Archery Range, Farm, Tower`) ở `CORE_BUILDING_TYPES`; số liệu thời gian trong file này tính cho bản 4 trụ cột, chưa retune cho 6. |
| D6 | Mỗi người chơi nâng tối đa **2 công trình** cùng lúc. |
| D7 | Timer **chỉ chạy khi online**, và tiến trình **cộng dồn qua các phiên**: `upgradeProgressMs` được lưu xuống DB khi autosave/leave và nạp lại khi vào, nên bước 13h40 nằm rải qua nhiều session. Hành vi này đã có sẵn từ phase 03, không cần cột mới. |

## 3. Công thức

```ts
// scale(level) trả về bội số của blueprint; level là cấp HIỆN TẠI, không phải cấp đích.
function timeScale(level) {
  return 0.5 * Math.pow(3, level - 1);      // TC 7,5s (cấp 1) → 13h40 (bước 9→10)
}

function costScale(level) {
  return 0.5 * Math.pow(1.3, level - 1);    // TC 138 gỗ (cấp 1) → 1.458 gỗ (cấp 10)
}
```

- `getBuildingUpgradeTimeMs(type, level) = buildTimeMs(type) × timeScale(level)` — **bỏ trần**
  `MAX_BUILDING_UPGRADE_MS` (bản nháp cũ có trần 2h; phase này không dùng).
- `getBuildingUpgradeCost(type, level) = cost(type) × costScale(level)`, làm tròn từng tài nguyên.
- Cấp 1→2 của TC vẫn là **138 gỗ + 50 đá** như hiện tại, nên đoạn đầu game không đổi.
- Đơn vị cấp không lũy kế: mọi chỉ số (`+2%/cấp`, `+1 pop/cấp` cho TC) giữ nguyên như phase 03.

## 4. Số liệu

Nhà chính (bậc thang):

| Bước | Giá | Thời gian |
| --- | --- | --- |
| 1→2 | 138 gỗ + 50 đá | 7,5s |
| 2→3 | 179 gỗ + 65 đá | 22,5s |
| 3→4 | 232 gỗ + 85 đá | 1m08 |
| 4→5 | 302 gỗ + 110 đá | 3m23 |
| 5→6 | 393 gỗ + 143 đá | 10m07 |
| 6→7 | 511 gỗ + 186 đá | 30m22 |
| 7→8 | 664 gỗ + 241 đá | 1h31 |
| 8→9 | 863 gỗ + 314 đá | 4h33 |
| 9→10 | 1.122 gỗ + 408 đá | 13h40 |
| **Tổng** | **4.404 gỗ + 1.602 đá** | **20h30** |

Cộng 4 trụ cột leo 1→9 (điều kiện gate ở mỗi bước):

| Công trình | Cấp tối đa | Tổng thời gian | Tổng tài nguyên |
| --- | --- | --- | --- |
| Town Center | 10 | **20,5h** | 4.404 gỗ + 1.602 đá |
| Tower | 9 | 5,5h | 597 gỗ + 1.492 đá |
| Barracks | 9 | 4,6h | 2.088 gỗ |
| Farm | 9 | 2,7h | 716 gỗ |
| House | 9 | 2,3h | 597 gỗ |
| **Tổng công việc** | | **35,5h** | |
| **Thời gian trôi qua (2 slot + gate)** | | **~22,5h** | |

- Tổng công việc là 35,5h nhưng hai slot chạy song song, nên đồng hồ chỉ trôi ~22,5h; cộng thêm
  thời gian farm tài nguyên.
- Tài nguyên chỉ vài giờ farm ở nhịp thu hoạch bình thường → **thời gian là cửa ải chính**.
- Gate bắt TC và trụ cột thay phiên nhau: TC chỉ nhích khi trụ cột đã tới cấp tương ứng, nên TC
  không thể "chạy trước" để rút ngắn thời gian.

## 5. Hành vi server

- `handleUpgradeBuilding` kiểm tra thêm, theo thứ tự: đã max → đang nâng → **gate (chỉ TC)** →
  **slot** → đủ tiền.
- Gate: lấy cấp cao nhất của từng loại trụ cột đã xây xong thuộc sở hữu; thiếu loại nào hoặc thấp
  hơn mốc thì từ chối, message nêu rõ loại + cấp cần.
- Slot: đếm số công trình của người chơi có `upgradeTimeMs > 0`; từ 2 trở lên thì từ chối.
- Huỷ nâng cấp vẫn hoàn 100% và **giải phóng slot** ngay.
- Gate chỉ áp cho TC; trụ cột và nhà phụ vẫn nâng tự do tới cap.

## 6. Dữ liệu & protocol

- **Không đổi gì**: `level`, `upgradeProgressMs`, `upgradeTimeMs` đã đủ cho cả gate, slot và cộng dồn
  qua phiên. Không thêm message, không thêm cột, không cần reset DB.
- Điều kiện duy nhất phải giữ: `savePlayerEmpire`/`loadZonePlayer` tiếp tục ghi và đọc hai cột
  `upgrade_progress_ms` / `upgrade_time_ms` (đã có từ `ensureUpgradeColumns()`).

## 7. Client

- Panel nâng cấp hiện thêm khối yêu cầu khi chọn TC: từng trụ cột `Hiện/Cần`, đỏ nếu thiếu.
- Hiện số slot đang dùng (`1/2`), disable nút khi hết slot hoặc thiếu điều kiện.
- Format thời gian: `45s`, `12m`, `6h42`, `13h40` — không hiện `49207.5s`.

## 8. Task log

| Task | Nội dung | Trạng thái |
| --- | --- | --- |
| LVL2-00 | Doc phase + index | DONE |
| LVL2-01 | `levels.ts`: `timeScale`/`costScale` 2 giai đoạn, bỏ trần 2h, `getRequiredCoreLevel`, `getCoreLevelGaps` | DONE |
| LVL2-02 | `getBuildingMaxLevel`: cấp 10 cho mọi công trình (2026-11-05) | DONE |
| LVL2-03 | `CommandSystem`: gate + slot, message lỗi | DONE |
| LVL2-04 | Client: khối yêu cầu, slot, format thời gian | DONE |
| LVL2-05 | Test: công thức, gate, slot, clamp cấp 10 | DONE |
| LVL2-06 | Xác nhận cộng dồn qua phiên: nạp lại `upgradeProgressMs` sau khi thoát giữa chừng (hành vi có sẵn, chỉ thêm test) | DONE |
| LVL2-07 | Cập nhật `03-level-upgrades.md` §3 và số ví dụ | DONE |

## 9. Rủi ro

- **Bước cuối là 13h40 chơi thật**: cộng dồn qua phiên (D7) nên không mất tiến trình; ở nhịp 3h/ngày
  thì bước cuối mất ~5 ngày. Nếu thấy quá dài, hạ D3 xuống 2,5 (tổng TC còn ~13h).
- **Timer dừng khi offline là chủ ý**: không có accrual theo giờ thực, nên "~22,5h" ở §4 là giờ chơi
  chứ không phải lịch.
- **Trụ cột nhẹ hơn TC nhiều**: vì nhân theo `buildTimeMs`, Barracks 1→9 chỉ 4,6h trong khi TC 1→10
  là 20,5h. Đây là chủ ý — gate bắt người chơi chờ TC, không chờ trụ cột.
- **Số liệu trong doc dễ trôi** khỏi code: mọi con số ở §4 đều sinh từ 4 hằng số ở §3, sửa hằng số
  phải chạy lại bảng.
- **UI hiện `Lv x/10`** cho trụ cột: phải lấy cap từ `getBuildingMaxLevel`, không hard-code.
- **Gate dùng "cấp cao nhất"** chứ không phải "mọi công trình cùng loại": người chơi xây nhiều nhà
  thì chỉ cần một cái đạt mốc. Đây là chủ ý, tránh bắt nâng toàn bộ làng.

## 10. Kiểm chứng

```bash
pnpm --filter @chien-quoc/shared build
cd apps/server && ../../node_modules/.bin/tsc --noEmit
cd apps/client && ../../node_modules/.bin/tsc --noEmit
pnpm --filter @chien-quoc/server test
pnpm --filter @chien-quoc/client test
```

Kiểm tra tay:

1. TC cấp 9 → 10 hiện `13h40`; TC cấp 1 → 2 hiện `7s`.
2. Nâng TC khi House/Barracks/Farm/Tower chưa đạt đúng cấp TC → bị chặn kèm tên công trình thiếu.
3. Đang nâng 2 công trình → công trình thứ ba bị chặn; huỷ một cái thì nâng được tiếp.
4. Mọi công trình đều hiện `Lv x/10`, kể cả TC và trụ cột.
5. Nâng TC rồi thoát giữa chừng, vào lại → tiến trình giữ nguyên (không nhảy thêm, không reset) và
   timer chạy tiếp từ chỗ đã dừng.

## 11. Kết quả code

| File | Thay đổi |
| --- | --- |
| `packages/shared/src/utils/levels.ts` | `timeScale` = `0,5 × 3^(L−1)`, `costScale` = `0,5 × 1,3^(L−1)`; `getBuildingMaxLevel` trả 10 cho mọi công trình; `getRequiredCoreLevel` trả đúng cấp TC (gate mỗi cấp); `getCoreLevelGaps`, type `CoreLevelGap` |
| `apps/server/src/rooms/upgrades.ts` | `collectCoreLevels` (chỉ công trình đã xong, lấy cấp cao nhất mỗi loại), `countActiveBuildingUpgrades`, `restoreBuildingUpgrade` |
| `apps/server/src/rooms/CommandSystem.ts` | gate TC trước slot, rồi tới giá; message nêu tên + cấp cần + cấp đang có |
| `apps/server/src/rooms/WorldRoom.ts` | dùng `restoreBuildingUpgrade` khi nạp lại từ DB |
| `apps/client/src/game/scenes/WorldScene.ts` | `upgradeContext()` gom cấp trụ cột + số slot vào `SelectedEntityData`; signature của panel tính cả hai nên không bị đứng số |
| `apps/client/src/components/UpgradePanels.tsx` | khối "Trụ cột cần Lv N" (đỏ khi thiếu), `Slot n/N`, disable nút kèm lý do, format thời gian mới |
| `apps/client/src/components/durationText.ts` | `formatDuration` → `45s` / `12m` / `6h42` / `73h` |

- Không thêm message, không thêm cột, không reset DB (đúng §6).
- Test mới: `upgrades.test.ts` (công thức hai giai đoạn, clamp, gate), `WorldRoom.test.ts`
  (`progression gate and slots (LVL2)`: gate TC, foundation không tính, 2 slot + huỷ giải phóng slot,
  clamp cấp 10, cộng dồn sau save/reload), `durationText.test.ts`.
- Lệch nhỏ so với bảng nháp ở §4 (đã sửa theo code): `formatDuration` làm tròn xuống nên 7,5s hiện
  `7s`, và 10→11 là `40m20` chứ không tròn `40m`.
- `pnpm --filter @chien-quoc/shared build` đang hỏng sẵn ở HEAD (`terrainMath.ts` import `MapZoneKind`
  từ `constants` trong khi type đó nằm ở `types`). Đã sửa để chạy được §10.
- `terrainMath.test.ts` có ngưỡng perf 250ms; chạy song song với `pnpm test` khác thì thỉnh thoảng
  vượt (260ms). Chạy riêng hoặc chạy cả suite server một mình đều pass — không liên quan phase này.
