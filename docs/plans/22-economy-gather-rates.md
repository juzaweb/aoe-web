# Phase 22 — Nhịp thu hoạch chậm lại + nông trại lớn hơn

**Status: `IMPLEMENTED`** (2026-11-05, awaiting live verify).

Phạm vi: `packages/shared` (constants + docstring), `apps/server` (EconomySystem + tests),
`README.md`. **Không** đổi schema, `NetworkMessage`, payload hay công thức nâng cấp.

## 1. Vấn đề

Dân lấy tài nguyên nhanh tới mức tài nguyên trên bản đồ gần như không kịp cạn:

| Thứ | Trước phase |
| --- | --- |
| Tốc độ lấy | `GATHER_AMOUNT_PER_SECOND = 10` cho **mọi** loại |
| Carry capacity | 10 (VILLAGER cấp 1) |
| Thời gian đầy 1 chuyến | **1 giây** đứng cạnh node |
| Nông trại | 250 food, giá gieo lại 60 wood |

Vì một giây là đầy túi, phần "đứng hái" của chuyến đi gần như bằng 0; chỉ quãng đường tới
drop-off được cảm nhận. Nông trại 250 food cạn trong 25 giây với một dân, và giá gieo lại
60 wood nhanh chóng vượt quá lượng gỗ người chơi kiếm được → `resowFarm` trả `false`, dân bỏ
đi, nông trại nằm trơ mà không có thông báo nào.

## 2. Quyết định

| Mã | Quyết định |
| --- | --- |
| D1 | Bỏ hằng số phẳng `GATHER_AMOUNT_PER_SECOND`; thay bằng `GATHER_UNITS_PER_SECOND` theo loại: wood `2`, food `2.5`, stone `1.5`, gold `1.25`. |
| D2 | Thu hoạch trả **đơn vị nguyên**, mỗi `1000 / rate` ms một đơn vị (`gatherIntervalMs()`). Không để phần lẻ trong `remainingAmount`/`carryingAmount` vì hai trường này replicate. |
| D3 | Phần lẻ của interval được giữ lại trong `gatherTimers` (modulo một interval), nên tick không bị làm tròn mất; nhưng phần bị giới hạn bởi `available`/chỗ trống trong túi thì bị bỏ, không dồn thành credit cho node kế tiếp. |
| D4 | Nông trại: `gatherCapacity` 250 → **600** (cấp 10 = 1.140). Giá gieo lại giữ nguyên 60 wood. |
| D5 | Không đổi `carryCapacity` (10) hay `RESOURCE_REGROW_MS`: nhịp chậm lại đã làm node sống lâu hơn, tăng thêm thời gian hồi sẽ biến thành chờ đợi thuần. |

Thời gian đầy một chuyến (10 đơn vị) sau phase: wood **5 s**, food **4 s**, stone **6,7 s**,
gold **8 s** — so với 1 s trước đó.

## 3. Thay đổi code

| File | Thay đổi |
| --- | --- |
| `packages/shared/src/constants/index.ts` | `GATHER_UNITS_PER_SECOND`, `gatherIntervalMs()`; `FARM.gatherCapacity` 250 → 600 |
| `packages/shared/src/utils/levels.ts` | Cập nhật ví dụ trong docstring (250/475 → 600/1140) |
| `apps/server/src/rooms/EconomySystem.ts` | Xoá `GATHER_AMOUNT_PER_SECOND`; thêm `harvestTick()` dùng chung cho node và nông trại |
| `apps/server/src/rooms/gatherables.ts` | Bỏ số 250 cứng trong docstring |
| `apps/server/src/rooms/WorldRoom.test.ts` | Helper `simulate()` + `fullLoadMs()`; mọi test gather chờ đúng thời gian thay vì 1 giây; test mới: 2 đơn vị sau 2 interval, không rút quá node gần cạn, không mang credit sang node khác, dân rời node đã cạn sẵn |
| `README.md` | Mục Gathering Rates, mô tả Farm mới |

## 4. Edge case

| Edge | Xử lý |
| --- | --- |
| Node cạn giữa interval | `harvestTick` trả 0 khi chưa đủ interval, và chỗ gọi **không return sớm**: nhánh depletion bên dưới vẫn chạy để dân rời node thay vì đứng mãi. |
| Node đã cạn trước khi dân tới | Cùng nhánh trên: `taken` bằng 0, `remainingAmount` đã 0 nên dân bank hàng hoặc retarget ngay tick đầu. |
| Tick dài (lag, resume) trên node gần cạn | `available` nằm trong `Math.min` nên không rút quá số còn lại; số đơn vị bị chặn không được giữ làm credit (`% interval`). |
| Túi đã đầy | `roomInHand <= 0` → trả 0, timer vẫn tích phần lẻ để chuyến sau không bị phạt. |
| `resourceType` lạ | `gatherIntervalMs` fallback về tốc độ wood. |
| Đổi tốc độ giữa chừng (sau này) | Timer tính theo ms nên đổi bảng chỉ ảnh hưởng interval kế tiếp, không cần migrate save. |
| Rate lẻ (2.5, 1.25) | `Math.floor(elapsed / interval)` giới hạn theo `roomInHand` và `available`, nên không bao giờ trả nhiều hơn chỗ trống hay số còn lại. |

## 5. Kiểm chứng

```
pnpm --filter @chien-quoc/shared build      # ok
npx tsc --noEmit -p apps/server             # ok
pnpm --filter @chien-quoc/server test       # 234 tests, 16 files pass
pnpm --filter @chien-quoc/client build      # ok
```

## 6. Verify tay

1. Cho 1 dân chặt cây: phải mất ~5 s mới đầy túi, không còn đầy trong 1 s.
2. Đào vàng: ~8 s mới đầy túi.
3. Nông trại: 1 dân cần ~4 s cho mỗi túi food; một nông trại 600 food đủ cho nhiều chuyến.
4. Nông trại cạn khi người chơi không đủ 60 wood: dân mang hàng về, nông trại vẫn trơ (hành vi cũ,
   chưa có thông báo — xem backlog).
