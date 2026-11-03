# Phase 08 — Đường cong nâng cấp dài hạn (1-10 phút, từ 11 tính bằng giờ)

Status: **IMPLEMENTED — chờ verify tay trong game** (code + test xong; số liệu ở §4 lấy trực tiếp từ
code sau khi implement).

## 1. Mục tiêu

Phase 03 cho TC 1→100 chỉ mất **7,54h** (đường cong bậc hai `0,5 + 0,1i + 0,004i²`). Với một game
online nhiều năm, mốc đó bị chạm trần trong vài ngày. Phase 08 thay toàn bộ đường cong nâng cấp
công trình bằng **hai giai đoạn**:

- **Cấp 1 → 10**: tính bằng phút (7,5s → 40 phút), người chơi học cơ chế.
- **Cấp 11 trở lên**: bắt đầu đúng **1 giờ** cho Nhà chính và nhân **1,05 mỗi cấp** — cấp 50 là
  6,7h, cấp 100 là **73,2h**.
- **Ràng buộc cấp**: TC không được vượt 4 công trình trụ cột; mỗi 5 cấp TC đòi trụ cột theo kịp.
- **Giới hạn 2 slot** nâng cùng lúc, để ràng buộc ở trên biến thành thời gian thật thay vì chỉ là
  thao tác song song.

Kết quả: đường đi tối thiểu tới TC 100 là **4.129 giờ** ≈ **3,8 năm** nếu chơi 3h/ngày, 2,3 năm nếu
5h/ngày.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | Thời gian: `L ≤ 10` → `7,5s × 1,9^(L−1)`; `L ≥ 11` → `1h × 1,05^(L−11)`. Nhân theo `buildTimeMs` của blueprint (TC 15s = 1h ở cấp 11; House 5s = 20 phút). |
| D2 | Giá: `L ≤ 10` → `0,5 × 1,07^(L−1)`; `L ≥ 11` → `0,5 × 1,07^9 × 1,08^(L−10)`, nhân theo `cost` của blueprint. |
| D3 | Hệ số thời gian **1,05/cấp**. Phương án 1,1 bị loại: cấp cuối 4.391h và tổng 104 năm ở nhịp 3h/ngày. |
| D4 | Cap: TC **100**, 4 trụ cột **100**, nhà phụ (`LUMBER_CAMP`/`MILL`/`MINING_CAMP`) giữ **10** và không nằm trong gate. |
| D5 | Gate: nâng TC từ `L` lên `L+1` cần **House, Barracks, Farm, Tower** đều ≥ `floor(L/5) × 5`. Dưới cấp 5 chưa có yêu cầu. |
| D6 | Mỗi người chơi nâng tối đa **2 công trình** cùng lúc. |
| D7 | Timer **chỉ chạy khi online**, và tiến trình **cộng dồn qua các phiên**: `upgradeProgressMs` được lưu xuống DB khi autosave/leave và nạp lại khi vào, nên một lần nâng 73h nằm rải qua nhiều session. Hành vi này đã có sẵn từ phase 03, không cần cột mới. |

## 3. Công thức

```ts
// scale(level) trả về bội số của blueprint; level là cấp HIỆN TẠI, không phải cấp đích.
function timeScale(level) {
  return level <= 10
    ? 0.5 * Math.pow(1.9, level - 1)              // 7,5s → 40 phút (TC)
    : 240 * Math.pow(1.05, level - 11);           // 1h → 73,2h (TC)
}

function costScale(level) {
  return level <= 10
    ? 0.5 * Math.pow(1.07, level - 1)
    : 0.5 * Math.pow(1.07, 9) * Math.pow(1.08, level - 10);
}
```

- `getBuildingUpgradeTimeMs(type, level) = buildTimeMs(type) × timeScale(level)` — **bỏ trần**
  `MAX_BUILDING_UPGRADE_MS` (bản nháp cũ có trần 2h; phase này không dùng).
- `getBuildingUpgradeCost(type, level) = cost(type) × costScale(level)`, làm tròn từng tài nguyên.
- Cấp 1→2 của TC vẫn là **138 gỗ + 50 đá** như hiện tại, nên đoạn đầu game không đổi.
- Đơn vị cấp không lũy kế: mọi chỉ số (`+2%/cấp`, `+1 pop/cấp` cho TC) giữ nguyên như phase 03.

## 4. Số liệu

Nhà chính (bậc thang):

| Cấp | Giá | Thời gian |
| --- | --- | --- |
| 1→2 | 138 gỗ + 50 đá | 7,5s |
| 5→6 | 180 gỗ + 66 đá | 1m37 |
| 10→11 | 253 gỗ + 92 đá | 40m20 |
| 20→21 | 546 gỗ + 198 đá | 1h33 |
| 30→31 | 1.178 gỗ + 428 đá | 2h31 |
| 40→41 | 2.544 gỗ + 925 đá | 4h06 |
| 50→51 | 5.492 gỗ + 1.997 đá | 6h42 |
| 60→61 | 11.856 gỗ + 4.311 đá | 10h55 |
| 70→71 | 25.597 gỗ + 9.308 đá | 17h47 |
| 80→81 | 55.261 gỗ + 20.095 đá | 28h58 |
| 90→91 | 119.305 gỗ + 43.383 đá | 47h12 |
| 99→100 | 238.490 gỗ + 86.724 đá | 73h13 |

Đường đi tối thiểu (TC 100 + 4 trụ cột tới mốc gate cao nhất = 95):

| Công trình | Cấp tối đa cần | Tổng thời gian | Tổng tài nguyên |
| --- | --- | --- | --- |
| Town Center | 100 | **1.519h** | 3,22M gỗ + 1,17M đá |
| Barracks | 95 | 791h | 1,39M gỗ |
| Tower | 95 | 949h | 0,40M gỗ + 1,00M đá |
| Farm | 95 | 475h | 0,48M gỗ |
| House | 95 | 395h | 0,40M gỗ |
| **Tổng** | | **4.129h** | 5,9M gỗ + 2,2M đá |

- 4.129h ≈ **3,8 năm** ở nhịp 3h/ngày, 2,3 năm ở 5h/ngày, 1,6 năm ở 7h/ngày.
- Tài nguyên chỉ ~22h farm ở 100 res/s → **thời gian là cửa ải chính**, tài nguyên là phụ.
- Gate bắt TC và trụ cột thay phiên nhau, nên thời gian thực tế xấp xỉ tổng trên chứ không chia đôi
  theo số slot.

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
- Format thời gian: `45s`, `12m`, `6h42`, `73h` — không hiện `260000.0s`.

## 8. Task log

| Task | Nội dung | Trạng thái |
| --- | --- | --- |
| LVL2-00 | Doc phase + index | DONE |
| LVL2-01 | `levels.ts`: `timeScale`/`costScale` 2 giai đoạn, bỏ trần 2h, `getRequiredCoreLevel`, `getCoreLevelGaps` | DONE |
| LVL2-02 | `getBuildingMaxLevel`: trụ cột 100, nhà phụ 10 | DONE |
| LVL2-03 | `CommandSystem`: gate + slot, message lỗi | DONE |
| LVL2-04 | Client: khối yêu cầu, slot, format thời gian | DONE |
| LVL2-05 | Test: công thức, gate, slot, clamp cấp 100 | DONE |
| LVL2-06 | Xác nhận cộng dồn qua phiên: nạp lại `upgradeProgressMs` sau khi thoát giữa chừng (hành vi có sẵn, chỉ thêm test) | DONE |
| LVL2-07 | Cập nhật `03-level-upgrades.md` §3 và số ví dụ | DONE |

## 9. Rủi ro

- **Một lần nâng 73h là 73 giờ chơi thật**: cộng dồn qua phiên (D7) nên không mất tiến trình, nhưng
  ở nhịp 3h/ngày thì cấp cuối mất ~24 ngày. Đây là hệ quả trực tiếp của ×1,05 + online-only, không
  phải lỗi; nếu thấy quá dài thì hạ D3 xuống 1,045 (tổng còn 3.023h).
- **Timer dừng khi offline là chủ ý**: không có accrual theo giờ thực, nên "3,8 năm" ở §4 đã tính
  đúng theo giờ chơi chứ không phải lịch.
- **Công trình nhẹ chưa đạt "tính bằng giờ"**: vì nhân theo `buildTimeMs`, ở cấp 11 House chỉ 20
  phút, Farm 24 phút, Barracks 40 phút — chỉ TC (1h) và Tower (48 phút) là sát ngưỡng giờ. Nếu muốn
  **mọi** công trình đều ≥1h từ cấp 11 thì phải bỏ hệ số base time, và tổng thời gian tăng từ 4.129h
  lên ~6.260h (gấp 1,5 lần).
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

1. TC cấp 10 → 11 hiện đúng `40m`; cấp 11 → 12 hiện `1h`.
2. Nâng TC khi House/Barracks/Farm/Tower chưa đủ mốc → bị chặn kèm tên công trình thiếu.
3. Đang nâng 2 công trình → công trình thứ ba bị chặn; huỷ một cái thì nâng được tiếp.
4. Trụ cột hiện `Lv x/100`, nhà phụ vẫn `Lv x/10`.
5. Nâng TC rồi thoát giữa chừng, vào lại → tiến trình giữ nguyên (không nhảy thêm, không reset) và
   timer chạy tiếp từ chỗ đã dừng.

## 11. Kết quả code

| File | Thay đổi |
| --- | --- |
| `packages/shared/src/utils/levels.ts` | `timeScale`/`costScale` hai giai đoạn thay `buildingUpgradeScale`; `getBuildingMaxLevel` trả 100 cho TC + 4 trụ cột, 10 cho nhà phụ (kể cả `PORTAL`); thêm `getRequiredCoreLevel`, `getCoreLevelGaps`, type `CoreLevelGap` |
| `apps/server/src/rooms/upgrades.ts` | `collectCoreLevels` (chỉ công trình đã xong, lấy cấp cao nhất mỗi loại), `countActiveBuildingUpgrades`, `restoreBuildingUpgrade` |
| `apps/server/src/rooms/CommandSystem.ts` | gate TC trước slot, rồi tới giá; message nêu tên + cấp cần + cấp đang có |
| `apps/server/src/rooms/WorldRoom.ts` | dùng `restoreBuildingUpgrade` khi nạp lại từ DB |
| `apps/client/src/game/scenes/WorldScene.ts` | `upgradeContext()` gom cấp trụ cột + số slot vào `SelectedEntityData`; signature của panel tính cả hai nên không bị đứng số |
| `apps/client/src/components/UpgradePanels.tsx` | khối "Trụ cột cần Lv N" (đỏ khi thiếu), `Slot n/N`, disable nút kèm lý do, format thời gian mới |
| `apps/client/src/components/durationText.ts` | `formatDuration` → `45s` / `12m` / `6h42` / `73h` |

- Không thêm message, không thêm cột, không reset DB (đúng §6).
- Test mới: `upgrades.test.ts` (công thức hai giai đoạn, clamp, gate), `WorldRoom.test.ts`
  (`progression gate and slots (LVL2)`: gate TC, foundation không tính, 2 slot + huỷ giải phóng slot,
  clamp 100, cộng dồn sau save/reload), `durationText.test.ts`.
- Lệch nhỏ so với bảng nháp ở §4 (đã sửa theo code): `formatDuration` làm tròn xuống nên 7,5s hiện
  `7s`, và 10→11 là `40m20` chứ không tròn `40m`.
- `pnpm --filter @chien-quoc/shared build` đang hỏng sẵn ở HEAD (`terrainMath.ts` import `MapZoneKind`
  từ `constants` trong khi type đó nằm ở `types`). Đã sửa để chạy được §10.
- `terrainMath.test.ts` có ngưỡng perf 250ms; chạy song song với `pnpm test` khác thì thỉnh thoảng
  vượt (260ms). Chạy riêng hoặc chạy cả suite server một mình đều pass — không liên quan phase này.
