# Phase 20 — Tài nguyên kingdom ở vành rìa + hồi theo loại (persist)

**Status: `IMPLEMENTED`** (built 2026-11-04, awaiting live verify).

Phạm vi: `packages/shared`, `apps/server` (schema + DB + room), `docs/plans`, `README.md`.
**Không** đổi `NetworkMessage`, payload, Colyseus schema `ResourceNodeState`, asset, layout
battlefield.

## 1. Mục tiêu

1. Rừng + mỏ vàng + mỏ đá **tập trung ở vành rìa** map kingdom 110×110; giữa map để trống cho
   Town Center và khu xây dựng.
2. Node cạn hồi **đầy 100%** sau khoảng chờ **khác nhau theo loại tài nguyên**.
3. Mốc hồi **lưu vào SQLite**, nên node đang cạn vẫn tiếp tục đếm khi server restart thay vì
   đầy ngay lập tức.
4. Tài nguyên **quanh nhà** (woodline + bụi berry tặng kèm Town Center) **không hồi**: chặt/đào
   xong là mất hẳn, buộc người chơi mở rộng ra vành rìa.

Ngoài phạm vi: hồi dần từng giây, loại tài nguyên mới, đổi giá/hiệu ứng gather, đếm ngược trên
HUD.

## 2. Hiện trạng trước phase

| Thứ | Chỗ code cũ | Vấn đề |
| --- | --- | --- |
| Sinh cụm | `worldGeneration.ts` | Tâm cụm random khắp map → rơi cả giữa, rìa thưa |
| Mật độ kingdom | 21 rừng / 10 vàng / 8 đá / 10 berry | ~274 node, thưa |
| Hồi | `RESOURCE_RESPAWN_MS = 90_000` cho mọi loại | Mọi tài nguyên cùng nhịp |
| Mốc hồi | `WorldRoom.resourceRespawnAt` (RAM) | Restart là đầy ngay |

## 3. Quyết định

| Mã | Quyết định |
| --- | --- |
| D1 | Hồi đầy 100% sau delay. Delay theo `resourceType`: `wood 60s`, `food 90s`, `stone 150s`, `gold 240s` (`RESOURCE_REGROW_MS`). |
| D2 | `RESOURCE_REGROW_MS` là nguồn sự thật chung trong `packages/shared`; xoá `RESOURCE_RESPAWN_MS`. |
| D3 | Cụm kingdom chỉ đặt trong vành rìa: cách biên gần nhất 8–22 tile (`KINGDOM_EDGE_BAND_MIN/MAX`), chia đều 4 cạnh (`edgeBandSpots`). Battlefield giữ công thức cũ. |
| D4 | Mật độ kingdom mới: rừng 32 cụm × 9–13 cây, vàng 18 × 4–6, đá 14 × 4–6, berry 14 × 5–7. Đo 10 seed: **406–464 node**. |
| D5 | Mốc hồi lưu ở cột `world_resource_nodes.respawn_at REAL NULL` (epoch ms). Không replicate. |
| D6 | Delta save so cả `remaining_amount` và `respawn_at`; node hồi xong ghi `respawn_at = NULL`. |
| D7 | Restore 3 nhánh: deadline đã qua → hồi ngay; còn hạn → hẹn đúng mốc; `NULL` → `now + delay(type)`. |
| D8 | Migration additive on-boot (`ensureUpgradeColumns`), không xoá dữ liệu, không reset DB. |
| D9 | Node tặng kèm lúc tạo đế (`spawnInitialBase`) mang tiền tố id `res_starter_`; khi cạn thì **xoá khỏi state** thay vì hẹn hồi. Tiền tố nằm trong `id` nên đi theo row DB, không cần cột mới. Save cũ (id `res_<n>`) được nhận diện bằng vị trí: node nằm trong plaza chỉ có thể là node tặng kèm, vì generator bỏ qua plaza. |

## 4. Thay đổi code

| File | Thay đổi |
| --- | --- |
| `packages/shared/src/constants/index.ts` | `RESOURCE_REGROW_MS`; import `ResourceType` |
| `apps/server/src/rooms/worldGeneration.ts` | `edgeBandSpots()` + `clusterSpots()`; `ResourcePlan` mới; tán cây rừng kingdom ±3 |
| `apps/server/src/services/databaseSchema.ts` | DDL thêm `"respawn_at" REAL NULL` |
| `apps/server/prisma/schema.prisma` | `respawnAt Float? @map("respawn_at")` |
| `apps/server/src/services/DatabaseService.ts` | `ensureUpgradeColumns` thêm cột; `saveAllResources` ghi `null`; `saveZoneResources` so thêm `respawnAt`; `saveFullWorldState` nhận `resourceRespawnAt` |
| `apps/server/src/rooms/resources.ts` (mới) | `STARTER_RESOURCE_PREFIX`, `starterResourceId`, `isOneOffResourceNode` (tiền tố id hoặc plaza — nhận diện cả save cũ), `regrowDelayMs` |
| `apps/server/src/rooms/WorldRoom.ts` | `scheduleResourceRespawn` theo loại; node tặng kèm bị xoá khỏi state khi cạn; restore 3 nhánh + bỏ node tặng kèm đã cạn; `autosave` + `onDispose` truyền map mốc hồi |
| `apps/client/src/game/scenes/WorldScene.ts` | `onRemove('resourceNodes')` bỏ chọn + đóng panel nếu node đang được chọn bị xoá |
| `apps/server/src/rooms/EconomySystem.ts` | Cập nhật chú thích: phòng quyết định node cạn có hồi hay bị xoá |

## 5. Test

| Test | File | Nội dung |
| --- | --- | --- |
| Generator ×5 | `rooms/worldGeneration.test.ts` (mới) | Mọi node kingdom cách biên ≤26; có gỗ+vàng ở cả 4 cạnh; không node trên road/plaza; 380–680 node; battlefield vẫn rải giữa |
| Regrow ×3 | `rooms/WorldRoom.test.ts` | Vàng hẹn sau gỗ; quét hồi refill + xoá entry; node biến mất thì xoá entry |
| Restore ×3 | `rooms/WorldRoom.persistence.test.ts` | P7 deadline tương lai giữ node rỗng; P8 deadline quá khứ refill; P9 `null` → hẹn mới |
| Delta ×4 | `services/DatabaseService.test.ts` | R7 ghi deadline; R8 hồi xong `NULL`; R9 chỉ deadline đổi vẫn update; R10 cột tồn tại sau boot lại |
| Starter ×3 | `rooms/WorldRoom.test.ts` | Node `res_starter_*` cạn → mất khỏi state, không hẹn hồi; node plaza của save cũ cũng mất; node vành rìa vẫn hẹn hồi |

## 6. Kiểm chứng đã chạy

```
pnpm --filter @chien-quoc/shared build      # ok
npx tsc --noEmit -p apps/server             # ok
pnpm --filter @chien-quoc/server test       # 199 tests, 15 files pass
pnpm --filter @chien-quoc/client build      # ok
```

## 7. Edge case

| Edge | Xử lý |
| --- | --- |
| Node bị xoá khỏi state khi còn hẹn hồi | `scanResourceRespawns` xoá entry khi node không còn |
| `resource_type` lạ trong row cũ | fallback `RESOURCE_REGROW_MS.wood` |
| Autosave chậm hơn 60 s | không ảnh hưởng: mốc tuyệt đối, không phải countdown |
| Cụm rìa bị road/plaza chặn | mỗi cạnh vẫn có `ceil(count/4)` cụm; `spawnNode` chỉ bỏ node lẻ |
| Cụm rìa bị TC/portal chiếm | TC ở tâm (cách biên 55 tile); portal `(108,54)` (sát mép phải, cập nhật 2026-11-05; trước là `(103,54)`); `clearResourcesInFootprint` dọn node dưới chân công trình |
| Save lỗi giữa chừng | delta save idempotent; lần autosave sau ghi lại |
| Node tặng kèm đã cạn trong save cũ | Bị bỏ khi restore; sweep của `saveZoneResources` xoá row |
| Base bị xoá rồi tạo lại | `spawnInitialBase` chạy lại → tặng woodline/berry mới (đúng ý: đế mới, nguồn khởi đầu mới) |

## 8. Verify tay cần làm

1. Vào kingdom: thấy rừng/mỏ tập trung quanh rìa, giữa map trống cho TC; woodline + berry sát TC
   vẫn có nhưng chặt xong là mất.
2. Chặt hết một cụm rừng gần TC → chờ ~60 s → cây mọc lại đầy.
3. Đào hết một mỏ vàng → chờ ~240 s.
4. Đang chờ hồi, restart server → node vẫn rỗng và tiếp tục đếm.
