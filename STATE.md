# Loop State — Chien Quoc (2D MMO RTS)

Last run: 2026-11-04 — **human decision recorded**. `FLOW-01` unblocked: payload
`{ message, code: RejectCode }` (code mandatory, option A), 8 groups
`RESOURCE/PLACEMENT/PREREQUISITE/BUSY/GONE/INVALID/FORBIDDEN/LIMIT`, client varies colour +
icon per group (3.5s, no audio — `ALERT-02` owns audio), `packages/shared/src/types/index.ts`
may be edited for this slice only. `FLOW-01` is now the first `candidate` row; `DOC-03` still
queued behind it. No source code touched in this edit.

Previous triage run: 2026-11-04 — daily triage (report-only). No new shipments since the previous run
(HEAD 1616c35 = merge of PR #13 state-triage). All four evidence sources re-swept; no new
slices proposed. Shipped to date: `ALERT-01` (PR #5), `SAVE-01` (PR #6), `ALERT-02` (PR #8),
`ALERT-03` (PR #9), `SAVE-06` (PR #10), `TEST-01` (PR #11), `DOC-01` (PR #12); tests green
(client 383, server 184), build OK. Plan status drift still only phases 15 & 18 (still `APPROVED`
though shipped) — `DOC-03` candidate. Asset gap: `mill.png`/`mining_camp.png` (WATCH-05) plus
terrain grass/dirt legacy (WATCH-06, new) have no licensed source / no `CREDITS.md` section.
Unchecked DoD boxes still 60 (`grep -rnE '^\s*- \[ \]' docs/plans/` → 60). CI on `develop`: no
red `ci.yml` runs; the two `loop/` branch failures (run ids 41769065653, 41772382791) already
replaced by the retry loop — ignored; earlier `Loop` workflow failures on develop (run ids
41660755613, 41665677527, 41673640446, 41674921220, 41745494265) were transitional (missing
secret / no candidate row) and have since been replaced by successful runs. PR feedback: only
Jules bot auto-comments on PRs #1–#3, no unanswered human review. No source code touched.
See `loop-run-log.md`.
Pipeline: `/loop-triage` → `/loop-pick` → `/loop-plan` → `/loop-build` → `/loop-verify` →
`/loop-ship`. One slice at a time. `pick` is the only step that needs a human; every other
step runs unattended in `.github/workflows/loop.yml`, which merges verified slices into
`develop` without waiting for a reviewer. See `LOOP.md`.

Baseline at last run: `apps/client` 383 tests passed, `apps/server` 184 tests passed.

## High Priority (loop is acting or waiting on human)

| ID | Slice | Why it matters | Next action | Effort | ROI |
| --- | --- | --- | --- | --- | --- |
| `ALERT-01` | **Cảnh báo khi bị tấn công** (banner + ping minimap) | Người chơi hiện **không có bất kỳ tín hiệu nào** khi quân/nhà của mình bị đánh. `hp` có replicated nhưng client chỉ vẽ thanh máu nhỏ ở sprite; không âm thanh, không banner, minimap không nháy. Trong AoE2 đây là tính năng phòng thủ cốt lõi ("Your town is under attack"). | `SHIPPED 2026-11-03 — PR #5` | M | 1 |
| `SAVE-01` | Log thời gian + số statement mỗi lần autosave | Phase 10 (DRAFT) cần baseline trước khi tối ưu dirty tracking. Hiện log chỉ có `Players/Buildings/Units`, không có `ms` → không so sánh được trước/sau. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/6` | S | 2 |
| `FLOW-01` | Bảng "lệnh bị từ chối" có phân loại | 54 call site `rejectCommand` (`CommandSystem.ts` 46 + `EconomySystem.ts` 8) đều đổ về **một** notification đỏ chung (`WorldRoom.ts:1225`, payload chỉ có `message`). Người chơi không phân biệt "thiếu tài nguyên" với "ô bị chặn". **Đã chốt 2026-11-04:** payload `{ message, code: RejectCode }` với `code` **bắt buộc** (phương án A); 8 nhóm `RESOURCE, PLACEMENT, PREREQUISITE, BUSY, GONE, INVALID, FORBIDDEN, LIMIT`; client đổi màu + icon theo nhóm, giữ 3.5s, **không** âm thanh (tránh trùng `ALERT-02`). | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/15` | M | 3 |
| `ALERT-02` | Âm thanh cảnh báo + trạng thái "đang bị đánh" trong panel | Phụ thuộc `ALERT-01`. Repo **không có** bất kỳ audio layer nào (`grep sound|audio|AudioContext` → 0 hit). | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/8` | S | 4 |

## Agent-ready backlog (chưa implement, loop làm được)

Cùng luật với High Priority: row ghi `candidate` là slice agent được phép nhận. Row ghi
`blocked` thì không — `Resolve slice` bỏ qua, vì cái thiếu là một **quyết định** hoặc một
**số đo**, không phải một dòng code.

| ID | Slice | Why it matters | Next action | Effort | ROI |
| --- | --- | --- | --- | --- | --- |
| `ALERT-03` | Cảnh báo khi công trình foundation bị phá | `hp` của foundation không có bar riêng ngoài thanh tiến độ, nên công trình đang xây bị đánh mà người chơi không biết. Client-only; tracker của `ALERT-01` tái dùng được. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/9` | S | 5 |
| `SAVE-06` | Script benchmark autosave (spawn N client giả, đo p95) | Phase 10 §7: `SAVE-02..05` chỉ nên mở khi có số đo, mà hiện không có cách đo. Script chạy local, không đụng runtime. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/10` | S | 10 |
| `TEST-01` | Test trực tiếp cho persistence | `saveFullWorldState`, `saveZoneResources`, `initializeWorldPersistence` không có test trực tiếp (grep `*.test.ts` → 0 hit, chỉ mock trong `WorldRoom.test.ts`). Không có lưới này thì `SAVE-03`/`SAVE-04` không verify được. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/11` | M | 9 |
| `DOC-01` | Sửa status trong `docs/plans/` (README + file plan) | README ghi phase 01 "APPROVED — chờ code" và phase 12 "APPROVED — chờ code" trong khi code đã có (`OWN-01..05` trong `ownerColor.ts`/ring/diamond/`ownerColorCss`) và `ALERT-01` đã shipped PR #5; phase 13 vẫn "IMPLEMENTED — chờ verify" dù `SAVE-01` shipped PR #6. File plan 01/12/13 cũng còn `APPROVED` và DoD checkbox tự động chưa tick. Doc chỉ, không sửa code. | `SHIPPED 2026-11-04 — https://github.com/juzaweb/chien-quoc/pull/12` | S | 7 |
| `DOC-03` | Sửa status phase 15 & 18 trong `docs/plans/` (README + file plan) | README phase 15 vẫn "APPROVED — chờ code" và phase 18 "APPROVED — awaiting code" dù `ALERT-03` shipped PR #9 và `DOC-01` shipped PR #12; file plan 15 & 18 còn status `APPROVED`. DoD tự động đã tick (phase 15: 4/4; phase 18: 5/5). Doc chỉ, không sửa code. | `candidate` | S | 7 |
| `SAVE-02` | Dirty tracking theo zone | Phase 10 D1. Cần biết zone nào thực sự dirty trước khi bỏ upsert toàn bộ. | `blocked` — chờ số đo từ `SAVE-01` + `SAVE-06` | L | 6 |
| `SAVE-03` | Batch upsert entity | Nút thắt thật theo phase 10 §2: mỗi entity một upsert, SQLite chỉ một writer. Là đòn bẩy lớn nhất nhưng phải có `TEST-01` trước. | `blocked` — chờ `SAVE-01` + `TEST-01` | L | 6 |
| `SAVE-04` | Resource delta, bỏ `findMany` toàn zone | 1258 node ở battlefield: đọc cả zone mỗi lần lưu là chi phí cố định vô ích. | `blocked` — chờ `SAVE-01` + `TEST-01` | L | 6 |
| `SAVE-05` | Throttle tick 20 Hz của room rỗng | 20 Hz cho mỗi room, kể cả khi không có ai; dễ làm lệch combat/respawn nên đi sau cùng. | `blocked` — chờ `SAVE-02` | L | 6 |
| `OWN-06` | Tint sprite theo màu chủ | Phase 01 §9 xếp DEFERRED; chỉ bật khi WebGL. Ghi lại để không mất dấu, không tự mở. | `blocked` — bạn đã DEFERRED ở phase 01 | S | 11 |
## Human-only backlog (agent không làm được)

Không việc nào ở đây được ghi `candidate`: agent không có đường nào hoàn thành chúng.

| Việc | Vì sao chặn |
| --- | --- |
| 8 asset thiếu nguồn: Farm, Watch Tower, Gold Mine, Stone Mine, Berry Bush, Cavalry, Icon HUD 64×64, cursor 32×32 (phase 06 §5) | Cần art, và AGENTS.md cấm tự vẽ. Portal + road đã xong ở phase 09. |
| Verify tay phase 03 §9, 04 §10, 05 §12.4, 06 §16.4, 07 §7, 08 §10, 09 §7.2 | Cần nhìn UI thật; 60 checkbox `- [ ]` chưa tick trong `docs/plans/`. |
| Verify phase 11 trên iOS Safari thật (§11.4) | Page-zoom, safe-area, reconnect sau khoá màn hình. |
| `SAVE-07` | Cần số đo thật sinh ra từ `SAVE-01` + `SAVE-06` trên máy bạn. |

## Watch List

- `DOC-02` (S, ROI 8): `SAVE-*` chưa xuất hiện trong code (đúng như phase 10 vẫn `DRAFT`); `LVL2-*` đã
  có marker trong `upgrades.test.ts`/`WorldRoom.test.ts` (phase 08 `IMPLEMENTED`). Chỉ là convention
  marker, không phải lỗi.
- `WATCH-01` (S, ROI 12): Baseline `SAVE-01` cho thấy autosave rẻ (~10 ms/save, ≤12 stmts/zone, kể cả
  10 client giả lập). `SAVE-02..05` có thể thấp ROI hơn giả định; giữ `blocked` cho đến khi `SAVE-06`
  có số đo p95 thật. Chỉ theo dõi, chưa mở.
- `WATCH-02` (S, ROI 13): Bundle client 2.0 MB (500 KB gz) vượt ngưỡng cảnh báo Vite; mobile (phase 11)
  có thể cảm nhận. Chưa chặn; theo dõi nếu thêm asset. Nếu mở, cần code-split/dynamic import.
- `WATCH-03` (S, ROI 14): `pnpm --filter @chien-quoc/server test` fail trên clone mới vì thiếu
  `prisma generate` (`index.test.ts`); `scripts/run-tests.sh` đã cover. DX nhỏ, không chặn CI.
- `WATCH-04` (S, ROI 15): 60 checkbox DoD chưa tick trong `docs/plans/` (manual verify, human-only);
  đếm cập nhật từ 64 → 60 (`grep -rnE '^\s*- \[ \]' docs/plans/` → 60). Không phải nợ code.
- `WATCH-05` (S, ROI 16): `mill.png` và `mining_camp.png` là art AI cũ, legacy, không có nguồn
  licensed rebuild: `scripts/assets/assets.lock.json` `legacy` (không có `targets` entry cho hai path
  này) và `CREDITS.md` không có section. Plan 06 §5 không liệt kê hai file này (chỉ Farm/Watch Tower/
  Gold Mine/Stone Mine/Berry Bush/Cavalry/Icon HUD/cursor). Cùng blocker với các asset thiếu nguồn
  khác (cần art; AGENTS.md cấm tự vẽ). Chỉ theo dõi, không mở slice.
- `WATCH-06` (S, ROI 17): terrain legacy (`grass.png`, `grass_1..3.png`, `dirt.png`, `dirt_1..3.png`)
  không có nguồn licensed và không có section trong `CREDITS.md`: `scripts/assets/assets.lock.json`
  `legacy` (không có `targets` entry cho 8 path này), `scripts/assets/manifest.json` `targets` không
  chứa terrain, `CREDITS.md` không có mục terrain. Plan 06 §16.3 đã bỏ `ART-03` (atlas
  `grassland_tiles.png` không cắt được thành diamond 64×32, render unlit mean RGB (60,56,44) so với
  grass hiện tại (102,123,44)) — D2 (CC-BY-SA) vì thế không áp dụng. Chỉ theo dõi; cần một nguồn
  tile mới hoặc quyết định paint-over trước khi mở slice.
- Phase 02 (`SESS-01..07`) đang `DONE — code + test`; phase 12 (`ATK-01..05`) đã code đủ và ship ở
  PR #5; phase 13 (`SAVE-01`) ship ở PR #6. Phase 15 (`ALERT-03`) ship ở PR #9 và phase 18 (`DOC-01`)
  ship ở PR #12; drift còn lại là status `APPROVED` cho hai phase này — đó chính là `DOC-03`.

## Recent Noise (ignored this run)

- `.codegraph` yêu cầu cập nhật v1.5.0 → v1.6.2: không liên quan codebase.
- `pnpm` báo có v12.16.1: không nằm trong scope.
- `TODO/FIXME/HACK` trong source: **0 hit** — không có nợ kỹ thuật đánh dấu sẵn để dọn.
- `console.log` 27 hit và 2 `catch {}` rỗng trong source (đếm lại 2026-11-04): nợ chất lượng nhỏ,
  không chặn; để cho vòng code-review, không mở slice triage.
- `Loop` workflow failures trên `develop` trước 2026-11-04 03:22 UTC (run ids 41660755613,
  41665677527, 41673640446, 41674921220, 41745494265): transitional (secret chưa set / chưa có
  `candidate` row), đã được các run sau thay thế — không phải regression code. `ci.yml` trên
  `develop` không có run đỏ.

---
Run log: `loop-run-log.md`