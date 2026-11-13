# Phase 29 — Hiệu ứng bắn tên cho cung thủ và trụ canh (`FX-01`)

**Mục tiêu:** khi cung thủ (`ARCHER`) hoặc trụ canh (`TOWER`) bắn, client vẽ một mũi tên
bay theo cung đạn từ người bắn tới mục tiêu, cắm vào mục tiêu rồi tan; kèm một cụm bụi nhỏ
lúc trúng. Asset mũi tên là art gốc của dự án, vẽ bằng **Canva** rồi tách nền thành PNG
trong suốt.

> **Status: `IMPLEMENTED`** (2026-11-13). `FX-01` code + test xanh (client 58 file / 707 test, server 31 file / 468 test,
> `tsc` sạch, `pnpm --filter @chien-quoc/client build` xanh, `python scripts/process_arrow_asset.py --check`
> xanh). Đã xem hiệu ứng chạy thật trong một sandbox Phaser (mũi tên bay + cắm vào mục tiêu);
> **chờ verify tay trong trận thật** (raid hoặc bị đánh) vì cần dựng quân + giao chiến.

**Phạm vi:** `apps/client` (+ `scripts/`, `docs/plans`) và một thay đổi nhỏ ở
`packages/shared` / `apps/server`: hai helper dùng chung (`distanceToFootprint`, `attackReach`)
được chuyển vào shared để server và client không thể lệch luật. **Không** đổi schema, protocol
hay DB: server đã replicate đủ dữ kiện để client tự dựng lại phát bắn.

---

## 1. Hiện trạng trước phase này

| Thứ đã có | Chỗ code | Ghi chú |
| --- | --- | --- |
| Luật bắn của server | `apps/server/src/rooms/CombatSystem.ts` (`updateTowerCombat`, `nearestEnemyOf`, `attackRangeAgainstTarget`) | trụ bắn mỗi `attackCooldownMs`, chọn enemy gần nhất trong `attackRange`; đơn vị bắn trong `attackRange + margin` (0,5 ô với unit, 1,5 ô với building) |
| Khoảng cách tới footprint | `apps/server/src/rooms/geometry.ts` | dùng bởi combat, construction, economy |
| Cung thủ có animation bắn | `render/unitArt.ts` (`ARCHER.attack`, 9 frame @ 10 fps) | chỉ là animation giương cung, không có mũi tên |
| Trạng thái để suy ra phát bắn | `UnitState.actionState` = `ATTACKING`, `targetEntityId`, `targetEntityType` | replicate sẵn, không cần message mới |
| Số liệu tầm bắn / nhịp bắn | `packages/shared/src/constants/index.ts` (`UNIT_BLUEPRINTS`, `BUILDING_BLUEPRINTS`, `isRangedAttackRange`) | ARCHER 5.0 ô / 1400 ms, TOWER 8 ô / 2000 ms |
| Tiền lệ "effect thuần cosmetic, không đổi protocol" | `render/buildingFire.ts`, `alerts/underAttack.ts` | cùng triết lý: client tự dựng từ state replicate |

| Thứ còn thiếu | Hệ quả |
| --- | --- |
| Không có projectile nào | cung thủ/trụ bắn mà không thấy gì; trụ canh trông như không hoạt động |
| Không có asset mũi tên | không có gì để vẽ |

---

## 2. Quyết định thiết kế

### D1 — CHỐT: client tự dựng phát bắn, **không** thêm message server

Server chỉ replicate `hp`, `actionState`, `targetEntityId`. Thêm `COMBAT_SHOT` sẽ phải sửa
protocol + server + test cho một thứ thuần cosmetic. Client dựng lại đúng luật server
(`RangedFireSim`) nên hiệu ứng không bao giờ mâu thuẫn với sát thương thật.

Đánh đổi đã biết: mũi tên đầu tiên của cung thủ trễ `ARCHER_DRAW_MS` (700 ms) so với lúc
server bắt đầu trừ máu — đúng bằng thời gian giương cung của animation, nên nhìn lại khớp.
Trụ bắn ngay frame đầu tiên có mục tiêu, giống server (cooldown khởi đầu 0).

### D2 — CHỐT: tách **luật bắn** (thuần, test được) khỏi **lớp vẽ** (Phaser)

- `render/rangedFire.ts` — `RangedFireSim`: không Phaser, không DOM, không `Date.now`,
  không `Math.random`. Vào: `nowMs` + ảnh chụp state; ra: `RangedShot[]`. Nhờ vậy toàn bộ
  luật (tầm bắn, nhịp bắn, chọn mục tiêu, prune timer) test được bằng vitest.
- `render/arrowFlight.ts` — hình học bay: đổi grid → screen, thời gian bay, vị trí theo `t`,
  góc xoay. Cũng thuần, cũng test được.
- `render/projectiles.ts` — `ProjectileLayer`: chỉ tạo/di chuyển/huỷ sprite.

### D3 — CHỐT: asset mũi tên vẽ bằng Canva, tách nền bằng script có `--check`

Art gốc của dự án (không phải third-party) nên **không** nằm trong
`scripts/assets/manifest.json` / `assets.lock.json`: không có URL upstream hay license để pin.
Thay vào đó `scripts/process_arrow_asset.py` làm pipeline tất định (chroma key → despill →
trim → resize premultiplied → PNG RGBA 164×28) và `--check` đo lại file đã ship: kích thước,
biên trong suốt, có pixel đặc, không còn viền xanh. Cùng mô hình với
`scripts/process_generated_assets.py` (cổng + đường đất).

### D4 — CHỐT: luật dùng chung đặt trong `packages/shared`, không chép lại

`distanceToFootprint` và biên tầm bắn (`UNIT_REACH_MARGIN` 0,5 / `BUILDING_REACH_MARGIN` 1,5 →
`attackReach()`) được đưa vào shared và dùng bởi **cả** server lẫn client. Trước đó client giữ
đúng `attackRange` của blueprint, trong khi server cộng thêm biên: dải 0,5 ô ngoài cùng của
cung thủ bị mất máu mà không có mũi tên nào bay — đúng loại lỗi "hiệu ứng nói dối". Một nguồn
sự thật duy nhất là cách duy nhất để nó không tái diễn khi cân bằng lại chỉ số.

### D5 — CHỐT: hiệu ứng có trần và tôn trọng `prefers-reduced-motion`

- Trần `MAX_LIVE_ARROWS = 160`: một trận 300 lính không thể làm nổ display list.
- Reduced motion (UIX-13): bay thẳng (arc = 0), thời gian bay ~35%, không bụi, cắm rồi tan nhanh.
- Texture fallback: nếu PNG 404, layer tự vẽ mũi tên bằng canvas — mất asset không làm sập scene.

---

## 3. Kiến trúc

```
WorldScene.update()
  └─ updateProjectiles(time)
       ├─ chụp room.state.units / .buildings vào buffer tái sử dụng (0 alloc/frame)
       ├─ RangedFireSim.update(time, world) -> RangedShot[]     (luật bắn)
       └─ ProjectileLayer.spawn(shot) + .update(time)           (vẽ + va chạm)
```

| File | Vai trò |
| --- | --- |
| `apps/client/src/game/render/rangedFire.ts` | luật bắn thuần: archer (ATTACKING + target trong tầm **theo `attackReach` của server**, draw 700 ms rồi theo cooldown), tower (enemy gần nhất trong tầm, bắn ngay rồi theo cooldown), prune timer, `RangedWorldSnapshot` (cầu nối state → input, tái sử dụng buffer) |
| `packages/shared/src/utils/geometry.ts` | `distanceToFootprint` dùng chung (server: combat/construction/economy, client: hiệu ứng tên) |
| `packages/shared/src/constants/index.ts` | `UNIT_REACH_MARGIN`, `BUILDING_REACH_MARGIN`, `attackReach()` — biên tầm bắn dùng chung |
| `apps/client/src/game/render/arrowFlight.ts` | hình học: `gridToScreenPoint`, `flightDurationMs` (60 ms/ô, kẹp 140–520 ms), `arrowPositionAt` (arc), `arrowAngle` |
| `apps/client/src/game/render/projectiles.ts` | `ProjectileLayer`: sprite, arc, xoay theo vận tốc, cắm + bụi, trần 160, fallback texture |
| `apps/client/src/game/scenes/WorldScene.ts` | preload `fx_arrow`, tạo layer, `updateProjectiles`, `reset()` khi đổi map |
| `apps/client/public/assets/fx/arrow.png` | sprite 164×28 (vẽ 46 px trên màn hình) |
| `scripts/process_arrow_asset.py` | pipeline + `--check` cho asset trên |

Chi tiết đáng nhớ:

- Mũi tên nhắm **vị trí hiện tại** của mục tiêu mỗi frame (không phải chỗ đã ngắm lúc bắn),
  nên bắn lính đang chạy vẫn trúng; mục tiêu chết giữa đường thì bay tới điểm cuối cùng.
- Độ sâu vẽ `900 000`: trên toàn bộ thế giới (hàng sâu nhất ~440 000), dưới overlay lệnh (999 990+).
- `RangedFireSim` giữ timer theo id người bắn và prune mỗi frame; `reset()` khi scene đổi room.

---

## 4. Edge case

| Tình huống | Xử lý |
| --- | --- |
| Lính cận chiến (`SPEARMAN`, `CAVALRY`) đang `ATTACKING` | không bắn: `isRangedAttackRange` lọc theo blueprint |
| Trụ còn là foundation | không bắn: `isConstructed === false` |
| Công trình `attackRange = 0` | không bắn |
| Mục tiêu ra khỏi tầm giữa loạt | timer bị xoá, phải giương cung lại khi vào tầm |
| Mục tiêu chết / rời room giữa đường bay | bay tới vị trí cuối đã biết rồi tan |
| 300 lính cùng bắn | trần 160 sprite; phần dư không vẽ (mất một mũi tên lẻ, không tụt FPS) |
| Đổi map (travel) | `projectiles.destroy()` + `rangedFire.reset()` |
| Thiếu `arrow.png` | layer vẽ mũi tên bằng canvas |
| Người chơi bật reduced motion | bay thẳng, nhanh, không bụi |
| Id unit trùng id building | hiện server không trùng; nếu đổi, phải key timer theo `kind` |

---

## 5. Test

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --filter @chien-quoc/client exec vitest run rangedFire` | 29/29 (gồm biên tầm bắn, tie-break, snapshot) |
| `pnpm --filter @chien-quoc/client exec vitest run arrowFlight` | 13/13 |
| `bash scripts/run-tests.sh` (gate đầy đủ: shared build → prisma → build 2 app → test 2 app) | client 58 file / 707 test, server 31 file / 468 test, exit 0 |
| `pnpm --filter @chien-quoc/client exec tsc --noEmit -p tsconfig.json` (cwd `apps/client`) | exit 0 |
| `pnpm --filter @chien-quoc/client build` | xanh |
| `python scripts/process_arrow_asset.py --check` | `ok ... (164, 28) alpha=255 solid=1285` (gate chạy tay: CI chỉ có Node, không cài Python) |

---

## 6. Việc còn lại (verify tay)

1. Vào kingdom, xây Trụ canh cạnh đường đi của địch (hoặc bị raid) → thấy tên bay từ đỉnh trụ.
2. Train cung thủ từ Archery Range, cho đánh lính địch → thấy tên bay theo nhịp ~1,4 s, cắm vào mục tiêu.
3. Bật "giảm chuyển động" trong OS → tên bay thẳng, nhanh, không bụi.
4. Đổi map (travel) giữa lúc đang bắn → không còn mũi tên nào sót lại của map cũ.
