# Plans — Index

Thư mục này thay cho `docs/plan/` (số ít) đã bị xoá ở commit `94cc557` sau khi các phase
`BUG-*` / `CTL-*` / `CMD-*` / `SIM-*` / `ECO-*` / `UIX-*` đóng xong. Quy ước giữ nguyên như cũ.

## Danh sách phase

| Phase | Chủ đề | Status |
| --- | --- | --- |
| [`01-owner-visibility.md`](./01-owner-visibility.md) | Nhìn ra quân / nhà nào của ai trên chiến trường (`OWN-01..OWN-05`; `OWN-06` DEFERRED) | APPROVED — chờ code |
| [`02-single-session.md`](./02-single-session.md) | Một tài khoản một phiên: chặn tab/thiết bị thứ hai, cưỡng chiếm phiên có xác nhận (`SESS-01..SESS-07`) | DONE — code + test |

Status: `DRAFT` (chưa chốt quyết định) → `APPROVED` (bắt đầu code) → `DONE`.

Phase 01 đã chốt 4 quyết định D1–D4 ngày 2026-11-01 (xem §11 của file phase); chưa có dòng code nào
được viết.

Phase 02 đã chốt 6 quyết định (policy "phiên cũ thắng", force takeover thủ công, dùng state RAM thay
vì DB khi takeover, heartbeat/`allowReconnection` để backlog) ngày 2026-11-01 và đã code xong ngày
2026-11-02: `SessionRegistry` ở server, join gate + close code 4004/4009/4011 trong
`@chien-quoc/shared`, màn chặn + nút cưỡng chiếm ở client. Verify tay 2 phiên cùng account đã chạy
(join thứ hai bị 4009, force takeover đá tab cũ bằng 4004, F5 không bị chặn).

## Quy ước

1. **Mỗi task = 1 commit** (hoặc 1 PR). Không gộp 2 task khác phase vào một commit.
2. Task nào chạm protocol (`NetworkMessage`) phải cập nhật **cả 3 chỗ**:
   `packages/shared/src/types/index.ts` → `apps/server/src/rooms/WorldRoom.ts` → `apps/client/src/game/scenes/WorldScene.ts`.
3. Thay đổi `@type()` trong schema (`apps/server/src/schema/*`) là **breaking** với snapshot đã lưu
   trong `apps/server/database/dev.db` → phải ghi rõ bước reset DB trong task.
4. Trước khi đánh dấu xong: `tsc --noEmit` cho cả `apps/server` và `apps/client`, và `vitest run`
   cho package bị chạm.
5. Không commit/push khi chưa được phép. Commit message **tiếng Anh**.
6. Chat, giải thích logic và tài liệu (file này) viết **tiếng Việt**; code, docstring, comment
   trong code và commit message viết **tiếng Anh**.

## Definition of Done (chung)

- [ ] `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `pnpm --filter @chien-quoc/client test` và `pnpm --filter @chien-quoc/server test` xanh
- [ ] Thao tác chạy được trong game thật (không chỉ typecheck)
- [ ] Không tạo message mới nếu có thể tái dùng message sẵn có
- [ ] Task có sửa schema → đã ghi chú reset DB
