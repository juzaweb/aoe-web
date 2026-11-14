# Phase 06 — Tạo lại bộ asset theo "AoE like Assets" (OpenGameArt)

Status: **IMPLEMENTED (một phần)** — code + test xanh, chờ verify tay trong game.
Ngày ghi plan: 2026-11-03. Ngày implement: 2026-11-03.
Phạm vi: client + `scripts/`. **Không** đổi server, `packages/shared`, schema, protocol hay DB.

Quyết định đã chốt khi implement: **D1 = A** (lấy thẳng art châu Âu của pack), **D2 = B** (chỉ
CC-BY-SA cho file dẫn xuất — nhưng xem §16: terrain không dùng được vì lý do kỹ thuật),
**D5 = A** (asset thiếu giữ art cũ + cờ `legacy`). Kết quả thực tế ở §16.

Nguồn tham chiếu: [AoE like Assets](https://opengameart.org/content/aoe-like-assets) — collection do
`wulfic` tổng hợp, gồm 18 mục art isometric 2.5D dùng được cho RTS kiểu AoE.

## 1. Mục tiêu

Thay bộ art hiện tại của client bằng art có nguồn gốc rõ ràng, lấy từ collection trên, giữ nguyên
các hợp đồng kỹ thuật mà code đang phụ thuộc:

- hình chiếu isometric 2:1 với `TILE_WIDTH = 128`, `TILE_HEIGHT = 64`
  (`packages/shared/src/constants/index.ts:12`);
- kích thước canvas + điểm neo của từng sprite, vì `buildingArt.ts` và `EntityRenderer.ts` đọc
  thẳng số đo từ đó;
- 8 hướng unit, thứ tự hàng E → NE (`unitDirections.ts:18`), cell 148×130 của pack SKYZ0R;
- lớp fallback procedural (`ProceduralSprites.ts`) để không bao giờ có texture 404.

Kết quả mong muốn:

1. Mọi hình trong `apps/client/public/assets` đến từ một URL OGA có license ghi rõ trong manifest.
2. Dựng lại được toàn bộ bằng một lệnh, không phụ thuộc ComfyUI nội bộ (`192.168.1.14:8090`),
   Canva hay job id đã mất.
3. Có test chặn drift giữa file PNG trên đĩa và manifest (kích thước, hash, alpha bbox, anchor).

**Không nằm trong phase này:** đổi gameplay/protocol/netcode, thêm công trình hay unit mới, tự vẽ
pixel art mới, đổi camera/hình chiếu.

### 1.1 Quan hệ với Phase 05 (map realism)

Phase 05 ([`05-map-realism.md`](./05-map-realism.md)) và phase này đều chạm phần nhìn nhưng không
trùng việc:

| | Phase 05 — map realism | Phase 06 — thay art (file này) |
| --- | --- | --- |
| Mục tiêu | biến thiên cách **vẽ** map: tint, stamp, decor, rừng viền, minimap | thay **file PNG** đang ship bằng art có nguồn |
| File chạm | `TerrainLayer`, `DecorLayer`, `Minimap` | `apps/client/public/assets`, `buildingArt.ts`, preload |
| Terrain | giữ tile cũ, thêm hash/tint/scale | có thể thay tile (ART-03, phụ thuộc D2) |
| Tài nguyên | thêm decor + border tree (`_tree_06`, `_tree_10`) | thay `resources/tree.png` (cùng pack Bleed, khác đích) |
| License | D2: chỉ CC0/CC-BY | D2 ở đây: phải xin phép mới nới sang CC-BY-SA cho terrain |

Hệ quả cần nhớ:

- **Không dựng pipeline thứ hai.** `scripts/build_decor_assets.py` của phase 05 đã có phần tải zip,
  tách connected-component và bottom-align; phase 06 import helper từ đó (hoặc từ
  `unit_sheet_kit.py`) thay vì copy.
- ART-04 và VIS-02 cùng lấy Tree Collection v2.6 nhưng khác file đích; phải chốt biến thể nào cho
  resource tree, biến thể nào cho rừng viền để không trùng hình.
- Minimap của phase 05 (D4) đọc đúng `/assets/resources/*.png` và `/assets/units/*_idle.png`, nên khi
  ART-04/ART-08 thay các file đó thì minimap đổi theo mà không cần sửa `Minimap.tsx`.
- Nếu phase 05 ship trước, tile mới của ART-03 vẫn bị tint/hash như tile cũ — không cần sửa thêm.
- Phase 05 tuyên bố **không** đổi art unit/building; phase 06 làm đúng phần đó, nên thứ tự 05 → 06
  tránh hai nhánh sửa cùng file.

## 2. Vì sao phải "tạo lại" chứ không chỉ tải về dán vào

| Vấn đề của art hiện tại | Bằng chứng |
| --- | --- |
| Sinh bằng AI, không tái lập được | `generate_buildings_assets.py`, `download_and_process_native_hd.py` gọi ComfyUI qua `job_id`; `generate_cursors.py` tương tự |
| Không có license của bên thứ ba | `CREDITS.md` chỉ ghi pack SKYZ0R cho unit; building/resource/terrain/icon/cursor không có mục nguồn |
| Kích thước phình to, không đồng nhất | TC 576×440 (405 KB); tree 160×220; barracks 400×320; mỗi loại một tỷ lệ khác nhau |
| Lệch phong cách nội bộ | unit là pixel art 148×130, building là ảnh render bóng bẩy, terrain là "AoE 2 grass" tự sinh |
| Không có hướng nhìn chuẩn | Building chỉ 1 ảnh, tree chỉ 1 ảnh, không có shadow layer |

Bộ OGA thì ngược lại: file gốc có alpha, nhiều hướng, có shadow layer riêng, license CC0/CC-BY ghi
ngay trên trang. Cái mất chỉ là art AI cũ — game đã chốt bối cảnh châu Âu trung cổ nên không lệch
nhận diện (xem D1).

## 3. Hiện trạng asset trong client

Số đo lấy trực tiếp từ file đang ship (59 PNG trong 8 thư mục).

| Nhóm | File | Kích thước | Neo / offset | Nguồn hiện tại |
| --- | --- | --- | --- | --- |
| Building | `buildings/town_center.png` | 576×440 | `SHEET_OFFSET_Y.TOWN_CENTER = -130` | AI (ComfyUI + Canva matting) |
| Building | `barracks.png`, `lumber_camp.png`, `mill.png`, `mining_camp.png`, `house.png` | 400×320, 256×220, 256×220, 256×220, 256×220 | `-96`, `-70`, `-70`, `-70`, `-70` | AI |
| Building | `farm.png` | 384×192 | `0` | AI |
| Building | `tower.png` | 160×360 | `-160`, HP bar `-350` | AI |
| Resource | `tree.png` | 160×220 | `offsetY = -84` (hardcode) | AI |
| Resource | `gold.png`, `stone.png`, `berry.png` | 152×116 | `offsetY = -28` (hardcode) | AI |
| Terrain | `grass{,_1,_2,_3}.png`, `dirt{,_1,_2,_3}.png` | 128×64 | tile centre | AI, mô phỏng "AoE 2 grass" |
| Terrain | `road_stamp{,_1,_2,_3}.png` | 120×60 | spline point | AI |
| Unit | `units/actions/*.png` | cell 148×130, 8 hàng | `unitArt.ts` | **OGA SKYZ0R, CC-BY 4.0** |
| Unit | `units/cavalry_sheet.png` | cell 160×160, 1 hướng | `UNIT_ART.CAVALRY` | procedural (không có art pack) |
| Icon | `icons/{wood,food,gold,stone,population}.png` | 64×64 | HUD `<img>` | AI |
| Cursor | `cursors/*.png` | 32×32 | `cursorArt.generated.ts` | AI |

Điểm neo và offset nằm ở `render/buildingArt.ts:16` (`SHEET_OFFSET_Y`), `:50` (`HP_BAR_Y`) và
`render/EntityRenderer.ts:136` (`createResourceNodeSprite`).

## 4. Bộ nguồn: đo được gì từ 18 mục của collection

Số đo dưới đây lấy từ file tải về ngày 2026-11-03 (preview ảnh, zip mẫu), không phải suy đoán từ
mô tả trang.

| Mục (OGA) | Tác giả | License | Đo được | Phù hợp cho |
| --- | --- | --- | --- | --- |
| [400+ Items - BaseHumanMale / Orc / Skeleton](https://opengameart.org/content/400-items-basehumanmale-orc-skeleton) | SKYZ0R | CC-BY 4.0 | 148×130/cell, 8 CAM, các anim `1_Idle`, `2_Attack`, `3_Bow`, `5_Walk`, `7_Death` | **đang dùng** cho villager/spearman/archer |
| [Grassland Tileset](https://opengameart.org/content/grassland-tileset) | Clint Bellanger + 6 tác giả khác | CC-BY 3.0 / CC-BY-SA 3.0 | `grassland_tiles.png` 1024×1344 = lưới 16×42 ô **64×32**, alpha ngoài diamond; 200+ tile (cỏ, đường đá, vách đá, cây, cọc, giếng, nhà, lều, cầu, bến) | **terrain**: upscale 2× (nearest) ra đúng 128×64 |
| [Tree Collection v2.6](https://opengameart.org/content/tree-collection-v26-bleeds-game-art) | Bleed | CC-BY 3.0 | 64 cây, mỗi cây 8 hướng, frame 631×723 | **tree** resource, nhiều biến thể |
| [Tree Collection](https://opengameart.org/content/tree-collection-bleeds-game-art) | Bleed | CC-BY 3.0 | 25 cây, PNG alpha | phương án dự phòng cho tree |
| [Animated Isometric Tree](https://opengameart.org/content/animated-isometric-tree-bleeds-game-art) | Bleed | CC-BY 3.0 | 30 frame 517×547, loop kiểu ping-pong | hiệu ứng rừng (optional) |
| [Simple Isometric Hovel](https://opengameart.org/content/simple-isometric-hovel) | Bleed | CC-BY 4.0 | 16 hướng 511×460 + shadow layer | house/camp |
| [Isometric Medieval Tavern](https://opengameart.org/content/isometric-medieval-tavern) | Bleed | CC-BY 3.0 / 4.0 | 8 hướng 396×499 + shadow layer | mill/quán (nếu cần) |
| [Old Well](https://opengameart.org/content/old-well-bleeds-game-art) | Bleed | CC-BY 3.0 (credit tuỳ chọn) | 8 hướng 467×504 | prop trang trí, không phải drop-off |
| [Medieval Cart Prop](https://opengameart.org/content/medieval-cart-prop) | Bleed | CC-BY 4.0 / CC0 | 16 hướng 551×320 + shadow | lumber camp (xe + gỗ) |
| [Medieval Catapult (free)](https://opengameart.org/content/medieval-catapult-free-version) | Bleed | CC-BY 3.0 / CC0 | 30 frame move, 8 hướng, 314×315 | unit siege tương lai (ngoài scope) |
| [Medieval Building 06](https://opengameart.org/content/medieval-building-06) | Bleed | CC-BY 3.0 | 1 hướng, preview 550×410 | town center dự phòng |
| [Medieval Barracks](https://opengameart.org/content/medieval-barracks-isometric-25d) | feudalwars | **CC0** | 315×250, 1 hướng | **barracks** |
| [Medieval Stable](https://opengameart.org/content/medieval-stable-isometric-25d) | feudalwars | **CC0** | 318×252, 1 hướng | stable/chuồng ngựa (chưa có trong game) |
| [Medieval Archery Range](https://opengameart.org/content/medieval-archery-range-isometric-25d) | feudalwars | **CC0** | 305×222, 1 hướng | archery range (chưa có trong game) |
| [Western-European Castle](https://opengameart.org/content/western-european-castle-isometric-25d) | feudalwars | **CC0** | 1024×192, alpha **đục hoàn toàn** → phải tách nền/segment trước khi dùng | town center hoặc tower |
| [Western-European Medieval Houses](https://opengameart.org/content/western-european-medieval-houses-isometric-25d) | feudalwars | **CC0** | 400×100, art 369×76, là **dải nhiều nhà** | house, lumber/mill/mining camp |
| [6 Isometric buildings](https://opengameart.org/content/6-isometric-buildings) | Scribe / Unknown Horizons | CC-BY-SA 3.0 (kèm LICENSE.txt lồng nhiều tác giả) | render 192×192, **4 hướng** (45°/135°/225°/315°), chỉ idle; herbary có thêm working | barracks/church/herbary thay thế |
| [isometric medieval buildings](https://opengameart.org/content/isometric-medieval-buildings) | rubberduck | **CC0** | 2 building, 2 độ phân giải (128×64 và 64×32), có tuyết | house dự phòng đúng tỷ lệ tile |
| [Animated fish swarm](https://opengameart.org/content/animated-fish-swarm-ready-for-isometric-rendering) | Scrittl | CC-BY 3.0 | 3 con cá hồi, animation | **loại** — game không có nước |

Ghi chú license (đọc từ trang gốc, không suy diễn):

- **CC0** (feudalwars 5 mục, rubberduck): không nghĩa vụ ghi công, an toàn nhất.
- **CC-BY 3.0/4.0** (Bleed, SKYZ0R, Scrittl): phải ghi tên + link + nói rõ đã sửa gì — `CREDITS.md`
  đã làm đúng mẫu này cho SKYZ0R.
- **CC-BY-SA 3.0** (grassland tileset, 6-isometric-buildings): file dẫn xuất phải giữ CC-BY-SA 3.0;
  grassland còn yêu cầu ghi công 7 tác giả + 16 texture nguồn. Đây là quyết định D2.

## 5. Khoảng trống so với nhu cầu của game

Đây là phần quan trọng nhất: collection **không phủ hết** bộ asset game cần.

| Asset game cần | Có trong collection? | Phương án |
| --- | --- | --- |
| Farm (3×3, có trạng thái cạn/brown) | Không | giữ art AI hiện tại, đánh dấu `legacy` (D5) |
| Watch Tower (1×1) | Không trực tiếp | crop tháp từ `castle.png` nếu tách được; nếu không, giữ AI |
| Portal (2×2) | Không | giữ tower + tint tím như D8 của phase 04 |
| Gold Mine | Không | giữ AI |
| Stone Mine | Không trực tiếp | có thể crop đá/vách từ grassland tileset (CC-BY-SA) |
| Berry Bush | Không trực tiếp | crop bụi cây trong grassland tileset, hoặc giữ AI |
| Cavalry | Không (pack SKYZ0R chỉ humanoid) | giữ procedural; không tự vẽ |
| Icon HUD 64×64, cursor 32×32 | Không | giữ AI (D5) |

Collection toàn art châu Âu trung cổ, khớp bối cảnh game đã chốt (xem D1).

## 6. Quyết định cần chốt

| Mã | Câu hỏi | Phương án | Đề xuất |
| --- | --- | --- | --- |
| **D1** | Bản sắc hình ảnh: game lấy bối cảnh châu Âu trung cổ, nên lấy thẳng art châu Âu của pack hay giữ art AI cũ? | A. lấy thẳng art châu Âu của pack cho công trình/cây, giữ unit pixel + terrain AoE. B. giữ art AI cũ, pack chỉ làm reference rồi re-skin tay (cần artist, ngoài scope). | **A** cho phase này. Lưu ý: đây là quyết định sản phẩm, không phải kỹ thuật — bối cảnh châu Âu đã chốt cùng tên game *AoE web*, nên công trình châu Âu trung cổ không còn lệch nhận diện |
| **D2** | Chấp nhận CC-BY-SA 3.0 cho terrain (và building của Unknown Horizons)? Phase 05 §4 đã chọn "chỉ CC0/CC-BY", nên phương án B ở đây là **nới ràng buộc đó** và cần user đồng ý rõ ràng | A. giữ nguyên CC0/CC-BY → bỏ ART-03, phase chỉ còn tree + building. B. nhận CC-BY-SA cho **file terrain dẫn xuất**, loại building UH. C. nhận cả hai. | **B** nếu muốn terrain khớp 128×64: grassland là nguồn duy nhất đúng tỷ lệ, và nghĩa vụ chỉ rơi trên 12 file PNG dẫn xuất. Nếu không được nới thì chọn **A** |
| **D3** | "Tạo lại" = transplant (dùng file gốc, chuẩn hoá) hay redraw theo phong cách? | A. transplant. B. redraw. | **A**. Redraw cần artist và không kiểm chứng được trong repo |
| **D4** | Có dùng nhiều hướng cho công trình/cây không? | A. công trình 1 hướng (chọn tay), cây 4 biến thể × `flipX`. B. công trình 1 hướng, cây 8 hướng thật. C. công trình cũng 8 hướng. | **A**: rẻ texture, đủ đa dạng thị giác; B chỉ khi thấy rừng quá lặp |
| **D5** | Asset không có nguồn OGA thì làm gì? | A. giữ art AI, gắn cờ `legacy` trong manifest. B. xoá và để fallback procedural. C. chờ nguồn khác rồi mới làm. | **A**. Xoá art AI sẽ làm farm/tower/mine xấu đi rõ rệt |
| **D6** | Offset/HP bar sau khi đổi art: sửa tay hay sinh tự động? | A. vẫn viết tay trong `buildingArt.ts`, thêm test đối chiếu số đo trong report. B. codegen `buildingArt.generated.ts`. | **A**: số offset là quyết định thị giác, cần review được trong diff; test chặn drift là đủ |
| **D7** | Xử lý archive nguồn (`.7z`, `.zip`, `.rar`) và shadow layer? | A. cache ngoài repo (`scripts/.cache/assets/`), chỉ commit PNG đã chuẩn hoá; shadow bake vào sprite. B. commit cả raw. C. giữ shadow layer thành sprite riêng. | **A**. Repo hiện đã ignore `scripts/raw_downloads/oga/`; game không có hệ thống đổ bóng động nên bake là đủ |

## 7. Đặc tả kỹ thuật đích

### 7.1 Hình chiếu và tile

- `gridToScreen` cho `x = (gx - gy) * 64`, `y = (gx + gy) * 32`; góc "trước" của một footprint là
  đỉnh nam (gx + gy lớn nhất) — công trình phải quay mặt về hướng này.
- Terrain: 1 ô = 128×64, alpha ngoài diamond. Nguồn grassland là 64×32 → **upscale 2× bằng NEAREST**
  (tỷ lệ nguyên, giữ pixel sắc cạnh); cấm LANCZOS cho tile pixel.
- Nền map `#58752d` (`WorldScene.ts`) phải khớp mép tile grass mới, nếu không sẽ lộ seam khi zoom.

### 7.2 Công trình

Hợp đồng neo (giữ nguyên để không phải sửa `EntityRenderer`):

- Canvas giữ đúng kích thước hiện tại của từng loại (bảng §3), trừ khi art mới buộc phải nới; nới
  canvas thì phải cập nhật đồng thời `SHEET_OFFSET_Y`, `HP_BAR_Y` và test.
- Neo **bottom-centre**: hàng cuối canvas phải có pixel đục (art chạm đáy). Test sẽ fail nếu không.
- Bbox ngang phải cân giữa canvas ±2 px.
- `offsetY = baseY - H / 2`, với `baseY` là đường chân công trình trong không gian container
  (dương = xuống). Giá trị hiện tại suy ra từ code: TC `+90`, barracks `+64`, house `+40`,
  tower `+20` — dùng làm mốc so sánh khi calibrate lại.
- `HP_BAR_Y = offsetY - (H / 2 - topInset) - 6`, `topInset` = hàng đục đầu tiên trong PNG. Bỏ số
  tay hiện tại (TC `-357`, tower `-350`, ...) sau khi đã đo.
- Tỷ lệ: `scale = footprintW / impliedGroundW` (đo từ diamond đáy sprite). Nếu `scale > 1.6` với
  art painted thì **nới canvas** thay vì phóng to (tránh mờ); với tile pixel thì chỉ cho phép hệ số
  nguyên (1×, 2×, 3×).

### 7.3 Tài nguyên

- Canvas giữ `160×220` (tree) và `152×116` (gold/stone/berry); offset hiện hardcode trong
  `EntityRenderer.ts:136` → chuyển thành config đo được, cùng cơ chế với building.
- Tree nhiều biến thể: chọn biến thể bằng hash `(gridX * 31 + gridY * 17) % N` (ổn định, không cần
  state server), `flipX` theo bit tiếp theo. Không thêm field protocol.
- Nếu dùng sheet nhiều hướng cho tree: 1 file `res_node_TREE_<variant>.png` gồm 8 hàng × 1 frame,
  cùng quy ước hàng E → NE; chỉ dùng hàng hợp với camera, không cần animation.

### 7.4 Terrain

- 4 biến thể grass + 4 dirt. Nếu phase 05 chưa ship thì giữ công thức
  `variant = (gx*7 + gy*13) % 3 + 1` (`TerrainLayer.ts:113`) và biến thể đường trong
  `terrainMath.ts:24`; nếu phase 05 đã ship thì biến thể do `visualVariation.ts` quyết định và phase
  này không sửa công thức đó.
- Road stamps: hiện là ảnh 120×60 vẽ đè theo spline; nguồn mới phải crop từ tile đường đá của
  grassland và **không** có viền diamond, nếu không sẽ lộ hình thoi khi chồng lên cỏ.
- Kiểm tra seam: render 64 ô liền nhau ở zoom 1.0 và 0.4, không được có đường tối giữa tile.

### 7.5 Unit

Không đổi trong phase này. Pack SKYZ0R vẫn là nguồn duy nhất cho 3 unit bộ binh; cavalry tiếp tục
là art cũ. Nếu sau này thêm catapult (CC0 của Bleed, 8 hướng, 30 frame) thì đó là phase riêng vì
phải thêm unit type + protocol.

### 7.6 Icon và cursor

Giữ nguyên art AI. Ghi `legacy` trong manifest để lần audit sau không tưởng là đã có nguồn.

### 7.7 Quy ước resample / alpha

- Resample trong premultiplied alpha (PIL `RGBa`) như `rebuild_buildings_canva.py` đang làm — tránh
  halo đen ở mép silhouette.
- Tile pixel: NEAREST, hệ số nguyên. Art painted 300–700 px: LANCZOS một lần về kích thước đích,
  không resize hai bước.
- Shadow layer của Bleed: bake thành một lớp alpha nhân 0.35, đặt dưới silhouette, **trước** khi đo
  bbox (shadow thuộc về sprite). Nếu shadow làm lệch anchor thì tách ra và ghi rõ trong report.
- Không thêm outline, không đổi hue, không "làm nét" — mọi thay đổi phải ghi trong `CREDITS.md`.

## 8. Ánh xạ asset → nguồn

| Asset đích | Canvas | Nguồn | Xử lý | Ưu tiên |
| --- | --- | --- | --- | --- |
| `terrain/grass{,_1,_2,_3}.png` | 128×64 | grassland tileset, chọn 4 ô cỏ | cắt ô 64×32 → NEAREST 2× | ART-03 |
| `terrain/dirt{,_1,_2,_3}.png` | 128×64 | grassland tileset, ô đất/đường | như trên | ART-03 |
| `terrain/road_stamp{,_1,_2,_3}.png` | 120×60 | grassland tileset, ô đường đá | crop phần giữa ô, bỏ viền diamond | ART-03 |
| `resources/tree.png` | 160×220 | Tree Collection v2.6, 4 cây | chọn 1 hướng, LANCZOS về 160×220, bake shadow | ART-04 |
| `resources/stone.png` | 152×116 | grassland tileset (vách đá/đá tảng) | ghép 2–3 mảnh, alpha | ART-08 |
| `resources/berry.png` | 152×116 | grassland tileset (bụi/plants) | ghép bụi, alpha | ART-08 |
| `buildings/barracks.png` | 400×320 (hoặc nới) | Feudal Wars barracks (CC0) | key nền trắng, bbox, scale theo footprint 3×3 | ART-06 |
| `buildings/house.png` | 256×220 | Feudal Wars houses (CC0), tách 1 nhà | dải 400×100 có các nhà dính nhau → tách bằng connected-component 2D hoặc crop tay theo toạ độ ghi trong manifest; key nền | ART-06 |
| `buildings/town_center.png` | 576×440 (hoặc nới) | Castle strip (CC0) hoặc Medieval Building 06 (CC-BY) | tách nền/segment trước; nếu castle không key được thì dùng Building 06 | ART-07 |
| `buildings/tower.png` | 160×360 | crop tháp từ castle (CC0) | crop + key; nếu fail → giữ AI | ART-07 |
| `buildings/lumber_camp.png` | 256×220 | Bleed cart (16 hướng) | chọn hướng hợp camera, bake shadow | ART-09 |
| `buildings/mill.png` | 256×220 | Bleed tavern (8 hướng) hoặc houses strip | cân nhắc: tavern là quán, không phải cối xay | ART-09 |
| `buildings/mining_camp.png` | 256×220 | houses strip / hovel | chọn biến thể nhà nhỏ | ART-09 |
| `buildings/farm.png` | 384×192 | — (không có nguồn) | giữ AI, `legacy` | — |
| `buildings/portal.png` | — | — (dùng `building_TOWER` + tint) | giữ nguyên | — |
| `cursors/*`, `icons/*` | 32×32, 64×64 | — | giữ AI, `legacy` | — |

## 9. Pipeline dựng asset

### 9.1 Thư mục

```
scripts/assets/
├── manifest.json          # nguồn + license + cách biến đổi từng file đích
├── build.py               # fetch / extract / transform / write / check
├── ops.py                 # crop ô, tách dải, key nền, resample, anchor (dùng unit_sheet_kit.py)
└── README.md              # cách chạy, cách thêm một asset

scripts/.cache/assets/     # archive + frame gốc (gitignored)
scripts/out/assets/        # report.json + contact sheet (gitignored)
```

Script hiện có (`build_oga_unit_sheets.py`, `unit_sheet_kit.py`) đã giải đúng bài toán tách figure,
anchor và feather; `build_decor_assets.py` của phase 05 đã có tải zip + connected-component +
bottom-align. Pipeline mới **import lại** các helper đó thay vì viết lại lần thứ ba.

### 9.2 Manifest (ví dụ rút gọn)

```json
{
  "version": 1,
  "sources": {
    "oga.grassland": {
      "page": "https://opengameart.org/content/grassland-tileset",
      "author": "Clint Bellanger, Lamoot, Blender Foundation, lattice, p0ss, Bart K., Sindwiller",
      "license": "CC-BY-SA-3.0",
      "files": {
        "tiles": {
          "url": "https://opengameart.org/sites/default/files/grassland_tiles.png",
          "sha256": "<filled by --fetch>"
        }
      }
    }
  },
  "targets": {
    "terrain.grass_1": {
      "source": "oga.grassland",
      "file": "tiles",
      "op": { "kind": "tile", "tileW": 64, "tileH": 32, "col": 3, "row": 0, "scale": 2, "resample": "nearest" },
      "out": "apps/client/public/assets/terrain/grass_1.png",
      "canvas": [128, 64],
      "anchor": "tile-center",
      "license": "CC-BY-SA-3.0"
    }
  }
}
```

Trường bắt buộc: `source`, `file`, `op`, `out`, `canvas`, `anchor`, `license`. Thiếu `license` hoặc
không có entry trong `sources.<id>.author` là lỗi build, không phải warning.

### 9.3 Lệnh

```bash
python scripts/assets/build.py --fetch             # tải + verify sha256 vào cache
python scripts/assets/build.py --only terrain      # dựng một nhóm
python scripts/assets/build.py --all               # dựng toàn bộ target
python scripts/assets/build.py --check             # không ghi, verify đĩa khớp manifest
python scripts/assets/build.py --report            # in bbox/scale/implied iso ratio
```

`--check` là thứ CI chạy. Nó fail khi: file thiếu, kích thước sai, hash khác manifest, hàng cuối
canvas trống, bbox lệch tâm > 2 px, hoặc license/author thiếu.

### 9.4 Report

`scripts/out/assets/report.json` ghi cho từng file đích: nguồn, license, bbox, kích thước gốc,
hệ số scale, `impliedIsoRatio` (rộng/cao của diamond đáy — kỳ vọng 2.0), `baseY` đo được, cảnh báo.
Đây là dữ liệu để calibrate offset (D6) và để review diff khi đổi nguồn.

### 9.5 Test trong CI

Thêm `apps/client/src/game/render/assetManifest.test.ts` theo đúng khuôn của
`unitArt.sheets.test.ts` (đọc IHDR, không cần decoder):

- mỗi target có file tồn tại đúng đường dẫn;
- kích thước = `canvas` trong manifest;
- `sha256` trên đĩa khớp manifest (chặn sửa tay file PNG);
- mọi `target` có `license`, và `license` đó xuất hiện trong `CREDITS.md`.

## 10. Task / commit

| # | Task | Commit |
| --- | --- | --- |
| ART-01 | Scaffold `scripts/assets/` (manifest + build + check + report), chưa đổi art nào | `chore(assets): add a manifest-driven pipeline for OpenGameArt sources` |
| ART-02 | License registry: mọi source có author/license, sinh khối attribution cho `CREDITS.md` | `docs(assets): record sources, authors and licenses for the new art` |
| ART-03 | Terrain: grass/dirt/road từ grassland tileset, bump cache key, test seam | `feat(client): rebuild grass, dirt and road terrain from the OGA grassland tileset` |
| ART-04 | Tree: 4 biến thể từ Tree Collection v2.6 + hash chọn biến thể + flipX | `feat(client): replace tree resource art with the OGA tree collection` |
| ART-05 | Đo và chốt offset/HP bar cho công trình từ bbox (không đổi art) | `feat(assets): derive building offsets and health bar positions from sprite bounds` |
| ART-06 | Barracks + house từ Feudal Wars CC0 | `feat(client): use CC0 feudal sprites for barracks and houses` |
| ART-07 | Town center + tower: castle strip / Medieval Building 06 | `feat(client): replace town center and tower art with OGA castle sprites` |
| ART-08 | Berry + stone từ grassland tileset; gold giữ legacy | `feat(client): rebuild berry and stone resource art from the OGA tileset` |
| ART-09 | Camp props: cart/hovel/houses cho lumber, mill, mining camp | `feat(client): add OGA prop art for the three drop-off camps` |
| ART-10 | Chốt danh sách `legacy` còn lại (farm/portal/gold/cavalry/icon/cursor, tower nếu ART-07 fail) | `docs(assets): list assets that keep their legacy artwork` |
| ART-11 | Verify trong game + perf + bump toàn bộ cache key | `chore(client): bump asset cache keys and verify the rebuilt art` |
| ART-12 | Chốt `CREDITS.md` + phạm vi license trong `README.md` | `docs: finalize third-party art credits and license scope` |

Chi tiết từng task:

**ART-01 — pipeline**

- Tạo `scripts/assets/{build.py,ops.py,manifest.json,README.md}`.
- `--check` phải chạy được khi manifest rỗng (CI xanh trước khi có art mới).
- Không sửa `apps/client/public/assets` trong commit này.

**ART-02 — license registry**

- Mỗi mục của collection được dùng phải có: page, author(s), license, file + sha256, ngày tải.
- Thêm mục "Changes made" cho từng pack (cắt, scale, bake shadow, đổi hướng) — CC-BY bắt buộc.
- `CREDITS.md` thêm section mới, giữ nguyên section SKYZ0R.

**ART-03 — terrain**

- Chọn 4 ô cỏ + 4 ô đất/đường khác nhau, không trùng pattern.
- Road stamp: crop giữa ô, kiểm tra không có viền diamond.
- Đổi `tv = 'v=7'` → `v=8` trong `WorldScene.ts` (nếu không, browser giữ ảnh cũ).
- Test seam thủ công ở zoom 0.4 / 1.0 / 2.2.

**ART-04 — tree**

- 4 biến thể từ 64 cây; cùng một hàng hướng (chốt tay, ghi index vào manifest).
- Chốt biến thể với VIS-02 (phase 05) để resource tree và border tree không trùng hình.
- Hash chọn biến thể nằm trong `EntityRenderer.createResourceNodeSprite`, không đụng protocol.
- Bump `v` của resource; minimap phase 05 tự đổi icon vì đọc cùng file.

**ART-05 — calibrate**

- Chạy `--report`, đo `baseY` cho 8 loại công trình, cập nhật `SHEET_OFFSET_Y` + `HP_BAR_Y`.
- Thêm test so offset config với report (sai lệch > 2 px là fail).
- Có thể merge cùng ART-06 nếu thấy diff quá lớn — nhưng phải tách commit.

**ART-06 / ART-07 — công trình**

- Key nền trắng/đục, bbox, resample premultiplied, đặt bottom-centre.
- Nếu nới canvas: cập nhật `SHEET_OFFSET_Y`, `HP_BAR_Y`, width của HP bar (`sizeX * 36`) nếu cần.
- Kiểm tra overhang: công trình 1×1/2×2 không được che quá nửa tile lân cận ở zoom 0.4.

**ART-08 / ART-09 — tài nguyên và prop**

- Berry/stone: ghép từ tile, giữ alpha sạch, cùng canvas 152×116.
- Prop: chọn hướng khớp camera; bake shadow; không thêm sprite shadow riêng.

**ART-10 / ART-11 / ART-12 — chốt**

- `legacy` phải hiện trong manifest để lần audit sau biết đây là art chưa có nguồn.
- Verify danh sách ở §13; bump `uv`, `v`, `tv` cùng lúc.
- `README.md` phải nói rõ: code private, art bên thứ ba theo license riêng (đã có câu này, cần bổ
  sung CC-BY-SA).

## 11. Điểm chạm trong client

| File | Dòng / hàm | Việc phải làm |
| --- | --- | --- |
| `scenes/WorldScene.ts` | `preload()` 313, cache key `uv` 318, `v` 363, `tv` 380 | bump cache key; thêm key nếu có biến thể tree mới |
| `render/buildingArt.ts` | `SHEET_OFFSET_Y` 16, `HP_BAR_Y` 50, `buildingArt()` 70 | cập nhật offset/HP bar theo report |
| `render/EntityRenderer.ts` | `createResourceNodeSprite` 136, `createBuildingSprite` 188 | chọn biến thể tree, offset tài nguyên, tint giữ nguyên |
| `render/TerrainLayer.ts` | `render()` 57, variant 113, road 134 | giữ số biến thể, kiểm tra seam |
| `render/unitArt.ts` | `UNIT_ART` | không đổi (trừ khi D4 mở rộng) |
| `input/cursorArt.generated.ts` | sinh bởi `generate_cursors.py` | không đổi |
| `components/Minimap.tsx` | phase 05 đọc `/assets/resources/*` + `/assets/units/*_idle.png` | không sửa code; icon tự khớp file mới |
| `components/HUD.tsx` | `?v=3` cho icon | bump nếu icon đổi (không đổi trong phase này) |
| `packages/shared/src/constants/index.ts` | `TILE_WIDTH/HEIGHT` | **không đổi** |

## 12. License và attribution

Quy tắc:

1. Không có asset nào vào `apps/client/public/assets` mà không có entry manifest + dòng trong
   `CREDITS.md`.
2. CC0: ghi nguồn cho minh bạch, không bắt buộc.
3. CC-BY: ghi tác giả, link trang OGA, license, và mô tả thay đổi (cắt/scale/bake shadow/đổi hướng).
4. CC-BY-SA: file dẫn xuất giữ CC-BY-SA 3.0; ghi đủ danh sách tác giả gốc (grassland: 7 tác giả +
   16 texture nguồn; Unknown Horizons: LICENSE.txt trong pack).
5. Không đổi giấy phép của file gốc, không ghi "All rights reserved" cho phần art bên thứ ba.
6. Attribution sinh từ manifest (ART-02), không chép tay — chép tay sẽ lệch khi thay asset.

## 13. Verify

Tự động:

- `python scripts/assets/build.py --check` sạch.
- `pnpm --filter @chien-quoc/client test` xanh, gồm `assetManifest.test.ts` mới.
- `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch.

Thủ công (bắt buộc, vì đây là thay đổi thị giác):

- [ ] Grass 4 biến thể + dirt 4 biến thể: zoom 0.4 / 1.0 / 2.2, không seam, không lộ hình thoi.
- [ ] Road stamp chồng lên cỏ: mép mềm, không viền.
- [ ] Tree: 4 biến thể xuất hiện, flipX tự nhiên, chân cây đúng tile, không nhấp nháy khi pan.
- [ ] Building: chân công trình nằm đúng footprint, thanh máu không lơ lửng, badge level không đè mái.
- [ ] Công trình 1×1 (tower) không che tile bên cạnh quá mức; click chọn vẫn trúng (`hitTest`).
- [ ] Đổi màu sở hữu (OWN) vẫn đọc được trên art mới.
- [ ] FPS ≥ mức hiện tại ở zoom xa nhất với 3–4 đế chế.
- [ ] DevTools Network: không 404, không tải lại ảnh cũ do cache key.

## 14. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Art pack châu Âu lệch style với các sprite AI còn lại (farm, tower, mine, icon) | Cao | D1 đã chốt bối cảnh châu Âu; các sprite AI còn lại xếp backlog thay dần ở phase 31/32 |
| Art pack không đúng 2:1, phải scale không đều | Trung bình | đo `impliedIsoRatio` trong report; lệch > 5% thì loại asset đó |
| `castle.png` là ảnh đục 100%, có thể là scene render không key được | Trung bình | thử key trước; fail thì dùng Medieval Building 06 (CC-BY 3.0) |
| CC-BY-SA lây sang file dẫn xuất | Trung bình | D2 giới hạn ở terrain; ghi license từng file |
| Offset/HP bar lệch sau khi đổi art | Cao | ART-05 calibrate riêng + test đối chiếu report |
| Cache browser giữ ảnh cũ | Thấp | bump `uv`/`v`/`tv` cùng commit |
| Dung lượng texture tăng (64 cây × 8 hướng) | Trung bình | chỉ dùng 4 biến thể × 1 hướng, sheet theo biến thể |
| Art pixel 64×32 upscale 2× bị "mềm" nếu dùng LANCZOS | Thấp | NEAREST bắt buộc cho tile |
| 7z/bsdtar không có trên máy mới | Thấp | `--fetch` báo lỗi rõ; README ghi dependency |

Rollback: mỗi task là một commit độc lập; revert commit là quay lại art cũ vì manifest trỏ file cũ
theo đường dẫn. Không xoá art cũ trong cùng commit với art mới.

## 15. Câu hỏi mở

1. **D1**: bối cảnh châu Âu trung cổ đã chốt cho game *AoE web* — lấy thẳng art châu Âu của pack,
   hay giữ art AI cũ rồi re-skin dần (cần artist)?
2. **D2**: có đồng ý CC-BY-SA 3.0 cho terrain không? Nếu không, terrain tiếp tục là art AI và phase
   này chỉ đổi tree + building.
3. **D5**: farm/tower/portal/gold/cavalry/icon/cursor giữ art AI — chấp nhận, hay có nguồn khác cần
   chờ?
4. **D4**: cây 4 biến thể × flipX đã đủ, hay cần 8 hướng thật?
5. Có cần dùng luôn stable/archery range của feudalwars để tách train Cavalry/Archer khỏi Barracks
   (thay đổi gameplay) hay để dành phase sau?

## 16. Kết quả implement (2026-11-03)

Pipeline: `scripts/assets/{manifest.json,build.py,ops.py,README.md}` + `assets.lock.json`.
Nguồn tải về nằm ở `scripts/.cache/assets/` (gitignored). Build tất định: chạy `--all` hai lần cho
cùng lock hash.

### 16.1 Target đã ship

| Target | File | Canvas | Nguồn | License | Fit |
| --- | --- | --- | --- | --- | --- |
| `resource.tree` | `resources/tree.png` | 160×220 | Tree Collection v2.6, `_tree_02` | CC-BY 3.0 | 0.309 |
| `resource.tree-2` | `resources/tree_2.png` | 160×220 | `_tree_04` | CC-BY 3.0 | 0.305 |
| `resource.tree-3` | `resources/tree_3.png` | 160×220 | `_tree_06` | CC-BY 3.0 | 0.305 |
| `resource.tree-4` | `resources/tree_4.png` | 160×220 | `_tree_11` | CC-BY 3.0 | 0.226 |
| `building.barracks` | `buildings/barracks.png` | 400×320 | Feudal Wars Barracks | CC0 1.0 | 1.270 |
| `building.house` | `buildings/house.png` | 256×220 | Simple Isometric Hovel `60000` | CC-BY 4.0 | 0.493 |
| `building.town-center` | `buildings/town_center.png` | 576×440 | Feudal Wars Castle | CC0 1.0 | 1.043 |
| `building.lumber-camp` | `buildings/lumber_camp.png` | 256×220 | Feudal Wars Stable | CC0 1.0 | 0.805 |

Mọi sprite được crop theo alpha, scale vừa canvas, neo bottom-centre, và **cân bằng luminance**
theo sprite cũ (cùng hue, chỉ đổi độ sáng) để map không tối đi. Art bottom luôn chạm hàng cuối
canvas, nên `SHEET_OFFSET_Y` và offset tài nguyên không phải sửa.

> **Cập nhật 2026-11-08:** `building.lumber-camp` đã bị gỡ khỏi manifest vì dùng lại
> stable khiến nó trùng hệt `stable.png`. Ba camp kinh tế (`lumber_camp`, `mill`,
> `mining_camp`) giờ là art generated riêng, giữ canvas 256×220 và được pin ở
> `legacy`. Xem `scripts/assets/README.md`.

Town centre ban đầu lấy *Medieval Building 06* (CC-BY 3.0) và đọc ra như nhà ở; collection không có
asset town hall, nên đổi sang *Western-European Castle* của feudalwars — cùng bộ render với barracks
và stable, CC0, và có alpha sạch. Castle bị lật ngang (`op.flip: "x"`, xử lý trong `apply_op`) vì bản
gốc quay cổng sang phía ngược với camera; gương của một render 2:1 vẫn là góc nhìn hợp lệ của cùng
toà nhà nên không phá projection. Đây là lý do manifest có thêm khoá `flip`. Ảnh so sánh: `scripts/out/assets/tc_swap/preview.html`; các ứng viên
đã cân nhắc (Bleed 01–06, castle) nằm ở `scripts/out/assets/tc_candidates/`.

### 16.2 Thay đổi client

- `WorldScene.preload()`: cache key `v=3` → `v=4`; thêm `res_node_TREE_2..4`.
- `render/treeVariants.ts` (mới): `treeVariant(gx, gy)` chọn 1 trong 4 silhouette theo toạ độ tile;
  tách khỏi `EntityRenderer` để test được dưới Node (import Phaser trong vitest fail vì `window`).
- `EntityRenderer.createResourceNodeSprite`: dùng variant khi texture tồn tại, fallback `res_node_TREE`.
- `buildingArt.ts` `HP_BAR_Y` tính lại từ `topInset` đo được: TC `-358`, barracks `-260`,
  house `-188`, lumber camp `-171`.
- `assetManifest.test.ts` (mới): 47 test, kiểm tra hash/canvas/anchor/license của cả 8 file,
  `treeVariant`, và độ lệch `HP_BAR_Y` so với `topInset` trong lock.

Kết quả: `tsc --noEmit` sạch; `vitest run` 8 file / 142 test xanh;
`python scripts/assets/build.py --check` → `asset check OK: 8 targets, 5 sources`.

### 16.3 Phần bị bỏ và lý do đo được

- **ART-03 terrain — bỏ.** `grassland_tiles.png` (1024×1344) là tileset cho "Tiled v0.8": trang OGA
  trỏ sang repo Flare để lấy tile definition, và `tilesetdef` hiện tại của Flare map một ảnh **khác**
  (`tileset_grassland.png`, source rect tới x=1423), nên file OGA không kèm tile map. Quét ô 64×32
  và đo phần chồng lấn của diamond (nửa diamond = 512 px) chỉ tìm được **19 ô là diamond thật**, tất
  cả đều nâu/tối (mean 22–96), không có ô cỏ nền; các ô "xanh" là bụi/cỏ trang trí (overlap ≈ 0), cắt
  ra sẽ thành mảnh vụn. Ngoài ra art được render **unlit**: mean RGB toàn ảnh `(60,56,44)` so với
  grass hiện tại `(102,123,44)` — phải tăng sáng ~2× mà không có cách kiểm chứng thị giác trong repo.
  Muốn làm terrain cần một bước chọn tile bằng mắt (hoặc tile map gốc), tức là task riêng.
- **ART-08 berry/stone — bỏ**, cùng atlas và cùng lý do.
- **ART-07 tower — bỏ.** File `castle.png` tải từ trang OGA là `castle_7.png` (500×422) và **có**
  alpha (39.2% pixel trong suốt); ghi chú "đục 100%" ở bản plan trước là đo nhầm file preview. Castle
  được dùng cho town centre, còn tower vẫn là art AI vì castle không phải tháp canh.
- **ART-06 house** dùng hovel thay vì dải houses: dải `400×100` là **một** connected
  component (các nhà dính nhau), không tách bằng column runs được.

  Bản đầu chọn frame `00000`; đo lại thì đó là **hình chiếu thẳng 0°**, không phải góc 45°: hàng alpha
  cuối của `house.png` trải phẳng **97%** bề ngang art, trong khi lưới 128×64 cần hàng cuối là **một**
  góc trước (vài pixel quanh tâm) để bottom-centre neo đúng lên đỉnh dưới của diamond footprint. Hệ quả
  là nhà đọc như tấm bìa dựng đứng trên lưới iso, dù nó vẫn vừa canvas và vẫn chạm hàng cuối — đúng
  những gì `--check` kiểm tra trước đây, nên lọt.

  Hai frame 45° là `20000` và `60000`. Chốt `60000`: art 228×220, hàng cuối 2.2% bề ngang, sườn đáy
  1.80 / -2.22 (trung bình ≈ 2, đúng 2:1), và **góc trước lệch tâm canvas 13 px** so với 22 px của
  `20000`. Tiêu chí chọn là góc trước gần tâm nhất, vì `EntityRenderer` neo bottom-centre: trong một
  turnaround 16 hướng, camera xoay quanh **vật** chứ không quanh **điểm chạm đất**, nên mỗi frame có
  điểm chạm đất lệch một lượng khác nhau và frame lệch ít nhất là frame đứng đúng chỗ nhất. Đo trên
  bốn building do manifest dựng: barracks 1.0%/2.4%, house 2.2%/5.9%, lumber camp 0.8%/3.7%, castle
  4.0%/3.6% (span/lệch tâm).

  Vì lỗi này lọt qua mọi check cũ, `--check` có thêm luật `iso_base` (`ops.py`): với mọi target
  `building.*`, hàng cuối phải ≤ 10% bề ngang art và góc trước ≤ 10% lệch tâm. Đã thử đặt lại
  `entry = hovel_00000.png` → check fail đúng thông báo "straight-on view instead of a 45-degree one",
  rồi trả về `60000`.

  Còn lại: góc trước vẫn lệch 13 px (0.10 tile) về phải — chấp nhận được ở mức hiển thị này; nếu cần
  chỉnh tuyệt đối thì thêm op `offsetX` vào manifest chứ không sửa tay PNG. Art cũ trước đợt OGA vốn
  đúng iso (sườn 1.90 / -2.84, hàng cuối 2 px), nên đây là regression của lần swap.
- **ART-09** chỉ làm lumber camp (stable). Mill/mining camp không có nguồn tương ứng trong collection.
- **ART-10** danh sách legacy hiện ghi ở `scripts/assets/README.md` §Not migrated; manifest chỉ chứa
  target đã migrate. Nếu muốn `--check` cảnh báo asset legacy thì thêm mảng `legacy` vào manifest ở
  task sau.

Vì terrain không đổi, **D2 (CC-BY-SA) không áp dụng** trong lần implement này; phase 05 vẫn giữ
ràng buộc "chỉ CC0/CC-BY" đúng như plan của nó.

### 16.4 Còn cần verify tay

- 4 biến thể cây trong rừng thật: tỷ lệ, chân cây, có bị lặp/không khớp tông không.
- Barracks (upscale 1.27×) có bị mềm ở zoom 2.2× không; castle (upscale 1.04×) có đọc ra "nhà chính"
  hay chỉ ra "pháo đài". House đã đúng projection; còn phải xem bằng mắt là cửa hovel có quay cùng
  phía với cửa barracks/castle không, và dáng "túp lều" có đọc ra House không.
- Thanh máu 4 công trình mới có nằm sát mái không; badge level không đè art.
- Lumber camp dùng sprite chuồng ngựa có đọc ra "trại gỗ" không.
