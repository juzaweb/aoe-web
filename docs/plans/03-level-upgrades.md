# Phase 03 — Nâng cấp (level-up) công trình và lính

Status: **IMPLEMENTED — chờ verify tay trong game**
Ngày chốt quyết định: 2026-11-02

> Đường cong giá/thời gian ở §3 đã bị **phase 08** thay thế (cấp 1-10 tính bằng phút, từ cấp 11
> tính bằng giờ, ×1,05/cấp, cộng gate cấp và 2 slot). Phần còn hiệu lực của phase này là mô hình
> level, protocol, persistence và hành vi server. Xem `08-progression-curve.md`.

## 1. Mục tiêu

Thêm vòng tiến trình nâng cấp để người chơi đầu tư tài nguyên vào công trình và vào từng loại lính.
Trước phase này repo không có bất kỳ khái niệm `level` / `tier` / `upgrade` nào; mọi chỉ số đều đọc
trực tiếp từ blueprint theo `type`.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Mô hình | Công trình có level **riêng từng cá thể**; lính nâng **toàn cục theo người chơi + loại lính** |
| Phạm vi | Mọi công trình đều nâng được; lính nâng tại trại lính |
| Cấp tối đa | Nhà chính 100; công trình khác 10; lính 10 |
| Tăng chỉ số | Công trình +2%/cấp; lính +5%/cấp (tuyến tính, không lũy kế) |
| Dân số / sức chứa | Nhà chính +1 dân/cấp; nhà ở tăng 2%/cấp (làm tròn); dân làng +5% sức chứa/cấp |
| Cơ chế thời gian | Nâng cấp/nghiên cứu chạy theo tick, không cần dân làng đứng xây; huỷ được và hoàn 100% |
| Ngoài phạm vi | Tốc độ di chuyển, thời gian train/xây, sức chứa ruộng, tech tree nhiều tầng |

## 3. Công thức

Với `i = level - 1` (level hiện tại, bắt đầu từ 1):

- Công trình:
  - `maxHp = round(maxHp_bp × (1 + 0.02i))`
  - `attackPower = round2(attackPower_bp × (1 + 0.02i))`
  - `populationProvided`: TC = `pop_bp + i`; còn lại = `round(pop_bp × (1 + 0.02i))`
  - Giá nâng cấp: `k = 0.5 + 0.1i + 0.004i²`, mỗi resource `round(cost_bp × k)`
  - Thời gian: `round(buildTimeMs_bp × k)`
- Lính:
  - `maxHp = round(maxHp_bp × (1 + 0.05i))`
  - `attackPower = round2(attackPower_bp × (1 + 0.05i))`
  - `carryCapacity = round(carryCapacity_bp × (1 + 0.05i))`
  - Giá: `k = 0.4 + 0.3×level + 0.02×level²`, mỗi resource `round(cost_bp × k)`, cộng thêm
    `gold += 25 × level`
  - Thời gian: `round(trainTimeMs_bp × (0.5 + 0.25i + 0.01i²))`

Ví dụ: TC 1→2 = 138 gỗ + 50 đá, 7.5s; TC 99→100 = 13.397 gỗ + 4.872 đá, 731s;
Spearman 1→2 = 18 gỗ + 36 thịt + 25 vàng, 3.5s; Cavalry 9→10 = 378 thịt + 555 vàng, 31.4s.

Toàn bộ số liệu nằm trong `packages/shared/src/utils/levels.ts` để chỉnh một chỗ.

## 4. Dữ liệu & protocol

- `BuildingState`: `level`, `upgradeProgressMs`, `upgradeTimeMs` (`0` = không nâng).
- `UnitState`: `level` (snapshot để combat/client đọc, kể cả khi chủ offline).
- `PlayerState`: `unitLevels` (mảng 4 phần tử theo `UNIT_UPGRADE_ORDER`),
  `researchUnitType`, `researchProgressMs`, `researchTimeMs`.
- Message mới: `UPGRADE_BUILDING`, `CANCEL_BUILDING_UPGRADE`, `UPGRADE_UNIT_TYPE`, `CANCEL_UNIT_UPGRADE`.
- Client không gửi giá/cấp/thời gian; server suy ra từ state.

## 5. Hành vi server

- `handleUpgradeBuilding`: chỉ công trình đã xây xong, đúng chủ, chưa max, không đang nâng, đủ tiền.
  Trừ tiền và đặt `upgradeTimeMs`; tick cộng dồn và hoàn tất.
- `handleCancelBuildingUpgrade`: hoàn 100% giá của cấp hiện tại, reset timer.
- `handleUpgradeUnitType`: cần ít nhất 1 trại lính đã xây xong, chưa max, không có research khác.
  Research lưu trên player nên trại lính bị phá giữa chừng không huỷ tiến trình.
- `handleCancelUnitUpgrade`: hoàn 100%, clear research.
- Hoàn tất nâng cấp công trình: giữ nguyên lượng máu đã mất (`hp += delta maxHp`), không hồi full.
- Hoàn tất research: cập nhật `level`, `maxHp`, `hp` cho **mọi unit cùng loại đang tồn tại**; unit
  train sau đó spawn ở cấp mới.
- Damage lính/tháp và sức chứa dân làng đọc chỉ số theo cấp; dân số TC/nhà ở tính lại khi hoàn tất.
- Research tạm dừng khi người chơi offline (PlayerState bị xoá khỏi room), giống hàng đợi train.

## 6. Client

- Panel chi tiết hiển thị `Lv x/max`; khối **Nâng cấp công trình** (giá, thời gian, tiến độ, huỷ).
- Trại lính có khối **Nghiên cứu quân đội** cho 4 loại lính, tiến độ toàn cục + huỷ.
- Tooltip train hiển thị HP/attack theo cấp hiện tại.
- Sprite công trình có badge `Lv N` và thanh tiến độ nâng cấp màu xanh trên đầu.
- `WorldScene` sync riêng cho building đang chọn vì research progress nằm trên `PlayerState`.

## 7. Persistence & migration

Cột mới:

- `players.unit_levels`, `research_unit_type`, `research_progress_ms`, `research_time_ms`
- `buildings.level`, `upgrade_progress_ms`, `upgrade_time_ms`
- `units.level`

`DatabaseService.ensureUpgradeColumns()` chạy lúc boot: đọc `PRAGMA table_info`, thêm cột còn thiếu
bằng `ALTER TABLE ... ADD COLUMN`. Nhờ vậy `dev.db` cũ **không mất account/empire**.

**Không chạy `prisma db push`** cho DB đang có: boot DDL và Prisma schema lệch nhau khiến Prisma đề
xuất drop toàn bộ bảng. Nếu cần reset hẳn thì backup `apps/server/database/dev.db*` trước.

## 8. Task log

| Task | Nội dung | Trạng thái |
| --- | --- | --- |
| LVL-00 | Doc phase + index | DONE |
| LVL-01 | Shared level constants/helpers | DONE |
| LVL-02 | Schema + Prisma/DDL + save/restore + auto-migration | DONE |
| LVL-03 | Protocol + 4 handler + tick building/research | DONE |
| LVL-04 | Call site dùng chỉ số theo cấp | DONE |
| LVL-05 | Client data plumbing + sender | DONE |
| LVL-06 | UI EntityDetails | DONE |
| LVL-07 | Badge sprite + test + verify | DONE (test), chờ verify tay UI |

## 9. Kiểm chứng

```bash
pnpm --filter @chien-quoc/shared build
cd apps/server && ../../node_modules/.bin/tsc --noEmit
cd apps/client && ../../node_modules/.bin/tsc --noEmit
pnpm --filter @chien-quoc/server test
pnpm --filter @chien-quoc/client test
```

Test server mới: `upgrades.test.ts` (công thức/clamp/parse) và các case LVL trong `WorldRoom.test.ts`
(validate, trừ tiền, tick, hoàn tiền, research cập nhật unit cũ, spawn unit mới, damage theo cấp).

Kiểm tra tay:

1. Chọn TC → nâng cấp; badge/thanh tiến độ hiện; hết giờ level +1, HP/dân số tăng.
2. Huỷ giữa chừng → hoàn đủ tiền.
3. Nâng nhà ở → dân số cap tăng; nâng tháp → damage tăng.
4. Trại lính → research Spearman; Spearman đang có tăng HP/damage; train thêm ra đúng cấp.
5. F5 giữa lúc nâng/research → tiến trình và level được khôi phục.
6. Max cấp / thiếu tiền / chưa có trại lính → bị chặn kèm thông báo.

## 10. Rủi ro đã xử lý

- Snapshot `maxHp` lệch với damage live → research cập nhật mọi unit hiện có.
- Update path của Prisma từng bỏ qua `maxHp`/`level` → đã thêm vào cả create và update.
- Boot DDL không alter DB cũ → thêm migration `ALTER TABLE` idempotent.
- Research progress không nằm trên building → thêm `syncSelectedBuildingDetails` ở client.
