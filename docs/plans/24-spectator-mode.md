# Phase 24 — Quan sát vương quốc khác

Xem trực tiếp một vương quốc khác (đang yên bình hoặc đang bị tập kích) từ bản đồ thế giới, ở cửa sổ
thứ hai, trong khi vương quốc của người xem vẫn chạy bình thường.

## 1. Mục tiêu

- Điểm vào duy nhất: nút **Quan sát** trong `WorldMapOverlay` (bản đồ lục giác).
- Xem được cả vương quốc yên bình lẫn trận tập kích đang diễn ra: cùng một `kingdom_room`, cùng snapshot.
- Chỉ đọc: không thể ra lệnh, đặt nhà, vẽ đường, huấn luyện hay rút quân.
- Camera tự do: kéo, zoom, phím mũi tên, bookmark; không giới hạn theo lãnh thổ.
- Ẩn danh với người bị xem: người xem không xuất hiện trong `players`, không có quân hay công trình.
- Bất kỳ tài khoản đã đăng nhập đều xem được nước khác; danh sách trên bản đồ vẫn chỉ gồm ±5 cấp
  Nhà chính như cũ.

## 2. Quyết định kiến trúc

| Mã | Quyết định | Lý do |
| --- | --- | --- |
| D1 | Dùng lại `kingdom_room` với `{ ownerId: targetId, spectate: true }` | Không cần schema/room mới; snapshot, terrain và phục hồi world đã có sẵn |
| D2 | `KingdomRoom.onJoin` rẽ nhánh `joinAsSpectator`, không gọi `super.onJoin` | Bỏ qua claim session, `PlayerState`, base khởi đầu và lưu account |
| D3 | Server xác thực mục tiêu bằng DB (`RaidService.findSpectateTarget`) rồi kiểm tra lại Nhà chính sau khi restore world | Không tin tham số client; tránh vào map rỗng khi cache cũ |
| D4 | Chặn lệnh ở biên room bằng `WorldRoom.onCommandMessage` + `spectatorSessions` | Một luật duy nhất thay vì rải kiểm tra ở từng handler |
| D5 | Client mở Phaser game thứ hai với `SpectatorScene` (read-only) | Vương quốc của người xem vẫn mô phỏng song song |
| D6 | `readOnly` tắt mọi phím lệnh, chỉ giữ phím camera; chặn click phải và tap-ra-lệnh | Không tạo cursor/armed order mà server chắc chắn từ chối |
| D7 | Không thêm `NetworkMessage` mới | Toàn bộ giao tiếp dùng message sẵn có |
| D8 | Mỗi tài khoản chỉ giữ một cửa sổ quan sát (`spectatorWatch`) | Người xem đã có session chơi riêng nên không bị claim session chặn; nếu không giới hạn, một client có thể mở nhiều room, mỗi room chạy mô phỏng/autosave |

## 3. Luồng

1. Người chơi mở bản đồ thế giới, chọn một nước, bấm **Quan sát**.
2. `App` đóng bản đồ, mở `SpectatorOverlay` và gọi `client.joinOrCreate('kingdom_room', { ownerId, spectate: true })`.
3. `KingdomRoom.onAuth` cho qua khi `spectate === true` (token vẫn được `super.onAuth` xác thực).
4. `onJoin` gọi `joinAsSpectator`:
   - từ chối nếu thiếu userId/ownerId, hoặc ownerId trùng người xem;
   - `findSpectateTarget` phải trả về account có `townCenterLevel > 0`;
   - chờ `readyPromise`, kiểm tra `worldRestoreError`, `isZoneOwner()`, `ownerScope === ownerId`;
   - map phải còn `TownCenter` của owner;
   - tài khoản người xem chỉ được giữ một cửa sổ quan sát (`claimSpectatorWatch`); từ chối join nếu
     đã có cửa sổ khác đang mở;
   - ghi session vào `spectatorSessions` / `spectatorViewers`.
5. Mọi message lệnh đi qua `onCommandMessage`; session trong `spectatorSessions` nhận
   `ERROR_NOTIFICATION` với `FORBIDDEN` thay vì vào handler.
6. `onLeave` xóa session khỏi set, nhả slot `spectatorWatch` rồi trả về ngay: không lưu empire,
   không nhả account session.
7. Đóng overlay (nút Đóng, chuyển map, đăng xuất) → leave room quan sát; room của người xem không đổi.
   `App` chờ leave cũ xong trước khi mở mục tiêu mới để không vấp giới hạn một cửa sổ.

## 4. Phía client

- `SpectatorScene` kế thừa `WorldScene`, đặt `readOnly = true` trước `create()` để `CommandController`
  chỉ bind phím zoom/bookmark/Escape.
- `WorldScene.readOnly` chặn: click phải, tap ra lệnh, long-press, placement, road, stop, stance,
  arm order, move từ minimap và các API public tương ứng.
- `WorldScene.focusOwnerId` thay `myPlayerName` khi căn camera: không có "base của mình" trong room
  quan sát, nên camera tìm `TownCenter` của owner mục tiêu.
- `ownerColorRegistry.remember()` nhận màu từ dòng bản đồ thế giới, phòng khi người bị xem offline và
  chưa có `PlayerState` trong snapshot.
- `PhaserGame` nhận thêm `readOnly`, `focusOwnerId`, `ownerColor`; chọn `SpectatorScene` khi read-only.
- `SpectatorOverlay` hiển thị tên, màu, cấp Nhà chính, trạng thái "chỉ xem", nút Đóng và Phaser game
  thứ hai. Game gốc vẫn mounted bên dưới.

## 5. Kiểm thử

- `apps/server/src/rooms/KingdomRoom.raid.test.ts`:
  - join spectator không tạo `PlayerState`, không spawn base, không đụng công trình;
  - từ chối xem chính mình, account không tồn tại, không có Nhà chính, map mất Nhà chính,
    zone đã bị thay thế;
  - `onLeave` chỉ xóa session khỏi `spectatorSessions`, nhả slot và không đụng empire;
  - giới hạn một cửa sổ quan sát mỗi tài khoản, nhả slot sau khi leave;
  - mọi lệnh từ session quan sát bị từ chối ở biên room; người chơi bình thường vẫn đi qua.
- `apps/client/src/game/input/commandArm.test.ts`: chế độ read-only chỉ bind phím camera
  (zoom/bookmark/Escape), không bind phím lệnh.
- `tsc --noEmit` cho `apps/server` và `apps/client`; `vitest run` cho hai package.

## 6. Giới hạn đã biết

- Người xem chỉ thấy những gì snapshot của room đang chứa; không có quyền xem lịch sử hay tài nguyên
  trong DB của người bị xem.
- Room quan sát là kết nối thứ hai của cùng client; đóng tab sẽ tự nhả cả hai.
- Không có thông báo cho người bị xem (đúng yêu cầu ẩn danh).
