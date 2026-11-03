# Phase 05 — Map realism (visual-only)

Status: **DRAFT — chờ duyệt**
Ngày ghi plan: 2026-11-03
Phạm vi: client only. **Không** đổi server, `packages/shared`, schema, protocol hay DB.

## 1. Mục tiêu

Map 220×220 hiện trông như một lưới test: cỏ lặp thành sọc chéo, đường đất lặp motif, rừng là
những cụm blob rải rác, rìa map cắt phựt, minimap là các chấm vuông. Phase này làm map tự nhiên và
"có sức sống" hơn bằng **thay đổi thị giác thuần tuý**:

- Nền cỏ hết chu kỳ 3 tile, có vạt sáng/tối và lớp cỏ hoa trang trí.
- Đường đất có mép gợn, tông và hướng stamp biến thiên.
- Rìa map có vành cỏ + rừng bao quanh thay vì cắt thẳng.
- Minimap dùng icon PNG thu nhỏ cho tài nguyên/lính, nền là địa hình thật, đường khớp world.
- Cây tài nguyên khác scale/tông/hướng; cỏ cây trang trí đung đưa nhẹ.

Ngoài phạm vi: sông/hồ, địa hình chặn đường, đổi vị trí tài nguyên/spawn, đổi art unit/building.
Những thứ đó cần server + reset map/DB và sẽ là phase khác.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | **Visual-only**: không sửa `packages/shared/src/utils/terrainMath.ts`, không sửa `apps/server`, không đổi schema/DB/protocol. |
| D2 | Dùng pack free trên OpenGameArt (CC0/CC-BY); **không** dùng local ComfyUI vì host `192.168.1.14:8090` timeout và repo không có `.env`/`LOCAL_API_KEY`. |
| D3 | Có decor PNG trong map (hoa/cỏ/bụi/đá) **và** rừng viền ngoài rìa map. |
| D4 | Minimap dùng PNG thumbnail của tài nguyên/lính; vector chỉ là fallback khi ảnh chưa load. |
| D5 | Decor là object không tương tác: không collision, không pathfinding, không xuất hiện trong state. |
| D6 | Giữ nguyên `isDirtRoadTile` và toàn bộ geometry đường; chỉ đổi cách render. |
| D7 | Không thêm nước/núi/địa hình chặn đường. |
| D8 | Resource đã sinh trên đường (từ map cũ) **không được di chuyển** trong phase này; ghi nhận là known limitation. |

## 3. Hiện trạng (đối chiếu code)

| Vấn đề | Chỗ code | Nguyên nhân |
| --- | --- | --- |
| Sọc cỏ chéo chu kỳ 3 | `apps/client/src/game/render/TerrainLayer.ts:112-124` | `((gx*7 + gy*13) % 3) + 1`; vì `7 ≡ 13 ≡ 1 (mod 3)` nên thực chất là `(gx+gy)%3`. Tile còn bị `clearTint()`. |
| Đường lặp motif | `TerrainLayer.ts:142-161` | 4 file `road_stamp*.png` giống hệt nhau (cùng MD5); stamp đặt cùng scale/rotation, mỗi 0.35 tile. |
| Variant cỏ trùng file | `apps/client/public/assets/terrain/` | `grass.png` và `grass_1.png` cùng MD5; chỉ có 3 texture thật. |
| Cây tài nguyên đồng nhất | `apps/client/src/game/render/EntityRenderer.ts:140-180` | Mọi node dùng cùng scale/flip/tint. |
| Minimap không đọc được | `apps/client/src/components/Minimap.tsx:36-44` | Nền vẽ gạch chéo thủ công. |
| Đường minimap trùng lặp | `Minimap.tsx:55-98` | Vẽ lại 4 công thức sin thay vì đọc dữ liệu đường thật. |
| Tài nguyên/lính là chấm vuông | `Minimap.tsx:100-116`, `:148-154` | `fillRect` 2–3px cho mọi loại. |
| Rìa map cắt phựt | `TerrainLayer.ts:86-89` | Vùng vẽ clamp đúng `[0, MAP-1]`; ngoài map là màu nền phẳng. |

Số liệu mô phỏng theo đúng tham số generator hiện tại (`WorldRoom.generateWorldResources`):
~1.311 node tài nguyên, ~4.3% rơi trên tile đường. Đây là lý do D8: phase này không sửa được
resource đã lưu mà không đụng server/DB.

## 4. Nguồn asset & license

| Asset | Nguồn | License | Dùng cho |
| --- | --- | --- | --- |
| `hjm-randomized_forbs_01..03-alpha.png` | [100+ isometric forbs](https://opengameart.org/content/100-isometric-forbs) — Hansjörg Malthaner (Varkalandar) | CC-BY 3.0 | hoa, cỏ, bụi nhỏ |
| `hjm-assorted_rocks_1.png` | [Assorted Isometric Rocks](https://opengameart.org/content/assorted-isometric-rocks) — Hansjörg Malthaner | CC-BY 4.0 | đá trang trí |
| `_tree_06.zip`, `_tree_10.zip` | [Tree Collection v2.6](https://opengameart.org/content/tree-collection-v26-bleeds-game-art) — Bleed | CC-BY 3.0 | rừng viền ngoài map |

- Chọn CC-BY (không chọn CC-BY-SA) để tránh nghĩa vụ share-alike.
- Attribution bắt buộc: thêm mục vào `CREDITS.md` (tiếng Anh) với tên tác giả, URL, license và mô
  tả chỉnh sửa: *cropped, segmented, scaled, brightness/gamma adjusted, alpha softened*.
- Chỉ PNG đã cắt nằm trong repo. Raw zip/sheet nằm ở `scripts/raw_downloads/decor/` và được
  `.gitignore` (giống cách `scripts/raw_downloads/oga/` đang bị ignore).

## 5. Pipeline asset

### 5.1. `scripts/build_decor_assets.py`

1. Tải pack nếu chưa có vào `scripts/raw_downloads/decor/`.
2. Tách sheet forbs/rocks thành từng sprite bằng connected-components trên alpha (numpy + flood
   fill), lọc area ≥ 300px, bỏ mảnh dính cạnh.
3. Phân loại forb theo tỉ lệ crop: cao/hẹp → `grass`, thấp/rộng → `flower`, còn lại → `bush`.
   Có bảng override nhỏ sau khi xem preview để sửa các ca sai.
4. Chuẩn hoá sáng: đo luminance trung bình vùng alpha>128, áp gamma/scale (clamp 0.8–2.0) về
   khoảng 115–135 để render tối của pack khớp art hiện tại.
5. Resize giữ tỉ lệ, bottom-align vào canvas trong suốt: forb ≤ 96px cao, rock ≤ 80×64,
   border tree cao 300–340px.
6. Xuất:
   - `apps/client/public/assets/decor/{forb,rock,border_tree}_NN.png`
   - `apps/client/src/game/render/decorArt.generated.ts` (pattern giống
     `apps/client/src/game/input/cursorArt.generated.ts`): `key`, `url`, `kind`, `height`.
   - `scripts/out/decor_preview.html` (đã gitignore) để duyệt art trước khi vào game.

### 5.2. Số lượng mục tiêu

- ~12 forb (hoa/cỏ/bụi), ~6 rock, ~6 border tree → ~24 PNG.
- Tổng dung lượng mục tiêu < 6 MB.

## 6. Thay đổi runtime

### 6.1. `apps/client/src/game/render/visualVariation.ts` (mới, thuần)

```ts
export function hash2(x: number, y: number, seed: number): number;
export function fbm(x: number, y: number, seed: number, octaves?: number): number;
export function grassTextureIndex(gx: number, gy: number): 1 | 2 | 3;
export function grassTint(gx: number, gy: number): number;
export function roadStampLook(gx: number, gy: number, angle: number, index: number): {
  angle: number; scale: number; tint: number; offsetX: number; offsetY: number;
  shoulderScale: number | null;
};
export function resourceLook(id: string, type: string): {
  scale: number; flipX: boolean; tint: number; offsetX: number; offsetY: number;
};
```

- `grassTextureIndex`: hash trắng theo `(gx, gy)`; **không** dùng `(gx+gy)%3`.
- `grassTint`: nội suy `0xfff2e0` (khô ấm) ↔ `0xe8f5d8` (mướt lạnh) bằng `fbm` tần số thấp
  (chu kỳ ~30–50 tile), biên độ ≤ 12%.
- `roadStampLook`: xoay theo tangent, scale 0.92–1.12, tint `0xf0e2cc`–`0xffffff`, lệch vuông góc
  ±5px; 25% điểm có thêm stamp "vai đường" scale 0.45–0.7, alpha thấp, lệch ±22–34px.
- `resourceLook`: cây scale 0.90–1.15, flipX ~50%, tint `0xdfe8cf`–`0xffffff`; loại khác
  0.96–1.05. Offset chỉ áp lên ảnh con, không đổi container.

### 6.2. `apps/client/src/game/render/TerrainLayer.ts`

- Thay variant + `clearTint()` bằng `grassTextureIndex` + `grassTint`.
- Stamp đường dùng `roadStampLook`; chỉ dùng texture `road_stamp`, giữ fallback nếu thiếu.
- Mở rộng vùng vẽ cỏ ra `MAP_APRON_TILES = 4` mỗi phía (chỉ cỏ, không đường) để rừng viền có nền.
  Không đổi bounds/pathfinding.
- Pool vẫn mở rộng động như hiện tại.

### 6.3. `apps/client/src/game/render/decorScatter.ts` (mới, thuần)

- `MAP_APRON_TILES = 4`.
- `decorAt(gx, gy, blockedTiles)`:
  - trong map: bỏ tile đường (`isDirtRoadTile`), bỏ tile có resource/building footprint;
  - mật độ theo fbm để thành từng vạt: hoa 0–12%, cỏ 0–14%, bụi ~1.2%, đá ~0.8%;
  - đá ưu tiên vùng tint khô, hoa ưu tiên vùng tint mướt;
  - chọn texture/scale/flip/phase deterministic bằng hash.
- `borderDecorAt(gx, gy)`: ngoài biên 1–3 vòng, density 0.7/0.45/0.2, chỉ trả border tree/bụi.
- `underCanopyDecor(treeId, gx, gy)`: 1–2 cỏ/bụi quanh mỗi TREE để rừng dày hơn.

### 6.4. `apps/client/src/game/render/DecorLayer.ts` (mới)

- Pool image không interactive, `setOrigin(0.5, 1)`, depth `getIsoDepth(gx, gy, 5)` (dưới
  resource 10 / building 15 / unit 25).
- Layout lại khi viewport đổi ≥ 16px hoặc zoom đổi, mirror cơ chế `TerrainLayer`.
- LOD: ẩn hoa/cỏ nhỏ khi `zoom < 0.55`; luôn giữ bụi/đá/cây viền.
- `update(time)`: đung đưa rotation ±1.5°, tần số 0.6–1.2Hz, phase riêng; border tree ±0.4°
  hoặc đứng yên.
- Bỏ qua texture thiếu; pool mở rộng động.

### 6.5. `apps/client/src/game/render/EntityRenderer.ts`

- `createResourceNodeSprite` áp `resourceLook`.
- Giữ đáy sprite bám tile: `img.y = offsetY + (img.height * (1 - scale)) / 2 + look.offsetY`.
- Giữ nguyên `visualCenterY` và container position để hit-test/selection không đổi.

### 6.6. `apps/client/src/game/scenes/WorldScene.ts`

- Preload mọi texture trong `DECOR_TEXTURES` với `?v=1`.
- Tạo `this.decor = new DecorLayer(this)` sau `terrain`; gọi `decor.render()` ở `create()`.
- Trong `update()`: `this.decor.render(time)` và `this.decor.update(time)`.
- `resetForNewWorld()`: `this.decor?.invalidateViewport()`.

### 6.7. Minimap: `minimapArt.ts` (mới) + `Minimap.tsx`

- Canvas backing **280×280**, CSS 140×140; click math vẫn dựa trên `rect` nên không đổi.
- Nền: `ImageData` 220×220 tạo một lần (cache module-level) từ `minimapGroundColor(gx, gy)`:
  cỏ palette + fbm; đường lấy từ `isDirtRoadTile` — bỏ 4 đoạn vẽ đường hard-code và nền gạch chéo.
- Icon PNG:
  - Tài nguyên: preload `Image` từ `/assets/resources/{tree,gold,stone,berry}.png`, vẽ thu nhỏ
    5–6px hiển thị; fallback vector khi ảnh chưa load.
  - Lính: preload `/assets/units/{type}_idle.png`, crop alpha, scale còn ~6px hiển thị, tint theo
    màu chủ bằng offscreen canvas `source-in`, cache theo `type|color|own`; lính mình viền trắng,
    địch viền tối.
  - Nhà: rect màu chủ + viền tối; portal giữ kim cương cyan.
- Thứ tự: terrain → vignette nhẹ → resources → buildings → units → viewport (trắng + nền mờ 8%)
  → viền hổ phách.
- Bỏ qua node `remainingAmount <= 0`; giữ click pan và right-click command.

## 7. Task / commit

Mỗi dòng là một commit độc lập (convention của repo). **Chưa commit/push khi chưa được phép.**

| Mã | Task | Commit message |
| --- | --- | --- |
| VIS-01 | `visualVariation.ts` + test | `feat(client): add deterministic visual variation helpers` |
| VIS-02 | Script build decor + PNG + `CREDITS.md` + `.gitignore` | `feat(assets): build decorative sprites from CC-BY packs` |
| VIS-03 | `TerrainLayer` cỏ/tint/stamp | `feat(client): vary grass, terrain tint and road stamps` |
| VIS-04 | `TerrainLayer` apron + `DecorLayer` border forest + `WorldScene` preload | `feat(client): draw a grass apron and border forest` |
| VIS-05 | `decorScatter` + scatter trong map + test | `feat(client): scatter decorative ground cover` |
| VIS-06 | `EntityRenderer` resource variation | `feat(client): vary resource sprite scale and tint` |
| VIS-07 | `minimapArt` + `Minimap.tsx` + test | `feat(client): rebuild the minimap with terrain and sprite icons` |
| VIS-08 | Tài liệu phase | `docs: add the map realism phase plan` |

## 8. Test & verify

### 8.1. Automated

- `visualVariation.test.ts`:
  - deterministic;
  - **regression sọc chéo**: tỉ lệ `variant(x,y) == variant(x+1,y+1)` ~1/3, không phải 100%;
  - phân bố 3 variant trong 25–42%;
  - tint/scale/góc trong biên.
- `decorScatter.test.ts`: deterministic; không trả decor trên tile đường; mật độ trong ngưỡng;
  border chỉ ngoài biên; `underCanopyDecor` đúng quanh TREE.
- `minimapArt.test.ts`: `minimapGroundColor` deterministic, road ≠ grass; map resource type → icon;
  `gridToMinimap` tỉ lệ 280/220; viewport clamp.
- `cd apps/client && ../../node_modules/.bin/tsc --noEmit`
- `pnpm --filter @chien-quoc/client test`
- `pnpm --filter @chien-quoc/client build`

### 8.2. Manual

- `pnpm dev` → http://localhost:5173.
- Kiểm ở cả Vương quốc và Chiến trường, zoom 0.4×–2.2×:
  - pan ngang/dọc hết map: không còn sọc chéo;
  - đường: mép gợn, tông/hướng stamp biến thiên;
  - cây tài nguyên khác scale/tông; click chọn vẫn đúng node;
  - decor xuất hiện thành vạt, không nằm trên đường/chân công trình; cỏ đung đưa nhẹ;
  - rìa map có vành cỏ + rừng, không cắt phựt;
  - minimap: icon cây/vàng/đá/berry + lính ta/địch + nhà/portal phân biệt được; đường khớp world;
  - click minimap pan đúng, right-click ra lệnh đúng, khung camera khớp.
- Mở `scripts/out/decor_preview.html` để duyệt art; nếu sprite lệch style thì loại khỏi override
  list rồi build lại.

## 9. Edge cases & hiệu năng

- Asset tải/cắt lỗi → script báo rõ; runtime thiếu texture thì bỏ category, không crash.
- Pool decor cạn → mở rộng động; viewport đứng yên → no-op.
- Decor bị bỏ trên tile resource/building để không đè chân công trình.
- Ngoài map chỉ có cỏ + rừng viền; không pathfinding/collision.
- Minimap ~1.3k icon/frame: `drawImage` icon nhỏ, cache tint; giữ 60fps.
- Không đổi `isDirtRoadTile`, spawn/portal, schema, DB, protocol.

## 10. Definition of Done

- [ ] Hết sọc cỏ chéo; cỏ có vạt sáng/tối tự nhiên.
- [ ] Đường không còn motif lặp; mép gợn; tông biến thiên.
- [ ] Có hoa/cỏ/bụi/đá rải thành vạt; cây khác scale/tông; cỏ đung đưa nhẹ.
- [ ] Rìa map có vành cỏ + rừng bao quanh.
- [ ] Minimap: nền địa hình thật, đường khớp world; icon PNG phân biệt tài nguyên/lính/nhà.
- [ ] `CREDITS.md` có đủ 3 nguồn CC-BY + mô tả chỉnh sửa; `.gitignore` chặn raw pack.
- [ ] `tsc --noEmit` sạch, test client xanh, build thành công, không 404/console error, 60fps.
- [ ] Không file server/shared/schema/DB nào bị sửa.
- [ ] Verify tay theo §8.2.

## 11. Known limitations

- Resource đã sinh trên đường (D8) vẫn giữ nguyên vị trí; muốn dọn phải sửa `generateWorldResources`
  + reset resource DB, tức là một task server riêng.
- Pack CC-BY có thể lệch style nhẹ so với art AI hiện tại; preview + override list là cửa chặn.
- Minimap 140px là giới hạn phần cứng của panel; icon 5–6px chỉ đủ phân biệt loại, không đọc được
  chi tiết.
