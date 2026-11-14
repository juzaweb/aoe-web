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
| `citadel/wall.png` | 128×184 | — | 1:1.44 |

Nền: **trắng `#FFFFFF` phẳng** (không gradient, không vignette). Nếu chạy qua pipeline chroma-key
thì đổi sang `#00FF00` — trắng không key được bằng `G − max(R, B) > 40`.

---

## Khối style dùng chung

Chèn vào mọi prompt, ngay sau câu mô tả chủ thể:

```text
Style and camera: true 2.5D dimetric isometric view at 45 degrees, 2:1 tile proportions, painterly semi-realistic medieval RTS art, hand-painted look with soft top-left key light and gentle ambient occlusion in the shading only. Muted desaturated palette matching an existing game set: warm grey-olive stone around #90896F, dark brown timber around #393A2E, straw and tan accents around #BFA462. Crisp readable silhouette, moderate detail that stays legible at the target pixel size, single building centered with generous margin on all sides.

Hard constraints: no ground plane, no terrain, no grass base, no cast shadow, no people, no animals, no text, no labels, no UI, no watermark, no border, no multiple variants, no collage. Isolated on a perfectly flat uniform pure white background (#FFFFFF) with no gradient and no vignette.
```

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

```