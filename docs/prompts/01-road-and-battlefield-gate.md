# Prompt — Đường đất và cổng ra chiến trường

Status: **DRAFT** — chưa generate, chưa thay file nào trong `apps/client/public/assets`.
Ngày ghi: 2026-11-03.
Công cụ đích: **ComfyUI nội bộ** (`http://192.168.1.14:8090`, xem `scripts/generate_buildings_assets.py`),
workflow SDXL hoặc Flux. Prompt viết tiếng Anh; ghi chú và quy trình viết tiếng Việt.

Phạm vi: 2 asset nhìn thấy trên map — **stamp đường đất** và **cổng (portal) 2×2**. Không đổi
gameplay, protocol, schema hay vị trí cổng do server đặt.

---

## 1. Vì sao cần prompt riêng

| Asset | Hiện trạng | Vấn đề |
| --- | --- | --- |
| Đường | `assets/terrain/road_stamp{,_1,_2,_3}.png`, 120×60 | `road_stamp.png` và `road_stamp_1.png` trùng MD5; `_2`/`_3` chỉ khác rất ít. Đường dài 220 tile lặp cùng một motif, nhìn thành sọc. |
| Cổng | Chưa có art. `PORTAL` mượn sheet `building_TOWER` (160×360) rồi tint tím `0xc084fc` | Cổng đọc thành tháp phòng thủ bị nhuộm màu, không đọc thành "cổng ra chiến trường". Xem `buildingArt.ts:83`, `EntityRenderer.ts:243`. |

Mục tiêu: đường có biến thiên tự nhiên khi chồng stamp; cổng có silhouette riêng, đọc được ở
25% scale, khớp palette với 8 sprite đã thay ở Phase 06 (`docs/plans/06-aoe-asset-rebuild.md`).

---

## 2. Hợp đồng kỹ thuật (đo từ code, không được vi phạm)

| | Đường | Cổng |
| --- | --- | --- |
| File đích | `apps/client/public/assets/terrain/road_stamp{,_1,_2,_3}.png` | `apps/client/public/assets/buildings/portal.png` (mới) |
| Canvas | **120×60**, RGBA | **320×360**, RGBA |
| Neo | stamp phủ kín canvas, alpha elip mềm, tâm đục | bottom-center, hàng cuối canvas có pixel đục |
| Hình chiếu | nhìn thẳng từ trên, **không** perspective | isometric 2:1, khớp `TILE_WIDTH=128 / TILE_HEIGHT=64` (`packages/shared/src/constants/index.ts:12`) |
| Cách vẽ | đặt tại từng điểm spline, cách nhau **0.35 tile**, depth `-99990` (`TerrainLayer.ts:134-170`) | container ở tâm footprint 2×2, depth theo `gridX+gridY` (`EntityRenderer.ts:198`) |
| Footprint | — | 2×2 tile ⇒ diamond 256×128 px; art cao ~1.4× bề ngang chân |
| Màu trung bình hiện tại | `#b09160`, luminance ≈ 148 | tower `#5f432a` / lum 71; town center lum 70; barracks lum 87 |
| Nguồn | AI + mẫu AoE 2, không tái lập được | AI (ComfyUI), chưa có trong `CREDITS.md` |

Ràng buộc thêm:

- Nền generate phải là **trắng phẳng** để tách alpha, không phải nền trong suốt thật (SDXL vẽ
  "transparent" thành caro hoặc viền trắng).
- Không bake bóng đổ lệch ra ngoài footprint; renderer không vẽ shadow layer.
- Không chữ, watermark, logo, UI, khung viền, lưới tile.
- Cổng xuất hiện ở cả kingdom (mép phải map) và battlefield (server đặt gần tâm), nên art không
  được giả định có tường thành nối vào hai bên.

---

## 3. Style block dùng chung cho cổng

Dán nguyên khối này vào cuối positive prompt của cổng. Prompt đầy đủ ở §6.2 đã gồm sẵn khối này —
chỉ dùng riêng §3 khi muốn đổi subject mà giữ style, tránh dán hai lần.

```text
late-medieval European frontier stonework, weathered grey limestone and dark walnut timber,
stone coping on the piers, one faded indigo banner per pier, hand-painted 2.5D isometric RTS game
asset in the style of Age of Empires II Definitive Edition, muted desaturated natural palette,
painterly texture with fine brush detail, clean readable silhouette, crisp edges, soft overcast
daylight from the upper left, gentle ambient occlusion only at the base, no dramatic lighting,
no photorealistic rendering, no 3D render look, isolated on a flat pure white background, full
object centered with 6 percent margin, no ground plane, no cast shadow outside the footprint,
no text, no watermark, no UI
```

Neo màu nên bám theo các sprite đang ship (dùng làm ảnh tham chiếu style/composition nếu workflow
có IP-Adapter hoặc img2img):

- `apps/client/public/assets/buildings/town_center.png` — độ chi tiết, tông đá.
- `apps/client/public/assets/buildings/barracks.png` — độ tương phản, cờ và gỗ.
- `apps/client/public/assets/buildings/tower.png` — tỉ lệ dọc và silhouette.

---

## 4. Negative prompt dùng chung

```text
blurry, low contrast, flat lighting, photorealistic, photograph, 3D render, octane, unreal engine,
perspective camera, fisheye, orthographic mismatch, isometric grid lines, multiple buildings,
human, soldier, horse, animal, crowd, text, letters, watermark, signature, logo, UI, frame, border,
vignette, harsh black outline, cartoon outline, oversaturated, neon, HDR, lens flare, drop shadow,
ground plane, grass field, white fringe, halo, jpeg artifacts, duplicate object, cropped object
```

Với đường, bỏ các mục `multiple buildings`…`duplicate object` và thêm:

```text
rocks, boulders, grass tufts, leaves, footprints, hoofprints, puddles, cracks wider than 4 px,
straight seam, tiling seam, tile border, frame, vignette, directional light, specular highlight,
high contrast, objects, debris
```

---

## 5. Asset A — Stamp đường đất

### 5.1 Cách làm: generate texture, mask bằng code

Không nhờ model vẽ "viên đá alpha elip" — model hay trả về hình có viền cứng, nhìn thành vảy cá
khi chồng stamp. Pipeline đúng (giống `scripts/generate_smooth_dirt.py`):

1. Generate **texture đất seamless 2:1** (1024×512), phẳng, không perspective.
2. Cắt 4 cửa sổ khác nhau từ texture, resize về 120×60.
3. Gán alpha elip mềm bằng code: tâm `(60,30)`, bán kính `60×30`, feather ~14–18 px ngang và
   6–8 px dọc; góc alpha = 0, tâm = 255.
4. Resize trong **premultiplied alpha** để mép không bị viền sẫm.

Vì stamp cách nhau 0.35 tile (~22 px ngang), elip 120×60 chồng lên nhau ~80%, nên texture chỉ cần
liền mạch, không cần khớp mép elip.

### 5.2 Positive prompt chính

```text
Seamless tileable texture of a packed dirt road, top-down orthographic view, fine dry earth and
grit, scattered 1 to 3 pixel pebbles, shallow wheel ruts running horizontally with a slight
meander, subtle tonal variation between warm ochre and muted umber, hand-painted RTS terrain art
in the style of Age of Empires II Definitive Edition, matte surface, evenly lit with no directional
light, no shadows, no perspective, no vignette, no border, no objects, fills the frame edge to edge,
2:1 aspect ratio
```

### 5.3 Bốn biến thể

Chạy cùng prompt, khác hậu tố và seed. Mỗi biến thể phải khác MD5 và khác rõ khi nhìn ở 100%.

| File | Hậu tố thêm vào prompt | Seed gợi ý |
| --- | --- | --- |
| `road_stamp.png` | `baseline surface, medium brown, sparse gravel` | 4101 |
| `road_stamp_1.png` | `paler and dustier surface, very fine grit, faint cart track, fewer pebbles` | 4102 |
| `road_stamp_2.png` | `slightly darker damp clay, denser compacted grit, a few embedded flat stones` | 4103 |
| `road_stamp_3.png` | `sun-bleached surface with hairline cracks and scattered straw flecks, faint crossing ruts` | 4104 |

### 5.4 Thông số ComfyUI

| | SDXL | Flux |
| --- | --- | --- |
| Độ phân giải | 1024×512 | 1024×512 |
| Steps | 32 | 30 |
| CFG / guidance | 6.5 | 3.5 |
| Sampler / scheduler | `dpmpp_2m` / `karras` | `euler` / `simple` |
| Batch | 4 | 4 |
| Hires fix | 1.5×, denoise 0.35 (tuỳ chọn) | không cần |

Chọn 1 ảnh/seed, lưu bản gốc vào `scripts/out/road/` trước khi hạ kích thước.

### 5.5 Hậu kỳ và kiểm tra

```text
1024x512 -> crop 4 cửa sổ 480x240 -> resize 120x60 (LANCZOS, premultiplied)
-> alpha ellipse + feather -> PNG RGBA optimize
```

- [ ] Đúng 120×60, RGBA, corner alpha = 0, tâm alpha ≥ 250.
- [ ] Mean RGB trong `#a88a5c`–`#b89a6a` (luminance 140–158).
- [ ] 4 file có 4 MD5 khác nhau; không file nào > 60 KB.
- [ ] Ghép thử 3 stamp lệch nhau 22/11 px: không thấy seam, không thấy viền elip.
- [ ] Đặt trên `grass.png`: không có halo trắng hoặc viền đen.

---

## 6. Asset B — Cổng ra chiến trường

### 6.1 Vì sao prompt cũ ra hình nhà

Bản đầu tiên dùng `gatehouse`, `medieval ... architecture`, `terracotta tile caps` và ảnh tham chiếu
AoE 2 (toàn nhà) — cả bốn đều kéo model về **building có mái**, không phải **archway**. Model cũng
không suy ra "cổng" nếu không thấy khoảng trống xuyên qua: thiếu `free-standing`, `no walls
attached`, `see-through opening` thì "two stone towers flanking an arch" dễ thành nhà hai tháp.

Ba sửa đổi bắt buộc:

1. Bỏ hẳn từ `gatehouse` và `terracotta tile caps` khỏi prompt cổng.
2. Đưa `free-standing stone archway` lên đầu prompt, kèm `open passage you can see straight
   through` và `no building behind it`.
3. Thêm negative riêng cho cổng: `house, cottage, roofed building, windows, chimney, solid wall`.

### 6.2 Positive prompt chính (đã sửa)

```text
(free-standing stone archway:1.3), a single monumental stone gate standing alone, two thick square
stone piers joined by one tall pointed arch, (open passage you can see straight through:1.3),
empty see-through opening with the white background visible through it, no building behind the
arch, no walls attached to the piers, no roof, no enclosed room, no windows, dark walnut timber
portcullis half raised inside the arch, worn cobblestone threshold under the arch, two iron
braziers with small flames at the base of the piers, faint violet runes carved into the arch stones,
the opening itself empty, the gate is taller than it is wide, about 1.4 times the base width,
readable silhouette at 25 percent scale, late-medieval European frontier architecture, weathered
grey limestone and dark walnut timber, stone coping on the piers, one faded indigo banner on each
pier, hand-painted 2.5D isometric RTS game asset in the style of Age of Empires II Definitive
Edition, muted desaturated natural palette, painterly texture with fine brush detail, clean
readable silhouette, crisp edges, soft overcast daylight from the upper left, gentle ambient
occlusion only at the base, no dramatic lighting, no photorealistic rendering, no 3D render look,
isolated on a flat pure white background, full object centered with 6 percent margin, no ground
plane, no cast shadow outside the footprint, no text, no watermark, no UI
```

### 6.3 Negative riêng cho cổng

Thêm khối này vào negative chung ở §4 khi generate cổng:

```text
house, cottage, hut, cabin, tavern, mansion, townhouse, gatehouse with living quarters, roofed
building, tiled roof, gable roof, chimney, windows, storefront, enclosed room, solid wall, wall
attached to the gate, castle, fort, keep, tower only, house doorway, white fill inside the arch
```

### 6.4 Biến thể

| Mục đích | Thay đổi |
| --- | --- |
| Cổng "sạch", ít magic | bỏ `faint violet runes`, thêm `no glow, opening empty` |
| Cổng đang mở, đọc rõ lối đi | `portcullis fully raised, open passage, warm torchlight on the piers` |
| Dự phòng silhouette thấp | `single squat stone arch, height about 1.1 times the base width` |

Chọn bản đọc rõ nhất ở 25% scale. Ưu tiên silhouette hơn chi tiết nhỏ: ở zoom mặc định cổng chỉ
chiếm ~320×360 px.

### 6.5 Prompt cứu hộ khi vẫn ra nhà

Generate riêng phần vòm, thêm trang trí sau bằng inpaint:

```text
a stone archway alone in an empty white void, two thick stone pillars, one semicircular arch, you
can see the white background through the opening, no roof, no walls, no windows, architectural
cutout, game asset, isometric, hand-painted
```

Mẹo theo thứ tự:

1. Đặt `stone archway` trong 10 token đầu; ComfyUI weight `(stone archway:1.3)`.
2. Bỏ ảnh tham chiếu nhà khỏi IP-Adapter/ControlNet; nếu cần thì tham chiếu ảnh cổng đá hoặc cầu.
3. ControlNet depth từ một ảnh cổng thật, hoặc img2img từ sketch 2 trụ + 1 vòm.
4. Vẫn ra nhà: generate "arch only" ở 6.5 rồi inpaint banner/brazier/lưới sắt.

### 6.6 Thông số ComfyUI

| | SDXL | Flux |
| --- | --- | --- |
| Độ phân giải | 1024×1152 (đúng tỉ lệ 320:360) | 1024×1152 |
| Steps | 32 | 30 |
| CFG / guidance | 6.5 | 3.5 |
| Sampler / scheduler | `dpmpp_2m` / `karras` | `euler` / `simple` |
| Batch | 4 | 4 |
| Hires fix | 1.5×, denoise 0.3 | không cần |

### 6.7 Hậu kỳ

```text
1024x1152 -> tách alpha khỏi nền trắng (matte + despill) -> crop alpha bounds
-> scale để chân rộng 250-280 px, cao <= 356 px -> dán bottom-center vào canvas 320x360
-> PNG RGBA optimize
```

- [ ] Đúng 320×360, hàng cuối canvas có pixel đục (bottom-anchored).
- [ ] Chân art rộng 250–280 px, không tràn quá diamond 256×128 của footprint 2×2.
- [ ] **Lòng vòm trong suốt**: alpha ≈ 0 ở giữa cổng, nhìn xuyên qua thấy cỏ; không có mảng trắng
      hoặc mảng tối đặc bịt kín lối đi.
- [ ] Mean luminance 70–90, lệch không quá 15% so với `tower.png` (71).
- [ ] Không hào quang trắng quanh mái/đá khi đặt trên cỏ.
- [ ] Đọc được ở 25%: nhận ra cổng, không thành "tháp có lỗ" hay "nhà có cửa".
- [ ] Không có người/lính/ngựa trong ảnh.

---

## 7. Tích hợp client

### 7.1 Đường — không cần sửa code

Ghi đè 4 file là xong; key đã load sẵn ở `apps/client/src/game/scenes/WorldScene.ts:399-402`.
Nếu Phase 05 (`VIS-03`) thêm xoay/scale stamp thì 4 biến thể này vẫn dùng được, không đổi tên key.

### 7.2 Cổng — cần sửa code

1. Thêm preload cạnh các building khác (`WorldScene.ts:366-373`):
   `this.load.image('building_PORTAL', '/assets/buildings/portal.png?' + v)`.
2. `buildingArt.ts:83-90`: xoá nhánh đặc biệt trả `building_TOWER`; để `customKey` tự khớp
   `building_PORTAL`.
3. `EntityRenderer.ts:243`: xoá `if (building.type === 'PORTAL') img.setTint(0xc084fc)`.
4. `SHEET_OFFSET_Y.PORTAL` (`buildingArt.ts:30`): đặt `-150` cho canvas 320×360, tức đáy art ở
   local y ≈ +30 — cùng quy ước với house (+40) và barracks (+64/3×3). Nếu `bottomInset` đo được
   khác 0 thì cộng bù đúng số đó.
5. `HP_BAR_Y.PORTAL` (`buildingArt.ts:65`): tính lại bằng
   `offsetY - canvasHeight/2 + topInset - 10`; không hard-code lại số cũ `-350`.
6. `assetManifest.test.ts` không phủ portal (portal không nằm trong `assets.lock.json`), nên không
   cần sửa test; vẫn phải chạy `tsc --noEmit` + `vitest run` cho client.

### 7.3 Verify trong game

- [ ] Kingdom: cổng nằm mép phải, không lơ lửng, không che TC.
- [ ] Battlefield: cổng đặt gần tâm đọc được, không lẫn với tower.
- [ ] Click cổng vẫn mở panel travel; right-click vẫn chở quân đi.
- [ ] Minimap vẫn vẽ kim cương cyan (`Minimap.tsx:126`), không phụ thuộc art mới.
- [ ] Không có texture 404 khi xoá cache (`?v=` đổi theo build).

---

## 8. Ghi nguồn

Asset sinh bằng prompt này là **art gốc của project**, không phải third-party, nên không thuộc
`scripts/assets/manifest.json` và không cần dòng license trong `CREDITS.md`. Vẫn nên lưu để tái
lập:

- ảnh gốc + seed + model + workflow vào `scripts/out/{road,portal}/` (đã gitignore);
- ghi model/seed vào body commit khi thay file, ví dụ
  `feat(client): add dedicated portal art and four road stamp variants`.

Nếu sau này lấy art từ OGA thay vì generate, chuyển sang `scripts/assets/manifest.json` +
`build.py` và cập nhật `CREDITS.md`; khi đó `assetManifest.test.ts` sẽ chặn nếu thiếu license.
