# Phase 22 — Người chơi tự xây đường trong Vương quốc

Status: **IMPLEMENTED** (2026-11-06). Server + client + tests xanh.
Phạm vi: `packages/shared`, `apps/server`, `apps/client`, DB.

## 1. Mục tiêu

Map `kingdom` (110×110) trước đây có 2 đường chéo sinh tự động, hard-code trong
`packages/shared/src/utils/terrainMath.ts` (`kingdomDiagonalY` /
`kingdomCounterDiagonalY`). Phase này:

- **Bỏ** toàn bộ đường mặc định ở kingdom; battlefield giữ nguyên.
- Cho người chơi **kéo vẽ** đường của mình, **2 gỗ/ô**, **+30% tốc độ** khi unit đứng trên ô
  đường, **chặn xây nhà đè đường**, **xoá được** (không hoàn gỗ), **lưu SQLite**.

Quyết định đã chốt:

| Hạng mục | Giá trị |
| --- | --- |
| Phạm vi | `kingdom` only |
| Cách xây | drag paint (Bresenham giữa 2 pointer sample) |
| Chi phí | 2 gỗ / ô (`ROAD_COST_PER_TILE`) |
| Hiệu ứng | `ROAD_SPEED_MULTIPLIER = 1.3` |
| Xây nhà đè đường | chặn (`RejectCode.PLACEMENT`) |
| Kết nối | tự do, không bắt buộc nối vào đường khác |
| Xoá | được, không hoàn gỗ, chỉ đường của mình |
| Lưu trữ | bảng `world_roads`, theo `zone` |

## 2. Shared

`packages/shared/src/utils/terrainMath.ts`:

- `computeIsDirtRoadTile` → `false` cho kingdom.
- `getRoadSplinePoints` → `[]` cho kingdom (cache giữ nguyên).
- Xoá `kingdomDiagonalY` / `kingdomCounterDiagonalY`.
- `isPlazaTile` giữ nguyên: plaza vẫn dùng cho spawn/resource.

`packages/shared/src/constants/index.ts`:

```ts
ROAD_COST_PER_TILE = 2
ROAD_SPEED_MULTIPLIER = 1.3
MAX_ROAD_TILES_PER_MESSAGE = 200
MAX_ROADS_PER_ZONE = 4000
roadTileKey(gx, gy) // "<gx>,<gy>"
```

`packages/shared/src/types/index.ts`: `RoadTilePayload`, `PlaceRoadPayload`,
`RemoveRoadPayload`, `NetworkMessage.PLACE_ROAD` / `REMOVE_ROAD`.

## 3. Server

- `apps/server/src/schema/RoadState.ts` — `id`, `ownerId`, `gridX`, `gridY`.
  `WorldState.roads` là `MapSchema<RoadState>`.
- `apps/server/src/rooms/roads.ts` — `RoadGrid` (1 byte/ô, rebuild khi `roads.size` đổi),
  `isRoad`, `roadAt`, `invalidate`, `footprintTouchesRoad`.
- `CommandSystem`:
  - `handlePlaceRoad`: chỉ kingdom; chuẩn hoá tile (integer, dedupe, bỏ ngoài biên và
    margin 6); bỏ ô đã có đường/nhà/resource; cap message và cap zone; kiểm tra tổng gỗ
    trước khi trừ; trừ gỗ và tạo `RoadState` cho từng ô.
  - `handleRemoveRoad`: chỉ kingdom; chỉ xoá ô có `ownerId` của client; không hoàn gỗ.
  - `handlePlaceBuilding`: chặn footprint chạm ô đường.
- `WorldRoom`:
  - listener `PLACE_ROAD` / `REMOVE_ROAD`.
  - `compute` tốc độ: `speed = onRoad ? unit.speed * ROAD_SPEED_MULTIPLIER : unit.speed`
    (không thêm field replicated; `unit.speed` vẫn là giá trị blueprint cho animation).
  - `initializeWorldPersistence` load `DatabaseService.loadRoads(zone)` và lọc `fitsMap`.
- `portals.ts`: `isPortalFootprintFree` coi đường người chơi là vật cản (portal kingdom đã
  truyền `ignoreRoads: true` nên vẫn đặt được).
- Đường **không** vào blocked grid: đi được, không phải vật cản pathfinding.

## 4. Persistence

- `prisma/schema.prisma`: model `WorldRoad` (`@@unique([zone, gridX, gridY])`, `@@index([zone])`).
- `databaseSchema.ts`: DDL `world_roads` + unique/index idempotent.
- `DatabaseService.loadRoads(zone)`, `saveZoneRoads(zone, roads, stmts)` — diff insert/delete,
  không update (một ô là có hoặc không).
- `saveFullWorldState` gọi `saveZoneRoads` sau resources.
- `savePlayerEmpire` / `saveZonePlayerEntities` **không** đụng đường: đường thuộc zone, không
  thuộc player, nên leave/travel không xoá đường.

## 5. Client

- `TerrainLayer.setPlayerRoads(tiles)`: pool ảnh `tile_dirt_1..3`, mỗi ô 1 quad, tint nhẹ theo
  hash toạ độ; depth `-99995` (dưới stamp battlefield).
- `WorldScene.refreshPlayerRoads()` + `onAdd/onRemove('roads')`; `DecorLayer.collectBlocked()`
  thêm tile đường để cỏ/hoa không mọc trên đường.
- `buildGroundPixels(terrain, roads?)` (minimap) vẽ thêm tile đường người chơi;
  `Minimap.tsx` cache ground theo signature `size:hash` (giới hạn 8 entry).
- `apps/client/src/game/input/roadPaint.ts`: `lineTiles` (Bresenham, chặn input non-finite),
  `appendTiles`, `batchTiles` — thuần, có test.
- `RoadController`: mode `build` / `erase`, stroke tích luỹ khi kéo, ghost hình thoi xanh/đỏ,
  commit chia batch `MAX_ROAD_TILES_PER_MESSAGE`.
- `WorldScene`: `setRoadMode` / `cancelRoadMode` / `roadMode`; nhánh road đứng trước placement
  và box-select ở pointer down/move/up, touch press/tap/drag, và `resetForNewWorld`.
- `CommandController`: hotkey `X` bật/tắt (chỉ kingdom, cần villager selected trừ khi đang mở);
  `Escape` huỷ road mode trước placement.
- `BuildMenu`: nút "Đường" (`Route`) + "Xoá" (`Eraser`) khi `showRoadTools`; tooltip ghi 2 gỗ/ô.
- `App.tsx`: `roadMode` state, `handleSelectRoad`, hai mode loại trừ nhau; `PhaserGame`
  truyền `onRoadModeChange`.

## 6. Tests

- `packages/shared` (qua server `terrainMath.test.ts`): kingdom không còn road tile; plaza giữ.
- `WorldRoom.roads.test.ts`: giá gỗ, thiếu gỗ, battlefield, cap message, cap zone, bỏ ô bị chiếm,
  input rác, chặn xây nhà đè đường, xoá chỉ đường của mình, không hoàn gỗ, tốc độ trên đường.
- `roadPaint.test.ts`: Bresenham, dedupe, batch, input non-finite.
- `minimapArt.test.ts`: kingdom mặc định không có pixel đường; có `roads` thì đổi màu.

## 7. Ghi chú

- Kingdom cũ có 2 đường chéo tĩnh: sau deploy chúng biến mất (đúng ý định), không migrate.
- `09-road-and-gate-assets.md` (art stamp đường) giờ chỉ áp dụng cho battlefield.
