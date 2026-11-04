# Phase 13 — Log thời gian và số statement mỗi lần autosave (`SAVE-01`)

**Mục tiêu:** thêm đo lường vào autosave để biết mỗi lần lưu tốn bao nhiêu thời gian và bao
nhiêu statement SQL, từ đó có baseline trước khi tối ưu dirty tracking (phase 10, D4). Không
đổi gameplay, schema, protocol hay DB.

> **Status: `APPROVED`** (chốt 2026-11-04). Slice `SAVE-01` đã được duyệt; tài liệu này là
> toàn bộ nội dung của bước plan. Slice cha: phase 10 (persistence scaling), trạng thái `DRAFT`.

Phạm vi: `apps/server` (chỉ `DatabaseService`). **Không** đổi client, shared, schema, protocol
hay DB.

---

## 1. Mục tiêu

1. Mỗi lần `saveFullWorldState` chạy thành công, log phải nêu rõ zone, số player/building/unit,
   thời gian wall-clock (ms) và số statement SQL đã thực thi.
2. Có quy tắc đếm statement rõ ràng, không phụ thuộc Prisma middleware hay trạng thái toàn cục.
3. Ghi baseline thật (1 user / 2 user / 10 client giả lập) vào phase 10 §4, thay các con số
   "ước lượng".
4. Giữ nguyên chữ ký `saveFullWorldState` và hành vi `skipIfBusy`.

---

## 2. Hiện trạng (đối chiếu code)

| Thành phần | Hành vi | Vị trí |
| --- | --- | --- |
| Log hiện tại | `💾 [DatabaseService] ${zone} auto-saved (Players: ..., Buildings: ..., Units: ...)` | `DatabaseService.ts:723-725` |
| Autosave | Mỗi room 30 s gọi `saveFullWorldState(this.state, this.zoneId, { skipIfBusy: true })` sau khi refresh baseline bên kia map | `WorldRoom.ts:1080-1093` |
| Hàng đợi zone | `withZoneQueue(zone, task, skipIfBusy)`; nếu đang busy thì trả `undefined` và **không** chạy task | `DatabaseService.ts:325-344` |
| Save một zone | player upsert + entity sweep + resource sweep, lặp theo owner | `DatabaseService.ts:670-729` |
| Baseline refresh | 3 query/player trước mỗi autosave (population bên kia map) | `WorldRoom.ts:1088-1090`, `DatabaseService.ts:879-909` |
| Test hiện có | `WorldRoom.test.ts` mock `saveFullWorldState`, không có test trực tiếp cho `DatabaseService` | `WorldRoom.test.ts:44` |

Chi phí statement hiện tại (theo phase 10 §2) cho 1 owner:

```
1 (player upsert) + 2 (delete buildings/units) + B (upsert building) + U (upsert unit)
  + 1 (resource findMany, nếu có node) + (created>0 ? 1 : 0) (createMany)
  + (số node đổi) (update) + 1 (resource deleteMany)
```

---

## 3. Quyết định thiết kế

### D1 — CHỐT: đo thời gian bên trong task của `withZoneQueue`

Bắt đầu `performance.now()` ở dòng đầu của task (sau `await this.initialize()` cũng tính, nhưng
`initialize` được cache nên không đáng kể) và tính delta ngay trước `console.log`. Nếu zone đang
busy (`skipIfBusy`), task không chạy → **không** có log mới, không có thời gian giả. Điều này
khớp hành vi hiện tại (log chỉ xuất khi thực sự ghi).

| Phương án | Trong task (chọn) | Bao quanh cả `withZoneQueue` |
| --- | --- | --- |
| Skip → log? | Không (đúng) | Có thể log 0 ms gây nhiễu |
| Đo đúng chi phí SQLite | Có | Bao gồm cả thời gian chờ hàng đợi → lệch khi tranh chấp |
| Đơn giản | Có | Cần xử lý `undefined` trả về |

→ Chốt: trong task.

### D2 — CHỐT: đếm statement bằng counter truyền tay, không dùng Prisma middleware

Một biến `const stmts = { n: 0 }` tạo trong `saveFullWorldState`, truyền xuống
`savePlayerAccountInternal`, `saveZoneEntitiesInternal`, `saveZoneResources` qua tham số tuỳ chọn
`stmts?: { n: number }`. Mỗi lời gọi Prisma tăng `stmts.n`. Lý do không dùng middleware/AsyncLocalStorage:
chi phí thấp, chính xác theo từng save, không trạng thái toàn cục, không ảnh hưởng caller khác.

Caller không truyền counter (ví dụ `savePlayerEmpire`, `saveZonePlayerEntities`) thì tham số là
`undefined` và code dùng `stmts?.n++` (no-op). Hành vi và chữ ký public không đổi.

### D3 — CHỐT: format log

Giữ dòng `💾` hiện có và thêm thời gian + số statement vào cùng một cặp ngoặc:

```
💾 [DatabaseService] ${zone} auto-saved (Players: ${p}, Buildings: ${b}, Units: ${u}, ${ms} ms, ${n} stmts)
```

`ms` là số nguyên (`Math.round(performance.now() - started)`). Phase 10 DoD yêu cầu "nêu rõ zone,
số player, thời gian" — format này thoả. Không thêm dòng `⏱️` riêng để tránh log kép.

### D4 — CHỐT: quy tắc đếm

- Một lời gọi method của Prisma (`upsert`, `update`, `deleteMany`, `findMany`, `createMany`,
  `$transaction` với mảng) = **1 statement mỗi operation bên trong**, không phải 1 cho cả transaction.
  `$transaction` chỉ gom round-trip, không giảm số statement.
- `$transaction(async (tx) => {...})` (interactive) vẫn đếm từng `tx.*` bên trong.
- `prisma.$executeRawUnsafe` / DDL trong `initialize()` **không** đếm (được cache, không thuộc save).
- Baseline refresh trong `WorldRoom.autosave` (3 query/player) **không** nằm trong log này vì nằm
  ngoài `saveFullWorldState`; ghi chú riêng ở §7.
- Save bị skip vì busy: không log, không đếm.

### D5 — CHỐT: không đổi chữ ký public

`saveFullWorldState(state, zone?, options?)` giữ nguyên. Counter chỉ thêm vào tham số của các
hàm private. Không đổi `@type()`, schema, protocol.

### D6 — CHỐT: baseline ghi vào phase 10

Sau khi code chạy, implementer cập nhật bảng §4 của `10-persistence-scaling.md` bằng số đo thật
(ms + stmts) cho 1 user / 2 user / 10 client giả lập và tick row `SAVE-01` trong §7 từ `TODO`
sang `DONE` (kèm commit). Nếu chưa có script benchmark (`SAVE-06`), đo bằng cách chạy server và
đọc log autosave.

---

## 4. Hợp đồng kỹ thuật

- **Input/Output:** không đổi. `saveFullWorldState` vẫn `Promise<void | undefined>`.
- **Counter:** tham số tuỳ chọn `stmts?: { n: number }` trên:
  - `savePlayerAccountInternal(player, zone, stmts?)`
  - `saveZoneEntitiesInternal(zone, ownerId, buildings, units, stmts?)`
  - `saveZoneResources(zone, nodes, stmts?)`
- **Đếm trong từng hàm:**
  - `savePlayerAccountInternal`: `stmts?.n++` quanh `prisma.player.upsert` → +1.
  - `saveZoneEntitiesInternal`: +1 `deleteMany` buildings, +1 cho mỗi `upsert` building,
    +1 `deleteMany` units, +1 cho mỗi `upsert` unit.
  - `saveZoneResources`: nếu `nodes.length > 0`: +1 `findMany`; nếu `created.length > 0`: +1 `createMany`;
    +`changed.length` cho các `update`; luôn +1 `deleteMany` ở cuối (kể cả `nodes.length === 0`).
- **Timing:** `const started = performance.now();` đầu task; `const elapsedMs = Math.round(performance.now() - started);` trước log.
- **Skip:** `withZoneQueue` trả `undefined` → hàm trả `undefined`, không log.

---

## 5. Thay đổi code (files to touch)

| File | Thay đổi |
| --- | --- |
| `apps/server/src/services/DatabaseService.ts` | `saveFullWorldState`: tạo `stmts`, `started`, truyền counter xuống, tính elapsed, log mới. |
| `apps/server/src/services/DatabaseService.ts` | `savePlayerAccountInternal`: thêm tham số `stmts?`, tăng counter quanh upsert. |
| `apps/server/src/services/DatabaseService.ts` | `saveZoneEntitiesInternal`: thêm tham số `stmts?`, tăng counter cho 2 `deleteMany` + từng `upsert`. |
| `apps/server/src/services/DatabaseService.ts` | `saveZoneResources`: thêm tham số `stmts?`, tăng counter theo quy tắc D4. |
| `docs/plans/10-persistence-scaling.md` | Tick `SAVE-01` → `DONE` + điền baseline §4 (implementer). |
| `docs/plans/README.md` | Dòng phase 13 (đã thêm khi plan). |
| `STATE.md` | Row `SAVE-01` → `PLANNED …` (đã đặt khi plan). |

Không đụng client, shared, schema, protocol, DB.

---

## 6. Test và kiểm chứng

### 6.1 Test tự động

- Chạy `pnpm --filter @chien-quoc/server test` — không được vỡ `WorldRoom.test.ts` (mock
  `saveFullWorldState`) và các test travel/auth.
- `tsc --noEmit` cho `apps/server`.
- (Tuỳ chọn, nếu implementer thêm) `DatabaseService.test.ts` với Prisma mock kiểm tra format log
  và số statement cho một state nhỏ. Không bắt buộc ở slice này; `TEST-01` sẽ bao phủ đầy đủ.

### 6.2 Verify tay

- Boot server, đăng nhập 1 tài khoản, chờ 1 chu kỳ autosave (≤ 35 s), đọc log:
  `💾 [DatabaseService] kingdom:<id> auto-saved (Players: 1, Buildings: ..., Units: ..., <ms> ms, <n> stmts)`.
- Lặp với 2 tài khoản ở 2 vương quốc → 2 dòng, mỗi dòng có ms + stmts.
- Ghi số đo vào phase 10 §4 (ít nhất 1 user và 2 user; 10 client nếu khả thi).

---

## 7. Baseline (điền sau khi đo)

| Quy mô | Room | ms/save (đo được) | stmts/save (đo được) | Ghi chú |
| --- | --- | --- | --- | --- |
| 1 user | 2 | battlefield 11–13 ms; kingdom 10–13 ms | battlefield 2; kingdom 12 | kingdom room + battlefield, đo steady-state (save thứ 2) |
| 2 user | 3 | battlefield 8–11 ms; kingdom 9–10 ms mỗi room | battlefield 2; kingdom 12 mỗi room | 2 kingdom room + 1 battlefield dùng chung |
| 10 client giả lập | 11 | battlefield 8 ms; kingdom 8–10 ms mỗi room | battlefield 2; kingdom 12 mỗi room (tổng ~122 stmts/chu kỳ) | 10 kingdom room + 1 battlefield, đo steady-state |

Baseline refresh (3 query/player) **không** nằm trong `stmts` ở trên; nếu đo tổng autosave ở
`WorldRoom.autosave`, cộng thêm `3 × số player` statement.

---

## 8. Rủi ro và edge case

| Rủi ro | Xử lý |
| --- | --- |
| Đếm sai do transaction gom nhiều upsert | Quy tắc D4 đếm từng operation; test tay so sánh stmts với công thức §2 |
| Log bị skip khi busy → mất baseline trong tải cao | Đúng hành vi; ghi chú "skipped" không cần log; đo trong điều kiện bình thường |
| `performance.now()` không có trong môi trường cũ | Node ≥ 16 có global `performance`; server đã dùng async/await hiện đại |
| Counter bị chia sẻ giữa các zone concurrent | Counter là biến cục bộ trong `saveFullWorldState`, truyền xuống theo call → không chia sẻ |
| Save ném exception → không log → tưởng không chạy | Giữ nguyên (log chỉ sau thành công); lỗi vẫn propagate để room xử lý |
| Implementer quên cập nhật phase 10 | Acceptance §10 kiểm tra; verifier fail nếu còn `TODO` |

---

## 9. Definition of Done

- [x] `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch
- [x] `pnpm --filter @chien-quoc/server test` xanh
- [x] Log autosave có đủ zone, players, buildings, units, ms, stmts
- [x] Quy tắc đếm khớp công thức §2 (đo tay 1 user)
- [x] Baseline §7 điền số thật cho ít nhất 1 user và 2 user
- [x] `docs/plans/10-persistence-scaling.md` tick `SAVE-01` → `DONE` và cập nhật §4
- [x] Không đổi schema/`@type()`/protocol/DB/client/shared

---

## 10. Ngoài phạm vi

- Dirty tracking, batch upsert, resource delta, throttle tick (`SAVE-02`..`SAVE-05`).
- Script benchmark spawn N client (`SAVE-06`).
- Test trực tiếp persistence (`TEST-01`).
- Đổi tần suất autosave hay RPO (`phase 10 D7`).
- Log cho `savePlayerEmpire` / `saveZonePlayerEntities` / travel (chỉ autosave).
