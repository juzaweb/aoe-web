# Phase 10 — Tải của persistence: autosave theo zone và giới hạn SQLite

Status: **DRAFT** (2026-11-03). Chưa có dòng code nào; số liệu dưới đây là đo trên
`apps/server/database/dev.db` + đọc code, phần "ước lượng" được ghi rõ.
Phạm vi dự kiến: `apps/server` (persistence + room lifecycle) và có thể `packages/shared` nếu cần
hằng số cấu hình. **Không** đổi schema bảng, không đổi protocol.

Xuất phát từ câu hỏi: "mỗi user 1 request có gây quá tải không?" — với 2 user đang online, log
`💾 [DatabaseService] kingdom:<id> auto-saved (Players: 1, ...)` xuất hiện **một dòng cho mỗi map**,
không phải một dòng tổng. Phase này ghi lại chi phí thật của mô hình đó và các bước giảm tải.

## 1. Mục tiêu

1. Trả lời bằng số: một user tốn bao nhiêu write cho mỗi lần autosave, và tải tăng thế nào theo
   số user.
2. Xác định thứ tự thành phần gãy khi scale: SQLite writer, Prisma overhead, CPU tick mỗi room,
   RAM mỗi room.
3. Có kế hoạch giảm tải rẻ (dirty tracking + batch upsert + resource delta) **trước** khi cần
   đổi database.
4. Thêm số đo (thời gian lưu, số statement) để mọi thay đổi sau này so sánh được.

Không thuộc mục tiêu: tối ưu tick simulation, đổi Colyseus sang multi-process, migrate Postgres —
chỉ ghi điều kiện kích hoạt ở §11.

## 2. Hiện trạng (đọc từ code)

| Thành phần | Hành vi | Vị trí |
| --- | --- | --- |
| Autosave | Mỗi room, mỗi **30 s**, gọi `saveFullWorldState` | `WorldRoom.ts:352-354`, `WorldRoom.ts:1080-1093` |
| Chống dồn | `skipIfBusy`: save mới bị **bỏ** nếu zone đang có write khác | `DatabaseService.ts:325-344` |
| Hàng đợi | FIFO **theo zone**, các zone khác chạy song song | `DatabaseService.ts:61-68` |
| Room | 1 room/tài khoản (`kingdom_room` + `filterBy(['ownerId'])`) và 1 room chung `battlefield_room` | `index.ts:111-112` |
| Baseline | Trước mỗi autosave, mỗi player đọc lại population map bên kia: 3 query | `WorldRoom.ts:1088-1090`, `DatabaseService.ts:879-909` |
| Tick | 20 Hz mỗi room, độc lập với số client | `WorldRoom.ts:348`, `constants/index.ts:38` |
| Chế độ DB | SQLite + WAL, Prisma, file `apps/server/database/dev.db` | `DatabaseService.ts:23-29`, `DatabaseService.ts:113` |

Một lần `saveFullWorldState(zone)` ([DatabaseService.ts:670-729](../../apps/server/src/services/DatabaseService.ts#L670-L729)):

1. Với **mỗi owner** có entity trên zone (kể cả owner offline trên battlefield):
   `player` upsert (1 stmt) + transaction gồm 2 `deleteMany` và **mỗi** building/unit là **một
   upsert riêng** ([dòng 569-660](../../apps/server/src/services/DatabaseService.ts#L569-L660)).
2. `saveZoneResources`: `findMany` **toàn bộ** node của zone, so sánh, `createMany` node mới,
   transaction update từng node đổi lượng, rồi `deleteMany notIn` toàn bộ id còn lại
   ([dòng 389-437](../../apps/server/src/services/DatabaseService.ts#L389-L437)).
3. Log một dòng cho zone đó ([dòng 723-725](../../apps/server/src/services/DatabaseService.ts#L723-L725)) —
   đây là lý do thấy `Players: 1` hai lần khi có 2 user ở 2 vương quốc.

Chi phí ước lượng cho 1 user (kingdom, B building, U unit):

```
statements ≈ 1 (player) + 2 (delete) + B + U + 3 (baseline) + 2 (resource read/sweep) + k (node đổi)
```

Với B=10, U=30, k=0 → **~48 câu SQL / 30 s** ≈ 1,6 câu/s/user.

## 3. Số đo trên DB dev (2026-11-03)

| Zone | `buildings` | `units` | `world_resource_nodes` |
| --- | --- | --- | --- |
| `battlefield` | 3 | 1 | **1258** |
| kingdom A | 4 | 3 | 259 |
| kingdom B | 4 | 5 | 262 |
| kingdom C | 2 | 3 | 274 |
| kingdom D | 2 | 3 | 258 |
| kingdom E | 2 | 3 | 281 |

Hệ quả: sweep tài nguyên của **battlefield** là query đắt nhất hiện tại (đọc 1258 row + `deleteMany`
với `notIn` 1258 id, mỗi 30 s), trong khi kingdom chỉ ~260 row. Kingdom hiện có rất ít entity nên
phần upsert gần như không đáng kể; con số này sẽ tăng theo tiến trình chơi (TC + nhà + lính).

## 4. Ước lượng tải theo quy mô

Giả định: mỗi user 1 kingdom room, cộng thêm 1 battlefield room dùng chung; entity trung bình
B=20/U=40 (mức giữa game) → ~68 statement mỗi lần lưu. **Đây là ước lượng, chưa benchmark** — §7
yêu cầu đo lại trước khi tối ưu.

| User online | Room | Autosave/s | Statement/s (ước lượng) | Tick/s (20 Hz) | Nhận xét |
| --- | --- | --- | --- | --- | --- |
| 2 | 3 | 0,1 | ~10 | 60 | Không đáng kể |
| 10 | 11 | 0,37 | ~25 | 220 | Không đáng kể |
| 100 | 101 | 3,4 | ~230 | 2020 | SQLite còn thoải mái; CPU tick bắt đầu thấy |
| 300 | 301 | 10 | ~680 | 6020 | Prisma overhead + tick O(B×U) mỗi room là vấn đề chính |
| 1000 | 1001 | 33 | ~2300 | 20020 | SQLite 1 writer là nút thắt; RAM/tick phải xử lý trước mức này |

Điểm quan trọng: **số request không phải vấn đề**. 1 request/30 s/user = 0,033 req/s. Vấn đề là
(1) số statement bên trong mỗi request tăng theo số entity, (2) tài nguyên server tỉ lệ tuyến tính
theo số user vì mỗi user một room với tick 20 Hz và một bản đồ đầy đủ trong RAM, (3) SQLite chỉ có
một writer.

## 5. Quyết định (đề xuất, chưa chốt)

| Mã | Quyết định | Trạng thái |
| --- | --- | --- |
| D1 | Autosave chỉ ghi khi **có thay đổi** (dirty flag theo zone: account, entity, resource). Room không ai thao tác vẫn giữ 30 s nhưng bỏ qua write. | ĐỀ XUẤT |
| D2 | Gộp upsert entity thành **1 câu raw `INSERT ... ON CONFLICT(id) DO UPDATE`** cho `buildings` và 1 cho `units`, thay vì B+U câu. | ĐỀ XUẤT |
| D3 | Resource: chỉ ghi node vừa đổi/biến mất, dùng chênh lệch tính từ state trong RAM + sổ node đã persist, **không** `findMany` toàn zone mỗi lần. | ĐỀ XUẤT |
| D4 | Log thêm thời gian và số statement mỗi lần lưu (`⏱️ <zone> saved in X ms, n stmts`) để có baseline trước/sau. | ĐỀ XUẤT |
| D5 | Room không có client: giảm tick (20 Hz → 2 Hz) hoặc tạm dừng simulation, vẫn chạy autosave. Cần kiểm tra lại hành vi combat/respawn khi vắng người. | ĐỀ XUẤT |
| D6 | Giữ SQLite cho dev và tới ~300 user; chỉ migrate Postgres khi vượt ngưỡng đo được ở §7, không migrate sớm. | ĐỀ XUẤT |
| D7 | Giữ chu kỳ 30 s, không tăng tần suất; nếu cần RPO thấp hơn thì ưu tiên save khi có hành động quan trọng thay vì giảm interval toàn cục. | ĐỀ XUẤT |

## 6. Hợp đồng kỹ thuật (nếu chốt D1-D5)

- **Nguồn dirty**: `WorldRoom` gắn cờ khi command/message làm đổi state (`commands`, `combat`,
  `economy`, travel, join/leave). Autosave reset cờ **sau khi** save thành công, không reset khi
  lỗi.
- **Không thay đổi chữ ký** `saveFullWorldState`; thêm option `changed?: { account?: Set<string>;
  entities?: Set<string>; resources?: boolean }` để tương thích test hiện có
  (`WorldRoom.test.ts` mock hàm này).
- **Raw SQL** phải nằm trong `DatabaseService`, dùng `$transaction` sẵn có, giữ nguyên
  `deleteMany` sweep để không bỏ sót entity đã chết.
- **An toàn dữ liệu**: nếu cờ dirty sai, dữ liệu người chơi có thể mất — mọi task phải có test
  "save sau khi không đổi state không ghi gì" và "save sau khi đổi đúng một unit vẫn ghi đủ".
- **Không** đổi `@type()` trong schema → không cần reset DB.

## 7. Task log

| Task | Nội dung | Trạng thái |
| --- | --- | --- |
| `SAVE-01` | Thêm log thời gian + số statement mỗi lần lưu; ghi baseline 1 user / 2 user / 10 client giả lập vào doc này. | TODO |
| `SAVE-02` | Dirty tracking theo zone (D1) + test. | TODO |
| `SAVE-03` | Batch upsert entity (D2) + test so sánh row sau save. | TODO |
| `SAVE-04` | Resource delta, bỏ `findMany` toàn zone (D3) + test node mới/biến mất/đổi lượng. | TODO |
| `SAVE-05` | Idle room tick throttle (D5) + kiểm tra combat/respawn không lệch. | TODO |
| `SAVE-06` | Benchmark script (spawn N client giả, đo autosave ms, p95) — chỉ chạy local. | TODO |
| `SAVE-07` | Cập nhật doc này bằng số đo sau `SAVE-01`/`SAVE-06`. | TODO |

Thứ tự đề xuất: `SAVE-01` → `SAVE-02` → `SAVE-03` → `SAVE-04` → (đo lại) → `SAVE-05` nếu cần →
`SAVE-07`.

## 8. Test và kiểm chứng

- [ ] Unit test: state không đổi → autosave không phát statement nào (spy Prisma).
- [ ] Unit test: đổi 1 unit / xóa 1 building / khai thác 1 node → đúng row trong SQLite đổi, các row
      khác giữ nguyên.
- [ ] Unit test: 2 owner cùng zone (battlefield) → cả hai được lưu, không owner nào bị sweep nhầm.
- [ ] Integration: 2 client thật, 1 ở kingdom + 1 ở battlefield, chờ 2 chu kỳ autosave, đọc DB xác
      nhận `last_saved_at` của cả hai tăng.
- [ ] Benchmark: đo p50/p95 thời gian `saveFullWorldState` trước và sau `SAVE-02`-`SAVE-04`.
- [ ] Chạy lại `pnpm --filter @chien-quoc/server test` và `tsc --noEmit`.

## 9. Rủi ro và edge case

1. **Dirty flag sót** → mất tiến trình khi server tắt. Giảm thiểu: vẫn full-flush ở `onLeave` và
   `onDispose` (đã có), và định kỳ full-save (ví dụ mỗi 5 phút) dù không dirty.
2. **Owner offline trên battlefield**: entity của họ phải được lưu dù không có player entry —
   nhánh `entitiesByOwner` hiện đã xử lý, mọi tối ưu không được bỏ nhánh này.
3. **Travel**: `skipAccountFor` và `saveZonePlayerEntities` là đường ghi riêng; batch upsert phải
   dùng chung, không tạo đường thứ hai lệch hành vi.
4. **`deleteMany notIn` với 1258 id**: hoạt động trên SQLite hiện tại nhưng là điểm cần đo; nếu
   battlefield lớn hơn nữa phải chuyển sang bảng tạm hoặc đánh dấu `saved_epoch`.
5. **WAL phình**: ghi ít đi nhưng checkpoint vẫn cần theo dõi dung lượng `dev.db-wal`.
6. **Đa tiến trình**: nếu sau này chạy nhiều process Colyseus, hàng đợi theo zone trong RAM không
   còn tác dụng — lúc đó phải khoá ở DB hoặc shard zone theo process.
7. **Prisma raw SQL**: dễ sai kiểu/escape; mọi câu raw phải có test đọc lại dữ liệu.

## 10. Definition of Done

- [ ] Có số đo trước/sau cho ít nhất 1 user và 10 client giả lập, ghi trong §4 (thay ước lượng).
- [ ] `SAVE-01`..`SAVE-04` xong, test xanh, `tsc --noEmit` sạch.
- [ ] Không đổi schema/`@type()`, không cần reset DB.
- [ ] Log autosave nêu rõ zone, số player, thời gian — người đọc log hiểu ngay "Players" là theo map.
- [ ] Doc này được cập nhật số thật, không còn dòng "ước lượng" ở phần đã đo.

## 11. Ngoài phạm vi

- Migrate PostgreSQL, connection pool, read replica: chỉ xét khi `SAVE-06` cho thấy SQLite là nút
  thắt thật (p95 autosave > 1 s hoặc tranh chấp writer).
- Shard zone sang nhiều process/Redis presence.
- Tối ưu simulation tick (pathfinding, combat) — thuộc phase riêng.
- Thay đổi nội dung gameplay hay số lượng entity mỗi map.
