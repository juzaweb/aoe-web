# Loop State — Chien Quoc (2D MMO RTS)

Last run: 2026-11-03 (triage L1 only — no slice promoted, nothing implemented)

Pipeline: `/loop-triage` → `/loop-pick` → `/loop-plan` → `/loop-build` → `/loop-verify` →
`/loop-ship`. One slice at a time. `pick` is the only step that needs a human; every other
step runs unattended in `.github/workflows/loop.yml`, which merges verified slices into
`develop` without waiting for a reviewer. See `LOOP.md`.

Baseline at last run: `apps/client` 355 tests passed, `apps/server` 167 tests passed.

## High Priority (loop is acting or waiting on human)

| ID | Slice | Why it matters | Next action | Effort | ROI |
| --- | --- | --- | --- | --- | --- |
| `ALERT-01` | **Cảnh báo khi bị tấn công** (banner + ping minimap) | Người chơi hiện **không có bất kỳ tín hiệu nào** khi quân/nhà của mình bị đánh. `hp` có replicated nhưng client chỉ vẽ thanh máu nhỏ ở sprite; không âm thanh, không banner, minimap không nháy. Trong AoE2 đây là tính năng phòng thủ cốt lõi ("Your town is under attack"). | `candidate` | M | 1 |
| `SAVE-01` | Log thời gian + số statement mỗi lần autosave | Phase 10 (DRAFT) cần baseline trước khi tối ưu dirty tracking. Hiện log chỉ có `Players/Buildings/Units`, không có `ms` → không so sánh được trước/sau. | `candidate` | S | 2 |
| `FLOW-01` | Bảng "lệnh bị từ chối" có phân loại | 64 chỗ `rejectCommand` (server) đều đổ về **một** notification đỏ chung (`ERROR_NOTIFICATION`). Người chơi không phân biệt "thiếu tài nguyên" với "ô bị chặn". | `candidate` — needs a UX decision first | M | 3 |
| `ALERT-02` | Âm thanh cảnh báo + trạng thái "đang bị đánh" trong panel | Phụ thuộc `ALERT-01`. Repo **không có** bất kỳ audio layer nào (`grep sound|audio|AudioContext` → 0 hit). | `candidate` — blocked by `ALERT-01` | S | 4 |

## Watch List

- `ALERT-03` (S, ROI 5): cảnh báo công trình foundation bị phá (hiện `hp` của foundation chưa có bar riêng
  ngoài thanh tiến độ) — cân nhắc sau `ALERT-01`.
- `SAVE-02`..`SAVE-05` (L, ROI 6) (phase 10): chỉ mở khi `SAVE-01` cho thấy p95 autosave > 1 s.
- `DOC-01` (S, ROI 7): `docs/plans/README.md` ghi phase 01 "APPROVED — chưa có dòng code" nhưng code **đã có**
  `OWN-01..OWN-05` (`ownerColor.ts`, `EntityRenderer` ownership ring/diamond, `Minimap` dùng
  `ownerColorCss`). Status trong index đã lệch thực tế → cập nhật doc, không sửa code.
- `DOC-02` (S, ROI 8): `SAVE-*` chưa xuất hiện trong code (đúng như phase 10 vẫn `DRAFT`); `LVL2-*` đã
  có marker trong `upgrades.test.ts`/`WorldRoom.test.ts` (phase 08 `IMPLEMENTED`). Chỉ là convention
  marker, không phải lỗi.
- `TEST-01` (M, ROI 9): `saveFullWorldState`, `saveZoneResources`, `initializeWorldPersistence` **không có**
  test trực tiếp (grep `*.test.ts` → 0 hit, chỉ mock trong `WorldRoom.test.ts`). Mọi thay đổi
  persistence phải thêm test.

## Recent Noise (ignored this run)

- `.codegraph` yêu cầu cập nhật v1.5.0 → v1.6.2: không liên quan codebase.
- `pnpm` báo có v12.16.1: không nằm trong scope.
- `TODO/FIXME/HACK` trong source: **0 hit** — không có nợ kỹ thuật đánh dấu sẵn để dọn.

---
Run log: `loop-run-log.md`