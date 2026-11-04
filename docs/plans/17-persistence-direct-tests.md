# Phase 17 — Test trực tiếp cho persistence (`TEST-01`)

**Mục tiêu:** thêm lưới test trực tiếp cho ba entry point persistence hiện chỉ được mock gián
tiếp trong `WorldRoom.test.ts`: `DatabaseService.saveFullWorldState`, `DatabaseService.saveZoneResources`
(private) và `WorldRoom.initializeWorldPersistence` (private). Lưới này là điều kiện để
`SAVE-03`/`SAVE-04` (batch upsert, resource delta) và mọi refactor của `DatabaseService` được
verify bằng số đo thay vì mắt.

> **Status: `IMPLEMENTED — chờ verify`** (cập nhật 2026-11-04). Slice `TEST-01` đã được build;
> code + test xanh, chờ verify. Slice cha: phase 10 (persistence scaling), trạng thái `DRAFT`;
> phụ thuộc `SAVE-01` đã shipped (log ms + stmts) và `SAVE-06` (benchmark).

Phạm vi: `apps/server` (test + hook testability nhỏ). **Không** đổi `apps/client`, `packages/shared`,
schema, protocol, DB production hay gameplay.

---

## 1. Mục tiêu

1. Có test trực tiếp cho `saveFullWorldState` với state nhỏ, kiểm tra đúng rows được ghi vào SQLite
   và đúng số statement được đếm (theo quy tắc D4 của phase 13).
2. Có test trực tiếp cho `saveZoneResources` (private) bao phủ toàn bộ nhánh delta: node mới, node
   đổi `remainingAmount`, node không đổi, node bị xoá, danh sách rỗng.
3. Có test trực tiếp cho `WorldRoom.initializeWorldPersistence` bao phủ: restore resource node,
   restore building/unit, sinh mới map khi chưa có resource, bỏ row nằm ngoài map, và đường lỗi.
4. Test chạy cô lập với `dev.db` thật: dùng file SQLite tạm trong `os.tmpdir()`, không làm bẩn DB
   dev và không phụ thuộc thứ tự test.
5. Giữ nguyên mock `DatabaseService` trong `WorldRoom.test.ts` / `WorldRoom.travel.test.ts`; test
   mới không làm vỡ chúng.

---

## 2. Hiện trạng (đối chiếu code)

| Thành phần | Hành vi | Vị trí |
| --- | --- | --- |
| `saveFullWorldState` | public static, gom entity theo owner, upsert account + sweep entity + `saveZoneResources` | `DatabaseService.ts:680-735` |
| `saveZoneResources` | private static, findMany → created/changed → deleteMany | `DatabaseService.ts:389-453` |
| `initializeWorldPersistence` | private method `WorldRoom`, load resources/entities, sinh mới nếu trống, bump entity id | `WorldRoom.ts:360-472` |
| DB file | Hằng `DATABASE_FILE` cố định `apps/server/database/dev.db`, không có override | `DatabaseService.ts:21-22` |
| `ensureDatabaseFile` | `fs.mkdirSync(DATABASE_DIR)` → phụ thuộc `DATABASE_DIR` | `DatabaseService.ts:123-131` |
| Test hiện có | `WorldRoom.test.ts` mock toàn bộ `DatabaseService`; không có test trực tiếp | `WorldRoom.test.ts:39-48` |
| Prisma client | Module-level singleton, url được đọc lúc import | `DatabaseService.ts:16-21` |
| Global id allocator | `entityIds` process-wide, có `reset()` cho test | `EntityIdAllocator.ts` |

Vấn đề testability hiện tại:

- `DATABASE_FILE` là hằng được tính lúc import → test không thể trỏ vào DB tạm nếu import tĩnh.
- `initialize()` cache `initPromise` → nhiều test file / nhiều DB tạm cần reset cache.
- `saveZoneResources` và `initializeWorldPersistence` là private → test phải gọi qua cast `as any`
  (đúng pattern đã dùng cho `WorldRoom` internals).

---

## 3. Quyết định thiết kế

### D1 — CHỐT: test bằng SQLite thật, không mock Prisma

Persistence là logic SQL (findMany + createMany + update transaction + deleteMany). Mock Prisma
sẽ chỉ kiểm tra thứ tự gọi, không bắt được sai `where`/`notIn`/cascade. Vì vậy test dùng DB SQLite
thật trong `os.tmpdir()`. Chi phí chấp nhận được: mỗi file < 1 s cho vài chục statement.

| Phương án | SQLite thật (chọn) | Mock Prisma |
| --- | --- | --- |
| Bắt lỗi SQL/where | Có | Không |
| Cô lập với dev.db | Cần env override | Có |
| Tốc độ | ~ms-statement | Nhanh hơn |
| Phụ thuộc prisma generate | Có (đã có trong run-tests.sh) | Không |

→ Chốt: SQLite thật + env override.

### D2 — CHỐT: override đường DB qua biến môi trường `DATABASE_FILE`

Thêm vào `DatabaseService`:

```ts
export const DATABASE_FILE = process.env.DATABASE_FILE
  ? path.resolve(process.env.DATABASE_FILE)
  : path.join(DATABASE_DIR, 'dev.db');
```

và `ensureDatabaseFile()` dùng `path.dirname(DATABASE_FILE)` thay vì `DATABASE_DIR`. Benchmark script
và server thật không set env → hành vi cũ không đổi. Đây là thay đổi source nhỏ nhất để mở đường
test; không đổi schema/protocol.

### D3 — CHỐT: một file test = một DB tạm; dọn bảng trong `beforeEach`

`initPromise` chỉ được tạo một lần trong vòng đời process của file. Vì vậy:

- `beforeAll`: set `process.env.DATABASE_FILE` **trước** khi dynamic import, rồi `initialize()`.
- `beforeEach`: `deleteMany` theo thứ tự `Unit` → `Building` → `Player` → `WorldResourceNode`
  (và `TravelTransfer` nếu có) để mỗi test bắt đầu sạch.
- `afterAll`: `disconnect()` + xoá file `.db`/`.db-wal`/`.db-shm`.

Dynamic import bắt buộc vì `process.env` phải được set trước khi module đọc hằng. Pattern:

```ts
let DatabaseService: any;
let prisma: any;
beforeAll(async () => {
  process.env.DATABASE_FILE = dbFile;
  ({ DatabaseService, prisma } = await import('./DatabaseService.js'));
  await DatabaseService.initialize();
});
```

### D4 — CHỐT: gọi private qua cast `as any`, không đổi visibility

`saveZoneResources` giữ `private`. Test gọi:

```ts
await (DatabaseService as any).saveZoneResources(zone, nodes, stmts);
```

đúng như `WorldRoom` internals đã làm với `as any`. Không thêm `public`/`__test` để tránh phình API.

### D5 — CHỐT: `initializeWorldPersistence` test với `DatabaseService` bị mock

Giống `WorldRoom.test.ts`, mock module `DatabaseService` để trả dữ liệu giả, rồi tạo bare `WorldRoom`
và gọi `(room as any).initializeWorldPersistence()`. Test không đụng SQLite. Terrain/map size lấy
từ `mapSizeForZone` như room thật.

### D6 — CHỐT: không reset `entityIds` giữa các test persistence DB

`DatabaseService.initialize()` gọi `seedEntityIds()` đọc id lớn nhất từ DB. Vì DB tạm bắt đầu rỗng,
`entityIds` có thể vẫn mang giá trị từ test trước nếu cùng process. `saveFullWorldState` không mint
id mới (dùng id đã có trong state), nên không ảnh hưởng assertion. Test sẽ tự đặt id rõ ràng
(`b_1`, `u_1`, `res_1`) và so sánh theo id, không theo sequence.

---

## 4. Hợp đồng testability (files to touch)

| File | Thay đổi |
| --- | --- |
| `apps/server/src/services/DatabaseService.ts` | `DATABASE_FILE` honour env `DATABASE_FILE`; `ensureDatabaseFile()` dùng `path.dirname(DATABASE_FILE)`. |
| `apps/server/src/services/DatabaseService.test.ts` | **MỚI** — test trực tiếp `saveZoneResources` + `saveFullWorldState`. |
| `apps/server/src/rooms/WorldRoom.persistence.test.ts` | **MỚI** — test trực tiếp `initializeWorldPersistence`. |
| `docs/plans/README.md` | Thêm row phase 17. |
| `STATE.md` | Row `TEST-01` → `PLANNED 2026-11-04 — awaiting build`. |

Không đụng client/shared/schema/protocol.

---

## 5. Test cases — `DatabaseService.test.ts`

### 5.1 `saveZoneResources` (private)

Zone dùng cho mọi case: `'test:zone'`. Mỗi test bắt đầu với bảng rỗng.

| # | Tên | Input | Kỳ vọng rows sau | stmts |
| --- | --- | --- | --- | --- |
| R1 | rỗng | `[]` | 0 row | 1 (`deleteMany`) |
| R2 | node mới | `[res_1 amount=5]` | 1 row, amount=5 | 3 (`findMany` + `createMany` + `deleteMany`) |
| R3 | node không đổi | seed `res_1 amount=5`, gọi lại cùng amount | 1 row, amount=5 | 2 (`findMany` + `deleteMany`) |
| R4 | node đổi amount | seed `res_1 amount=5`, gọi với amount=3 | 1 row, amount=3 | 3 (`findMany` + 1 update + `deleteMany`) |
| R5 | xoá stale | seed `res_old amount=1`; gọi với `[res_new]` | chỉ `res_new` | 3 |
| R6 | mixed | seed `res_keep=5`, `res_drop=1`; gọi `[res_keep amount=4, res_new amount=2]` | `res_keep=4`, `res_new=2`, không còn `res_drop` | 4 (`findMany` + update 1 + createMany 1 + deleteMany 1) |

Ghi chú: statement count theo quy tắc D4 phase 13; `$transaction` với 1 update vẫn là 1 statement.

### 5.2 `saveFullWorldState` (public)

| # | Tên | Input | Kỳ vọng |
| --- | --- | --- | --- |
| F1 | lưu đầy đủ | 1 player (wood=123), 1 building (TC), 1 unit (villager), 1 resource node | rows: Player 1, Building 1, Unit 1, WorldResourceNode 1; giá trị khớp |
| F2 | nhiều owner | 2 player, mỗi người 1 building | 2 player rows, 2 building rows, grouped đúng ownerId |
| F3 | sweep entity cũ | seed building `b_old` cho owner; state không còn → bị xoá | sau save không còn `b_old` |
| F4 | `skipAccountFor` | traveler đã commit; state vẫn có player; gọi với `skipAccountFor = new Set([ownerId])` | entity rows được ghi, nhưng account row **không** bị ghi đè (giữ giá trị DB cũ) |
| F5 | `skipIfBusy` skip | gọi hai lần liên tiếp cùng zone với task chậm? | không bắt buộc ở slice này; ghi rõ là out-of-scope, để test queue riêng nếu cần |
| F6 | resource delta qua full save | gọi hai lần, lần hai amount không đổi | stmts lần hai ít hơn lần một (không có update) |

F6 kiểm tra plumbing counter từ `saveFullWorldState` xuống `saveZoneResources` (D2 phase 13).

---

## 6. Test cases — `WorldRoom.persistence.test.ts`

Mock `DatabaseService`:

```ts
vi.mock('../services/DatabaseService.js', () => ({
  DatabaseService: {
    loadResources: vi.fn(),
    clearAllResources: vi.fn().mockResolvedValue(undefined),
    saveAllResources: vi.fn().mockResolvedValue(undefined),
    loadZoneEntities: vi.fn().mockResolvedValue([])
  }
}));
```

Bare room setup:

```ts
function createRoom(zone = 'battlefield') {
  const room = new WorldRoom();
  room.setState(new WorldState());
  const size = mapSizeForZone(zone);
  room.state.zoneId = zone;
  room.state.mapWidth = size.width;
  room.state.mapHeight = size.height;
  const internals = room as any;
  internals.zoneId = zone;
  internals.zoneReady = false;
  return { room, internals };
}
```

| # | Tên | Mock | Kỳ vọng |
| --- | --- | --- | --- |
| P1 | restore resources | `loadResources` → `[row res_1 amount 7/10 at (5,6)]` | `state.resourceNodes` có `res_1`, remaining=7, max=10, grid đúng |
| P2 | restore building/unit | `loadZoneEntities` → 1 player với 1 building + 1 unit | `state.buildings`/`state.units` có đúng id, ownerId, level clamp, hp clamp theo level stats |
| P3 | map trống → sinh mới | `loadResources` → `[]` | `clearAllResources(zone)` và `saveAllResources` được gọi; `state.resourceNodes.size > 0` |
| P4 | bỏ row ngoài map | resource gridX=999; building gridX=999; unit x=999 | không có entity nào được thêm; `droppedOutOfBounds` → log warning (có thể assert console.warn spy) |
| P5 | restore upgrade progress | building row có `upgradeProgressMs=1000, upgradeTimeMs=5000` | building.upgradeProgressMs/timeMs được restore (qua `restoreBuildingUpgrade`) |
| P6 | lỗi load | `loadResources` reject | `worldRestoreError` là Error, `zoneReady === false`, không throw ra ngoài |

Ghi chú P4: assert số lượng `resourceNodes`/`buildings`/`units` = 0 cho các row ngoài. Warning log có thể spy `console.warn` nếu muốn chặt, nhưng không bắt buộc.

---

## 7. Task

Size: **S** < 2h, **M** ~ nửa ngày, **L** ≥ 1 ngày.

| Task | Size | Phụ thuộc | Nội dung | Trạng thái |
| --- | --- | --- | --- | --- |
| `TEST-01A` | S | — | `DatabaseService`: honour env `DATABASE_FILE` + `ensureDatabaseFile` dùng `path.dirname`. | DONE (2026-11-04) |
| `TEST-01B` | M | TEST-01A | Viết `DatabaseService.test.ts`: R1–R6 + F1–F4 + F6. | DONE (2026-11-04) |
| `TEST-01C` | M | — | Viết `WorldRoom.persistence.test.ts`: P1–P6. | DONE (2026-11-04) |
| `TEST-01D` | S | TEST-01B/C | Chạy full server suite, sửa flake (thứ tự delete, idempotency). | DONE (2026-11-04) |

### TEST-01A — testability hook (source nhỏ)

- Chỉ sửa 2 dòng logic + import `path` (đã import). Không đổi behaviour khi env không set.
- Kiểm tra `tsc --noEmit` server sạch.

### TEST-01B — DatabaseService direct tests

- Dùng dynamic import sau khi set env.
- Helper `makeState()` trả `WorldState` với player/building/unit/resource.
- Helper `resetTables()` delete theo thứ tự FK.
- F4 cần seed account row trước (gọi saveFullWorldState lần 1 với resources=0, rồi update wood, rồi gọi lần 2 với skipAccountFor và so sánh wood không đổi). Implementer có thể đơn giản hoá: seed bằng `saveFullWorldState` lần 1, sau đó mutate `player.wood`, gọi lần 2 với skip, expect wood giữ giá trị lần 1? Thực ra skipAccountFor bỏ qua upsert nên DB giữ wood lần 1 (chưa mutate). Để test "không ghi đè", nên seed giá trị A, mutate in-memory thành B, skip → DB vẫn A. Assert A.

### TEST-01C — WorldRoom persistence tests

- Mock DatabaseService như trên.
- Dùng `vi.spyOn(console, 'warn')` nếu cần.
- P6: mock `loadResources.mockRejectedValue(new Error('boom'))`, gọi initialize, expect `internals.worldRestoreError instanceof Error`.

### TEST-01D — ổn định

- Chạy `pnpm --filter @chien-quoc/server test` nhiều lần (ít nhất 3) để bắt flake do SQLite lock/timing.
- Nếu flake do file DB còn sót, kiểm tra `afterAll` xoá đủ suffix.

---

## 8. Verify

**Bắt buộc:**
1. `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch.
2. `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch (không sửa client, nhưng chạy để chắc).
3. `pnpm --filter @chien-quoc/client test` xanh.
4. `pnpm --filter @chien-quoc/server test` xanh, bao gồm file mới.
5. Chạy server suite 3 lần liên tiếp không flake.

**Kịch bản tay:**
| Thao tác | Kỳ vọng |
| --- | --- |
| Xoá `apps/server/database/dev.db` rồi chạy server test | Suite mới dùng DB tạm, không tạo/sửa dev.db |
| `ls /tmp` sau test | Có file `cq-persist-*.db` được xoá (không còn sót) |
| Sửa cố ý `saveZoneResources` deleteMany condition | Test R5/R6 fail |

---

## 9. Edge case

| # | Tình huống | Xử lý |
| --- | --- | --- |
| 1 | SQLite file còn từ run trước (crash) | `beforeAll` xoá file trước khi set env; hoặc `fs.rmSync(..., {force:true})` đầu file |
| 2 | Foreign key order | Delete `Unit`/`Building` trước `Player`; `WorldResourceNode` độc lập |
| 3 | `initPromise` cache từ test khác trong cùng worker | File test là worker riêng; dynamic import sau set env |
| 4 | `DATABASE_DIR` không tồn tại khi env trỏ temp | `ensureDatabaseFile` mkdir dirname |
| 5 | Prisma client chưa generate (fresh clone) | `run-tests.sh` chạy `prisma:generate` trước; ghi rõ trong DoD |
| 6 | `loadResources` trả row có `remainingAmount=0` | `initializeWorldPersistence` refill thành `maxAmount` (đã có logic); test P1 dùng amount > 0, thêm case nếu cần |
| 7 | Building level vượt cap persisted | `clampStoredLevel` clamp; P2 có thể assert |
| 8 | Out-of-bounds detection cho building dùng sizeX/Y | `fitsMap(x,y,sizeX,sizeY)`; P4 cover |
| 9 | Console noise từ initialize | Có thể spy, không fail test |

---

## 10. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Test DB integration làm chậm suite | Chỉ vài chục statement; đo và giữ < 2 s/file |
| Flaky do SQLite lock khi parallel workers | Vitest mặc định threads; nếu flake, set `fileParallelism: false` cho server config hoặc gộp file. Ghi vào plan, implementer quyết |
| Env override vô tình ảnh hưởng benchmark/server | Chỉ test file set env; benchmark không set → default |
| Mock DatabaseService trong WorldRoom test thiếu method mới | Mock chỉ các method cần; `initializeWorldPersistence` dùng 4 method đã list |
| Test private bằng cast vỡ khi refactor rename | Accept; rename sẽ làm test fail rõ ràng, đó là mục đích |

---

## 11. Hiệu năng và chi phí

- Không thêm tải runtime. Test chỉ chạy trong vitest.
- DB tạm < 1 MB.
- Không thêm dependency.

---

## 12. Ngoài phạm vi

- Test cho `savePlayerEmpire`, `saveZonePlayerEntities`, `commitTravel` (để slice sau nếu cần).
- Test cho queue `withZoneQueue`/`skipIfBusy` (có thể thêm vào TEST-01 nếu implementer thấy cần, nhưng không bắt buộc).
- Thay đổi `DatabaseService` để nhận Prisma injection (không cần; env override đủ).
- Reset DB dev hoặc migration.
- Test client.

---

## 13. Definition of Done

- [x] `apps/server/src/services/DatabaseService.ts` honour env `DATABASE_FILE` (default không đổi).
- [x] `apps/server/src/services/DatabaseService.test.ts` tồn tại, R1–R6 + F1–F4 + F6 pass.
- [x] `apps/server/src/rooms/WorldRoom.persistence.test.ts` tồn tại, P1–P6 pass.
- [x] `tsc --noEmit` server/client sạch.
- [x] `pnpm --filter @chien-quoc/server test` xanh 3 lần liên tiếp.
- [x] Không sửa `apps/client`, `packages/shared`, schema, protocol, DB production.
- [x] Mock `DatabaseService` hiện có trong `WorldRoom.test.ts`/travel test vẫn xanh.

---

## 14. Nhật ký

| Ngày | Thay đổi |
| --- | --- |
| 2026-11-04 | Tạo plan: 2 file test + hook env override, 3 task TEST-01A..D. Status `APPROVED`. |
