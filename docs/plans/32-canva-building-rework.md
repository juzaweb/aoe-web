# Phase 32 — Sinh lại art 5 công trình bằng Canva (`CVB-01..CVB-09`)

**Status: `DRAFT`** — đã chốt với user **style** và **phạm vi**; quyết định D1–D9 chờ duyệt để bắt
đầu code. Chưa có dòng code nào, chưa có asset mới.

**Đã chốt với user (2026-11-13):**

1. Style: **Tây Âu đá ấm**, cùng hướng palette với phase 31 (`31-citadel-style-rework.md`) — không
   chuyển Đông Á, không dùng lại nhà tranh `m_house_mat.png`.
2. Phạm vi: **toàn bộ công trình còn lấy từ OpenGameArt** — `house`, `barracks`, `stable`,
   `archery_range`, `tower`.

**Phạm vi file:** `apps/client` (`public/assets/buildings`, `buildingArt.ts`, `WorldScene.ts`,
`buildingThumbnails.ts`, `assetManifest.test.ts`), `scripts/` (pipeline asset), `CREDITS.md`,
`docs/plans`. **Không** đổi `packages/shared`, `apps/server`, schema, DB, `NetworkMessage`, protocol,
footprint hay placement: đây là phase art + pipeline thuần cosmetic.

---

## 1. Mục tiêu

Thay 5 sprite đang build từ OpenGameArt (`building.house`, `building.barracks`, `building.stable`,
`building.archery-range`, `building.tower`) bằng art **do Canva sinh**, lắp offline bằng một script
có cổng đo, giữ nguyên hợp đồng hình học mà client đang dựa vào.

Năm sprite hiện tại đến từ ba pack khác nhau, ba hướng sáng khác nhau: house/tower là ảnh Bleed
(CC-BY 3.0, đá xám lạnh, có bóng đổ bake), barracks/stable/archery_range là feudalwars (CC0, nắng
gắt, khung gỗ nâu). Sau phase 31, Thành chuyển sang đá ấm; nếu 5 công trình còn lại giữ nguyên thì
một vương quốc sẽ có hai chất liệu đá không liên quan gì nhau.

**Tiêu chí thành công:**

1. `python scripts/process_canva_buildings.py --check` xanh: đúng canvas, neo đáy, `iso_base` đạt
   ngưỡng hiện có, luminance đúng target, bốn góc canvas trong suốt.
2. `python scripts/assets/build.py --check` xanh — 5 file đã ra khỏi manifest/lock và nằm trong
   `GENERATED_PATHS`.
3. `pnpm --filter @chien-quoc/client run test` xanh.
4. Năm sprite cùng một palette (đá ấm, sáng trên-trái), silhouette khác nhau rõ, không bóng đổ,
   không ground plane, không chữ/watermark.
5. Manifest không còn `oga.bleed-medieval-06`, `oga.bleed-galata-tower`, `oga.feudal-*`;
   `CREDITS.md` không còn khai báo ba nguồn đó.

**Ngoài phạm vi:** cây/đá/cỏ/forbs/rocks (vẫn OGA, giữ attribution), 4 bậc nhà của phase 21,
tint theo màu phe, thay đổi `SHEET_OFFSET_Y`/`SHEET_SCALE`/footprint.

## 2. Hiện trạng đo được

Số đo đọc trực tiếp từ PNG đang ship (`ops.alpha_bbox`, `ops.top_inset`, `ops.luminance`,
`ops.iso_base`):

| Sprite | Canvas | `SHEET_OFFSET_Y` | `topInset` | lum (alpha ≥ 200) | `iso_base` (span, offset) | Nguồn |
| --- | --- | --- | --- | --- | --- | --- |
| `house.png` | 341×256 | −88 | 0 | **87.0** | 0.011, 0.000 | Bleed — Medieval Building 06 |
| `barracks.png` | 400×320 | −96 | 4 | **90.3** | 0.010, 0.024 | feudalwars — Barracks |
| `stable.png` | 400×320 | −96 | 3 | **89.2** | 0.008, 0.038 | feudalwars — Stable |
| `archery_range.png` | 400×320 | −96 | 29 | **90.5** | 0.010, 0.024 | feudalwars — Archery Range |
| `tower.png` | 160×360 | −160 | 9 | **74.3** | 0.071, 0.006 | Bleed — Galata Tower |

`buildingArt.ts` tính bar HP bằng `HP_BAR_Y[type] = SHEET_OFFSET_Y[type] − canvasH/2 + topInset − 8`,
nên `topInset` là số duy nhất phải đo lại sau khi thay art. Ngưỡng gate sẵn có trong
`scripts/assets/ops.py`: `ISO_BASE_MAX_SPAN = 0.10`, `ISO_BASE_MAX_OFFSET = 0.12` — phase này
**không nới**.

Vì sao 5 sprite này đang là "nợ": `scripts/assets/README.md` ghi rõ pipeline OGA tồn tại để pin
hash + license của pack tải về. Art do Canva sinh không có upstream URL, không có license để pin,
nên nó không thuộc manifest — nhưng hiện tại cả 5 vẫn nằm trong `targets` và bị `--check` đối xử
như hàng OGA.

## 3. Quyết định

| Mã | Quyết định |
| --- | --- |
| **D1** | **Canva sinh ảnh, Python lắp.** Dùng `generate-image` (text-to-image) cho từng công trình. Không dùng `create-design`: cần sprite tách nền, không cần layout; design sinh ra sẽ kèm khung/nền trang. |
| **D2** | **Nền chroma xanh, tách nền local.** Prompt yêu cầu nền phẳng `#00FF00`, không gradient/bóng/ground. Tách nền bằng ramp mềm + despill — cùng thuật toán `scripts/process_arrow_asset.py` — chạy trong script mới. Nhờ vậy build tái lập được từ raw đã commit, không phụ thuộc Canva lúc build. Raw đã có alpha thì bỏ qua bước key. |
| **D3** | **Raw commit vào repo**: `scripts/raw_downloads/canva_rework/<name>_raw.png` (tiền lệ `town_center_wide_mat_raw.png`). Không dùng tiền tố `_` — `.gitignore` đang bỏ qua `scripts/raw_downloads/**/_*`. |
| **D4** | **Hợp đồng hình học bất biến.** Canvas và `SHEET_OFFSET_Y` giữ nguyên; chỉ `HP_BAR_Y` được cập nhật theo `topInset` đo được. `SHEET_SCALE`, footprint, placement, `getIsoDepth` không đổi. |
| **D5** | **Art rời pipeline OGA.** Xoá 5 target + 5 source khỏi `manifest.json`; thêm 5 path vào `GENERATED_PATHS` của `build.py` (cùng cơ chế `portal.png` và `citadel/*`): không pin hash, `--check` của script mới là cổng. Pin hash sẽ khiến mỗi lần sinh lại trông như "hand edit". |
| **D6** | **Giữ độ sáng map.** `match_luminance` chạy **sau** khi đã `place` lên sheet, target = lum ở §2, sai số cho phép ±2.0. Gain bị clamp `[0.45, 2.60]` như mọi sprite khác. |
| **D7** | **`alphaFloor` 96**, chạy hai lần: trước `crop` và sau `fit`. Đây chính là op đã cứu `building.house` cũ: bóng đổ bake sẵn kéo dài về một phía làm hàng opaque cuối cùng lệch tâm, `iso_base` chặn; hạ alpha mờ rồi giãn phần còn lại giữ silhouette sắc. Lần thứ hai sau `fit` vì lanczos sinh lại pixel alpha rất mờ ở hàng đáy. |
| **D8** | **Không nới gate.** Sprite fail `iso_base` / sai canvas / `scale > 1.0` thì **sinh lại** với prompt chỉnh, không sửa ngưỡng và không nới `iso_base`. |
| **D9** | **Preview trước khi chốt.** Script có `--preview` ghép 5 sprite trên nền cỏ (`scripts/out/canva_buildings/`, đã gitignore) để user duyệt; ảnh Canva cũng hiện trong widget. Chỉ sau khi duyệt mới coi sprite là DONE. |

## 4. Art direction & prompt

Style chung, chèn vào mọi prompt:

> Isometric 2.5D game asset, true 2:1 dimetric view at 45°, Western European medieval, warm grey
> limestone with dark oak timber framing, soft top-left key light, painterly semi-realistic like a
> medieval RTS, single building centred with margin, no ground plane, no cast shadow, no people,
> no text, no watermark, isolated on a perfectly flat uniform pure green #00FF00 chroma-key
> background.

| Sprite | Chủ thể | `aspectRatio` |
| --- | --- | --- |
| house | two-storey village cottage, steep shingle roof, chimney | `LANDSCAPE_4_3` |
| barracks | rectangular barracks hall, training yard, weapon racks, low palisade | `LANDSCAPE_5_4` |
| stable | timber stable with three open stalls, hay bales, fenced paddock | `LANDSCAPE_5_4` |
| archery_range | open-sided archery range, straw target butts, shooting line, wooden fence | `LANDSCAPE_5_4` |
| tower | tall slender stone watchtower, battlements, single banner | `PORTRAIT_9_16` |

Mỗi lần gọi kèm `user_intent`. `jobId`, prompt và thời điểm sinh được ghi vào docstring script mới
và mục "Buildings (Canva rework)" của `CREDITS.md` để truy vết — Canva không seed được nên "tái
lập" nghĩa là build lại từ raw đã commit, không phải sinh lại giống hệt.

## 5. Pipeline lắp offline — `scripts/process_canva_buildings.py`

Khuôn theo `process_generated_assets.py` (cổng `--check` đo lại file đã ship thay vì so hash) và
`rebuild_canva_wall_town.py` (dùng lại `ops` của pipeline OGA).

```bash
python scripts/process_canva_buildings.py            # build 5 sprite từ raw đã commit
python scripts/process_canva_buildings.py --check    # cổng đo, không cần Canva
python scripts/process_canva_buildings.py --preview  # contact sheet trên cỏ
```

Op chain mỗi sprite:

```
key (ramp mềm + despill, bỏ qua nếu raw đã có alpha)
  -> floor_alpha(96)
  -> crop_to_alpha
  -> fit
  -> place(bottom-center)
  -> floor_alpha(96)
  -> match_luminance(target)
```

`--check` kiểm tra và fail kèm thông điệp nêu rõ sprite + số đo:

- canvas đúng bảng §2; `bottomInset == 0`; bốn góc canvas alpha == 0;
- `|lum − target| ≤ 2.0`;
- `iso_base` trong `ops.ISO_BASE_MAX_SPAN` / `ops.ISO_BASE_MAX_OFFSET`;
- `topInset` khớp hằng `MEASURED_TOP_INSET` trong script (nguồn sự thật cho `HP_BAR_Y`);
- `topInset ≤ 25%` chiều cao canvas và `scale ≤ 1.0` — chặn ảnh bị kéo to hoặc bố cục sai tỉ lệ;
- không còn pixel mang màu key: `G − max(R, B) > 40` ở vùng `alpha > 0` phải bằng 0;
- alpha coverage 20–60% (bắt ảnh nền bị key mất một nửa hoặc còn nguyên nền).

Toàn bộ hằng số (`CANVAS`, `MATCH_LUM`, `MEASURED_TOP_INSET`, `RAW_DIR`, đường dẫn out) nằm một chỗ
trong script, giống `process_citadel_assets.py`.

## 6. Hợp đồng từng sprite sau khi thay

Canvas và offset giữ nguyên; `topInset` mới đo từ `--check`; `HP_BAR_Y` suy ra từ nó:

| Type | Canvas | `SHEET_OFFSET_Y` | `topInset` (mới) | `HP_BAR_Y` = offset − canvasH/2 + topInset − 8 |
| --- | --- | --- | --- | --- |
| HOUSE | 341×256 | −88 | đo | `topInset − 224` |
| BARRACKS | 400×320 | −96 | đo | `topInset − 264` |
| STABLE | 400×320 | −96 | đo | `topInset − 264` |
| ARCHERY_RANGE | 400×320 | −96 | đo | `topInset − 264` |
| TOWER | 160×360 | −160 | đo | `topInset − 348` |

Nếu `topInset` mới bằng số cũ (0/4/3/29/9) thì `HP_BAR_Y` không đổi; khác thì cập nhật bảng
`HP_BAR_Y` trong `buildingArt.ts` + hằng trong test. Không được để `topInset` phình quá 25% canvas:
sprite sẽ nhỏ xíu trong khung, dù bar vẫn đúng.

## 7. Thay đổi file

### 7.1 Pipeline asset (`scripts/`)

| File | Việc |
| --- | --- |
| `scripts/process_canva_buildings.py` | **Mới** — §5 |
| `scripts/raw_downloads/canva_rework/{house,barracks,stable,archery_range,tower}_raw.png` | **Mới** — raw đã commit |
| `scripts/assets/manifest.json` | Xoá 5 target `building.*` + 5 source `oga.bleed-medieval-06`, `oga.bleed-galata-tower`, `oga.feudal-barracks`, `oga.feudal-stable`, `oga.feudal-archery-range` (không còn target nào dùng) |
| `scripts/assets/build.py` | Thêm 5 path vào `GENERATED_PATHS` + comment trỏ tới script mới |
| `scripts/assets/assets.lock.json` | Regenerate: `python scripts/assets/build.py --fetch --all` (mất 5 entry `targets`, 24 target còn lại không đổi hash) |
| `scripts/assets/README.md` | Mục "Generated art (not third-party)": thêm 5 sprite + lệnh `--check`; sửa đoạn nói stable/archery/tower/house build từ OGA |
| `scripts/generate_buildings_assets.py` | Cập nhật comment "must not overwrite" — 5 file giờ do script Canva sở hữu |
| `scripts/rebuild_buildings_canva.py` | **Xoá** — sau phase này vô nghĩa và nguy hiểm: target `house` của nó là 256×220, chạy lại sẽ ghi đè sai canvas |

### 7.2 Client

| File | Việc |
| --- | --- |
| `apps/client/src/game/render/buildingArt.ts` | `HP_BAR_Y` của 5 type theo §6; sửa comment ("Bleed's Galata Tower…", "same 400x320 canvas…"). Không đổi `SHEET_OFFSET_Y`, `SHEET_SCALE`, `FALLBACK_ART`, `TIER_ART` |
| `apps/client/src/game/scenes/WorldScene.ts` | `v=28` → `v=29` + comment lý do |
| `apps/client/src/components/buildingThumbnails.ts` | `BARRACKS`/`STABLE`/`ARCHERY_RANGE` v3→4, `TOWER` v4→5, `HOUSE` v15→16 |

### 7.3 Test

`apps/client/src/game/render/assetManifest.test.ts`:

- Xoá bảng `MIGRATED` (5 target đã ra khỏi lock) và `describe('house level invariance')` hiện tại —
  cả hai đọc `lock.targets['building.*']` nên sẽ đỏ ngay khi lock đổi.
- Thêm bảng hằng `CANVA_SHEETS: Partial<Record<BuildingType, { canvas, topInset }>>` đo từ
  `--check`, và `describe('canva building sheets')`:
  - `pngSize()` từng file == `canvas` (đọc IHDR, không cần decoder);
  - `buildingHpBarY(type) === SHEET_OFFSET_Y[type] − canvas[1]/2 + topInset − 8`;
  - `buildingArt(type, () => true)` trả `building_<TYPE>` với `offsetY` đúng bảng;
  - giữ nguyên case "falls back to procedural texture" của HOUSE.
- `describe('asset pipeline lock')` vẫn chạy trên 24 target OGA còn lại (cây/decor/resource), nên
  license + attribution của các pack đó vẫn được gác.

### 7.4 Docs

- `docs/plans/32-canva-building-rework.md` — file này.
- `docs/plans/README.md` — thêm dòng phase 32.
- `CREDITS.md` — xoá ba mục "Medieval Building 06", "Galata Tower", "Medieval Barracks/Stable/
  Archery Range"; thêm mục **Buildings (Canva rework)** dưới "Project-original art" (5 file, prompt,
  Canva provenance, script lắp). Giữ nguyên mục units / trees / forbs / rocks.

## 8. Edge cases & failure modes

| Tình huống | Xử lý |
| --- | --- |
| Job Canva fail / hết quota | Thử lại một lần; vẫn fail thì dừng và báo rõ sprite nào thiếu — **không** wire nửa bộ, vì 5 sprite phải cùng palette |
| Link job không trả về bytes ảnh | Bậc thang: `curl` URL → nếu là trang HTML thì mở bằng chrome-devtools, `list_network_requests(image)` + `get_network_request(responseFilePath=…)` để lấy body → vẫn fail thì nhờ user lưu file. Xác minh bằng Pillow (mở được, ≥ 1024 px) trước khi dùng |
| AI vẽ nền gradient / bóng đổ / ground plane | Matte để lại fringe, `iso_base` fail hoặc còn pixel key → sinh lại với prompt mạnh hơn ("no floor, no shadow, flat green only") |
| Matte ăn vào tường sáng | Nền xanh không trùng màu đá ấm, nhưng nếu vẫn ăn thì hạ `KEY_LO`/`KEY_HI`; kiểm tra alpha coverage 20–60% |
| Ảnh ra góc 30° / straight-on | `iso_base` span ~0.9 → sinh lại, nêu rõ "true 2:1 dimetric, 45°, front corner at bottom" |
| `topInset` lệch nhiều | Cập nhật `HP_BAR_Y` + hằng test; nếu > 25% chiều cao canvas thì sinh lại thay vì để sprite nhỏ xíu |
| Một sprite lệch palette (lạnh/xám) | Đo chroma/lum trong `--preview`; sinh lại đúng sprite đó, không tint runtime (Canvas renderer không tint được — xem `01-owner-visibility.md` §D) |
| Quên đồng bộ lock | `build.py --check` báo "not in the lock" hoặc target lạ → chạy `--fetch --all`; chỉ chạy `--legacy` khi thật sự muốn pin file ngoài pipeline |
| `--all` thiếu cache | `scripts/.cache/assets` đã có sẵn; nếu máy khác thì `python scripts/assets/build.py --fetch` trước |
| Rollback | `git revert` commit phase này; 5 PNG cũ vẫn lấy lại được từ git history |

## 9. Verification

```bash
python scripts/process_canva_buildings.py --check
python scripts/assets/build.py --check
pnpm --filter @chien-quoc/client run test
bash scripts/run-tests.sh     # build shared + prisma + tsc/vite build + client/server test
```

Kiểm tra mắt: `--preview` (contact sheet trên cỏ) và 5 thumbnail trong build menu — xác nhận không
sprite nào "trôi" khỏi tile và bar HP nằm trên nóc chứ không lơ lửng.

## 10. Hạng mục công việc

| Mã | Việc | Quyết định liên quan |
| --- | --- | --- |
| `CVB-01` | Sinh 5 ảnh bằng Canva theo prompt §4, tải raw về `scripts/raw_downloads/canva_rework/`, xác minh bằng Pillow (mở được, ≥ 1024 px) | D1–D3 |
| `CVB-02` | `scripts/process_canva_buildings.py`: op chain, `--check`, `--preview`, hằng số một chỗ | D2, D6, D7, D9 |
| `CVB-03` | Xoá 5 target + 5 source khỏi `manifest.json`, regenerate `assets.lock.json` | D5 |
| `CVB-04` | `GENERATED_PATHS` + `scripts/assets/README.md` + comment `generate_buildings_assets.py`; xoá `rebuild_buildings_canva.py` | D5 |
| `CVB-05` | `HP_BAR_Y` + comment trong `buildingArt.ts` theo `topInset` đo được | D4 |
| `CVB-06` | Test: thay `MIGRATED` + `house level invariance` bằng `CANVA_SHEETS` | D4 |
| `CVB-07` | Bump cache-bust: `WorldScene` `v=29`, thumbnail từng type | — |
| `CVB-08` | `CREDITS.md` (bỏ 3 mục OGA, thêm mục Canva) + plan doc + index | D5 |
| `CVB-09` | Chạy §9 verification, duyệt `--preview` và thumbnail trong build menu | D9 |

## 11. Giả định

- Canva MCP còn quota, và link ảnh truy cập được từ máy này (network + chrome-devtools đã kiểm tra
  là có).
- Không giữ bản OGA nào làm fallback: art Canva thay thế hoàn toàn 5 sprite; fallback procedural
  (`b_house`, `b_barracks`, …) vẫn nguyên trong `FALLBACK_ART` cho trường hợp PNG 404.
- Canvas/offset hiện tại là hợp đồng đúng; không thêm tier nhà (phase 21 vẫn ngoài phạm vi).
- Cây/đá/cỏ/forbs/rocks vẫn là OGA và vẫn được attribute.
