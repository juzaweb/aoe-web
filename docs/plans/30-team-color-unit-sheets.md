# Phase 30 — Màu phe cho lính 3D: bake 2 lớp sheet + tint runtime (`TEAM-01`)

**Mục tiêu:** dùng model 3D `linh.glb` để thay sheet của `SPEARMAN`, và cho **màu phe của
người chơi phủ lên đúng vùng khăn/viền** của lính mà không phải bake lại art cho từng màu.
Cách làm: bake **hai lớp sheet** (body + accent) từ Blender, lớp accent render grayscale rồi
`setTint(ownerColor)` lúc runtime — đúng cách AoE2 DE / Diablo 2 làm team color.

> **Status: `APPROVED`** (2026-11-13) — các quyết định D1–D10 đã chốt với user. Chưa có dòng
> code nào; chưa có mask, chưa có script bake, `UNIT_ART.SPEARMAN` vẫn trỏ sheet OpenGameArt cũ.

**Phạm vi:** `apps/client` + `scripts/` + `docs/plans` + `CREDITS.md`. **Không** đổi
`packages/shared`, `apps/server`, schema, protocol hay DB: màu phe đã có sẵn trong
`PlayerState.color`, không cần message mới.

---

## 1. Hiện trạng trước phase này

| Thứ đã có | Chỗ code | Ghi chú |
| --- | --- | --- |
| Model 3D lính + ngựa | `scripts/raw_downloads/models/linh.glb`, `ngua.glb` (+ `.blend`) | đã track trong git (4 file, ~34 MB) |
| Màu phe của người chơi | `apps/client/src/game/render/ownerColor.ts` (`OwnerColorRegistry`, `parseHexColor`, `colorToCss`) | CSS hex từ server → `0xRRGGBB` cho Phaser, cache theo owner, `UNKNOWN_OWNER_COLOR = 0x94a3b8` |
| Grid sheet 8 hướng | `apps/client/src/game/render/unitDirections.ts` (`DIRECTION_NAMES` = E, SE, S, SW, W, NW, N, NE) | một hàng một hướng, một cột một frame; thứ tự compass-from-east để index rơi thẳng ra từ `atan2` |
| Cấu hình art theo unit | `apps/client/src/game/render/unitArt.ts` (`UNIT_ART.SPEARMAN`: cell 192×168, scale 0.95, `offsetY -58`) | idle 4 / walk 11 @16fps / attack 10 @12fps / death 8 @9fps |
| Sheet đang ship | `apps/client/public/assets/units/actions/spearman_walk.png` (2112×1344), `spearman_idle.png` (768×1344) | nguồn: pack OpenGameArt "400+ Items" (CC-BY 4.0) |
| Cổng kiểm grid | `apps/client/src/game/render/unitArt.sheets.test.ts` | đọc IHDR: `width % frameWidth == 0`, `height == frameHeight × 8`, `columns == frames` |
| Vẽ unit + ring sở hữu | `apps/client/src/game/render/EntityRenderer.ts` (`scene.add.sprite` dòng 573, ring OWN-02 trước sprite) | chưa có lớp thứ hai |
| Sprite xác chết | `apps/client/src/game/render/EntityRenderer.ts` dòng 123–138 (`corpseSprites`) | sprite riêng, cũng cần accent |
| Projection isometric | `packages/shared/src/constants/index.ts` (`TILE_WIDTH = 128`, `TILE_HEIGHT = 64`) | 2:1 dimetric |

| Thứ còn thiếu | Hệ quả |
| --- | --- |
| Mask vùng accent (khăn/viền) | không có gì để đổi màu; texture đã bake chung một material |
| Script bake sheet từ GLB | không có đường nào biến `linh.glb` thành sheet đúng grid repo |
| Khái niệm "sheet thứ hai" trong `UnitArt` | `EntityRenderer` chỉ biết một sprite mỗi unit |
| Mục CREDITS cho `linh.glb` / `ngua.glb` | nguồn/license chưa ghi nhận — chặn merge |

**Ràng buộc của asset (đã đo, không phải giả định):** `linh.glb` = 1 mesh `Mesh0`,
**1 material `BakedMaterial`**, baseColor 2048² (hue teal 180–210° + da/gỗ 0–30°), normal +
metallic-roughness 2048², 14.991 verts / 19.489 tris, 28 joints, extension
`KHR_materials_specular`, 6 animation: `Walking`, `Running`, `Triple_Combo_Attack`,
`Archery_Shot_1`, `Left_Slash`, `BeHit_FlyUp`.

⇒ Vì chỉ có **một** material và màu đã bake vào texture, `material.color = teamColor`
không dùng được (multiply chỉ làm tối, teal không thành đỏ). Bắt buộc phải có mask.

---

## 2. Quyết định thiết kế

### D1 — CHỐT: bake offline, **không** đưa three.js vào runtime

Client là Phaser 2D, 22k dòng, 698 test gắn Phaser API. Trộn hai renderer nghĩa là hai WebGL
context, **không share depth buffer** ⇒ không thể để cây che lính 3D, phải tự làm y-sort chéo
giữa hai canvas. Thay Phaser bằng three là rewrite `WorldScene` (2.615 dòng), `EntityRenderer`
(783), `TerrainLayer` (264) — không phải việc của một phase art.

⇒ three.js (nếu dùng) chỉ xuất hiện **offline** trong `scripts/`, hoặc Blender. Runtime vẫn là
Phaser.

### D2 — CHỐT: hai lớp sheet, màu do `setTint` nhân vào

- **Lớp body**: render bình thường, vùng accent tô đen.
- **Lớp accent**: render `mask × luminance(baseColor)` → grayscale, nền trong suốt.
- Runtime: sprite body + sprite accent cùng frame/hướng, accent `setTint(colorOf(owner))`,
  depth = body + 1.

Không bake theo từng màu: màu do server cấp động (`PlayerState.color`), số màu không biết
trước. Số render cố định: `2 × 8 hướng × (11 + 10 + 4 + 8) frame = 528` lần, dùng cho mọi
player vĩnh viễn.

### D3 — CHỐT: mask accent bake bằng Blender `Emit`, không suy theo hue

1. Edit Mode chọn face vùng khăn/viền/cờ → material slot thứ 2.
2. Slot accent: Emission trắng; slot cũ: Emission đen.
3. Image 2048² → Bake Type = **Emit** → Save PNG 8-bit, color space **Non-Color**.

Lý do: mask theo hue (teal 180–210°) làm lem mọi vùng teal khác và không phân biệt được "khăn"
với "áo". Fallback Python hue-range **chỉ** dùng khi không có Blender, và phải review bằng mắt
trước khi dùng — ghi rõ trong script là fallback kém chính xác.

### D4 — CHỐT: camera và cell khớp projection của repo

`TILE_WIDTH 128 / TILE_HEIGHT 64` ⇒ 2:1 dimetric ⇒ **elevation 30°** (`sin θ = 0.5`),
**azimuth 45°**; trong Blender: `cam.rotation_euler = (radians(60), 0, radians(45))`,
`OrthographicCamera`. Cell giữ **192×168** như `SPEARMAN`, sole neo về **hàng ~145**, scale
0.95, `offsetY -58` — không đổi `UNIT_ART` hình học, chỉ thay file PNG.

Đèn cố định trong world, xoay model theo hướng (không xoay camera) để hướng sáng khớp sun
của map. `film_transparent = True`, không ground plane, không shadow — repo tự vẽ ring.

### D5 — CHỐT: accent pass phải sáng, có shading

Accent render `mask × luminance(baseColor)` chứ **không** phải trắng phẳng: tint là phép nhân,
nên nếp gấp vải chỉ còn nếu lớp accent giữ luminance. Pixel accent phải nằm trong khoảng
~0.75–1.0; accent quá tối × màu đậm sẽ ra gần đen — đây là lỗi hay gặp nhất của team color.

### D6 — CHỐT: thay sheet `SPEARMAN`, **không** thêm `UnitType` mới

`linh` là lính giáo; thêm `LINH` vào `packages/shared/src/types/index.ts` kéo theo blueprint,
DB, protocol, test server. Phase này chỉ thay PNG của `SPEARMAN` (cùng cell, cùng số frame).
Sheet OpenGameArt cũ vẫn nằm trong git history nếu cần rollback.

### D7 — CHỐT: mapping animation

| Action repo | Clip trong GLB | Frames @ fps |
| --- | --- | --- |
| `walk` | `Walking` | 11 @ 16 |
| `attack` | `Triple_Combo_Attack` | 10 @ 12 |
| `idle` | 4 frame lấy từ `Walking` ở đoạn pose trung tính | 4 @ 4 |
| `death` | `BeHit_FlyUp` | 8 @ 9 |

`death` là clip bị đánh trúng, không phải clip chết: chấp nhận làm placeholder, ghi chú để
thay nếu sau này có clip chết thật. Không dùng `Archery_Shot_1` (cung thủ) và `Left_Slash`
(ngoài scope).

### D8 — CHỐT: accent áp cho **cả** sprite sống và sprite xác chết

`EntityRenderer` tạo sprite xác riêng (`corpseSprites`, dòng 123–138). Nếu chỉ tint sprite
sống, xác lính sẽ mất màu phe ngay khi chết — sai rõ ràng khi có 2 player cùng màu khác nhau
trong một trận raid.

Màu lấy từ `OwnerColorRegistry.colorOf(ownerId)` như mọi thứ khác; minimap **không** đổi
(vẫn dùng `colorToCss`).

### D9 — CHỐT: giữ asset gốc trong repo, không LFS ở phase này

`linh.blend` + `linh.glb` + `ngua.blend` + `ngua.glb` ≈ 34 MB đã track. Phase này không thêm
file nặng nào khác (sheet PNG là art đã ship, ~0.5 MB/file). Nếu sau này thêm model, cân nhắc
Git LFS như một phase riêng.

### D10 — CHỐT: CREDITS là điều kiện merge

`linh.glb`/`ngua.glb` hiện **không** có mục trong `CREDITS.md`. Trước khi merge phải ghi
nguồn + license (hoặc xác nhận là art gốc của dự án như `arrow.png` ở phase 29). Không có mục
này thì phase không được đánh `DONE`.

---

## 3. Kiến trúc

```
Blender (headless)                     scripts/ (Python)                apps/client
──────────────────                     ─────────────────                ────────────
linh.blend
  ├─ bake EMIT  ──────────────────────► linh_teammask.png
  └─ render 8 dir × frames, 2 pass ───► out/linh_<dir>_<action>_<f>.png
                                                │
                                      pack_team_sheets.py
                                                │
                                                ├─► public/assets/units/actions/spearman_<action>.png
                                                └─► public/assets/units/actions/spearman_<action>_accent.png
                                                            │
                                                unitArt.ts (accentSheet: true)
                                                            │
                                      WorldScene.preload + animation keys
                                                            │
                                      EntityRenderer: body sprite + accent sprite (setTint)
```

| File | Vai trò |
| --- | --- |
| `scripts/blender_make_mask.py` | headless `bpy`: chọn face theo material slot 2, bake EMIT ra `linh_teammask.png`, `--check` kiểm kích thước + tỉ lệ pixel trắng |
| `scripts/blender_bake_sheet.py` | headless `bpy`: camera ortho 2:1, 8 hướng × frames × 2 pass, render 2× rồi downsample LANCZOS |
| `scripts/pack_team_sheets.py` | PIL: crop alpha, neo sole hàng 145, pad 192×168, ghép 8 hàng E→NE, `--check` kích thước từng sheet |
| `apps/client/src/game/render/unitArt.ts` | thêm `accentSheet?: boolean` vào `UnitArt`; `SPEARMAN` bật cờ |
| `apps/client/src/game/render/entityAccent.ts` | hàm thuần: quyết định accent có bật cho unit/corpse, tính depth, chọn tint từ registry (test được, không Phaser) |
| `apps/client/src/game/render/EntityRenderer.ts` | tạo/huỷ sprite accent cho unit sống + xác, đồng bộ frame khi `play`, `setTint` |
| `apps/client/src/game/scenes/WorldScene.ts` | preload sheet accent, đăng ký animation key `<unit>_<action>_accent_<dir>` |
| `apps/client/public/assets/units/actions/spearman_*.png` | 4 file body + 4 file accent (4 action × 2 lớp) |

Chi tiết đáng nhớ:

- Frame index của accent **phải** dùng cùng công thức `directionIndex() * frames + frame` như
  body; lệch một frame là accent trượt khỏi thân.
- Accent sprite không nhận input, không tham gia hit-test, không đổi `setInteractive`.
- Depth: `getIsoDepth(gridX, gridY, heightOffset)` của body + 1; ring OWN-02 vẫn ở dưới body.
- Khi unit chuyển action, gọi `accent.play(clip)` cùng lúc với body trong **cùng** một nhánh
  code, không qua event — tránh lệch 1 frame khi đổi action.

---

## 4. Edge case

| Tình huống | Xử lý |
| --- | --- |
| Owner chưa có trong `players` (quân restore từ DB trước khi chủ login) | `colorOf` trả `UNKNOWN_OWNER_COLOR`; accent tô xám, tự đổi sang màu thật khi player xuất hiện (registry không cache miss) |
| Owner rời room, quân còn lại | registry giữ màu cuối (OWN-01/D4) — accent không nháy xám |
| Unit chết | accent của xác dùng cùng tint; huỷ cả hai sprite khi server bỏ xác |
| Đổi map (travel) | huỷ toàn bộ accent sprite trong `reset()` cùng body |
| Thiếu file accent (404) | `EntityRenderer` bỏ qua accent, chỉ vẽ body — mất màu phe nhưng không sập scene |
| 300 lính cùng màn | gấp đôi số sprite; nếu FPS tụt, hạ ưu tiên: chỉ bật accent khi zoom > 0.6 (ghi lại số đo trước khi tối ưu) |
| Accent bị lệch 1 px so với body | kiểm bằng test so frame index, và bằng mắt ở 8 hướng trước khi merge |
| Tint quá đậm làm accent gần đen | accent pass phải giữ luminance 0.75–1.0 (D5); nếu vẫn tối, đổi sang `setTintFill` chỉ cho accent sáng |
| Model có nhiều object riêng cho khăn | không cần mask: gán material riêng, export, tint slot — D3 rút gọn |
| Sheet bake sai grid | `unitArt.sheets.test.ts` fail ngay (chiều rộng/cao/cột) |

---

## 5. Test

| Test | Nội dung |
| --- | --- |
| `unitArt.sheets.test.ts` (mở rộng) | với mọi unit có `accentSheet`, kiểm cả `<unit>_<action>_accent.png`: tồn tại, `width % frameWidth == 0`, `height == frameHeight × 8`, `columns == frames` |
| `entityAccent.test.ts` (mới) | bật/tắt accent theo cờ; tint lấy đúng từ registry; owner lạ → `UNKNOWN_OWNER_COLOR`; depth = body + 1; xác cũng có accent |
| `scripts/pack_team_sheets.py --check` | kích thước từng sheet + số hàng/cột khớp `UNIT_ART` (cổng chạy tay: CI chỉ có Node) |
| `scripts/blender_make_mask.py --check` | mask 2048², có pixel trắng, tỉ lệ trắng trong khoảng hợp lý (không phải mask rỗng/toàn trắng) |

Lệnh xác nhận:

```
pnpm --filter @chien-quoc/client test     # baseline 698 test, phải xanh và tăng theo test mới
cd apps/client && ../../node_modules/.bin/tsc --noEmit
pnpm build
```

---

## 6. Task breakdown

**Tiền đề:** `brew install --cask blender` (~1 GB). Không có Blender thì chỉ còn fallback D3
(mask theo hue, kém chính xác) + bake bằng Chrome headless; khi đó `TEAM-01`/`TEAM-02` phải ghi
rõ trong script là fallback và phải review mask bằng mắt trước khi dùng.

| ID | Việc | Ghi chú |
| --- | --- | --- |
| `TEAM-01` | `scripts/blender_make_mask.py` + `linh_teammask.png` + `--check` | checkpoint: mask xem bằng mắt, viền sạch |
| `TEAM-02` | `scripts/blender_bake_sheet.py`, bake **1 hướng × 1 action** trước | checkpoint: đúng tỉ lệ, sole đúng hàng 145, sáng khớp map |
| `TEAM-03` | Bake đủ 4 action × 8 hướng × 2 pass, `scripts/pack_team_sheets.py` | 528 render, ~10–25 phút EEVEE |
| `TEAM-04` | `unitArt.ts` (`accentSheet`) + `WorldScene` preload/animation keys | chưa tint, chỉ hiện accent trắng |
| `TEAM-05` | `entityAccent.ts` + `EntityRenderer` (sống + xác) + `setTint` | cờ tắt được để so sánh trước/sau |
| `TEAM-06` | Test: mở rộng sheet test + `entityAccent.test.ts` | theo loop-constraints: hàm export mới phải có test cùng run |
| `TEAM-07` | `CREDITS.md` mục cho `linh.glb`/`ngua.glb` | điều kiện merge (D10) |
| `TEAM-08` | Cập nhật `docs/plans/README.md` + verify tay trong game | 2 player khác màu, 8 hướng, chuyển action, chết |

---

## 7. Việc còn lại (verify tay)

1. Vào kingdom, train lính giáo → lính hiện art mới, đứng đúng ground line như villager/cung thủ.
2. Vào world map, raid một vương quốc khác → lính hai bên khác màu accent, đúng màu trên minimap.
3. Cho lính chết → xác vẫn giữ màu phe (D8).
4. Xoay camera/đổi hướng đi 8 hướng → accent không trượt khỏi thân, không lệch 1 frame khi đổi action.
5. Bật/tắt cờ accent → so sánh FPS với 300 lính trên màn.

---

## 8. Definition of Done

- [ ] `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `pnpm --filter @chien-quoc/client test` xanh (gồm test mới)
- [ ] `pnpm build` xanh
- [ ] 8 file sheet (4 action × 2 lớp: body + accent) đúng kích thước, `unitArt.sheets.test.ts` pass
- [ ] Accent đổi màu theo `OwnerColorRegistry` cho cả unit sống và xác
- [ ] Không tạo message mới, không đổi schema/DB
- [ ] `CREDITS.md` có mục cho model 3D (D10)
- [ ] Thao tác chạy được trong game thật (mục §7)
