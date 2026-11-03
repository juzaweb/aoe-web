# Loop State — Chien Quoc (2D MMO RTS)

Last run: 2026-11-03 (triage L1 only — no slice promoted, nothing implemented)

Loop mode: **L1 report-only** by default. The full pipeline is `/loop-triage` → `/loop-pick` →
`/loop-plan` → `/loop-build` → `/loop-verify` → `/loop-ship`. One slice moves at a time, and a
human decides at step 2. See `LOOP.md` for the status vocabulary each command enforces.

Baseline at last run: `apps/client` 355 tests passed, `apps/server` 167 tests passed.

## High Priority (loop is acting or waiting on human)

| ID | Slice | Why it matters | Next action | Effort |
| --- | --- | --- | --- | --- |
| `ALERT-01` | **Cảnh báo khi bị tấn công** (banner + ping minimap) | Người chơi hiện **không có bất kỳ tín hiệu nào** khi quân/nhà của mình bị đánh. `hp` có replicated nhưng client chỉ vẽ thanh máu nhỏ ở sprite; không âm thanh, không banner, minimap không nháy. Trong AoE2 đây là tính năng phòng thủ cốt lõi ("Your town is under attack"). | `candidate` | M |
| `ALERT-02` | Âm thanh cảnh báo + trạng thái "đang bị đánh" trong panel | Phụ thuộc `ALERT-01`. Repo **không có** bất kỳ audio layer nào (`grep sound|audio|AudioContext` → 0 hit). | `candidate` — blocked by `ALERT-01` | S |
| `SAVE-01` | Log thời gian + số statement mỗi lần autosave | Phase 10 (DRAFT) cần baseline trước khi tối ưu dirty tracking. Hiện log chỉ có `Players/Buildings/Units`, không có `ms` → không so sánh được trước/sau. | `candidate` — touches `DatabaseService` (denylisted) | S |
| `FLOW-01` | Bảng "lệnh bị từ chối" có phân loại | 40 chỗ `rejectCommand` đều đổ về **một** notification đỏ chung. Người chơi không phân biệt "thiếu tài nguyên" với "ô bị chặn". | `candidate` — needs a UX decision first | M |

## Watch List

- `ALERT-03`: cảnh báo công trình foundation bị phá (hiện `hp` của foundation chưa có bar riêng
  ngoài thanh tiến độ) — cân nhắc sau `ALERT-01`.
- `SAVE-02`..`SAVE-05` (phase 10): chỉ mở khi `SAVE-01` cho thấy p95 autosave > 1 s.
- `DOC-01`: `docs/plans/README.md` ghi phase 01 "APPROVED — chưa có dòng code" nhưng code **đã có**
  `OWN-01..OWN-05` (`ownerColor.ts`, `EntityRenderer` ownership ring/diamond, `Minimap` dùng
  `ownerColorCss`). Status trong index đã lệch thực tế → cập nhật doc, không sửa code.
- `DOC-02`: `LVL2-*` và `SAVE-*` không xuất hiện trong code; phase 08 mô tả là "đã code xong"
  nhưng không có marker task-id. Không phải lỗi, chỉ là convention marker không được áp dụng.
- `TEST-01`: `saveFullWorldState`, `saveZoneResources`, `initializeWorldPersistence` **không có**
  test trực tiếp (codegraph báo "no covering tests"). Mọi thay đổi persistence phải thêm test.

## Recent Noise (ignored this run)

- `.codegraph` yêu cầu cập nhật v1.5.0 → v1.6.2: không liên quan codebase.
- `pnpm` báo có v12.16.1: không nằm trong scope.
- `TODO/FIXME/HACK` trong source: **0 hit** — không có nợ kỹ thuật đánh dấu sẵn để dọn.

---
Run log: `loop-run-log.md`