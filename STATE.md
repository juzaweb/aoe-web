# Loop State — Chien Quoc (2D MMO RTS)

Last run: 2026-11-03 — `ALERT-01` shipped as PR #5. The tables below were reconciled by hand
against `docs/plans/` the same day: 8 phases were missing entirely, and `pick` had been
blanking every other row, which emptied the queue. See `loop-run-log.md` for the runs.

Pipeline: `/loop-triage` → `/loop-pick` → `/loop-plan` → `/loop-build` → `/loop-verify` →
`/loop-ship`. One slice at a time. `pick` is the only step that needs a human; every other
step runs unattended in `.github/workflows/loop.yml`, which merges verified slices into
`develop` without waiting for a reviewer. See `LOOP.md`.

Baseline at last run: `apps/client` 367 tests passed, `apps/server` 167 tests passed.

## High Priority (loop is acting or waiting on human)

| ID | Slice | Why it matters | Next action | Effort | ROI |
| --- | --- | --- | --- | --- | --- |
| `ALERT-01` | **Cảnh báo khi bị tấn công** (banner + ping minimap) | Người chơi hiện **không có bất kỳ tín hiệu nào** khi quân/nhà của mình bị đánh. `hp` có replicated nhưng client chỉ vẽ thanh máu nhỏ ở sprite; không âm thanh, không banner, minimap không nháy. Trong AoE2 đây là tính năng phòng thủ cốt lõi ("Your town is under attack"). | `SHIPPED 2026-11-03 — PR #5` | M | 1 |
| `SAVE-01` | Log thời gian + số statement mỗi lần autosave | Phase 10 (DRAFT) cần baseline trước khi tối ưu dirty tracking. Hiện log chỉ có `Players/Buildings/Units`, không có `ms` → không so sánh được trước/sau. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/6` | S | 2 |
| `FLOW-01` | Bảng "lệnh bị từ chối" có phân loại | 64 chỗ `rejectCommand` (server) đều đổ về **một** notification đỏ chung (`ERROR_NOTIFICATION`). Người chơi không phân biệt "thiếu tài nguyên" với "ô bị chặn". | `blocked` — needs a UX decision first | M | 3 |
| `ALERT-02` | Âm thanh cảnh báo + trạng thái "đang bị đánh" trong panel | Phụ thuộc `ALERT-01`. Repo **không có** bất kỳ audio layer nào (`grep sound|audio|AudioContext` → 0 hit). | `candidate` | S | 4 |

## Agent-ready backlog (chưa implement, loop làm được)

Cùng luật với High Priority: row ghi `candidate` là slice agent được phép nhận. Row ghi
`blocked` thì không — `Resolve slice` bỏ qua, vì cái thiếu là một **quyết định** hoặc một
**số đo**, không phải một dòng code.

| ID | Slice | Why it matters | Next action | Effort | ROI |
| --- | --- | --- | --- | --- | --- |
| `ALERT-03` | Cảnh báo khi công trình foundation bị phá | `hp` của foundation không có bar riêng ngoài thanh tiến độ, nên công trình đang xây bị đánh mà người chơi không biết. Client-only; tracker của `ALERT-01` tái dùng được. | `candidate` | S | 5 |
| `SAVE-06` | Script benchmark autosave (spawn N client giả, đo p95) | Phase 10 §7: `SAVE-02..05` chỉ nên mở khi có số đo, mà hiện không có cách đo. Script chạy local, không đụng runtime. | `candidate` | S | 10 |
| `TEST-01` | Test trực tiếp cho persistence | `saveFullWorldState`, `saveZoneResources`, `initializeWorldPersistence` không có test trực tiếp (grep `*.test.ts` → 0 hit, chỉ mock trong `WorldRoom.test.ts`). Không có lưới này thì `SAVE-03`/`SAVE-04` không verify được. | `candidate` | M | 9 |
| `DOC-01` | Sửa status trong `docs/plans/README.md` | Index ghi phase 01 "APPROVED — chưa có dòng code" trong khi `OWN-01..05` đã có trong code (`ownerColor.ts`, ownership ring/diamond, `ownerColorCss`), và ghi phase 12 "APPROVED — chờ code" trong khi `ALERT-01` đã shipped ở PR #5. Doc chỉ, không sửa code. | `candidate` | S | 7 |
| `SAVE-02` | Dirty tracking theo zone | Phase 10 D1. Cần biết zone nào thực sự dirty trước khi bỏ upsert toàn bộ. | `blocked` — chờ số đo từ `SAVE-01` + `SAVE-06` | L | 6 |
| `SAVE-03` | Batch upsert entity | Nút thắt thật theo phase 10 §2: mỗi entity một upsert, SQLite chỉ một writer. Là đòn bẩy lớn nhất nhưng phải có `TEST-01` trước. | `blocked` — chờ `SAVE-01` + `TEST-01` | L | 6 |
| `SAVE-04` | Resource delta, bỏ `findMany` toàn zone | 1258 node ở battlefield: đọc cả zone mỗi lần lưu là chi phí cố định vô ích. | `blocked` — chờ `SAVE-01` + `TEST-01` | L | 6 |
| `SAVE-05` | Throttle tick 20 Hz của room rỗng | 20 Hz cho mỗi room, kể cả khi không có ai; dễ làm lệch combat/respawn nên đi sau cùng. | `blocked` — chờ `SAVE-02` | L | 6 |
| `OWN-06` | Tint sprite theo màu chủ | Phase 01 §9 xếp DEFERRED; chỉ bật khi WebGL. Ghi lại để không mất dấu, không tự mở. | `blocked` — bạn đã DEFERRED ở phase 01 | S | 11 |

## Human-only backlog (agent không làm được)

Không việc nào ở đây được ghi `candidate`: agent không có đường nào hoàn thành chúng.

| Việc | Vì sao chặn |
| --- | --- |
| 7 asset thiếu nguồn: Farm, Watch Tower, Gold Mine, Stone Mine, Berry Bush, Cavalry, Icon HUD 64×64, cursor 32×32 (phase 06 §5) | Cần art, và AGENTS.md cấm tự vẽ. Portal + road đã xong ở phase 09. |
| Verify tay phase 03 §9, 04 §10, 05 §12.4, 06 §16.4, 07 §7, 08 §10, 09 §7.2 | Cần nhìn UI thật; 58 checkbox `- [ ]` chưa tick trong `docs/plans/`. |
| Verify phase 11 trên iOS Safari thật (§11.4) | Page-zoom, safe-area, reconnect sau khoá màn hình. |
| `SAVE-07` | Cần số đo thật sinh ra từ `SAVE-01` + `SAVE-06` trên máy bạn. |
| `FLOW-01` (ROI 3) | Cần quyết định UX: chia lỗi bị từ chối thành mấy nhóm, đặt tên gì. |

## Watch List

- `DOC-02` (S, ROI 8): `SAVE-*` chưa xuất hiện trong code (đúng như phase 10 vẫn `DRAFT`); `LVL2-*` đã
  có marker trong `upgrades.test.ts`/`WorldRoom.test.ts` (phase 08 `IMPLEMENTED`). Chỉ là convention
  marker, không phải lỗi.
- Phase 02 (`SESS-01..07`) đang `DONE — code + test`; phase 12 (`ATK-01..05`) đã code đủ và ship ở
  PR #5. Cả hai không cần row trong bảng nào ở trên, nhưng `docs/plans/README.md` vẫn ghi phase 12
  là `APPROVED — chờ code` — đó chính là `DOC-01`.

## Recent Noise (ignored this run)

- `.codegraph` yêu cầu cập nhật v1.5.0 → v1.6.2: không liên quan codebase.
- `pnpm` báo có v12.16.1: không nằm trong scope.
- `TODO/FIXME/HACK` trong source: **0 hit** — không có nợ kỹ thuật đánh dấu sẵn để dọn.

---
Run log: `loop-run-log.md`