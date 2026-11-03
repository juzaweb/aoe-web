# Phase 05 — Map realism (visual-only)

Status: **IMPLEMENTED — chờ verify tay** (code + test xong 2026-11-03; xem §12)
Ngày ghi plan: 2026-11-03
Phạm vi: client only. **Không** đổi server, `packages/shared`, schema, protocol hay DB.

## 1. Mục tiêu

Map 220×220 hiện trông như một lưới test: cỏ lặp thành sọc chéo, đường đất lặp motif, rừng là
những cụm blob rải rác, rìa map cắt phựt, minimap là các chấm vuông. Phase này làm map tự nhiên và
"có sức sống" hơn bằng **thay đổi thị giác thuần tuý**:

- Nền cỏ hết chu kỳ 3 tile, có vạt sáng/tối và lớp cỏ hoa trang trí.
- Đường đất có mép gợn, tông và hướng stamp biến thiên.
- Rìa map có vành cỏ + rừng bao quanh thay vì cắt thẳng.
- Minimap: nền địa hình thật, đường khớp world, rừng tô theo cụm và tài nguyên/lính là glyph
  (không dùng thumbnail PNG — lý do đo được ở §3.1).
- Cây tài nguyên khác scale/tông/hướng; cỏ cây trang trí đung đưa nhẹ.

Ngoài phạm vi: sông/hồ, địa hình chặn đường, đổi vị trí tài nguyên/spawn, đổi art unit/building.
Những thứ đó cần server + reset map/DB và sẽ là phase khác.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | **Visual-only**: không sửa `packages/shared/src/utils/terrainMath.ts`, không sửa `apps/server`, không đổi schema/DB/protocol. |
| D2 | Dùng pack free trên OpenGameArt (CC0/CC-BY); **không** dùng local ComfyUI vì host `192.168.1.14:8090` timeout và repo không có `.env`/`LOCAL_API_KEY`. |
| D3 | Có decor PNG trong map (hoa/cỏ/bụi/đá) **và** rừng viền ngoài rìa map. |
| D4 | Minimap **không** dùng PNG thumbnail: battlefield chỉ 0.64 px/tile nên thumbnail 5–6px phủ 8–9 tile, nuốt cụm rừng và đè đường. Thay bằng rừng tô theo cụm + glyph 3px có viền tối, palette lấy từ sprite world (§3.1). |
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
| Nền minimap kẻ sọc 45° | `Minimap.tsx:101-107` | Vòng `i += 16` vẽ line chéo — cùng lỗi "vân chéo" với cỏ world, nên sửa `TerrainLayer` thôi là chưa đủ. |
| Rừng gần như vô hình | `Minimap.tsx:141-142` | `#166534` trên nền `#1e3f16` = **1.66:1**; vàng/đá 7.7–8.0:1 nên mắt chỉ thấy vàng/đá. |
| Tài nguyên/lính là chấm vuông | `Minimap.tsx:141-152`, `:189-190` | `fillRect` 2px = **3.1 tile** (battlefield); 892 TREE chỉ có 77 cụm nên chấm từng node luôn nhoè. |
| Đường minimap trùng lặp | `Minimap.tsx:55-98` | Vẽ lại 4 công thức sin thay vì đọc dữ liệu đường thật. |
| Rìa map cắt phựt | `TerrainLayer.ts:86-89` | Vùng vẽ clamp đúng `[0, MAP-1]`; ngoài map là màu nền phẳng. |

Số liệu mô phỏng theo đúng tham số generator hiện tại (`WorldRoom.generateWorldResources`):
~1.311 node tài nguyên, ~4.3% rơi trên tile đường. Đây là lý do D8: phase này không sửa được
resource đã lưu mà không đụng server/DB.

### 3.1. Audit asset đang ship (2026-11-03)

Đo trực tiếp trên file trong repo: mean RGB trên pixel `alpha ≥ 200`, hue median trên pixel
`sat > 0.15`, luminance Rec.709. Tồn kho: **62 PNG**, chỉ **8** nằm trong
`scripts/assets/assets.lock.json` (4 cây + 4 công trình).

| Nhóm | File | Nguồn | Gate |
| --- | --- | --- | --- |
| `resources/tree*.png` | 4 | Bleed Tree Collection v2.6 | có |
| `buildings/{barracks,house,town_center,lumber_camp}.png` | 4 | feudalwars, Bleed | có |
| `resources/{gold,stone,berry}.png` | 3 | legacy | không |
| `buildings/{farm,mill,mining_camp,tower}.png` | 4 | legacy | không |
| `terrain/*` | 12 | legacy | không |
| `units/**` | 24 | legacy | không |
| `cursors/*` | 6 | legacy | không |
| `icons/*` | 5 | legacy | không |

Sáu phát hiện ảnh hưởng trực tiếp tới phase này:

1. **Rừng trên minimap vô hình.** `#166534` trên nền `#1e3f16` = **1.66:1** (WCAG non-text cần
   3:1); vàng `#facc15` 7.71:1, đá `#cbd5e1` 7.96:1. Mắt chỉ thấy vàng/đá, còn rừng thành mảng tối
   không đọc được.
2. **Không thể dùng thumbnail.** Battlefield 220 tile → 140 CSS px = **0.64 px/tile**; blip 2px phủ
   3.1 tile. 892 TREE gom lại chỉ còn **77 cụm** (lớn nhất 25 node), nên chấm từng node luôn nhoè;
   thumbnail 5–6px sẽ phủ 8–9 tile và đè lên đường. Vì vậy D4 đổi sang cụm + glyph.
3. **`tree_3.png` lệch tông.** Hue 45° (cây thu lá vàng) so với 66–81° của ba cây còn lại, tức 25%
   rừng là cây thu. Quét đủ 14 pack Bleed: 01/02/04/05/08/09/11/12/13 = 66–81°, 06/07 = 45°,
   10/14 = 23–27°, `_tree_03` lum 137 (quá sáng) → thay bằng `_tree_05`, `_tree_08`, `_tree_09`,
   `_tree_12` hoặc `_tree_13`.
4. **Forbs lệch chroma, không lệch hue.** Mean `(81,85,76)`, sat **0.36**, lum **84**; cỏ mean
   `(102,124,45)`, sat **0.62**, lum **113**. Đỉnh hue forbs 75° khớp cỏ 77°, nên `matchLum` một
   mình sẽ ra đám xám bẩn — phải `gain` màu trước rồi mới cân sáng (§5.1).
5. **Icon HUD không cần vẽ lại.** Cả 5 icon đều ấm (22–36°) nhưng mỗi icon nằm trong một tile màu
   riêng (`amber / red / yellow / slate / sky`), thứ tự cố định và có tooltip, nên vẫn phân biệt
   được ở 24px. Chỉ cần ghi nguồn + hash (legacy gate), không đụng art.
6. `units/raw/*_cutout_raw.png` (3 file, ảnh trung gian) nằm trong `public/` nhưng không code nào
   tham chiếu — nên dọn ở task riêng, không thuộc phase này.

## 4. Nguồn asset & license

| Asset | Nguồn | License | Dùng cho |
| --- | --- | --- | --- |
| `hjm-randomized_forbs_01..03-alpha.png` | [100+ isometric forbs](https://opengameart.org/content/100-isometric-forbs) — Hansjörg Malthaner (Varkalandar) | CC-BY 3.0 | hoa, cỏ, bụi nhỏ |
| `hjm-assorted_rocks_1.png` | [Assorted Isometric Rocks](https://opengameart.org/content/assorted-isometric-rocks) — Hansjörg Malthaner | CC-BY 4.0 | đá trang trí |
| `_tree_09.zip`, `_tree_12.zip`, `_tree_13.zip` | [Tree Collection v2.6](https://opengameart.org/content/tree-collection-v26-bleeds-game-art) — Bleed | CC-BY 3.0 | rừng viền ngoài map |

- Rừng viền **không** dùng `_tree_06` (đã là `resource.tree-3`), `_tree_07` (thu lá vàng), `_tree_10`
  hay `_tree_14` (nâu, hue 23–27°). Ba pack 09/12/13 đều 77–78°, silhouette khác hẳn 4 cây tài
  nguyên nên rừng rìa không bị trùng dáng.
- Chọn CC-BY (không chọn CC-BY-SA) để tránh nghĩa vụ share-alike.
- Attribution bắt buộc: thêm mục vào `CREDITS.md` (tiếng Anh) với tên tác giả, URL, license và mô
  tả chỉnh sửa: *cropped, segmented, scaled, brightness/gamma adjusted, alpha softened*.
- Chỉ PNG đã cắt nằm trong repo. Raw zip/sheet nằm ở `scripts/.cache/assets/` (gitignored) — cùng
  chỗ phase 06 đang cache nguồn OGA.

## 5. Pipeline asset

### 5.1. Mở rộng `scripts/assets` (không thêm script thứ hai)

Phase 06 đã có pipeline khai báo `manifest.json` + `build.py` + `ops.py` + `assets.lock.json`, với
`--check` chạy trong `assetManifest.test.ts`. Decor đi cùng pipeline để có hash + license gate:

1. Thêm source `oga.hjm-forbs` (CC-BY 3.0), `oga.hjm-rocks` (CC-BY 4.0); thêm file `_tree_09`,
   `_tree_12`, `_tree_13` vào `oga.bleed-trees`.
2. Thêm op `split: { minArea: 300, maxCount: 16 }` vào `ops.py` cho sheet forbs/rocks: flood-fill
   alpha, bỏ mảnh dính cạnh, sort diện tích giảm dần, lấy tối đa `maxCount`. `build.py` cho một
   target sinh nhiều output (`out` là pattern `decor/forb_{i:02d}.png`) và ghi từng file vào lock.
3. Thêm op `gain: [r, g, b]` (nhân kênh, clamp 0–255) chạy **trước** `matchLum`. Số đo ở §3.1:
   forbs cần `gain: [1.20, 1.30, 1.05]` + `matchLum: 113`; rocks cần `matchLum: 112` +
   `gain: [1.0, 1.0, 1.02]`. Đây là điểm khởi đầu, duyệt preview rồi chỉnh.
4. Resize giữ tỉ lệ, bottom-align canvas trong suốt: forb ≤ 96px cao, rock ≤ 80×64, border tree
   300–340px.
5. Xuất `apps/client/public/assets/decor/{forb,rock,border_tree}_NN.png`; khai báo key/url/kind/
   height trong `apps/client/src/game/render/decorArt.ts` (viết tay, không sinh code).
6. `scripts/out/decor_preview.html` (gitignore) để duyệt art trước khi vào game.
7. `build.py --check` phủ luôn decor nên decor không thể bị sửa tay mà không lộ.
8. Thêm mảng `legacy` vào `manifest.json` cho 54 PNG còn lại (VIS-09): `sha256` tại thời điểm chốt,
   `license` ghi đúng nếu biết (5 icon hiện không rõ nguồn → ghi `legacy/unknown`). `--check` chỉ so
   hash, không rebuild, nên không đụng art đang chạy.

### 5.2. Số lượng mục tiêu

- ~12 forb (hoa/cỏ/bụi), ~6 rock, 3 border tree → ~21 PNG.
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

Số đo quyết định thiết kế: battlefield 220 tile → 140 CSS px = **0.64 px/tile** (kingdom 110 tile =
1.27). Vì vậy mọi thứ vẽ theo tile phải là *đại diện*, không phải ảnh thu nhỏ.

- Canvas backing **280×280**, CSS `w-[140px] h-[140px]`; toạ độ nhân `S = 280 / mapWidth`.
  Click math vẫn dựa trên `rect` nên không đổi.
- Nền: `ImageData` 280×280 dựng một lần (cache module-level) từ `minimapGroundColor(gx, gy)`:
  cỏ `#3a4a1f` (grass mean ×0.55) + fbm ±6%; đường `#b09161` lấy từ `isDirtRoadTile`. Bỏ hẳn nền
  `#1e3f16` và vòng line 45°.
- Rừng: gom TREE bằng connected components bán kính 2 tile (892 node → **77 cụm**, lớn nhất 25),
  cache theo `zoneId`. Mỗi cụm vẽ bằng chùm tròn quanh từng cây (bán kính ~1.7 tile): pass viền
  `#8aab52` trước, pass ruột `#1d2c0e` sau, nên ranh giới là đường cong tự nhiên chứ không phải
  hình chữ nhật; viền đạt **3.68:1** với nền. Layer render một lần vào canvas offscreen, mỗi frame
  chỉ `drawImage`.
- Tài nguyên khác: glyph 3px tại tâm node, viền tối 0.5px:
  vàng = diamond `#e0ad42` (4.69:1), đá = triangle `#b0b7bb` (4.74:1), berry = dot `#e26a80`
  (3.03:1). Không dùng `/assets/resources/*.png` trên minimap: 5–6px sẽ phủ 8–9 tile.
- Lính: circle bán kính 1.5px (mình 2px + ring trắng 1px), màu chủ, viền `#0b1206` 0.75px.
- Nhà: rect màu chủ + viền `#0b1206`, tối thiểu 3px; portal giữ diamond cyan.
- Thứ tự: terrain → đường → cụm rừng → tài nguyên → nhà → lính → viewport (trắng 1px + nền
  `rgba(255,255,255,0.08)`) → viền hổ phách.
- Bỏ qua node `remainingAmount <= 0`; giữ click pan và right-click command.

## 7. Task / commit

Mỗi dòng là một commit độc lập (convention của repo). **Chưa commit/push khi chưa được phép.**

| Mã | Task | Commit message |
| --- | --- | --- |
| VIS-01 | `visualVariation.ts` + test | `feat(client): add deterministic visual variation helpers` |
| VIS-02 | Mở rộng `scripts/assets` (`split`/`gain`/multi-output) + decor PNG + `CREDITS.md` | `feat(assets): extend the asset pipeline for decorative sprites` |
| VIS-03 | `TerrainLayer` cỏ/tint/stamp | `feat(client): vary grass, terrain tint and road stamps` |
| VIS-04 | `TerrainLayer` apron + `DecorLayer` border forest + `WorldScene` preload | `feat(client): draw a grass apron and border forest` |
| VIS-05 | `decorScatter` + scatter trong map + test | `feat(client): scatter decorative ground cover` |
| VIS-06 | `EntityRenderer` resource variation | `feat(client): vary resource sprite scale and tint` |
| VIS-07 | `minimapArt` + `Minimap.tsx` + test | `feat(client): rebuild the minimap with terrain, clusters and glyphs` |
| VIS-08 | Tài liệu phase | `docs: add the map realism phase plan` |
| VIS-09 | Legacy hash gate cho 54 PNG còn lại | `chore(assets): record hashes for legacy sprites` |
| VIS-10 | Đổi `resource.tree-3` sang variant xanh + lock/`CREDITS.md` | `fix(assets): replace the autumn resource tree with a green variant` |

## 8. Test & verify

### 8.1. Automated

- `visualVariation.test.ts`:
  - deterministic;
  - **regression sọc chéo**: tỉ lệ `variant(x,y) == variant(x+1,y+1)` ~1/3, không phải 100%;
  - phân bố 3 variant trong 25–42%;
  - tint/scale/góc trong biên.
- `decorScatter.test.ts`: deterministic; không trả decor trên tile đường; mật độ trong ngưỡng;
  border chỉ ngoài biên; `underCanopyDecor` đúng quanh TREE.
- `minimapArt.test.ts`: `minimapGroundColor` deterministic, road ≠ grass; `minimapClusters` gom đúng
  (4 node liền kề → 1 cụm, node cách 3 tile → 2 cụm); `gridToMinimap` đúng tỉ lệ 280/220 và
  280/110; `markerColor(type)` trả đúng palette; viewport clamp.
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
- Minimap: 77 cụm rừng + ~450 glyph/frame (129 vàng, 87 đá, 150 berry, ~180 lính) thay vì 1.3k
  `fillRect`; không `drawImage` per frame, cache cụm theo `zoneId`; giữ 60fps.
- Không đổi `isDirtRoadTile`, spawn/portal, schema, DB, protocol.

## 10. Definition of Done

- [ ] Hết sọc cỏ chéo; cỏ có vạt sáng/tối tự nhiên.
- [ ] Đường không còn motif lặp; mép gợn; tông biến thiên.
- [ ] Có hoa/cỏ/bụi/đá rải thành vạt; cây khác scale/tông; cỏ đung đưa nhẹ.
- [ ] Rìa map có vành cỏ + rừng bao quanh.
- [ ] Minimap: nền địa hình thật, đường khớp world, không còn sọc chéo; rừng vẽ theo cụm;
  vàng/đá/berry/lính/nhà phân biệt được ở cả 220×220 lẫn 110×110; mọi marker ≥ 3:1 với nền.
- [ ] `CREDITS.md` có đủ 3 nguồn CC-BY + mô tả chỉnh sửa; `.gitignore` chặn raw pack.
- [ ] `tsc --noEmit` sạch, test client xanh, build thành công, không 404/console error, 60fps.
- [ ] Không file server/shared/schema/DB nào bị sửa.
- [ ] Verify tay theo §8.2.

## 11. Known limitations

- Resource đã sinh trên đường (D8) vẫn giữ nguyên vị trí; muốn dọn phải sửa `generateWorldResources`
  + reset resource DB, tức là một task server riêng.
- Pack CC-BY có thể lệch style nhẹ so với art AI hiện tại; preview + override list là cửa chặn.
- Minimap 140px (backing 280) là giới hạn của panel: 1 tile = 1.27px ở battlefield, nên chỉ phân
  biệt được *loại* và *vị trí*, không đọc được số node trong một cụm.

## 12. Kết quả implement (2026-11-03)

Toàn bộ `VIS-01..VIS-10` đã code, không đụng `apps/server`, `packages/shared`, schema hay DB.
Chưa commit (chờ duyệt).

### 12.1 Asset (VIS-02, VIS-09, VIS-10)

| Hạng mục | Kết quả |
| --- | --- |
| `resource.tree-3` | Đổi `_tree_06` (45°) → `_tree_05` (74.8°); `_tree_06` bỏ khỏi manifest. Bốn cây giờ 65.8–80°, cùng tông. |
| Decor | 12 forb (3 sheet `hjm-randomized_forbs_01..03`), 6 rock (sheet `hjm-assorted_rocks_1`, 102 mảnh), 3 border tree (`_tree_09/12/13`, canvas 400×340). 21 PNG, ~500 KB. |
| Op mới | `split` (connected alpha, `minArea` 300, bỏ mảnh dính cạnh, sort diện tích rồi vị trí) và `gain` (nhân kênh, chạy trước `matchLum`). |
| Forbs | `gain [1.20, 1.30, 1.05]` + `matchLum 113`: sat 0.36 → 0.40–0.75, lum 110–115, mean `(101,122,57)` khớp cỏ `(102,124,45)`. |
| Rocks | `matchLum 112` + `gain [1.0, 1.0, 1.02]`: lum 114, mean `(107–126, 111–116, 87–125)`; không dùng component đen (mean 34–39) vì đó là bóng. |
| Legacy gate | `build.py --legacy` ghi `legacy` (54 PNG) vào lock; `--check` fail khi file bị sửa hoặc có PNG mới chưa pin. |
| Gate hiện tại | `asset check OK: 29 targets, 7 sources, 54 legacy`. |

Chọn sprite decor bằng số đo (diện tích, tỉ lệ, saturation), không xem ảnh — cần mắt người duyệt lại
trước khi coi là chốt.

### 12.2 Client

| Task | File / thay đổi |
| --- | --- |
| VIS-01 | `visualVariation.ts`: `hash2`, `hashString`, `fbm`, `grassTextureIndex`, `grassTint`, `roadStampLook`, `resourceLook` (thuần, test dưới Node). |
| VIS-03 | `TerrainLayer`: variant theo hash (hết `(gx+gy)%3`), tint 2 trường fbm chu kỳ ~40 tile (mọi kênh ≥ 0.88), stamp xoay theo tangent + scale 0.92–1.12 + tint + lệch vuông góc ±5px, 25% có stamp vai (pool 260, alpha 0.55). |
| VIS-04 | `TerrainLayer` vẽ cỏ ra ngoài biên `MAP_APRON_TILES = 4`; `DecorLayer` (pool theo loại, depth 5, LOD forb khi zoom < 0.55, đung đưa ±1.5°, tắt dưới zoom 0.55) + `decorArt.ts` + preload trong `WorldScene`. |
| VIS-05 | `decorScatter.ts`: `decorAt` (hoa/cỏ theo fbm thành vạt, đá 0.8%, bụi 1.2%, bỏ tile đường/blocked), `borderDecorAt` (ring 4 mức), `canopyDecor` (1–2 cỏ quanh gốc cây). |
| VIS-06 | `EntityRenderer.createResourceNodeSprite`: scale 0.90–1.15, flip ~50%, tint ≥ `0xdfe8cf`, bù `y` để đáy vẫn bám tile; ghi `gridX/gridY` (và `sizeX/sizeY` cho nhà) làm dữ liệu cho decor. |
| VIS-07 | `minimapArt.ts` + `Minimap.tsx`: backing 280×280 (CSS 140), nền raster từ `isDirtRoadTile` + fbm, rừng gom cụm (bán kính 2, cache theo số cây sống) rồi vẽ thành blob tròn có viền, vàng = diamond, đá = triangle, berry = dot, lính = circle (mình có ring trắng), viewport nền mờ 8%. Bỏ hẳn nền `#1e3f16` và vòng line 45°. |
| VIS-08 | Phase này. |

### 12.3 Kiểm tra

- `apps/client && tsc --noEmit` → sạch.
- `vitest run` → **287 test / 11 file xanh** (thêm 40 test: `visualVariation` 15, `decorScatter` 12,
  `minimapArt` 13; `assetManifest` tự phủ 29 target).
- `pnpm --filter @chien-quoc/client build` → OK (1.97 MB JS, cảnh báo chunk cũ).
- `python3 scripts/assets/build.py --check` → OK (29 target, 7 source, 54 legacy).

### 12.4 Còn phải verify tay

- Rừng: `tree_3` mới có còn lẫn tông không; mật độ/thân cây 4 biến thể ở zoom 0.4× và 2.2×.
- Decor: hoa/cỏ/đá có đúng chỗ (không đè chân nhà, không trên đường), mật độ có quá dày ở vạt fbm
  không; cỏ lay có tự nhiên không; rừng viền có che hết đường cắt map không.
- Minimap: cụm rừng đọc được ở cả 110×110 và 220×220; vàng/đá/berry/lính/nhà phân biệt được;
  khung camera và click/right-click vẫn đúng.
- Đường: xoay stamp có làm lộ mép cứng của `road_stamp` không; vai đường có bị lốm đốm.
- FPS: đếm sprite decor ở zoom min (kỳ vọng < 3k ảnh) và minimap 60fps.
