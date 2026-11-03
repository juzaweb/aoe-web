# Phase 12 — Cảnh báo khi bị tấn công (banner + ping minimap)

**Mục tiêu:** khi quân hoặc nhà của người chơi mất máu (bị đánh), client phải báo ngay bằng
**banner** trên màn hình và **ping minimap** tại vị trí bị đánh. Hiện `hp` đã được replicate
và client có vẽ thanh máu nhỏ ở sprite, nhưng không có âm thanh, không có banner, minimap
không nháy — người chơi không biết mình đang bị đánh cho đến khi nhìn thấy thanh máu giảm.

**Phạm vi:** chỉ `apps/client`. **Không** đụng server, `packages/shared`, schema, protocol,
DB. Phát hiện mất máu làm hoàn toàn ở client, dựa trên thay đổi `hp` đã replicate. Âm thanh
và trạng thái "đang bị đánh" trong panel để `ALERT-02` (phụ thuộc phase này).

> **Status: `APPROVED`** (chốt 2026-11-03). Chưa có dòng code nào được viết — tài liệu này
> là toàn bộ nội dung của bước plan.

---

## 1. Mục tiêu (đo được)

1. Khi một unit hoặc building **của mình** mất HP (hp mới < hp cũ), client hiển thị banner
   "Bạn đang bị tấn công!" trong ~4 s.
2. Minimap vẽ một ping đỏ tại vị trí entity bị đánh, tồn tại ~3 s, với hiệu ứng lan rộng.
3. Không spam: banner có cooldown toàn cục 4 s; ping vẫn được thêm cho mỗi lần mất máu, nhưng
   số ping đồng thời bị giới hạn.
4. Không báo động cho entity của người khác, cho entity của mình khi hp không giảm, và không
   báo động cho snapshot ban đầu (entity đã bị thương từ trước khi join).
5. Desktop và mobile đều hoạt động; không đổi protocol/schema/DB.
6. `tsc --noEmit` (client) sạch, `pnpm --filter @chien-quoc/client test` xanh.

Không thuộc mục tiêu: âm thanh (`ALERT-02`), trạng thái "đang bị đánh" trong panel, tự pan
camera tới chỗ bị đánh, phát hiện mất unit (chết) — chỉ phát hiện **mất máu**.

---

## 2. Quyết định thiết kế

| # | Quyết định | Lý do |
| --- | --- | --- |
| D1 | Phát hiện mất máu ở **client**, qua `cb.onChange` trên unit/building đã có | `hp` đã replicate; không cần message mới, không đụng protocol (ràng buộc gate) |
| D2 | Chỉ báo cho entity **của mình** (`ownerId === scene.myOwnerId`) | Entity địch bị đánh không phải việc của mình; tránh nhiễu |
| D3 | Chỉ báo khi `hp` **giảm nghiêm ngặt** (`newHp < lastHp`) | Tránh báo khi hp tăng (hiếm), khi hp bằng, và khi entity mới được tạo |
| D4 | Snapshot ban đầu **không** báo: `lastHp` được ghi ở lúc tạo sprite, không so sánh | Một unit đã bị thương từ trước khi join không phải là "vừa bị đánh" |
| D5 | Banner có cooldown toàn cục 4 s (`ATTACK_ALERT_COOLDOWN_MS`); ping không bị cooldown | Banner spam liên tục là khó chịu; ping vẫn cần để chỉ chỗ đánh |
| D6 | Ping tồn tại 3 s (`ATTACK_PING_DURATION_MS`), tối đa 12 ping đồng thời | Giữ minimap đọc được khi bị đánh nhiều chỗ cùng lúc |
| D7 | Không tự pan camera | Người chơi có thể đang điều quân chỗ khác; ping trên minimap đủ để định vị |
| D8 | Ping và `lastAttackAlertAt` bị xoá khi bind room mới (travel/rejoin) | Tránh ping của map cũ còn sót trên map mới |
| D9 | Foundation bị đánh cũng báo (hp của foundation bắt đầu ở 1 và có thể giảm) | Nhà đang xây là mục tiêu thường gặp, nhất quán với "nhà của mình" |

---

## 3. Hiện trạng (đối chiếu code)

| Thứ đã có | Chỗ code | Ghi chú |
| --- | --- | --- |
| `hp`/`maxHp` replicate trên unit & building | `apps/server/src/schema/UnitState.ts`, `BuildingState.ts` | client đọc được |
| Thanh máu vẽ ở sprite, chỉ khi bị thương | `EntityRenderer.ts:395-418` (unit), `:320-360` (building) | `CMB-02`: ẩn khi full HP |
| `cb.onChange` đã đăng ký cho cả hai loại | `EntityRenderer.ts:410-418` (unit), `:210-218` (building) | nơi tự nhiên để phát hiện mất máu |
| Banner đỏ chung cho `ERROR_NOTIFICATION` | `App.tsx:226-228`, `:737-743` | banner chung; attack banner nên tách biệt |
| Minimap poll `sceneRef` mỗi frame | `Minimap.tsx:95-100` | có thể vẽ ping từ state của scene |
| `myOwnerId` resolve theo tên người chơi | `WorldScene.ts:153-168` | dùng để lọc entity của mình |
| `ownerColorRegistry` / ownership visuals | `EntityRenderer.ts` (OWN-05) | không liên quan trực tiếp |

| Thứ còn thiếu | Hệ quả |
| --- | --- |
| Không có theo dõi HP cũ per-entity | Không biết hp có giảm hay không |
| Không có callback attack từ scene sang React | Không thể bật banner |
| Không có state ping trên scene/minimap | Không có hiệu ứng ping |
| Không có cooldown/spam guard | Banner sẽ nháy liên tục mỗi lần mất máu |

---

## 4. Thiết kế chi tiết

### 4.1 Phát hiện mất máu (`EntityRenderer`)

Ở `createUnitSprite` và `createBuildingSprite`, sau khi tạo container, ghi `lastHp`:

```ts
container.setData('lastHp', unit.hp);   // hoặc building.hp
```

Trong `cb.onChange` hiện có, **trước** khi gọi `updateUnitBar`/`updateBuildingBar`, so sánh:

```ts
const prevHp = container.getData('lastHp') as number | undefined;
if (prevHp !== undefined && entity.hp < prevHp && entity.ownerId === this.scene.myOwnerId) {
  const center = /* unit: {x: unit.x, y: unit.y}; building: tâm footprint */;
  this.scene.notifyAttack(center);
}
container.setData('lastHp', entity.hp);
```

Edge case cần xử lý trong cùng chỗ:

- `prevHp === undefined` (entity vừa tạo) → không báo, chỉ ghi `lastHp`.
- `entity.hp` mới lớn hơn `prevHp` (hiếm, ví dụ restore) → không báo, cập nhật `lastHp`.
- `scene.myOwnerId` rỗng (chưa resolve) → không báo (tránh báo nhầm cho entity chưa biết chủ).
- Entity bị remove giữa chừng → `lastHp` đi cùng container bị destroy, không leak.

### 4.2 State ping trên `WorldScene`

Thêm vào `WorldScene`:

```ts
export interface AttackPing {
  x: number;        // grid x
  y: number;        // grid y
  startMs: number;  // scene.time.now khi ping được tạo
  durationMs: number;
}

public attackPings: AttackPing[] = [];
private lastAttackAlertAt = 0;

public readonly ATTACK_ALERT_COOLDOWN_MS = 4000;
public readonly ATTACK_PING_DURATION_MS = 3000;
public readonly MAX_ATTACK_PINGS = 12;

public notifyAttack(location: { x: number; y: number }): void;
```

`notifyAttack`:

- luôn thêm ping `{ x, y, startMs: this.time.now, durationMs: this.ATTACK_PING_DURATION_MS }`;
- nếu số ping > `MAX_ATTACK_PINGS`, bỏ ping cũ nhất;
- nếu `this.time.now - this.lastAttackAlertAt >= this.ATTACK_ALERT_COOLDOWN_MS`,
  đặt `lastAttackAlertAt = this.time.now` và gọi `this.onAttackAlert?.(location)`.

Trong `update()`, prune:

```ts
const now = this.time.now;
this.attackPings = this.attackPings.filter((p) => now - p.startMs < p.durationMs);
```

Khi bind room mới (`setRoom`/`bindRoomEvents`): `this.attackPings = []` và
`this.lastAttackAlertAt = 0` (D8).

### 4.3 Pure helper (để test được)

Tạo `apps/client/src/game/render/attackAlert.ts` (thuần, không Phaser) chứa:

```ts
export interface AttackPing { x: number; y: number; startMs: number; durationMs: number; }

export function shouldAlert(previousHp: number | undefined, nextHp: number, ownerId: string, myOwnerId: string): boolean;
export function pruneAttackPings(pings: readonly AttackPing[], nowMs: number): AttackPing[];
export function capAttackPings(pings: readonly AttackPing[], max: number): AttackPing[];
```

`EntityRenderer` và `WorldScene` gọi helper này để logic có thể unit-test bằng vitest
(`node` env), giống `ownerColor.ts` / `unitMotion.ts`. Hằng số cooldown/duration có thể đặt
ở helper hoặc ở scene; plan khuyến nghị đặt hằng số ở helper để test.

### 4.4 React banner + wiring

- `PhaserGame.tsx`: thêm prop `onAttackAlert?: (location: { x: number; y: number }) => void`,
  lưu qua ref `onAttackAlertRef`, gán `scene.onAttackAlert = (loc) => onAttackAlertRef.current?.(loc)`
  trong bootstrap (giống `onIdleVillagersChange`).
- `App.tsx`:
  - state `attackAlertUntil: number` (timestamp ms, 0 = không hiện);
  - `handleAttackAlert = () => setAttackAlertUntil(Date.now() + 4000)`;
  - `useEffect` auto-clear khi đến hạn;
  - render banner riêng (không dùng `notification`, để không bị error message ghi đè):
    ```tsx
    {attackAlertUntil > Date.now() && (
      <div className="... red ...">Bạn đang bị tấn công!</div>
    )}
    ```
  - truyền `onAttackAlert={handleAttackAlert}` vào `PhaserGame`.

Banner đặt `top-16` (giống notification) hoặc `top-20`; z-50. Trên mobile compact vẫn đọc được.

### 4.5 Minimap ping

Trong `Minimap.tsx`, sau khi vẽ units (bước 5), đọc `scene.attackPings`:

```ts
const pings = scene?.attackPings ?? [];
pings.forEach((p) => {
  const point = gridToMinimap(p.x, p.y, width);
  const age = (scene.time.now - p.startMs) / p.durationMs; // 0..1
  const radius = 4 + age * 8;
  const alpha = Math.max(0, 1 - age);
  ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  // tâm nhỏ cố định để định vị chính xác
  ctx.fillStyle = `rgba(239, 68, 68, ${Math.min(1, alpha + 0.3)})`;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
  ctx.fill();
});
```

Nếu muốn minimap "nháy" rõ hơn, có thể thêm stroke đỏ nhấp nháy quanh viền canvas khi có ping
tuổi < 0.5 s. Plan khuyến nghị chỉ ping per-location để không che map; viền nháy là tuỳ chọn
trong build.

---

## 5. Task

| Task | Size | Phụ thuộc | Nội dung |
| --- | --- | --- | --- |
| `ATK-01` | S | — | helper thuần `attackAlert.ts` (types + `shouldAlert` + prune/cap) + unit test |
| `ATK-02` | S | ATK-01 | `WorldScene`: `attackPings`, `notifyAttack`, cooldown, prune trong `update`, reset khi bind room mới |
| `ATK-03` | S | ATK-01, ATK-02 | `EntityRenderer`: ghi `lastHp` ở create, so sánh trong `onChange` của unit & building, gọi `notifyAttack` |
| `ATK-04` | S | ATK-02 | `Minimap.tsx`: vẽ ping từ `scene.attackPings` |
| `ATK-05` | S | ATK-02 | `PhaserGame.tsx` + `App.tsx`: prop `onAttackAlert`, state `attackAlertUntil`, banner + auto-clear |
| `ATK-06` | S | ATK-02..05 | wiring kiểm tra + edge case + verify tay |

Thứ tự commit đã chốt:

1. `feat(client): add attack-alert helper and ping state`
2. `feat(client): detect hp loss on own entities and notify attack`
3. `feat(client): draw attack pings on the minimap`
4. `feat(client): show under-attack banner from scene alert`
5. `chore(client): reset attack pings on room switch`

---

## 6. Edge case (kiểm tra khi review)

| # | Tình huống | Kỳ vọng |
| --- | --- | --- |
| 1 | Unit của mình bị đánh, hp giảm | banner hiện ~4 s, ping ở vị trí unit ~3 s |
| 2 | Building của mình bị đánh | banner + ping ở tâm footprint |
| 3 | Foundation của mình bị đánh | banner + ping (D9) |
| 4 | Entity của địch bị đánh | không banner, không ping |
| 5 | hp không đổi (đánh hụt / miss) | không báo |
| 6 | hp tăng (restore / heal) | không báo, `lastHp` cập nhật |
| 7 | Entity đã bị thương trước khi join (snapshot) | không báo ở lúc tạo sprite |
| 8 | Nhiều entity bị đánh cùng lúc | một banner (cooldown), nhiều ping (tối đa 12) |
| 9 | Tấn công liên tục > 4 s | banner hiện lại sau cooldown; ping liên tục |
| 10 | Travel/rejoin sang map mới | ping cũ bị xoá, cooldown reset |
| 11 | Entity bị remove giữa lúc đang có ping | ping vẫn tồn tại đến hết duration (không crash) |
| 12 | `myOwnerId` chưa resolve khi mất máu đầu tiên | không báo (tránh báo nhầm); các lần sau khi resolved thì báo |
| 13 | Zoom xa nhất (`ZOOM_MIN`) | ping vẫn hiển thị (bán kính tính theo pixel minimap, không theo zoom thế giới) |

---

## 7. Verify

**Bắt buộc:**

1. `cd apps/server && ../../node_modules/.bin/tsc --noEmit` sạch (không đụng server, nhưng chạy để chắc).
2. `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch.
3. `pnpm --filter @chien-quoc/client test` xanh (có test mới của `ATK-01`).
4. Kiểm chứng tay với 2 account trên cùng server `:2567`:
   - Account A đặt lính/nhà gần account B; B tấn công → A thấy banner + ping.
   - Ping biến mất sau ~3 s nếu ngừng đánh.
   - Banner không spam liên tục khi đánh liên tục quá mức.
   - Minimap ping đúng vị trí (so với bản đồ chính).
   - Mobile (touch emulation): banner không che HUD, ping vẽ được.

---

## 8. Ngoài phạm vi

- Âm thanh cảnh báo và trạng thái "đang bị đánh" trong panel → `ALERT-02`.
- Cảnh báo foundation bị phá riêng (thanh tiến độ) → `ALERT-03`.
- Tự pan camera tới chỗ bị đánh.
- Thay đổi server/shared/schema/protocol/DB.
- Gom nhóm ping theo cụm (clustering) — chỉ làm nếu minimap rối khi bị đánh nhiều chỗ.
- Bất kỳ thay đổi gameplay nào.
