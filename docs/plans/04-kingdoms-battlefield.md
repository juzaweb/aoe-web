# Phase 04 — Kinh thành riêng + Chiến trường chung

Status: IMPLEMENTED — chờ verify tay đầy đủ trên UI.

## 1. Mục tiêu

Trước phase này, toàn bộ game chạy trong một `world_room` 220×220 dùng chung: nhà của mọi
người nằm trên cùng một map và ai cũng có thể đi vào đánh nhau. Phase 04 tách thành:

- **Kinh thành (kingdom)**: map riêng của từng tài khoản, an toàn tuyệt đối, giữ nguyên lối
  chơi cũ ( Town Center, dân, khai thác, xây dựng, train lính).
- **Chiến trường (battlefield)**: một map chung duy nhất, có tài nguyên thiên nhiên, nơi người
  chơi mang quân/dân sang tự xây căn cứ tiền phương, tranh tài nguyên và phá công trình đối
  phương.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | Mỗi tài khoản một kingdom room riêng; một battlefield room chung. |
| D2 | Cổng cố định, chuyển cả màn hình (đổi room), không dùng march timer. |
| D3 | Chỉ đơn vị đang được chọn đi qua cổng; số còn lại ở lại. |
| D4 | Chiến trường không có căn cứ sẵn; người chơi tự xây. |
| D5 | Công trình ở chiến trường tồn tại lâu dài, bị đánh được kể cả khi chủ offline. |
| D6 | "Cướp" = tranh mỏ/rừng chung, giết dân đang khai thác/chở hàng, phá công trình đối phương. Không có loot pool, không trừ kho chủ khi phá nhà. |
| D7 | Kingdom an toàn tuyệt đối: không ai vào được; PvP chỉ ở chiến trường. |
| D8 | Cổng dùng sprite có sẵn (`building_TOWER`) + tint tím làm placeholder; không vẽ art mới. Cổng kingdom cố định ở mép phải map; cổng cũ được dời sang vị trí này ở lần join kế tiếp. |

## 3. Kiến trúc

| Room | Class | Zone | Restore | Spawn |
| --- | --- | --- | --- | --- |
| `kingdom_room` | `KingdomRoom` | `kingdom:<ownerId>` | resource + entity của đúng owner + zone | TC + 3 villager + cổng cố định ở mép phải map |
| `battlefield_room` | `BattlefieldRoom` | `battlefield` | resource + toàn bộ entity của zone | Không base; cổng tạo lazy theo owner |

- `gameServer.define('kingdom_room', KingdomRoom).filterBy(['ownerId'])`.
  `KingdomRoom.onAuth` kiểm tra `options.ownerId === authUser.userId`; `filterBy` chỉ là
  matchmaking, không phải authorization.
- `gameServer.define('battlefield_room', BattlefieldRoom)`.
- `WorldRoom` vẫn là base class; các hook `resolveOwnerScope`, `resolveZoneId`,
  `canJoinOwner`, `spawnZoneContent` cho phép hai subclass mô tả khác biệt mà không rải
  `if (kind === ...)` khắp nơi.

## 4. Protocol travel

- `TRAVEL { portalId, unitIds }` → server validate portal của chính mình, unit thuộc owner,
  `<= MAX_TRAVEL_UNITS`, và cooldown.
- Server commit một transaction:
  1. upsert `players` (resource/research + `last_zone`);
  2. xoá row `units` khỏi zone nguồn;
  3. insert `travel_transfers` (JSON snapshot id/type/level/hp/maxHp/speed).
- Sau commit, server mới xoá unit khỏi state RAM và gửi `TRAVEL_READY
  { transferId, destination, roomName }`.
- Client nhận ack, gửi leave room cũ (không chờ save xong) rồi join room đích ngay; server
  dùng handoff token để room đích nhận phiên. Room cũ chỉ lưu entity (không ghi lại account
  row) để tránh đè resource của map mới. Scene giữ frame bản đồ cũ (freeze) trong lúc chờ.
- Room đích gọi `consumeTravelTransfers` trong `onJoin`, tạo lại unit quanh cổng với **đúng id
  cũ**, rồi xoá transfer row.

Nhờ thứ tự này, mất mạng giữa chừng chỉ để quân nằm an toàn trong `travel_transfers`; lần vào
sau sẽ nhận lại. Không có trường hợp nhân đôi hoặc mất quân.

## 5. Persistence theo zone

- Cột `zone` cho `buildings`, `units`, `world_resource_nodes`; `last_zone` cho `players`;
  bảng `travel_transfers`.
- Mọi sweep (`deleteMany`) đều có `zone` trong `where`:
  - `savePlayerEmpire(player, buildings, units, zone)` → chỉ xoá row của owner **trên zone đó**.
  - `saveFullWorldState(state, zone)` → sweep toàn zone, gồm cả entity của owner offline.
- `EntityIdAllocator` toàn cục thay `nextEntityId` per-room: id là primary key dùng chung cho
  mọi zone, nên hai room không được mint trùng `b_1001`.
- `ZonePersistence` cấp token cho room mới nhất của mỗi zone; `onDispose` của room cũ bỏ qua
  save nếu đã bị thay thế.
- `AccountSessionCoordinator` là singleton process-wide, đóng session cũ ở đúng room khi
  takeover, kể cả khi session đó đang ở map khác.
- `ZonePersistence` token được kiểm tra ở `onJoin`, autosave, leave và dispose: room cũ không
  thể ghi đè map đã bị room mới nhận.
- Travel cooldown dùng map theo account (không reset khi đổi room), và điểm arrival tránh
  footprint công trình đặt dưới cổng.
- Population là account-wide: mỗi room load `populationElsewhere` /
  `populationCapElsewhere` từ DB và refresh trước mỗi autosave.

## 6. Migration

Chạy tự động lúc boot, idempotent (`DatabaseService.ensureZoneColumns`):

```sql
UPDATE buildings SET zone = 'kingdom:' || owner_id WHERE zone = 'world';
UPDATE units     SET zone = 'kingdom:' || owner_id WHERE zone = 'world';
DELETE FROM world_resource_nodes WHERE zone = 'world';
```

Empire cũ được giữ nguyên và chuyển vào kingdom của chủ. Tài nguyên thế giới cũ bị xoá và sinh
lại theo zone. Không cần reset DB; nếu reset thì mọi thứ sinh lại như mới.

## 7. Tài nguyên cạn

Node cạn **không bị xoá** khỏi state/DB. `remainingAmount = 0`, client ẩn sprite, room hẹn
refill theo loại tài nguyên và hiện lại khi đầy.

> **Phase 20 thay thế hành vi này**: delay theo `resourceType` (`RESOURCE_REGROW_MS`) và mốc hồi
> được lưu vào `world_resource_nodes.respawn_at`, nên restart không còn refill ngay. Xem
> [`20-kingdom-resource-density-regrow.md`](./20-kingdom-resource-density-regrow.md).

## 8. Client

- `App.tsx` giữ một SDK `Client`, join kingdom với `{ ownerId, force }` hoặc battlefield với
  `{ force }`. Lưu map cuối trong `localStorage` theo `userId` để F5 vào đúng map.
- `WorldScene.resetForNewWorld()` dọn toàn bộ sprite, selection, control group, bookmark và
  camera khi `room.roomId` đổi. `PhaserGame` được giữ mounted trong lúc chuyển map để scene
  reset thay vì dựng lại Phaser.
- UX cổng:
  - chuột phải vào cổng của mình khi đang chọn quân → mang đúng selection theo;
  - click trái cổng → panel có nút "Đi tới chiến trường"/"Về vương quốc" (đi một mình);
  - HUD và minimap hiển thị `VƯƠNG QUỐC` / `CHIẾN TRƯỜNG`.
- Cổng không nằm trong build menu, không upgrade, không bị chọn làm target.

## 9. Task / commit

| # | Commit |
| --- | --- |
| 1 | `feat(shared): add portal building and travel protocol types` |
| 2 | `feat(server): add zone columns, travel transfers and zone-scoped persistence` |
| 3 | `refactor(server): add a process-wide entity id allocator` |
| 4 | `feat(server): share the account session gate across rooms` |
| 5 | `refactor(server): split WorldRoom into kingdom and battlefield rooms` |
| 6 | `feat(server): create fixed portals and untargetable building rules` |
| 7 | `feat(server): add cross-map travel with unit transfers` |
| 8 | `feat(client): switch rooms on travel and fully reset the scene` |
| 9 | `feat(server): respawn resources and hide depleted nodes` |
| 10 | `docs: document kingdom and battlefield architecture` |

## 10. Verify

Đã chạy:

- `tsc --noEmit` sạch cho `apps/server` và `apps/client`.
- `vitest run` sạch: server 137 test, client 60 test.
- E2E qua browser SDK thật:
  - Kingdom: `zoneId = kingdom:<id>`, có TC + PORTAL, 3 villager.
  - Gửi TRAVEL 2 villager → nhận `TRAVEL_READY`, join battlefield, 2 unit xuất hiện cạnh cổng
    với đúng id, kingdom còn 1 villager.
  - Travel ngược → kingdom restore TC + PORTAL, đủ 3 villager, resource giữ nguyên.
  - DB: `buildings` 1 battlefield/2 kingdom, `units` 3 kingdom/0 battlefield,
    `travel_transfers` rỗng, resource tách đúng zone.

Đã verify thêm bằng Chrome headless có WebGL (tài khoản test riêng):

- Kingdom render terrain + TC + dân; cổng ở toạ độ `(213, 109)` (mép phải, giữa trục dọc).
- Click/chuyển bằng `TRAVEL`: battlefield render portal tower tím + dân, HUD sang CHIẾN TRƯỜNG.
- Quay về: kingdom render lại TC + cổng + đủ dân, không exception/console error.
- Trong lúc chờ join, scene giữ frame bản đồ cũ (freeze) và overlay trong suốt, không còn canvas
  đen; resource node được tạo theo frame (80/frame) thay vì block một lần.

Còn cần verify tay: nhiều tài khoản cùng lúc trên battlefield và cảm giác chuyển map trên máy
có GPU thật.
