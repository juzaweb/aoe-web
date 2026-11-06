# Phase 23 — Bản đồ thế giới + tập kích vương quốc

Status: **DRAFT** — chờ duyệt. Chưa có dòng code nào.

Phạm vi: `packages/shared`, `apps/server`, `apps/client`, DB. Không đụng art/terrain.

## 1. Mục tiêu

Thay cổng "ra chiến trường chung" bằng một vòng chơi PvP có mục tiêu rõ:

1. **Bỏ cổng ra chiến trường** khỏi vương quốc; chiến trường chung bị ẩn hoàn toàn
   (code còn, không vào được).
2. Thêm **bản đồ thế giới** dạng overlay: liệt kê các nước trong vòng **±5 cấp Nhà chính**.
3. Người chơi chọn quân → chọn một nước → **tập kích ngay**: quân sang vương quốc nước đó,
   PvP thật; chủ nhà online thì tự điều quân chống.
4. Trận kết thúc khi **Nhà chính chủ nhà còn ≤ 25% máu** (không phá được nhà), khi người tấn
   công **rút qua cổng**, hoặc khi **hết quân**.
5. Thắng thì cướp **20%/loại tài nguyên** (có trần); thua thì **3 ngày** không được đánh lại
   nước đó; nước bị đánh nhận **khiên 72 giờ**.

### Vì sao bỏ chiến trường

Chiến trường 220×220 chung là một bãi đất trống: không có mục tiêu, không có lý do giữ căn cứ,
và mọi tương tác PvP đều là "gặp nhau giữa đồng". Đưa trận đánh vào **vương quốc của người
khác** làm mỗi trận có đích (Nhà chính), có tài sản để mất (nhà, quân), và có lý do xây tháp.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| R1 | Chiến trường: `keep_hidden`. `BattlefieldRoom` giữ file nhưng **không** `gameServer.define`; kingdom **không** sinh cổng ra chiến trường; `TRAVEL` bị từ chối. |
| R2 | "Cấp của nước" = **cấp Nhà chính** (1–10). Vòng lân cận: `\|level_a − level_b\| ≤ 5`. Ghi chú: cap 10 khiến vòng này gần như toàn server — đây là lựa chọn của chủ dự án, chấp nhận. |
| R3 | Bản đồ thế giới là **overlay React**, không phải room Colyseus mới. |
| R4 | Tập kích **tức thời**: không march timer, chuyển room ngay sau khi server commit. |
| R5 | Kết quả: cướp tài nguyên + phá quân/công trình vĩnh viễn. |
| R6 | Không giới hạn số trận/ngày. **Thua** thì khoá cặp (attacker → defender) **3 ngày**. Defender luôn có **khiên 72 giờ** sau một trận. |
| R7 | Nhà chính **không phá được**. Điều kiện thắng: HP Nhà chính chủ nhà ≤ **25%** `maxHp`. |
| R8 | Rút quân bằng **cổng riêng** đặt trong vương quốc địch (tái dùng `ensurePortalFor`). |
| R9 | Tối đa **120 quân**/trận (`MAX_TRAVEL_UNITS`). |
| R10 | Chủ nhà online **đánh trả được** — PvP thật, hai tài khoản chung một phòng. |
| R11 | Danh sách nước = tài khoản **đã có Nhà chính**; không có khiên bảo vệ tài khoản mới. |
| R12 | Bố cục bản đồ: **lục giác**, vị trí cố định sinh từ hash `userId`. |
| R13 | Cướp 20%/loại, trần **2.000**/loại/trận, tính trên số dư defender lúc kết thúc. |
| R14 | Người tấn công **không** được xây/nâng cấp/đặt đường/khai thác trong vương quốc địch; chỉ có lệnh quân sự. |

## 3. Hiện trạng (đối chiếu code)

| Thứ đã có | Chỗ code | Dùng lại thế nào |
| --- | --- | --- |
| Vương quốc riêng mỗi tài khoản, `filterBy(['ownerId'])` | [`KingdomRoom.ts`](../../apps/server/src/rooms/KingdomRoom.ts) | Nới cho raider vào qua `raidId`. |
| Cổng `PORTAL` + `ensurePortalFor` + `arrivalPoint` | [`portals.ts`](../../apps/server/src/rooms/portals.ts) | Tái dùng làm **cổng rút quân** của raider. |
| Chuyển quân giữa hai zone, `travel_transfers` | `DatabaseService.commitTravel` | Không dùng nữa cho travel; mẫu transaction để học theo. |
| Persistence theo zone, `ZonePersistence`, autosave | [`WorldRoom.ts`](../../apps/server/src/rooms/WorldRoom.ts) | Giữ nguyên; raid diễn ra trong `kingdom:<defenderId>`. |
| Combat có chủ sở hữu, `attackable: false` cho cổng | [`CombatSystem.ts`](../../apps/server/src/rooms/CombatSystem.ts) | Thêm guard ngưỡng HP Nhà chính. |
| Cảnh báo bị tấn công (banner + ping) | [`WorldScene.ts`](../../apps/client/src/game/scenes/WorldScene.ts) | Tự chạy khi defender bị đánh. |

| Thứ còn thiếu | Hệ quả |
| --- | --- |
| Khái niệm "nước" / danh sách đối thủ | Không có màn hình nào để chọn mục tiêu |
| Bảng trận đấu, khiên, khoá cặp | Không có chỗ kiểm soát ai đánh được ai |
| Đường cho người lạ vào phòng vương quốc | `onAuth` chặn mọi `ownerId` khác |
| Quy tắc kết thúc trận và cướp | Trận sẽ kéo dài vô tận |

## 4. Mô hình dữ liệu

### 4.1 Bảng mới

```sql
-- Một trận đang diễn ra hoặc đã kết thúc.
CREATE TABLE IF NOT EXISTS "raids" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "attacker_id" TEXT NOT NULL,
  "defender_id" TEXT NOT NULL,
  -- ACTIVE | ATTACKER_WON | DEFENDER_WON | RETREATED
  "status"      TEXT NOT NULL,
  "units"       TEXT NOT NULL,
  "loot"        TEXT NOT NULL DEFAULT '{}',
  "started_at"  DATETIME NOT NULL,
  "ended_at"    DATETIME NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "raids_one_active_per_defender"
  ON "raids"("defender_id") WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "raids_pair_idx"
  ON "raids"("attacker_id", "defender_id", "status");

-- Khoá cặp sau khi người tấn công thua (R6).
CREATE TABLE IF NOT EXISTS "raid_locks" (
  "attacker_id" TEXT NOT NULL,
  "defender_id" TEXT NOT NULL,
  "unlock_at"   REAL NOT NULL,
  PRIMARY KEY ("attacker_id", "defender_id")
);
```

Unique index có `WHERE status = 'ACTIVE'` là **partial index**, SQLite hỗ trợ. Nó bảo đảm một
nước không bao giờ bị hai người đánh cùng lúc, kể cả khi hai request `POST /raid/start` đến
cùng mili-giây.

### 4.2 Cột mới trên `players`

```sql
ALTER TABLE "players" ADD COLUMN "shield_until" REAL NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN "town_center_level" INTEGER NOT NULL DEFAULT 1;
```

- `shield_until` — epoch ms, hết khiên thì 0.
- `town_center_level` — **cache** cấp Nhà chính cao nhất đã xây xong. Nhờ nó `GET /world-map`
  không phải join `buildings` cho mọi tài khoản. Ghi lại mỗi lần autosave/leave/settle.
  Giá trị `0` = chưa có Nhà chính → không xuất hiện trên bản đồ.

### 4.3 Prisma

Thêm `model Raid`, `model RaidLock`, hai cột trên `Player`; mirror DDL vào
[`databaseSchema.ts`](../../apps/server/src/services/databaseSchema.ts) và thêm
`ensureRaidColumns()` idempotent (cùng kiểu `ensureUpgradeColumns`), chạy trong
`DatabaseService.bootstrap()`.

## 5. Shared

### 5.1 Hằng số

```ts
// packages/shared/src/constants/index.ts
export const RAID_MAX_UNITS = MAX_TRAVEL_UNITS;              // 120
export const RAID_MIN_UNITS = 1;
export const RAID_LEVEL_RANGE = 5;                            // ±5 cấp Nhà chính
export const RAID_SHIELD_MS = 72 * 60 * 60 * 1000;            // 72 giờ
export const RAID_LOSS_LOCK_MS = 72 * 60 * 60 * 1000;         // 3 ngày
export const RAID_LOOT_PERCENT = 0.2;
export const RAID_LOOT_CAP_PER_RESOURCE = 2000;
export const RAID_TOWN_CENTER_HP_THRESHOLD = 0.25;            // 25%
export const RAID_DEFAULT_RETREAT_TIMEOUT_MS = 30 * 60 * 1000; // 30 phút
```

### 5.2 Hàm thuần (`packages/shared/src/utils/raid.ts`)

Test được, không phụ thuộc DB:

```ts
isRaidLevelInRange(a: number, b: number): boolean
computeRaidLoot(defender: Resources): Resources      // 20%, trần 2000/loại, floor
raidOutcomeOf(townCenterHpRatio: number): 'ATTACKER_WON' | 'ONGOING'
hexPositionOf(userId: string): { q: number; r: number }  // hash → axial cố định
```

`hexPositionOf` dùng hash FNV-1a 32-bit trên `userId` rồi ánh xạ vào lưới hex bán kính 12.
Vị trí **cố định theo tài khoản**, nên hai người cùng thấy một nước ở cùng một ô.

### 5.3 Type & message

```ts
// packages/shared/src/types/index.ts
export type RaidOutcome = 'ATTACKER_WON' | 'DEFENDER_WON' | 'RETREATED';

export interface WorldMapEntry {
  userId: string;
  name: string;
  color: string;
  townCenterLevel: number;
  /** 0 khi không bị khiên. */
  shieldUntil: number;
  /** 0 khi không bị khoá. */
  lockedUntil: number;
  canAttack: boolean;
  blockReason?: string;
}

export interface WorldMapPayload {
  self: { userId: string; townCenterLevel: number };
  neighbors: WorldMapEntry[];
}

export interface RaidStartResponse {
  raidId: string;
  defenderId: string;
  roomName: 'kingdom_room';
}

export interface RaidEndedPayload {
  outcome: RaidOutcome;
  loot: Resources;
  returnRoom: 'kingdom_room';
}

// NetworkMessage
RAID_RETREAT = 'RAID_RETREAT',
RAID_ENDED = 'RAID_ENDED'
```

**Vì sao thêm 2 message mới** (theo checklist `docs/plans/README.md`): không message nào có sẵn
mang nghĩa này. `TRAVEL` là "đi sang map khác", `RAID_RETREAT` là "đóng trận, trả quân về nhà và
khoá cặp" — dùng lại `TRAVEL` sẽ khiến server không phân biệt được ý định rút quân với một lần
chuyển map thông thường, và client cũ gửi `TRAVEL` phải bị từ chối chứ không được settle trận.
`RAID_ENDED` là ack server→client một chiều, khác hẳn `ERROR_NOTIFICATION` và
`SYSTEM_ANNOUNCEMENT` (hai message này chỉ chở text).

## 6. Server

### 6.1 Bỏ cổng ra chiến trường

| File | Thay đổi |
| --- | --- |
| [`WorldRoom.ts`](../../apps/server/src/rooms/WorldRoom.ts) | `spawnInitialBase` **bỏ** lời gọi `ensurePortalFor(...)`. Handler `TRAVEL` → từ chối `RejectCode.FORBIDDEN` "Chiến trường đã đóng." |
| [`index.ts`](../../apps/server/src/index.ts) | Bỏ `gameServer.define('battlefield_room', BattlefieldRoom)`. |
| [`BattlefieldRoom.ts`](../../apps/server/src/rooms/BattlefieldRoom.ts) | Giữ file, thêm comment "hidden: no longer registered". |
| [`portals.ts`](../../apps/server/src/rooms/portals.ts) | Giữ. `ensurePortalFor` **chỉ** gọi cho raider khi vào vương quốc địch. |

Client cũ gửi `TRAVEL` nhận thông báo rõ ràng thay vì im lặng. Không xoá
`TravelPayload`/`travel_transfers` trong phase này: dữ liệu cũ còn trong DB, xoá cột/bảng là
việc của một migration riêng.

### 6.2 `RaidService` (`apps/server/src/services/RaidService.ts`, mới)

| Hàm | Việc |
| --- | --- |
| `listNeighbors(ownerId)` | Đọc cấp TC của mình, `findMany` các `players` có `town_center_level > 0` và `abs(Δ) ≤ 5`, bỏ chính mình; ghép `raids`/`raid_locks` để tính `canAttack` + `blockReason`. |
| `startRaid({ attackerId, defenderId, unitIds })` | Một transaction: validate lại (cấp, khiên, khoá, không tự đánh mình, chưa có raid ACTIVE trên defender, 1..120 quân, quân thuộc attacker và đang ở `kingdom:<attackerId>`) → `UPDATE units SET zone='kingdom:<defenderId>'` với toạ độ chờ → `INSERT raids`. |
| `settleRaid({ raidId, outcome })` | Transaction: tính loot, trừ defender/cộng attacker, đặt `shield_until = now + 72h`, `raids.status/ended_at`, `INSERT OR REPLACE raid_locks` khi thua, chuyển quân sống về `kingdom:<attackerId>`, xoá hàng quân đã chết. |
| `retreatUnits(raidId, attackerId)` | Gọi `settleRaid(outcome='RETREATED')`. Idempotent. |
| `syncTownCenterLevel(ownerId, level)` | Cập nhật cache sau autosave/settle. |
| `reconcileStaleRaids()` | Lúc boot: raid `ACTIVE` quá `RAID_DEFAULT_RETREAT_TIMEOUT_MS` → settle `RETREATED`. Khoá/zone không bị kẹt vĩnh viễn sau restart. |

Toạ độ chờ khi chuyển quân: mép phải vương quốc (nơi `ensurePortalFor` sẽ đặt cổng). Room sẽ
dời quân vào đúng `arrivalPoint` khi join, nên DB chỉ cần một điểm hợp lệ trong map.

### 6.3 `KingdomRoom` mở cho quân tập kích

```ts
static async onAuth(token, options): Promise<RoomAuth> {
  const auth = await super.onAuth(token);
  // Có raidId thì chưa xác minh sâu ở đây (static, không có room state);
  // onJoin đọc DB và xác minh tuyệt đối.
  if (typeof options?.raidId === 'string' && options.raidId.length > 0) return auth;
  // Luật cũ: chỉ được vào vương quốc của chính mình.
  if (options?.ownerId !== auth.userId) throw new ServerError(...);
  return auth;
}
```

- `onJoin` override: nếu có `raidId`, đọc `raids` và yêu cầu
  `status === 'ACTIVE' && attackerId === auth.userId && defenderId === options.ownerId`;
  sai → `ServerError(AUTH_FAILED)`. Lưu lại `this.raidId`, `this.raidAttackerId`.
- `canJoinOwner(ownerId)`: `ownerId === this.ownerScope || ownerId === this.raidAttackerId`.
- **Không spawn base cho raider**: `spawnZoneContent` chỉ chạy khi `ownerId === this.ownerScope`.
- Raider vào phòng → `ensurePortalFor(this.state, raiderId)` tạo cổng rút quân.
- `onCreate` đọc raid `ACTIVE` của defender (nếu có) để nối lại phiên đang dở sau restart.

### 6.4 Chặn quyền "kinh tế" của raider (R14)

Thêm một guard dùng chung, ví dụ `CommandSystem.requireZoneOwner(client)`:

| Cho phép | Từ chối (`RejectCode.FORBIDDEN`) |
| --- | --- |
| `MOVE_UNITS`, `ATTACK_TARGET`, `ATTACK_MOVE`, `PATROL`, `STOP_UNITS`, `SET_STANCE` | `PLACE_BUILDING`, `PLACE_ROAD`, `REMOVE_ROAD`, `UPGRADE_BUILDING`, `CANCEL_BUILDING`, `CANCEL_BUILDING_UPGRADE`, `UPGRADE_UNIT_TYPE`, `CANCEL_UNIT_UPGRADE`, `TRAIN_UNIT`, `CANCEL_TRAIN`, `SET_RALLY_POINT`, `HARVEST_RESOURCE`, `BUILD_TARGET` |

Lý do: nếu raider khai thác được mỏ của chủ nhà thì loot 20% mất nghĩa, và nếu xây được thì
họ biến vương quốc người khác thành thuộc địa. Client ẩn nút build/harvest khi đang trong trận.

### 6.5 Vòng tick của trận

Trong `WorldRoom.update`, chỉ khi `this.raidId`:

1. Không còn unit nào của attacker → `DEFENDER_WON`.
2. Không còn Nhà chính của defender → `DEFENDER_WON` (không xoá gì thêm).
3. `tc.hp / tc.maxHp <= 0.25` → `ATTACKER_WON`.
4. Quá `RAID_DEFAULT_RETREAT_TIMEOUT_MS` → `RETREATED`.
5. Mọi nhánh đều đi qua `settleRaid` **một lần**; cờ `raidSettling` chặn gọi lặp trong lúc
   transaction đang chạy.
6. Sau settle: gửi `RAID_ENDED` cho attacker (và `SYSTEM_ANNOUNCEMENT` cho defender), rồi
   attacker client rời phòng, join lại `kingdom_room` của mình.

Guard trong [`CombatSystem.ts`](../../apps/server/src/rooms/CombatSystem.ts): damage vào
`TOWN_CENTER` của defender **không** được đẩy HP xuống dưới ngưỡng 25% — clamp tại ngưỡng rồi
để tick kết thúc trận. Nếu không, một tick burst có thể xoá nhà trước khi settle chạy.

### 6.6 HTTP API (mới)

Tất cả yêu cầu `Authorization: Bearer <token>`; verify bằng `AuthService.verifyToken` +
`AuthService.findById` (giống `/auth/me`). Dùng `express.json({ limit: '16kb' })` đã có.

| Route | Body | Trả |
| --- | --- | --- |
| `GET /world-map` | — | `WorldMapPayload` |
| `POST /raid/start` | `{ defenderId, unitIds }` | `RaidStartResponse` hoặc `4xx` `{ error }` tiếng Việt |
| `POST /raid/retreat` | `{ raidId }` | `{ ok: true }`, idempotent |

Rate limit: `createRateLimit({ limit: 20, windowMs: 60_000 })` cho `/raid/start` để một client
hỏng không spam transaction.

Không N+1: `GET /world-map` là hai truy vấn phẳng (players + raids/locks), không join theo từng
hàng.

## 7. Client

| File | Thay đổi |
| --- | --- |
| [`WorldMapOverlay.tsx`](../../apps/client/src/components/WorldMapOverlay.tsx) **(mới)** | Overlay toàn màn hình: lưới lục giác, chú giải màu theo Δcấp, ô tìm tên, panel chi tiết + nút "Tập kích". |
| [`worldMapArt.ts`](../../apps/client/src/components/worldMapArt.ts) **(mới)** + test | Hình học hex thuần (axial → pixel, hit-test, màu theo Δcấp) để unit-test được. |
| [`App.tsx`](../../apps/client/src/App.tsx) | State `worldMapOpen`; `POST /raid/start` → `switchToRaid()` (dùng lại khung `switchZone` nhưng join `kingdom_room` với `{ ownerId: defenderId, raidId }`); xử lý `RAID_ENDED` (join lại nhà mình); nút "Rút quân"; lưu `raidId` vào `localStorage` để F5 nối lại trận. |
| [`HUD.tsx`](../../apps/client/src/components/HUD.tsx) | Nút "Bản đồ thế giới" (icon `Map`), thay nhãn CHIẾN TRƯỜNG. |
| [`EntityDetails.tsx`](../../apps/client/src/components/EntityDetails.tsx) | Khối "CỔNG DỊCH CHUYỂN" → "CỔNG RÚT QUÂN", chỉ hiện với cổng của chính mình khi đang trong trận. |
| `CommandController.ts` | Right-click cổng của mình → `RAID_RETREAT` thay vì `TRAVEL`. |
| [`BuildMenu.tsx`](../../apps/client/src/components/BuildMenu.tsx) | Ẩn toàn bộ menu xây/đường khi đang trong trận (R14). |

Chi tiết overlay:

- Ô lục giác cạnh 34 px, toạ độ axial từ `hexPositionOf(userId)` → pixel.
- Màu: xám `#64748b` = đang khiên/khoá (không đánh được), xanh = cấp thấp hơn, vàng = ngang
  cấp, đỏ = cấp cao hơn; ô của chính mình có viền trắng.
- Nhãn trong ô: tên rút gọn + `Lv N`; tooltip đầy đủ khi hover/chạm.
- Panel phải: tên, cấp, số quân đang chọn `N/120`, lý do bị chặn, giờ hết khiên/khoá.
- Chưa chọn quân → nút "Tập kích" disabled kèm gợi ý.
- Chọn quá 120 → hiện đỏ và chặn gửi.
- Trong trận: thanh HP Nhà chính địch + nút "Rút quân" cố định góc dưới.

## 8. Ranh giới & edge case

| Tình huống | Hành vi |
| --- | --- |
| Defender offline | Phòng được tạo, base restore từ DB, quân defender đứng yên; chỉ tháp/nhà tự bắn. |
| Defender online | Chung phòng với quân attacker, thấy và điều quân được (R10). |
| Attacker F5 giữa trận | `raids.status='ACTIVE'` còn hiệu lực; client đọc `raidId` từ `localStorage`, join lại `kingdom_room` với `raidId`. |
| Attacker mất mạng | Quân vẫn là hàng `units` có `owner_id` = attacker trong `kingdom:<defender>`; join lại là thấy. |
| Defender rời phòng khi đang bị đánh | Phòng còn attacker nên không dispose; defender join lại vẫn thấy trận. |
| Hai người cùng đánh một nước | Bị chặn bởi unique index `raids_one_active_per_defender`. |
| Attacker tự đánh mình / ngoài ±5 cấp / đang khiên / đang bị khoá | `400` với thông báo tiếng Việt cụ thể. |
| Defender không còn Nhà chính | Không xuất hiện trên bản đồ (`town_center_level = 0`). |
| Nhà chính defender biến mất giữa trận | `DEFENDER_WON`; không xoá thêm gì. |
| Pop của attacker khi quân ở nước khác | `populationElsewhere` đã xử lý sẵn; thêm assert trong test. |
| Server restart giữa trận | `reconcileStaleRaids()` lúc boot đóng các raid quá hạn, trả quân về nhà. |
| Raider cố xây/nâng cấp/khai thác | `RejectCode.FORBIDDEN` (R14). |
| Raider cố mở bản đồ thế giới khi đang trong trận | Nút bị ẩn; API `POST /raid/start` cũng chặn vì đã có raid ACTIVE. |

## 9. Task / commit

| # | Task | Commit đề xuất |
| --- | --- | --- |
| RD-01 | Hằng số + hàm thuần + type/message trong `@chien-quoc/shared` | `feat(shared): add raid constants, hex positions and world map types` |
| RD-02 | Bảng `raids`/`raid_locks`, cột `players`, DDL mirror + `ensureRaidColumns()` | `feat(server): add raid tables and player shield columns` |
| RD-03 | `RaidService` + test DB | `feat(server): implement raid service with loot and cooldowns` |
| RD-04 | Bỏ cổng chiến trường, từ chối `TRAVEL`, bỏ `define battlefield_room` | `refactor(server): retire the battlefield gateway` |
| RD-05 | `KingdomRoom` cho raider + chặn quyền kinh tế + cổng rút | `feat(server): allow raiders into a defended kingdom` |
| RD-06 | Vòng tick trận, guard Nhà chính, `RAID_ENDED`, timeout | `feat(server): settle raids on town center threshold` |
| RD-07 | 3 route HTTP + rate limit + test | `feat(server): expose world map and raid endpoints` |
| RD-08 | `WorldMapOverlay` + `worldMapArt` + test | `feat(client): add the hexagonal world map overlay` |
| RD-09 | Luồng client: tập kích, F5 nối lại, rút quân, banner | `feat(client): wire the raid flow from world map to battle` |
| RD-10 | Dọn UI cổng cũ, ẩn build menu trong trận | `refactor(client): remove the battlefield gate UI` |
| RD-11 | Plan này + index + README gốc | `docs: document the world map and raid phase` |

## 10. Kiểm thử

```bash
pnpm --filter @chien-quoc/shared test        # loot, khoảng cấp, hex
pnpm --filter @chien-quoc/server test        # RaidService, WorldRoom.raid.test.ts, HTTP
pnpm --filter @chien-quoc/client test        # worldMapArt, overlay helpers
pnpm -r exec tsc --noEmit
```

Các test server phải có:

- `RaidService`: loot 20% + trần; khiên 72 h; khoá 3 ngày sau khi thua; chặn tự đánh mình;
  chặn ngoài ±5 cấp; chặn hai raid ACTIVE trên một defender; `reconcileStaleRaids`.
- `WorldRoom.raid.test.ts`: raider join được, **không** spawn base, có cổng rút; raider bị từ
  chối xây/nâng cấp/khai thác; thắng khi TC ≤ 25%; thua khi hết quân; rút quân; F5 nối lại;
  `TRAVEL` bị từ chối.
- HTTP: `GET /world-map` lọc đúng; `POST /raid/start` 400 cho từng lý do; `POST /raid/retreat`
  idempotent.

Thủ công: hai tài khoản A/B, A tập kích B khi B online; B đánh trả; A rút; kiểm tra DB
`raids`/`raid_locks`/`players.shield_until`, tài nguyên hai bên, và quân A về đúng nhà.

## 11. Không đụng tới

- Art/sprite, terrain, đường vẽ tay, minimap hiện có.
- Cơ chế nâng cấp/nghiên cứu (chỉ **đọc** cấp Nhà chính).
- Autosave/dirty-tracking, ngoài việc thêm `syncTownCenterLevel`.
- Bảng `travel_transfers` và code travel cũ (giữ để không phá dữ liệu; dọn ở phase sau).

**Không cần reset DB**: chỉ thêm bảng (`raids`, `raid_locks`) và cột nullable/default
(`players.shield_until`, `players.town_center_level`). `ensureRaidColumns()` chạy idempotent lúc
boot, giống `ensureUpgradeColumns()`. Tài khoản cũ có `town_center_level = 1` mặc định và sẽ
được `syncTownCenterLevel` sửa lại ngay lần autosave đầu tiên sau khi họ vào game.

## 12. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| `filterBy(['ownerId'])` cho phép chọn phòng của nước khác | `onJoin` xác minh raid row bằng DB; sai thì ném lỗi, join bị huỷ. |
| Vòng ±5 cấp với cap 10 ≈ toàn server | Đã báo trước. Nếu thấy quá rộng, đổi sang chỉ số sức mạnh ở phase sau; hằng số đã tách riêng nên đổi một chỗ. |
| Raider chiếm phòng defender rồi phá hoại | Guard R14 cho mọi lệnh kinh tế/xây dựng. |
| Trận treo khi cả hai mất kết nối | Timeout 30 phút trong tick + `reconcileStaleRaids()` lúc boot. |
| Loot tính sai khi defender vừa tiêu tài nguyên | Loot tính trong cùng transaction với lúc đóng trận, đọc số dư tại thời điểm đó. |
| Hai transaction `settleRaid` chạy song song | Cờ `raidSettling` + `raids.status` được kiểm trong transaction (`updateMany where status='ACTIVE'`, `count === 0` → bỏ qua). |
