# Prompt sinh lại art công trình (Gemini)

Prompt cho **từng công trình còn lại** (nhà lính đã có prompt riêng). Mỗi mục gồm canvas đích,
độ sáng mục tiêu đo từ sprite đang ship, tỉ lệ và một khối prompt copy-paste được.

**Đo từ `apps/client/public/assets/buildings/*.png` (alpha ≥ 200):**

| Sprite | Canvas | Luminance | Tỉ lệ |
| --- | --- | --- | --- |
| `town_center.png` | 576×440 | 74.3 | 1.31:1 |
| `house.png` | 341×256 | 86.9 | 4:3 |
| `farm.png` | 384×192 | 112.0 | 2:1 |
| `stable.png` | 400×320 | 88.9 | 5:4 |
| `archery_range.png` | 400×320 | 90.2 | 5:4 |
| `siege_workshop.png` | 400×320 | 90.4 | 5:4 |
| `tower.png` | 160×360 | 74.5 | 4:9 |
| `lumber_camp.png` | 256×220 | 93.3 | ~6:5 |
| `mill.png` | 256×220 | 106.6 | ~6:5 |
| `mining_camp.png` | 256×220 | 94.5 | ~6:5 |
| `portal.png` | 320×360 | 85.3 | 8:9 |
| `citadel/wall.png` | 128×184 | 107.1 | 1:1.44 |
| `citadel/gate.png` | 512×500 | 107.6 | 1.02:1 |
| `citadel/gate_door.png` | 192×169 | 72.8 | 1.14:1 |
| `citadel/stairs.png` | 256×260 | 109.1 | 0.98:1 |
| `citadel/floor.png` | 128×64 | 130.7 | 2:1 |

Nền: **trắng `#FFFFFF` phẳng** (không gradient, không vignette). Pipeline hiện tại key đúng màu
này — `scripts/generate_buildings_assets.py` gọi `/v1/sprites` với `key_color: "#ffffff"`,
`tolerance: 28`. Không cần đổi sang `#00FF00`.

---

## TOWN_CENTER — 576×440, lum 74.3, 1.31:1

```text
Create ONE 2D isometric game asset of a medieval Western European town centre hall, for a real-time strategy game. Generate only the building.

Subject: a large two-storey timber-framed great hall on a warm grey limestone plinth, steep dark shingle roof with two small dormers and a stone chimney, an arched main doorway under a carved oak lintel, banners hanging either side of the door, a modest market stall with crates and barrels against one wall, low stone steps across the front. It must read as the biggest, most important building in a village.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall mid-dark brightness around 74/255 luminance so it sits above the village roofs without glowing. Crisp readable silhouette, moderate detail that stays legible at 576x440 pixels, single building centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape aspect ratio close to 4:3.
```

## HOUSE — 341×256, lum 86.9, 4:3

```text
Create ONE 2D isometric game asset of a medieval Western European peasant cottage, for a real-time strategy game. Generate only the building.

Subject: a compact two-storey cottage with a steep shingle roof and a stone chimney, warm grey stone ground floor, dark oak timber framing on the upper floor, a plank door with iron hinges, one shuttered window, a small firewood stack and a wicker basket beside the door. Modest village dwelling, clearly smaller and simpler than a town hall.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 87/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 341x256 pixels, single building centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape 4:3 aspect ratio.
```

## FARM — 384×192, lum 112.0, 2:1

```text
Create ONE 2D isometric game asset of a medieval European farm field tile, for a real-time strategy game. Generate only the field.

Subject: a neat rectangular plot of tilled dark soil with rows of young green wheat shoots, a low split-rail fence along two edges, a small scarecrow in one corner, and a wooden hand plough resting at the field edge. Flat, wide, ground-hugging composition that reads as a farm plot rather than a building.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive soil and stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, plus muted green crop shoots, overall brighter than the buildings at around 112/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 384x192 pixels, field centered with margin on all sides.

Hard constraints: no ground plane extending beyond the plot, no surrounding terrain, no horizon, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape 2:1 aspect ratio.
```

## STABLE — 400×320, lum 88.9, 5:4

```text
Create ONE 2D isometric game asset of a medieval Western European cavalry stable, for a real-time strategy game. Generate only the building.

Subject: a long timber-framed stable with three open stall bays facing the viewer, hay bales and a wooden hay rack inside, a steep shingle roof, warm grey stone corner posts, a fenced paddock strip in front with a water trough, a horseshoe sign above the central bay. Must read as a horse stable, not as a house or a barracks.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 89/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 400x320 pixels, single building centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape 5:4 aspect ratio.
```

## ARCHERY_RANGE — 400×320, lum 90.2, 5:4

```text
Create ONE 2D isometric game asset of a medieval Western European archery range, for a real-time strategy game. Generate only the building.

Subject: an open-sided timber shooting shelter with a shingle roof on the left, a row of round straw target butts on wooden stands across the back, a marked shooting line of low posts in front, a rack of longbows and quivers leaning against one post, a coiled rope and a small stool. Low, open structure — it must read as a training range, not a walled building.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 90/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 400x320 pixels, single structure centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape 5:4 aspect ratio.
```

## SIEGE_WORKSHOP — 400×320, lum 90.4, 5:4

```text
Create ONE 2D isometric game asset of a medieval Western European siege workshop, for a real-time strategy game. Generate only the building.

Subject: a big open-sided timber workshop with a wide shingle roof over a dirt work floor, a half-built wooden catapult frame with rope skeins inside, a heavy timber tripod hoist, stacked planks and iron-bound crates, a rack of tools and a spare wheel leaning on the wall, a small stone forge chimney at one end. It must read as a siege-engine yard, not a barracks or a barn.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 90/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 400x320 pixels, single building centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Landscape 5:4 aspect ratio.
```

## TOWER — 160×360, lum 74.5, 4:9

```text
Create ONE 2D isometric game asset of a medieval Western European stone watchtower, for a real-time strategy game. Generate only the tower.

Subject: a tall slender round tower of warm grey limestone with a battered base, crenellated top with a single plain banner on a short pole, a narrow arched doorway at the base, two small slit windows, a wooden hoarding ring just under the battlements. Vertical, narrow silhouette that stays readable at 160x360 pixels.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall darker brightness around 74/255 luminance. Crisp edges, moderate detail, tower centered with margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Portrait aspect ratio close to 4:9.
```

## LUMBER_CAMP — 256×220, lum 93.3, ~6:5

```text
Create ONE 2D isometric game asset of a medieval European lumberjack camp, for a real-time strategy game. Generate only the camp.

Subject: an open-sided timber workshop with a weathered shingle roof, tall stacks of cut logs and sawn planks, a two-man pit saw frame over a saw pit, an axe stuck in a chopping stump, small packed-dirt yard edged with stones. Grey-brown timber only, no masonry house walls — clearly a woodcutting camp, not a cottage.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 93/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 256x220 pixels, camp centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Aspect ratio near 6:5.
```

## MILL — 256×220, lum 106.6, ~6:5

```text
Create ONE 2D isometric game asset of a medieval European water mill, for a real-time strategy game. Generate only the mill.

Subject: a small stone and timber mill house beside a wooden water flume, one large vertical wooden water wheel on the side with visible spokes and paddles, a turning axle entering the wall, burlap flour sacks and grain sacks stacked by the door, a small handcart. Warm tan stone base, dark timber frame, slate shingle roof. Clearly a mill, not a cottage.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brighter brightness around 107/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 256x220 pixels, mill centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Aspect ratio near 6:5.
```

## MINING_CAMP — 256×220, lum 94.5, ~6:5

```text
Create ONE 2D isometric game asset of a medieval European mining camp, for a real-time strategy game. Generate only the camp.

Subject: a compact rocky outcrop built up tall with a timber-framed mine tunnel entrance at its foot, a wooden headframe winch over the shaft on top, one small ore cart on short wooden rails in front, crates of grey ore stacked beside the adit, pickaxes leaning on a crate. Grey stone and brown timber, open mine workings instead of house walls — clearly a mine.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 95/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 256x220 pixels, compact near-square composition, camp centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Aspect ratio near 6:5.
```

## PORTAL — 320×360, lum 85.3, 8:9

```text
Create ONE 2D isometric game asset of a medieval Western European stone gateway portal, for a real-time strategy game. Generate only the gate.

Subject: a tall fortified stone gatehouse with a single arched passage through the middle, weathered warm grey limestone voussoir band over the arch, twin crenellated turrets flanking the arch, a raised portcullis with iron spikes visible inside the passage, two iron-banded oak doors standing open, a plain banner on each turret. It must read as a passage between places, not a wall segment or a tower.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462, overall brightness around 85/255 luminance. Crisp readable silhouette, moderate detail that stays legible at 320x360 pixels, gate centered with margin on all sides and its base flat along the bottom edge.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Portrait aspect ratio close to 8:9.
```

## CITADEL / WALL — 128×184, 1:1.44

```text
Create ONE 2D isometric game asset of a single medieval Western European stone wall segment, for a real-time strategy game. Generate only the wall piece.

Subject: one modular curtain-wall block of warm grey limestone ashlar, straight horizontal top with a low crenellated parapet, a subtle battered base course, faint weathering streaks and slightly varied stone tones. It must tile seamlessly left and right with an identical neighbour, so both ends are straight vertical cuts with no corner return, no pillar, and no end cap.

Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F with darker mortar joints, overall lighter brightness around 107/255 luminance so it reads as fresh cut ashlar. Crisp readable silhouette, moderate detail that stays legible at 128x184 pixels, wall centered and filling the canvas horizontally.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette. Aspect ratio close to 1:1.44.
```

---

## Ghi chú sử dụng

- Sinh từng công trình một, không gộp. Prompt đã khóa `ONE` + `no multiple variants, no collage`.
- **Gemini không nối trực tiếp vào pipeline.** `scripts/generate_buildings_assets.py` gọi **ComfyUI
  local** (`LOCAL_API_URL` + `/v1/images` + `/v1/sprites`), không phải Gemini. Ảnh Gemini phải tải
  về tay, rồi mới đưa qua bước crop/fit.
- Script sở hữu từng sprite — dùng đúng cái, đừng chạy `--all`:

| Sprite | Script sở hữu | Ghi chú |
| --- | --- | --- |
| `farm`, `lumber_camp`, `mill`, `mining_camp` | `generate_buildings_assets.py --only <id>` | id có trong `BUILDING_SPECS` |
| `siege_workshop` | `generate_siege_workshop_asset.py` | có `TARGET_LUMA = 90.4`, `CANVAS = (400,320)` |
| `portal`, `citadel/{wall,gate,gate_door,floor,stairs}` | `process_generated_assets.py`, `process_citadel_assets.py` | nằm trong `GENERATED_PATHS` của `scripts/assets/build.py` |
| `town_center`, `barracks`, `house` | **chưa có** — đang là OGA trong `manifest.json` | `--all` sẽ ghi đè bằng bản render nét hơn; script tự chặn |
| `stable`, `archery_range`, `tower` | **chưa có** — đang là OGA (`oga.feudal-*`, `oga.bleed-galata-tower`) | thay art phải xoá target + source khỏi `manifest.json` và thêm vào `GENERATED_PATHS` (phase 32, D5) |

- `scripts/process_canva_buildings.py` được nhắc trong `docs/plans/32-canva-building-rework.md` §5
  **chưa tồn tại** — plan đó còn `DRAFT`. Đừng chạy theo plan cho tới khi nó được implement.
- Canvas và `SHEET_OFFSET_Y` trong `apps/client/src/game/render/buildingArt.ts` không đổi, nên chỉ
  cần cập nhật `HP_BAR_Y` theo `topInset` đo lại — xem `docs/plans/32-canva-building-rework.md` §6.
- Luminance trong bảng trên là **số đo của sprite đang ship**, không phải ngưỡng gate. Chỉ
  `generate_siege_workshop_asset.py` và `rebuild_canva_wall_town.py` thực sự ép luminance
  (`ops.match_luminance`); các sprite còn lại không bị ép, nên prompt phải tự mang con số đó.
