# Phase 07 — Kingdom nhỏ hơn + Town Center giữa map

Status: **DRAFT — chờ duyệt**
Ngày ghi plan: 2026-11-03
Phạm vi: `packages/shared`, `apps/server`, `apps/client`, migration dữ liệu SQLite (không đổi
schema `NetworkMessage`, không reset DB).

## 1. Mục tiêu

Hiện tại cả hai map dùng chung một hằng số: `MAP_GRID_WIDTH/HEIGHT = 220`
(`packages/shared/src/constants/index.ts:15-16`). Vì vậy:

- Kingdom của mỗi tài khoản là một map 220×220 rỗng, rộng gấp ~5 lần lượng nội dung một người
  chơi có thể dùng: 1 TC + 3 dân nằm lạc lõng giữa map, camera zoom xa gần như chỉ thấy cỏ.
- Town Center spawn theo hash rải khắp map (`WorldRoom.spawnInitialBase`, fallback mới về gần
  tâm), nên không có cảm giác "vào game là thấy nhà chính của mình".

Phase này:

1. Kingdom riêng mỗi tài khoản nhỏ lại còn **96×96**; battlefield giữ nguyên **220×220**.
2. Vào game (lần đầu hoặc sau migration), **Town Center luôn ở đúng tâm map kingdom** và camera
   mở đúng vào TC.
3. Kích thước map trở thành dữ liệu theo zone (`WorldState.mapWidth/mapHeight`, field đã có
   nhưng hiện chưa ai set/đọc) thay vì hằng toàn cục, để client/server/terrain cùng một nguồn.
4. Không đổi cảm giác battlefield: terrain, mật độ tài nguyên, plot portal giữ nguyên 220.

Ngoài phạm vi: đổi kích thước battlefield, thêm địa hình chặn đường, sông/hồ, đổi art, đổi
travel protocol.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | Kingdom = **96×96**, battlefield = **220×220** (không đổi). |
| D2 | Dữ liệu kingdom cũ (toạ độ theo map 220) **reset một lần**: xoá `buildings` / `units` / `world_resource_nodes` của mọi zone `kingdom:%`, giữ nguyên row `players` (wood/food/gold/stone, level, research). Lần join kế tiếp sinh lại TC + 3 dân ở tâm. |
| D3 | Terrain kingdom rút gọn: **2 tuyến đường chéo** (NW→SE, NE→SW) + **plaza trống bán kính 7 tile ở tâm**; bỏ đại lộ Đông–Tây, trục Bắc–Nam và hub 4 tuyến của battlefield. |
| D4 | TC đặt **đúng tâm**: `x = floor(w/2) - floor(sizeX/2)`, `y = floor(h/2) - floor(sizeY/2)` ⇒ (46, 46) trên map 96. Chỉ lùi khi ô đó bị chiếm (spiral quanh tâm). |
| D5 | Nguồn sự thật kích thước map là `WorldState.mapWidth/mapHeight`; server set trong `onCreate` từ `mapSizeForZone(zoneId)`, client đọc từ room state. |
| D6 | Tài nguyên kingdom scale theo diện tích (~19% mật độ battlefield); không sinh node trên tile đường hoặc trong plaza. |
| D7 | Portal kingdom vẫn cố định ở mép phải, giữa trục dọc; trên map 96 là `(89, 47)` (margin 5, size 2×2). |
| D8 | Không thêm/sửa message nào trong `NetworkMessage`; travel, portal, `travel_transfers` giữ nguyên. Migration chỉ là dữ liệu, không phải thay đổi schema bảng. |

## 3. Hiện trạng — các chỗ hardcode 220 (đối chiếu code)

| Chỗ | File:line | Ghi chú |
| --- | --- | --- |
| Hằng kích thước | `packages/shared/src/constants/index.ts:15-16` | 220 cho mọi map |
| Đường đất + bảng lookup | `packages/shared/src/utils/terrainMath.ts:15-75`, `:81-115`, `:131-142` | Công thức dùng `110` (tâm), `220` (cạnh), cache 1 global |
| Bounds footprint / spawn | `apps/server/src/rooms/WorldRoom.ts:492`, `:553-571` | `isFootprintFree`, `findSpawnNearCenter` |
| Sinh tài nguyên | `apps/server/src/rooms/WorldRoom.ts:575-660` | 85 cụm rừng / 40 vàng / 32 đá / 40 berry, rải theo `MAP_GRID_*` |
| Spawn TC theo hash | `apps/server/src/rooms/WorldRoom.ts:862-889` | `hashPlayerName` + 512 candidate trên `MAP_GRID_WIDTH - 40` |
| Portal | `apps/server/src/rooms/portals.ts:14`, `:56-155`, `:200-215` | `PORTAL_MARGIN`, spot cố định, hash plot battlefield |
| Điểm arrival từ portal | `apps/server/src/rooms/portals.ts:321+` | clamp theo hằng map |
| Command bounds | `apps/server/src/rooms/CommandSystem.ts:160`, `:760-761`, `:852-853` | validate/build/move clamp |
| Pathfinding | `apps/server/src/rooms/MovementSystem.ts:1`, `:179-180`, `:244-261` | `new Pathfinder()` mặc định + blocked grid |
| Camera center | `apps/client/src/game/scenes/WorldScene.ts:450`, `:596` | `gridToScreen(MAP_GRID_WIDTH/2, MAP_GRID_HEIGHT/2)` |
| Terrain client | `apps/client/src/game/render/TerrainLayer.ts:5`, `:38` | `getAllRoadSplinePoints()` không tham số |
| Minimap | `apps/client/src/components/Minimap.tsx:52-53`, `:61-98`, `:196-197` | scale + vẽ lại 4 công thức sin, hardcode `110/210/220` |
| Đặt nhà (client) | `apps/client/src/game/input/PlacementController.ts:41-43` | bounds theo hằng |
| Chuột phải / clamp lệnh (client) | `apps/client/src/game/input/CommandController.ts:516`, `:656-657`, `:691` | bounds theo hằng |
| Test | `apps/server/src/services/terrainMath.test.ts:39-40`, `apps/server/src/rooms/portals.test.ts:74-88`, `apps/server/src/rooms/WorldRoom.test.ts:337`, `apps/server/src/services/Pathfinder.test.ts:151` | giả định 220 |

Kiểm tra trước khi code: `WorldState.mapWidth/mapHeight`
(`apps/server/src/schema/WorldState.ts:16-17`) đã tồn tại và đã replicate, nhưng **không nơi nào
set** — mọi thứ đọc hằng số. Đây là lý do D5 chọn state làm nguồn sự thật thay vì thêm field mới.

## 4. Thiết kế

### 4.1. Shared: kích thước map theo zone

`packages/shared/src/constants/index.ts`:

```ts
export type MapKind = 'kingdom' | 'battlefield';

export interface MapSize {
  width: number;
  height: number;
}

export const KINGDOM_MAP_SIZE: MapSize = { width: 96, height: 96 };
export const BATTLEFIELD_MAP_SIZE: MapSize = { width: 220, height: 220 };

/** Legacy alias kept for the battlefield; new code should use `mapSizeForZone`. */
export const MAP_GRID_WIDTH = BATTLEFIELD_MAP_SIZE.width;
export const MAP_GRID_HEIGHT = BATTLEFIELD_MAP_SIZE.height;

export function mapKindOfZone(zone: string): MapKind {
  return zoneKindOf(zone); // already exists (constants/index.ts:36-38)
}

export function mapSizeForZone(zone: string): MapSize {
  return mapKindOfZone(zone) === 'kingdom' ? KINGDOM_MAP_SIZE : BATTLEFIELD_MAP_SIZE;
}
```

Giữ `MAP_GRID_WIDTH/HEIGHT` trong task 1 để battlefield và các test cũ biên dịch được; các task
sau mới thay dần call site. Cuối phase chỉ còn battlefield dùng alias này.

### 4.2. Terrain tham số hoá theo layout

`packages/shared/src/utils/terrainMath.ts`:

```ts
export interface MapTerrain extends MapSize {
  kind: MapKind;
}

export const TERRAIN_BATTLEFIELD: MapTerrain = { ...BATTLEFIELD_MAP_SIZE, kind: 'battlefield' };
export const TERRAIN_KINGDOM: MapTerrain = { ...KINGDOM_MAP_SIZE, kind: 'kingdom' };

export function terrainForZone(zone: string): MapTerrain;

/** Cached per `${kind}:${width}x${height}`. */
export function getRoadSplinePoints(terrain: MapTerrain): RoadSplinePoint[];

/** O(1) lookup; grid cached per layout. */
export function isDirtRoadTile(gx: number, gy: number, terrain?: MapTerrain): boolean;

/** True inside the kingdom's central plaza (never a road tile). */
export function isPlazaTile(gx: number, gy: number, terrain: MapTerrain): boolean;
```

- `isDirtRoadTile` giữ default `TERRAIN_BATTLEFIELD` để hành vi 220 không đổi; test cũ
  (`roadCount = 2205`, `isDirtRoadTile(110, 110) === true`) vẫn xanh nguyên.
- Battlefield: 4 tuyến + hub giữ **đúng công thức cũ** (không đổi một hằng nào), chỉ đổi nguồn
  `110/220` thành `cx/cy`, `width/height` của layout.
- Kingdom (D3): tâm `cx = width / 2`, `cy = height / 2`, `PLAZA_RADIUS = 7`:
  - NW→SE: `gy = gx + 3 * sin(gx * 0.09)`, `gx ∈ [4, width - 4]`;
  - NE→SW: `gy = (height - 1 - gx) + 3 * sin(gx * 0.07)`, cùng khoảng;
  - bỏ mọi điểm có `hypot(gx - cx, gy - cy) <= PLAZA_RADIUS` ⇒ hai tuyến thành 4 nhánh quanh
    plaza thay vì cắt qua TC.
- `isPlazaTile` là nguồn duy nhất cho cả `isDirtRoadTile` (trả `false` trong plaza) và generator
  tài nguyên. Bán kính 7 so với TC 4×4 đặt ở tâm (góc (46,46), cách tâm ~2.8) đủ chỗ cho TC +
  nhà 2×2 sát cạnh.
- Cache: `Map<string, RoadSplinePoint[]>` và `Map<string, Uint8Array>`; chỉ có tối đa 2 key nên
  không cần LRU. Bảng 96×96 = 9.2 KB (so với 48.4 KB của 220).

### 4.3. Server

**`WorldRoom.onCreate`** (`:241`) — trước `setState`, hoặc ngay sau:

```ts
this.setState(new WorldState());
const size = mapSizeForZone(this.zoneId);
this.state.zoneId = this.zoneId;
this.state.mapWidth = size.width;
this.state.mapHeight = size.height;
```

Sau đó thay mọi `MAP_GRID_WIDTH/HEIGHT` trong room bằng `this.state.mapWidth/mapHeight`
(`isFootprintFree`, `findSpawnNearCenter`, `generateWorldResources`, `spawnInitialBase`).

**`spawnInitialBase`** (D4) — bỏ hoàn toàn nhánh hash + 512 candidate:

```ts
const { width, height } = this.state;
const cx = Math.floor(width / 2) - Math.floor(tcBlueprint.sizeX / 2);
const cy = Math.floor(height / 2) - Math.floor(tcBlueprint.sizeY / 2);
const { x: spawnX, y: spawnY } = this.isSpawnAreaClear(cx, cy, sizeX, sizeY)
  ? { x: cx, y: cy }
  : this.findSpawnNearCenter(sizeX, sizeY);
```

- `findSpawnNearCenter` bắt đầu từ `radius = 4` (thay 8) để lùi ngắn, vẫn deterministic.
- Trước khi đặt, xoá resource node nằm trong footprint (an toàn cho save cũ); plaza đã chặn
  generator nên bình thường không có gì để xoá.
- Giữ nguyên offset cây/berry/dân khởi đầu quanh TC (chúng nằm trong plaza, cố ý — woodline sát
  nhà như AoE).
- `hashPlayerName` vẫn dùng cho màu người chơi (`:797`), không xoá.

**`generateWorldResources`** (D6) — bảng mật độ:

| Loại | Battlefield (220²) | Kingdom (96²) | Ghi chú |
| --- | --- | --- | --- |
| Forest cluster | 85 | 16 | tree/cluster 12–16 → 8–12 |
| Gold vein | 40 | 8 | 3–5 node/cụm giữ nguyên |
| Stone quarry | 32 | 6 | 3–4 node/cụm giữ nguyên |
| Berry grove | 40 | 8 | 4–6 bush/cụm giữ nguyên |

Hệ số 96²/220² = 0.19. Thêm bộ lọc chỉ áp cho kingdom:

```ts
if (terrain.kind === 'kingdom' && (isDirtRoadTile(gx, gy, terrain) || isPlazaTile(gx, gy, terrain))) return;
```

Battlefield giữ nguyên hoàn toàn (kể cả lỗi cũ "node đè lên đường" đã ghi ở phase 05 D8).
Ước lượng node kingdom: ~160 cây + 32 vàng + 21 đá + 40 berry ≈ **253 node** (battlefield ~1.311).

**`portals.ts`** — đọc size từ `state.mapWidth/mapHeight` trong `isPortalFootprintFree`,
`findPortalSpot`, `findKingdomPortalSpot`, `arrivalPoint`. Hệ quả: kingdom portal thành `(89, 47)`;
battlefield plot hash không đổi vì state vẫn 220. `clearPortalResources` giữ nguyên.

**`CommandSystem`** — bounds validate (`:160`, `:760-761`) và clamp điểm đến (`:852-853`) lấy
`this.state.mapWidth/mapHeight`.

**`MovementSystem`/`Pathfinder`** — `MovementSystem` đã nhận `state`, nên:

```ts
private get pathfinder(): Pathfinder {
  this.pathfinderInstance ??= new Pathfinder(this.state.mapWidth, this.state.mapHeight);
  return this.pathfinderInstance;
}
```

Blocked grid cấp phát `new Uint8Array(state.mapWidth * state.mapHeight)`, index
`y * state.mapWidth + x`. Không cần API resize vì mỗi room một map cố định.

### 4.4. Client

**`WorldScene`** — thêm state công khai:

```ts
public mapWidth = MAP_GRID_WIDTH;   // overridden from room state on join
public mapHeight = MAP_GRID_HEIGHT;
```

- `syncMapSize()` đọc `room.state.mapWidth/mapHeight` (guard `> 0`), cập nhật field, gọi
  `terrain.setTerrain(terrainForZone(zoneId))` + `terrain.invalidateViewport()`.
- Gọi từ `bindRoomEvents`/`resetForNewWorld` và từ listener `onChange` của state (map size chỉ
  đến một lần sau join, nên một lần sync là đủ).
- `create` (`:450`) và `centerCameraOnMap` (`:596`) dùng `this.mapWidth/mapHeight`.
- `centerOnOwnBaseIfNeeded` (`:711-722`) đã tự căn theo TC; `resetForNewWorld` reset
  `hasCenteredOnSpawn` (`:645`) nên travel về kingdom là camera về đúng TC. Không cần code mới.

**`TerrainLayer`** — `getRoadSplinePoints(terrain)` thay `getAllRoadSplinePoints()`; thêm
`setTerrain(terrain)` để đổi bộ điểm khi travel mà không dựng lại pool. Pool tile/road stamp vẫn
theo viewport nên map nhỏ không cần đổi kích thước pool.

**`Minimap`** — `scaleX/scaleY` theo `room.state.mapWidth/mapHeight`; bỏ 4 khối vẽ công thức sin
(`:61-98`) và thay bằng một vòng vẽ `getRoadSplinePoints(terrainForZone(zoneId))` sample mỗi
~2 tile. `gridFromEvent` (`:196-197`) chia theo state, không theo hằng — giữ đúng ý nghĩa comment
ở `:188`. Label `VƯƠNG QUỐC` / `CHIẾN TRƯỜNG` giữ nguyên.

**`PlacementController`** (`:41-43`) và **`CommandController`** (`:516`, `:656-657`, `:691`) đọc
`this.scene.mapWidth/mapHeight` thay hằng.

**Zoom** — không đổi `ZOOM_MIN = 0.4`. Trên 96×96 at 0.4 người chơi thấy khoảng ⅓ map, đúng cảm
giác AoE; không thêm logic "fit map". Ghi nhận là điểm cần cảm nhận tay, có thể chỉnh sau.

### 4.5. Migration dữ liệu (một lần)

Thêm bảng meta vào `apps/server/src/services/databaseSchema.ts`:

```sql
CREATE TABLE IF NOT EXISTS "schema_meta" (
  "key"   TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
```

`DatabaseService.bootstrap()` gọi `await this.resetLegacyKingdoms();` sau `ensureZoneColumns()`
(`:99`):

```ts
// One-time data migration: kingdoms used to be laid out on the 220x220 map and
// are now 96x96 with the Town Center at the centre. Coordinates from the old
// layout are not remappable without overlaps, so the layout is reset once; the
// account row (resources, levels, research) is kept.
private static async resetLegacyKingdoms() {
  const done = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
    `SELECT "key" FROM "schema_meta" WHERE "key" = 'kingdom_map_96_v1'`
  );
  if (done.length > 0) return;

  await prisma.$executeRawUnsafe(`DELETE FROM "buildings" WHERE "zone" LIKE 'kingdom:%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "units" WHERE "zone" LIKE 'kingdom:%'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "world_resource_nodes" WHERE "zone" LIKE 'kingdom:%'`);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "schema_meta" ("key", "value") VALUES ('kingdom_map_96_v1', 'done')`
  );
  console.log('🗺️  [DatabaseService] Reset legacy kingdoms onto the 96x96 map.');
}
```

- Không cần đụng `travel_transfers`: unit đang trên đường về kingdom vẫn được materialize quanh
  portal của map mới (portal được tạo lại khi join). Quân đang ở battlefield không bị ảnh hưởng.
- **Không reset DB**: schema bảng không đổi, chỉ thêm bảng meta. Trước khi chạy lần đầu nên copy
  `apps/server/database/dev.db` để có đường lùi.
- Restore phòng thủ: trong `initializeWorldPersistence` (`:380+`), bỏ qua row có
  `gridX/gridY` ngoài `[0, mapWidth/mapHeight)` và log warning — chỉ để không crash nếu ai đó xoá
  `schema_meta` mà để lại dữ liệu cũ.

## 5. Edge cases & rủi ro

| # | Tình huống | Xử lý |
| --- | --- | --- |
| 1 | TC tâm trùng tile đường | Plaza không bao giờ là road tile; test `isDirtRoadTile(48, 48, TERRAIN_KINGDOM) === false` |
| 2 | TC tâm trùng resource node | Generator bỏ qua plaza; `spawnInitialBase` xoá node trong footprint trước khi đặt |
| 3 | Portal cố định (89,47) trùng công trình cũ | Migration xoá toàn bộ công trình kingdom ⇒ không có va chạm |
| 4 | Đang ở battlefield, travel về kingdom | `resetForNewWorld` → `syncMapSize` → `setTerrain` + camera về TC; test tay bắt buộc |
| 5 | F5 vào lại kingdom | `last_zone` + restore; size lấy từ zone, không phụ thuộc localStorage |
| 6 | Room kingdom cũ còn sống khi battle mở | `ZonePersistence` token như cũ, không đổi |
| 7 | Pathfinder/blocked grid cấp phát sai size | Khởi tạo từ `state`, test với room kingdom 96 |
| 8 | Minimap lệch click | scale + `gridFromEvent` cùng đọc state, test tay 2 map |
| 9 | Battlefield đổi hình do refactor terrain | Công thức 220 giữ nguyên; `terrainMath.test` `roadCount 2205` phải vẫn xanh |
| 10 | Mất tiến trình kingdom khi deploy | Đã chốt D2; nhắc backup `dev.db` trong PR/commit message |

Rủi ro chính: (a) quên một call site `MAP_GRID_*` khiến clamp sai ở map 96 (grep lại trước khi
merge); (b) mật độ tài nguyên 96 cần cảm nhận tay — có thể chỉnh bảng §4.3 mà không đổi code;
(c) camera/zoom trên map nhỏ cần chỉnh tay sau khi chạy thật.

## 6. Task / commit

| # | Commit | Nội dung |
| --- | --- | --- |
| 1 | `feat(shared): add per-zone map size and layout-aware terrain roads` | `MapSize`, `mapSizeForZone`, `MapTerrain`, `terrainForZone`, `getRoadSplinePoints`, `isDirtRoadTile(..., terrain)`, `isPlazaTile`; cache theo layout; test terrain 96 |
| 2 | `feat(server): size each room from its zone and clamp simulation bounds` | `onCreate` set `mapWidth/mapHeight`; WorldRoom/portals/CommandSystem/MovementSystem dùng state |
| 3 | `feat(server): spawn the kingdom town center at the map centre` | Bỏ hash spawn, TC tâm, fallback spiral ngắn, xoá node trong footprint |
| 4 | `feat(server): scale kingdom resource clusters to the smaller map` | Bảng mật độ + lọc road/plaza cho kingdom |
| 5 | `feat(server): reset legacy kingdoms onto the smaller map` | `schema_meta`, `resetLegacyKingdoms`, restore bỏ row ngoài bounds |
| 6 | `feat(client): follow the room map size in terrain, camera and minimap` | `WorldScene.mapWidth/mapHeight`, `TerrainLayer.setTerrain`, Minimap theo state, controller bounds |
| 7 | `docs: document the smaller kingdom map` | Cập nhật `docs/plans/README.md` + file này sang IMPLEMENTED |

Thứ tự bắt buộc: 1 → 2 → (3, 4 song song được) → 5 → 6 → 7. Task 5 chỉ chạy sau khi task 2 đã
ship, nếu không kingdom sẽ bị reset rồi vẫn sinh lại trên map 220.

## 7. Verify

Đã chốt Definition of Done chung (`docs/plans/README.md` §"Definition of Done"), cụ thể phase này:

- [ ] `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `pnpm --filter @chien-quoc/server test` xanh — `terrainMath.test` (thêm case 96, case 220
      giữ `roadCount 2205`), `portals.test` (kingdom 96: portal `(89,47)`, arrival trong bounds),
      `WorldRoom.test` (bounds đọc từ state), `Pathfinder.test` (thêm case 96)
- [ ] `pnpm --filter @chien-quoc/client test` xanh
- [ ] Chạy thật, tài khoản mới: kingdom 96×96, TC ở `(46,46)`, portal `(89,47)`, camera mở trên
      TC, HUD/minimap hiện `VƯƠNG QUỐC`
- [ ] Đặt nhà trong plaza quanh TC được; không đặt được ngoài biên 96
- [ ] Travel sang battlefield: vẫn 220×220, không có TC, tài nguyên như cũ, plot portal không đổi
- [ ] Travel về kingdom: map 96, TC vẫn `(46,46)`, không còn sprite/selection của map cũ
- [ ] Minimap 96: click trái pan, click phải ra lệnh đúng ô; đường vẽ khớp world
- [ ] DB: `buildings` kingdom 1 row/account, `world_resource_nodes` zone `kingdom:%` ≈ 253 node,
      `schema_meta` có `kingdom_map_96_v1`
- [ ] Lần boot thứ hai **không** xoá lại kingdom (idempotent)

## 8. Ngoài phạm vi (ghi nhận)

- Battlefield 220 vẫn dùng đại lộ + hub; chưa có kế hoạch đổi.
- Chưa thêm đường nối plaza → portal (D3 chỉ có 2 tuyến chéo). Nếu thấy trống có thể thêm ở phase
  visual sau.
- Chưa đổi `ZOOM_MIN`/auto-fit camera; chờ cảm nhận tay.
- Chưa xử lý trường hợp nhiều kingdom cùng tài khoản (không tồn tại theo thiết kế phase 04).
