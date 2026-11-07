# Phase 18 — Sửa status trong `docs/plans/` (README + file plan) (`DOC-01`)

**Mục tiêu:** đưa trạng thái ghi trong `docs/plans/` khớp với code thật đã có/shipped, chỉ sửa tài
liệu, không sửa code. Ba file plan (`01`, `12`, `13`) và bảng phase trong `README.md` đang stale:
phase 01/12 vẫn `APPROVED — chờ code` dù `OWN-01..OWN-05` và `ATK-01..ATK-05` đã có code/shipped;
phase 13 vẫn `IMPLEMENTED — chờ verify` dù `SAVE-01` đã shipped PR #6 và DoD đã tick đủ. Đồng thời
tick các checkbox DoD **tự động** (tsc/vitest/ràng buộc tĩnh) đã đúng sự thật, giữ checkbox verify
tay.

> **Status: `APPROVED`** (chốt 2026-11-04). Slice `DOC-01` đã được duyệt; tài liệu này là toàn bộ
> nội dung của bước plan. Doc-only, không đụng source code, schema, protocol, DB.

Phạm vi: `docs/plans/` (+ `STATE.md`). **Không** đổi `apps/*`, `packages/*`, schema, protocol, DB.

---

## 1. Mục tiêu

1. `docs/plans/README.md`: hàng phase 01/12/13 mang status đúng với thực tế; thêm hàng phase 18.
2. `docs/plans/01-owner-visibility.md`: status `APPROVED` → `IMPLEMENTED` (code + test có, chờ verify tay);
   tick checkbox DoD tự động.
3. `docs/plans/12-under-attack-alert.md`: status `APPROVED` → `IMPLEMENTED` (shipped PR #5, chờ verify tay);
   tick checkbox DoD tự động.
4. `docs/plans/13-autosave-timing-log.md`: status `APPROVED` → `DONE` (DoD tick đủ, shipped PR #6);
   cập nhật nhật ký.
5. Giữ nguyên các checkbox verify tay (chưa tick) và không thêm claim verify chưa có.

---

## 2. Hiện trạng (đối chiếu code)

| Thành phần | Trạng thái thật | Vị trí |
| --- | --- | --- |
| `OWN-01..OWN-05` | code có (`ownerColor.ts`, ring/diamond/`ownerColorCss`) + test `ownerColor.test.ts` | `apps/client/src/game/render/ownerColor.ts` |
| `OWN-06` | DEFERRED (tint sprite, chỉ khi WebGL) | `docs/plans/01-owner-visibility.md` §9 |
| `ATK-01..ATK-05` | shipped PR #5 (ALERT-01) | `STATE.md` High Priority |
| `SAVE-01` | shipped PR #6; DoD phase 13 tick đủ; baseline §4b phase 10 đã điền | `docs/plans/13-...`, `docs/plans/10-...` |
| Phase 01/12 status | vẫn `APPROVED` trong file plan và README | `docs/plans/01...`, `docs/plans/12...`, `README.md` |
| Phase 13 status | vẫn `APPROVED` trong file plan, README ghi `IMPLEMENTED — chờ verify` | `docs/plans/13...`, `README.md` |
| DoD tự động phase 01/12 | chưa tick (manual scenario chưa tick) | `docs/plans/01...`, `docs/plans/12...` |

---

## 3. Quyết định thiết kế

### D1 — CHỐT: chỉ sửa tài liệu, không sửa code

DOC-01 là slice doc-only. Không đụng `apps/*`, `packages/*`, schema, protocol, DB, asset. Mọi thay đổi
đều trong `docs/plans/` và `STATE.md`.

### D2 — CHỐT: status target theo mức verify đã có

| Phase | Status hiện tại (file/README) | Status target | Lý do |
| --- | --- | --- | --- |
| 01 | `APPROVED` / `APPROVED — chờ code` | `IMPLEMENTED` / `IMPLEMENTED — chờ verify tay` | code + test có; manual scenario (screenshot) chưa có bằng chứng |
| 12 | `APPROVED` / `APPROVED — chờ code` | `IMPLEMENTED` / `IMPLEMENTED — chờ verify` | shipped PR #5; DoD manual scenario chưa tick |
| 13 | `APPROVED` / `IMPLEMENTED — chờ verify` | `DONE` / `DONE — code + test` | DoD §9 tick đủ, shipped PR #6 |

Không dùng nhãn `SHIPPED` trong `docs/plans/` (vocabulary README chỉ có `DRAFT/APPROVED/IMPLEMENTED/DONE`);
việc shipped được theo dõi ở `STATE.md`.

### D3 — CHỐT: chỉ tick checkbox "tự động" trong DoD

Tick các mục có thể kiểm chứng bằng tsc/vitest/ràng buộc tĩnh (đã đúng sự thật do code shipped).
Giữ **chưa tick** các mục verify tay (screenshot/kịch bản) vì chưa có bằng chứng. Không tick "Mỗi
task một commit" nếu chưa đối chiếu git history — để build step quyết định theo git log.

### D4 — CHỐT: không claim verify chưa có

Không thêm câu "đã verify tay" cho phase 01/12. Giữ rõ "chờ verify tay" trong status để không mâu
thuẫn với Human-only backlog.

---

## 4. Task

Size: **S** < 2h, **M** ~ nửa ngày, **L** ≥ 1 ngày.

| Task | Size | Phụ thuộc | Nội dung |
| --- | --- | --- | --- |
| `DOC-01A` | S | — | Cập nhật `docs/plans/01-owner-visibility.md`: status line + tick DoD tự động + nhật ký |
| `DOC-01B` | S | — | Cập nhật `docs/plans/12-under-attack-alert.md`: status line + tick DoD tự động + nhật ký |
| `DOC-01C` | S | — | Cập nhật `docs/plans/13-autosave-timing-log.md`: status line `APPROVED` → `DONE` + nhật ký |
| `DOC-01D` | S | DOC-01A/B/C | Cập nhật `docs/plans/README.md`: hàng 01/12/13 + thêm hàng 18; kiểm tra nhất quán |

### DOC-01A — `docs/plans/01-owner-visibility.md`

- Thay dòng status (hiện `APPROVED`, chốt 2026-11-01, "Chưa có dòng code nào") bằng:
  `> **Status: `IMPLEMENTED`** (cập nhật 2026-11-04). `OWN-01..OWN-05` đã có code
  (`ownerColor.ts`/ring/diamond/`ownerColorCss`) và test (`ownerColor.test.ts`); `OWN-06` vẫn DEFERRED.
  Chờ verify tay (kịch bản §6 + screenshot).`
- DoD §10: tick `[x]` cho 4 mục bắt buộc §6 xanh, không đụng protocol/schema, không polling `update()`,
  comment tiếng Anh. Giữ `[ ]` cho kịch bản tay + screenshot.
- Nhật ký §12: thêm dòng 2026-11-04 cập nhật status `APPROVED` → `IMPLEMENTED` (DOC-01).

### DOC-01B — `docs/plans/12-under-attack-alert.md`

- Thay dòng status (hiện `APPROVED`, chốt 2026-11-03) bằng:
  `> **Status: `IMPLEMENTED`** (cập nhật 2026-11-04). `ATK-01..ATK-05` shipped PR #5; code + test xanh;
  manual scenario (banner/ping/screenshot) chờ verify.`
- DoD §10: tick `[x]` cho 4 mục bắt buộc §6 xanh, không đụng protocol/schema/DB, không polling `update()`,
  comment tiếng Anh. Giữ `[ ]` cho kịch bản tay + screenshot.
- Nhật ký (nếu có) hoặc thêm mục Nhật ký: dòng 2026-11-04 cập nhật status `APPROVED` → `IMPLEMENTED` (DOC-01).

### DOC-01C — `docs/plans/13-autosave-timing-log.md`

- Thay dòng status (hiện `APPROVED`, chốt 2026-11-04) bằng:
  `> **Status: `DONE`** (cập nhật 2026-11-04). Slice `SAVE-01` build + test xanh và shipped PR #6;
  DoD §9 tick đủ.`
- DoD §9 đã `[x]` đầy đủ → không thay đổi checkbox.
- Nhật ký §9/§10: thêm dòng 2026-11-04 cập nhật status `APPROVED` → `DONE` (DOC-01).

### DOC-01D — `docs/plans/README.md`

- Hàng phase 01: `APPROVED — chờ code` → `IMPLEMENTED — chờ verify tay`.
- Hàng phase 12: `APPROVED — chờ code` → `IMPLEMENTED — chờ verify`.
- Hàng phase 13: `IMPLEMENTED — chờ verify` → `DONE — code + test`.
- Thêm hàng phase 18 với status `APPROVED — awaiting code` (theo convention loop-plan).

---

## 5. Edge case

| # | Tình huống | Xử lý |
| --- | --- | --- |
| 1 | Phase 01/12 có checkbox manual chưa tick | giữ `[ ]`, không claim verify |
| 2 | Phase 13 DoD đã tick đủ | không sửa checkbox, chỉ status + nhật ký |
| 3 | README có nhiều hàng status tương tự | chỉ sửa đúng 3 hàng + thêm hàng 18; không đụng hàng khác |
| 4 | `STATE.md` row DOC-01 | planning step đã set `PLANNED 2026-11-04 — awaiting build`; build step không đổi STATE |
| 5 | Nhầm lẫn "shipped" vs "verified" | shipped chỉ ở STATE; docs/plans dùng `IMPLEMENTED/DONE` |

---

## 6. Verify

**Bắt buộc:**
1. `grep -n "Status:" docs/plans/01-owner-visibility.md docs/plans/12-under-attack-alert.md docs/plans/13-autosave-timing-log.md` khớp target.
2. `grep -n "01-owner\|12-under\|13-autosave\|18-doc" docs/plans/README.md` khớp status target.
3. `git diff --stat` chỉ chạm file docs (`docs/plans/*`, `STATE.md` đã planning) — không có source.
4. Không chạy tsc/test (không đổi code), nhưng kiểm tra markdown render OK (bảng không vỡ).

---

## 7. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Tick nhầm checkbox manual | D3: chỉ tick mục tsc/vitest/ràng buộc tĩnh |
| Status target không khớp convention | D2 bảng rõ ràng; README vocabulary `DRAFT/APPROVED/IMPLEMENTED/DONE` |
| Đụng hàng README khác | DOC-01D chỉ sửa 3 hàng + thêm 1 hàng |

---

## 8. Ngoài phạm vi

- Sửa code, test, schema, protocol, DB.
- Verify tay phase 01/12 (chưa có bằng chứng).
- Cập nhật status phase khác (03–11, 14–17) — không thuộc DOC-01.
- Cập nhật `STATE.md` rows khác (chỉ DOC-01).

---

## 9. Definition of Done

- [x] `docs/plans/01-owner-visibility.md` status = `IMPLEMENTED`, DoD tự động tick.
- [x] `docs/plans/12-under-attack-alert.md` status = `IMPLEMENTED`, DoD tự động tick.
- [x] `docs/plans/13-autosave-timing-log.md` status = `DONE`.
- [x] `docs/plans/README.md` hàng 01/12/13 khớp target + hàng 18 `APPROVED — awaiting code`.
- [x] `git diff` không chứa file source.
- [x] Không claim verify tay chưa có.

---

## 10. Nhật ký

| Ngày | Thay đổi |
| --- | --- |
| 2026-11-04 | Tạo plan DOC-01 (phase 18): scope doc-only, status target cho phase 01/12/13, task DOC-01A..D. Status `APPROVED`. |
| 2026-11-04 | Build DOC-01: cập nhật status 01/12/13, tick DoD tự động, README + STATE. |
