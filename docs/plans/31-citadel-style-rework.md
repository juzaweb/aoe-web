# Phase 31 — Cải thiện style "Thành": keep thay castle, tường liền mạch, cổng có chiều sâu (`CIT-01..CIT-09`)

**Status: `PARTIAL`** (2026-11-13). Tường/cổng/sàn đã ship và đạt cổng đo. **Town Center không đổi**: `CIT-02` đã chạy — Canva sinh 3 candidate keep, dựng proof sheet, đo cả 3 đều đạt (lum 85.6, chroma 20.6-23.9, iso base OK) — nhưng user **revert** sau khi xem: giữ art castle hiện tại. Art cũ đã về nguyên trạng trong git. Xem §11.

**Phạm vi:** `apps/client` (`public/assets`, `buildingArt.ts`, `CitadelLayer.ts`, `WorldScene.ts`),
`scripts/`, `docs/plans`, `CREDITS.md`. **Không** đổi `packages/shared`, `apps/server`, schema,
`NetworkMessage`, protocol hay DB: đây là phase art + render thuần cosmetic.

**Đã chốt với user:** (1) đối tượng là art Thành **trong game** (`town_center.png` + bộ
`citadel/`), (2) kết quả **cả hai** — làm art trong Canva trước, duyệt bằng preview, rồi đưa PNG
vào game, (3) "mỗi nước" **dùng chung một bộ art**, chỉ cần đẹp hơn — không tint theo
`PlayerState.color`, không bake nhiều bộ, (4) style **giữ Tây Âu**, nâng chất lượng — không
chuyển Đông Á ở phase này.

---

## 1. Hiện trạng trước phase này

### 1.1 Thứ đã có

| Thứ | Chỗ | Ghi chú |
| --- | --- | --- |
| Art town center | `apps/client/public/assets/buildings/town_center.png` | 576×440, neo đáy, sinh bằng Canva rồi `ops` crop/fit/anchor |
| Art tường/cổng/sàn | `apps/client/public/assets/citadel/{wall,gate,gate_door,floor}.png` | wall 128×184, gate 512×500, door 192×169, floor 128×64 |
| Pipeline lắp tường/cổng/sàn | `scripts/process_citadel_assets.py` (`build_wall`, `build_gate`, `build_gate_door`, `build_floor`, `check`, `preview`) | mọi hình học nằm trong hằng số của module này |
| Pipeline town center | `scripts/rebuild_canva_wall_town.py` (`build_town_center`) + `scripts/assets/ops.py` | crop alpha → match luminance 74.8 → fit 576×440 → neo đáy |
| Hình học runtime | `apps/client/src/game/render/CitadelLayer.ts` (`WALL_RISE 120`, `WALL_BASE_CENTER_Y 152`, `GATE_ORIGIN_Y 308/500`, `GATE_DOOR {160,219,192,169}`) | tường/cổng phải khớp đúng các số này |
| Vị trí Thành trong map | `packages/shared/src/utils/citadel.ts` (`CITADEL_SIZE 17`, TC offset `(5,10)`, `CITADEL_GATE_WIDTH 3`) | vòng 17×17 quanh Nhà chính 4×6 |
| Cổng đo art | `python scripts/process_citadel_assets.py --check`, `apps/client/src/game/render/assetManifest.test.ts` | size, anchor, độ sáng, độ phủ, góc trong suốt |
| Proof sheet | `python scripts/process_citadel_assets.py --preview` | ghép 17×17 trên cỏ — **chưa có** town center ở giữa |
| Màu phe | `apps/client/src/game/render/ownerColor.ts` (`OwnerColorRegistry`) | phase này **không** dùng cho công trình |

### 1.2 Thứ còn thiếu / lệch

| Triệu chứng | Số đo (pixel đục) | Nguyên nhân đọc được từ code |
| --- | --- | --- |
| Tường đọc như hàng bia mộ, mỗi block tách rời | ảnh ghép 17×17 dựng bằng chính công thức `preview()` cho thấy viền tối bao quanh **mặt cap** của từng block | `WALL_OUTLINE = (0x3A, 0x3F, 0x47)` (lum ≈ 62) vẽ dày **1.2 px** trong `add_outline` — tương phản ~1.7× so với mặt đá (lum 103) |
| Tường/sân "nhựa", mất chi tiết đá | wall meanLum **103.0**, chroma **11.5**; gate chroma **3.5** | `prepare_texture` pre-blur **Gaussian 3.0 px** + desat 0.25 trên texture crop 360 px, map vào mặt 64 px ⇒ mất mip, mất màu |
| Thành lạc tông với nhà/trại | town_center chroma **8.4**, meanLum **73.9**; house chroma 23.2 / lum 86.7; barracks chroma 24.0 / lum 86.8 | render Canva cũ bị kéo về xám-lạnh; cờ fleur-de-lis xanh **baked sẵn** trong PNG |
| "Thành trong thành" | `town_center.png` có vòng tường + cổng riêng, nằm gọn trong vòng 17×17 `CitadelLayer` vẽ | art vẽ cả một castle hoàn chỉnh thay vì phần lõi (keep + sân trong) |
| Cổng tối, khối hộp | `GATE_PASSAGE_TOP 0x0B0D10 → GATE_PASSAGE_BOTTOM 0x1C2026`; `GATE_ARCH_RING 0x9A9FA8` mỏng | cổng lắp từ đá, không có voussoir/AO nên đọc là "hộp xám có lỗ đen" |
| Sân 15×15 phẳng lì | 225 tile dùng **cùng một** `floor.png`, meanLum **127.9**, chroma **4.3** | không biến thiên, không AO chân tường |

Số đo lấy bằng cách đọc PNG đã ship: `meanLum = mean(0.2126R + 0.7152G + 0.0722B)`,
`chroma = mean(max(R,G,B) − min(R,G,B))`, chỉ tính pixel có `alpha > 16`.

## 2. Quyết định thiết kế

| Mã | Quyết định |
| --- | --- |
| **D1** | **Hợp đồng hình học bất biến.** `town_center.png` 576×440 neo đáy; `wall.png` 128×184 (`WALL_RISE 120`, `WALL_BASE_CENTER_Y 152`); `gate.png` 512×500 với `GATE_ANCHOR (256,340)` và door rect `{160,219,192,169}`; `floor.png` 128×64. Không nới canvas ⇒ không đụng `CitadelLayer`, `buildingArt` offsets, luật placement, `getIsoDepth`. |
| **D2** | **Một bộ art dùng chung cho mọi nước.** Không tint runtime (Canvas renderer không tint được — xem `01-owner-visibility.md` §D); cờ trong art đổi sang heraldry **ấm** (đỏ thẫm/vàng đồng) để hoà palette, không mang nghĩa "màu phe". |
| **D3** | **Canva sinh art, Python lắp.** Canva sinh (a) ảnh keep cho town center, (b) 3 texture đá (mặt tường / walkway / sàn). Tường–cổng–sàn vẫn lắp offline vì hình học của chúng là hợp đồng với server; docstring `process_citadel_assets.py` đã ghi rõ gatehouse do AI sinh không khớp tỉ lệ 3-tile opening / 6-tile front. Không thêm three.js hay generation lúc runtime. |
| **D4** | **Tường: bỏ viền đen, thêm lỗ châu mai thấp.** Thay `add_outline` trên mặt cap bằng **AO mềm** (1 px, alpha ~0.35, độ tối tương đương lum ≥ 70). Thêm dải **merlon cao ≤ 10 px** chỉ trên nửa xa của cap, nằm trong **12 px headroom** có sẵn (đỉnh cap ở `y = 12`) ⇒ `WALL_SIZE` không đổi, cả dải tường đọc là battlement liên tục. Bỏ Gaussian 3.0, thay bằng **box-downsample (mip) + mortar line cố định** để hết speckle mà vẫn sắc. |
| **D5** | **Cổng: giữ hình học, thêm chiều sâu.** Voussoir ring dày hơn + highlight, passage gradient ấm (`#2A2620 → #3C362C`, không đen tuyền), cap dùng texture paving, AO ở chân tường và góc trụ, portcullis sáng hơn (`GATE_IRON_HIGHLIGHT` nâng). `GATE_DOOR` rect **không** đổi ⇒ animation kéo cổng không phải sửa. |
| **D6** | **Sàn: 3 biến thể, chọn bằng hash.** `floor.png` ấm hơn (chroma ≥ 10, rim lum 104 → ~112) + `floor_1.png`, `floor_2.png` (vách đất/rêu nhẹ). `CitadelLayer` chọn texture bằng `hash2(x, y)` sẵn có trong `visualVariation.ts` (hàm thuần, deterministic, test được) ⇒ 225 tile hết phẳng, không cần server replicate gì. |
| **D7** | **Town center là keep, không phải castle.** Ảnh mới 4:3: tháp chính + đại sảnh + 2–3 nhà trong sân, **không** vòng tường ngoài, **không** bóng đổ baked, sáng từ trên-trái (khớp `WALL_LEFT_LUM 105 > WALL_RIGHT_LUM 80`), đá ấm (base ~`#b9a88c`, highlight ~`#e8dcc4`, shadow ~`#6b5f4d`). Neo đáy, `ops.iso_base` phải đạt ngưỡng hiện có. |
| **D8** | **Mọi thay đổi art phải qua cổng đo.** Bổ sung chroma/lum window vào `process_citadel_assets.check()`; `rebuild_canva_wall_town.py` có `--check` (size, bottom inset, corner alpha, iso base, chroma, lum) và `--preview` — mở rộng `preview()` để **ghép cả town center vào giữa**, vì hiện preview chỉ vẽ tường/cổng/sàn. |
| **D9** | **Duyệt bằng proof sheet trước khi ghi asset.** Luồng: 3 candidate keep → proof sheet before/after (PIL, offline) → user chọn → mới ghi `town_center.png`. Không ghi đè asset đã ship khi chưa duyệt. |

## 3. Kiến trúc

```
Canva MCP                                   scripts/                         apps/client
─────────                                   ────────                         ───────────
generate-image (keep 4:3, 3 texture)
  └─ create-design → resize-design
     → start-editing-transaction
     → perform-editing-operations insert_fill
     → export-design (png, đúng canvas)
        └─ curl download_url ─────────────► scripts/raw_downloads/canva_rework/
                                             citadel_castle_v2_raw.png
                                             stone_face_v2_raw.png
                                             stone_cap_v2_raw.png
                                             stone_floor_v2_raw.png
                                                   │
                                     rebuild_canva_wall_town.py
                                       ├─ chroma key + despill (castle)
                                       ├─ box-downsample texture
                                       ├─ ops: crop/fit/anchor (town center)
                                       └─► buildings/town_center.png
                                     process_citadel_assets.py
                                       ├─ build_wall(parapet=True)  ─► citadel/wall.png
                                       ├─ build_gate(face, paving)  ─► citadel/gate.png
                                       ├─ build_gate_door           ─► citadel/gate_door.png
                                       └─ build_floor(--variant)    ─► citadel/floor{,_1,_2}.png
                                                   │
                                     WorldScene.preload (v=29, cv=9)
                                                   │
                                     CitadelLayer + buildingArt (HP bar theo topInset mới)
```

| File | Vai trò sau phase này |
| --- | --- |
| `scripts/rebuild_canva_wall_town.py` | Nhận 4 nguồn (`--castle/--face/--cap/--floor`); chroma-key + despill cho castle (dùng `process_arrow_asset.key_out_background`/`despill`); bỏ pre-blur Gaussian; tuning `STONE_GAIN`, `TOWN_MATCH_LUM` (74.8 → đo lại theo house ~86); thêm `--check` và `--preview` |
| `scripts/process_citadel_assets.py` | `build_wall(..., parapet=True)` (merlon ≤ 10 px, mask mở rộng); AO thay `add_outline` cap; `build_gate` thêm voussoir/AO/passage ấm; `build_floor(..., variant=)` xuất `floor_1/floor_2`; `check()` thêm chroma window + parapet row + contract của variant; `preview()` ghép town center vào giữa |
| `apps/client/src/game/render/citadelFloorVariants.ts` (mới) | `floorVariantAt(gridX, gridY): 0 \| 1 \| 2` — hàm thuần dùng `hash2`, không Phaser, không `Math.random` |
| `apps/client/src/game/render/CitadelLayer.ts` | Chọn texture `citadel_floor{,_1,_2}` theo `floorVariantAt`; fallback `citadel_floor` nếu texture biến thể thiếu |
| `apps/client/src/game/render/buildingArt.ts` | `HP_BAR_Y.TOWN_CENTER` theo `topInset` mới (comment ghi công thức `offsetY − height/2 + topInset − 8`) |
| `apps/client/src/game/render/assetManifest.test.ts` | Cập nhật hằng `measuredTopInset` (đang hardcode 23) + comment; giữ assert 576×440, wall 128×184, offset −60 |
| `apps/client/src/game/scenes/WorldScene.ts` | Preload 2 variant sàn; bump cache-bust `v=28 → v=29`, `cv=8 → cv=9` |
| `apps/client/public/assets/**` | 4 PNG thay thế + 2 PNG sàn mới |
| `CREDITS.md` | Mục "Citadel art": art gốc của dự án, sinh qua Canva, không license third-party; pipeline tái tạo là 2 script trên |

## 4. Luồng Canva chi tiết

1. **Sinh art** — `generate-image`:
   - Keep: `aspectRatio: LANDSCAPE_4_3`, prompt tiếng Anh: *isometric 2:1 (elevation 30°, azimuth 45°) medieval stone keep with great hall and inner bailey, warm sandstone, lit from top-left, crisp edges, no outer curtain wall, no baked shadow, no text or watermark, isolated on flat chroma green #00B140*. Làm **3 candidate**.
   - Texture (mỗi cái `SQUARE_1_1`): *seamless medieval ashlar stone, warm grey-beige, subtle moss, flat even light, no perspective, no vignette*; *top-down worn flagstone paving, seamless*; *top-down packed dirt and flagstone courtyard, seamless, moss in joints*.
   - Poll `get-generate-image-job` tới `SUCCESS`.
2. **Duyệt** — dựng proof sheet offline (PIL) 3 candidate + before/after, `present` cho user chọn; ghi lựa chọn vào file này (§7).
3. **Xuất PNG đúng canvas** — `create-design` (poster, brief *single flat chroma-green page, nothing else*) → `resize-design` custom đúng canvas đích → `start-editing-transaction` → `perform-editing-operations` `insert_fill` (`asset_id` = media id, `left 0 / top 0`, đúng `width`/`height`) → **show preview + xin duyệt** → `commit-editing-transaction` → `export-design` (`{type: png, width, height, transparent_background: false}`) → `curl` `download_url` về `scripts/raw_downloads/canva_rework/` với tên cố định ở §3. Thư mục này **được track** trong git (không nằm trong `.gitignore`).
4. **Matte** — `process_arrow_asset.key_out_background` + `despill` cho castle; texture giữ RGB.
5. **Fallback** — nếu bước 3 fail (auth, quota, URL cần cookie): user tải PNG tay từ link Canva vào đúng thư mục trên; script nhận đường dẫn qua flag nên không phụ thuộc tên file.

## 5. Edge case

| Tình huống | Xử lý |
| --- | --- |
| Art AI không đúng iso 2:1 (đáy không phải diamond) | `ops.iso_base` span/offset vượt `ISO_BASE_MAX_*` ⇒ script `exit`, candidate bị loại, **không** ghi asset |
| Art AI có bóng đổ baked / text / watermark | Loại ở bước duyệt; prompt đã cấm; kiểm bằng mắt trên proof sheet |
| Chroma key ăn vào vùng xám của đá | `KEY_LO/KEY_HI` chỉ áp cho pixel gần `#00B140`; `despill` + `bleed_rgb` chống halo; `--check` đo tỉ lệ pixel còn lệch hue xanh ở biên và fail nếu vượt ngưỡng |
| Ảnh nguồn nhỏ hơn canvas ⇒ upscale mờ | `ops.fit` trả `scale`; `--check` cảnh báo khi `scale < 0.9`; ưu tiên ảnh ≥ 1024 px |
| Parapet vượt 12 px headroom ⇒ đè lên tile phía trên | `build_wall` assert mọi pixel parapet có `y ≥ 2`; fail cổng nếu vi phạm |
| Tường mất liền mạch khi ghép 2 block | Test dựng tile 256×184 (ghép 2 block) và đo chênh lệch cột 127/128 dưới ngưỡng |
| `topInset` mới làm thanh máu lệch | Cập nhật `HP_BAR_Y.TOWN_CENTER` + `measuredTopInset` **cùng commit**; `assetManifest.test.ts` là cổng |
| Quên bump cache-bust ⇒ browser giữ PNG cũ | Ghi trong DoD; `v`/`cv` nằm cùng commit với PNG |
| Canva export trả size lệch | Resize offline bằng premultiplied alpha (`ops.fit`), không resize straight alpha |
| Thiếu texture biến thể sàn (404) | `CitadelLayer` fallback về `citadel_floor`; sàn vẫn vẽ, chỉ mất biến thiên |
| Phaser rơi về Canvas renderer | Phase này không dùng tint ⇒ không ảnh hưởng |

## 6. Test

| Cổng | Nội dung |
| --- | --- |
| `python scripts/process_citadel_assets.py --check` | size/anchor/corner/opaque như hiện tại + **mới**: chroma window (wall ≥ 16, gate ≥ 12, floor ≥ 10), parapet row (`y ≥ 2`), contract của `floor_1`/`floor_2` |
| `python scripts/rebuild_canva_wall_town.py --check` | town center 576×440, bottom inset 0, 4 góc alpha 0, iso base span/offset, chroma ≥ 16, lum 80–92 |
| `python scripts/process_citadel_assets.py --preview` | proof sheet có town center ở giữa, dùng để duyệt và lưu before/after |
| `apps/client/src/game/render/citadelFloorVariants.test.ts` (mới) | deterministic theo `(x, y)`; phân bố đủ 3 giá trị trên 15×15; không phụ thuộc thứ tự gọi |
| `apps/client/src/game/render/assetManifest.test.ts` | giữ assert hình học; cập nhật `measuredTopInset` theo art mới |
| `pnpm --filter @chien-quoc/client test` | baseline 58 file / 707 test (phase 29) + test mới, phải xanh |
| `cd apps/client && ../../node_modules/.bin/tsc --noEmit` | sạch |
| `pnpm build` | xanh |

## 7. Task breakdown

| ID | Việc | Checkpoint |
| --- | --- | --- |
| `CIT-01` | Mở rộng `preview()` ghép town center; dựng proof sheet **before** | Ảnh before lưu lại để so |
| `CIT-02` | Canva: sinh 3 candidate keep + 3 texture; duyệt bằng proof sheet | User chọn candidate (ghi lại trong file này) |
| `CIT-03` | Canva: export PNG đúng canvas, tải về `scripts/raw_downloads/canva_rework/` | 4 file nguồn nằm trong repo |
| `CIT-04` | `rebuild_canva_wall_town.py`: matte + bỏ pre-blur + tuning + `--check` | `--check` xanh |
| `CIT-05` | `process_citadel_assets.py`: parapet, AO thay viền đen, gate depth, floor variants, chroma gate | `--check` xanh |
| `CIT-06` | `citadelFloorVariants.ts` + `CitadelLayer` + preload + bump `v`/`cv` | test + `tsc` xanh |
| `CIT-07` | `buildingArt.ts` `HP_BAR_Y` + `assetManifest.test.ts` theo `topInset` mới | test client xanh |
| `CIT-08` | Verify in-game: screenshot zoom 0.4 / 1.0 / 2.2 (chrome-devtools MCP + dev server) | Ảnh after đạt §8.1 |
| `CIT-09` | Docs: cập nhật file này + `docs/plans/README.md` + `CREDITS.md` | — |

## 8. Tiêu chí thành công (đo được) & verify tay

1. **Palette khớp**: chroma trung bình của pixel đục đạt town_center ≥ 16, wall ≥ 16, gate ≥ 12,
   floor ≥ 10 (hiện 8.4 / 11.5 / 3.5 / 4.3; house 23.2, barracks 24.0).
2. **Tường liền mạch**: không còn viền tối bao quanh cap; có dải merlon; ghép 2 block không lộ seam.
3. **Hết "thành trong thành"**: ảnh keep không có vòng tường ngoài.
4. **Cổng có chiều sâu**: passage không đen tuyền, có voussoir + AO; portcullis vẫn khớp vòm.
5. **Verify tay**:
   - Vào kingdom, nhìn Thành ở 3 mức zoom: tường liền mạch, có lỗ châu mai, không viền đen; sân có
     biến thiên; cổng có chiều sâu.
   - Cho lính đi qua cổng: portcullis kéo lên vẫn khớp vòm.
   - So screenshot before/after ở cùng camera.
   - Chặn asset (404): fallback `b_tower`/procedural vẫn chạy, không sập scene.

## 9. Definition of Done

- [x] 4 PNG thay thế + 2 variant sàn đúng canvas/anchor theo D1; chroma đạt §8.1.
- [x] `--check` của 2 script xanh; `pnpm --filter @chien-quoc/client test`, `tsc --noEmit`,
      `pnpm build` xanh.
- [x] `v`/`cv` đã bump; `HP_BAR_Y.TOWN_CENTER` + `measuredTopInset` khớp art mới
      (`topInset` đo lại vẫn 23 nên `HP_BAR_Y` giữ `-335`).
- [ ] Proof sheet before/after; screenshot in-game 3 mức zoom — xem §11.4 (`CIT-08` chưa chốt).
- [x] `CREDITS.md` có mục citadel art; file này cập nhật status + số đo after; README index khớp.

## 10. Ngoài phạm vi / giả định

**Ngoài phạm vi**
- Nâng độ phân giải sprite (wall/floor 2× + `setScale(0.5)`) — ghi lại số đo ở zoom 2.2 làm backlog.
- Chuyển style Đông Á, tint màu phe cho công trình, nhiều bộ art theo nước.
- Art cho `stairs.png` và `gate_door.png` (giữ nguyên, trừ khi `CIT-05` buộc phải chỉnh contrast
  của portcullis để khớp passage mới).

**Giả định**
- Canva MCP còn quota, đang đăng nhập đúng team; `export-design` PNG khả dụng (đã xác nhận bằng
  `get-export-formats` trên một design có sẵn).
- Dev server chạy được cục bộ để verify in-game; nếu không, `CIT-08` hạ xuống "verify bằng proof
  sheet + chờ user".

## 11. Kết quả triển khai (2026-11-13)

### 11.1 Số đo trước / sau

Đo trên pixel `alpha > 16`; `lum` = Rec.709, `chroma` = mean(max − min).

| File | lum trước | lum sau | chroma trước | chroma sau |
| --- | --- | --- | --- | --- |
| `citadel/floor.png` | 127.9 | 129.7 | 4.3 | 25.1 |
| `citadel/floor_1.png` | — | 129.5 | — | 28.8 |
| `citadel/floor_2.png` | — | 126.7 | — | 22.4 |
| `citadel/wall.png` | 103.0 | 103.6 | 11.5 | 21.9 |
| `citadel/gate.png` | 103.6 | 106.4 | 3.5 | 22.7 |
| `citadel/gate_door.png` | 59.3 | 71.8 | 12.9 | 12.9 |
| `buildings/town_center.png` | 73.9 | 73.9 (không đổi) | 8.4 | 8.4 (không đổi) |

Tham chiếu palette: house lum 86.7 / chroma 23.2, barracks lum 86.8 / chroma 24.0. Wall
mean RGB sau là `(114, 105, 92)`, cùng độ lệch đỏ-trên-xanh của house `(93, 86, 70)`.

### 11.2 Việc đã làm

- `scripts/process_citadel_assets.py`: `build_wall(parapet=True)` thêm dải merlon 9 px trên hai
  mép xa của cap (đỉnh ở `y 3`, trong 12 px headroom, `--check` chặn `topRow < 2`), thay
  `add_outline` cap bằng `apply_ao` (0.30, 1.4 px), thêm `mortar_lines` cố định;
  `build_gate` thêm AO chân tường/góc trụ, passage ấm `#2A2620 → #3C362C` giữ 38% grain đá,
  voussoir band 13 px + joint + highlight; `build_floor(variant=)` xuất 3 biến thể;
  `measure_chroma` + `CHROMA_MIN` thành cổng; `preview()` dựng citadel 26×26 có Town Center
  thật ở slot của nó, sàn chọn theo `floor_variant_at` (mirror của hàm TS).
- `scripts/rebuild_canva_wall_town.py`: bỏ Gaussian blur + desaturate, dùng `box_mip` (đã chuyển
  vào `load_stone` của `process_citadel_assets` nên không bị áp hai lần); `matte()` tái dùng
  `process_arrow_asset.key_out_background`/`despill`; `TOWN_MATCH_LUM` 74.8 → 86.0;
  thêm `--check` (size, bottom inset, corner alpha, iso base, chroma ≥ 16, lum 80-92) và
  `--preview` (delegate sang proof sheet).
- `apps/client/src/game/render/citadelFloorVariants.ts` + `.test.ts`: `floorVariantAt` dùng
  `hash2(gridX, gridY, 0x1f2e3d4c)`; test khẳng định deterministic, đủ 3 giá trị trên 15×15,
  và **không** vẽ sọc chéo.
- `CitadelLayer.ts`: chọn texture theo variant, fallback `citadel_floor` khi thiếu file.
- `WorldScene.ts`: preload `citadel_floor_1`/`citadel_floor_2`; bump `v=28 → v=29`,
  `cv=8 → v=9`.
- `buildingArt.ts`: không phải sửa — `topInset` của art mới vẫn 23 nên `HP_BAR_Y.TOWN_CENTER`
  giữ `-335` (công thức `-130 - 440/2 + 23 - 8`).

### 11.3 Cổng đã chạy

| Cổng | Kết quả |
| --- | --- |
| `uv run --with numpy --with pillow python scripts/process_citadel_assets.py --check` | OK |
| `uv run --with numpy --with pillow python scripts/rebuild_canva_wall_town.py --check` | OK |
| `pnpm --filter @chien-quoc/client test` | 60 file / 725 test pass |
| `cd apps/client && ../../node_modules/.bin/tsc --noEmit` | sạch |
| `pnpm build` | xanh (cảnh báo chunk 2.2 MB có sẵn từ trước) |

Lưu ý môi trường: Mac này không có `numpy`/`Pillow` trong `python3` hệ thống, nên mọi lệnh Python
ở trên chạy qua `uv run --with numpy --with pillow`.

### 11.4 Còn lại

- `CIT-02` (keep mới): **đã làm rồi revert**. Canva sinh 3 candidate keep 4:3 không có vòng
tường ngoài, export 1456×1088, dựng proof sheet qua đúng đường build
(`python scripts/rebuild_canva_wall_town.py --candidates a.png b.png c.png`). Cả 3 đạt cổng
(lum 85.6, chroma 20.6-23.9, iso base trong ngưỡng); user chọn `c1` rồi **đổi ý revert**,
giữ art castle hiện tại. `town_center.png` đã `git checkout` về nguyên trạng, và
`town_center_failures()` không còn gate chroma/lum của keep (chỉ in số đo kèm ngưỡng mong
đợi) vì art cũ vốn không đạt band đó — gate nó sẽ làm `--check` đỏ trên file không ai sửa.
- Muốn bật lại: đặt render keep vào `scripts/raw_downloads/canva_rework/`, trỏ
`CASTLE_SOURCE` sang file đó, chạy `rebuild_canva_wall_town.py`, rồi cập nhật
`HP_BAR_Y.TOWN_CENTER` theo `topInset` mới (keep c1 đo được `topInset` 0 → `-358`;
art castle hiện tại là 23 → `-335`).
- `CIT-08` (screenshot in-game 3 mức zoom): proof sheet và swatch tường đã kiểm, nhưng cần user mở
  game để chốt cảm nhận ở zoom 0.4 / 1.0 / 2.2.
