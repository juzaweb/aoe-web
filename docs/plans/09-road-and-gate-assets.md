# Phase 09 — Asset đường đất và cổng ra chiến trường (AI-generated)

Status: **DRAFT — chờ duyệt D1–D5**. Chưa có file PNG nào trong repo bị thay.
Ngày ghi plan: 2026-11-03.
Phạm vi: `apps/client` + `scripts/`. **Không** đổi server, `packages/shared`, schema, protocol hay DB.

Nguồn: 2 ảnh AI gen tại `/Users/dev/Downloads/games/{cong,duong}.png`, prompt ở
[`docs/prompts/01-road-and-battlefield-gate.md`](../prompts/01-road-and-battlefield-gate.md).

## 1. Mục tiêu

Thay placeholder hiện tại bằng art riêng:

- **Cổng**: `PORTAL` đang mượn sheet `building_TOWER` + tint tím `0xc084fc`
  (`buildingArt.ts:83-90`, `EntityRenderer.ts:257`). Phase này thêm `portal.png` riêng, bỏ tint.
- **Đường**: 4 file `road_stamp*.png` đang lặp motif (`road_stamp.png` trùng MD5 `road_stamp_1.png`).
  Phase này thay bằng 4 biến thể cắt từ một texture mới, có biến thiên tông và tương phản.

Kết quả mong muốn: cổng đọc ra "cổng" ở 25% scale, đúng footprint 2×2, không còn tím; đường không
còn sọc lặp, giữ nguyên hình học spline và `isDirtRoadTile`.

## 2. Nguồn và số đo

Số đo lấy trực tiếp từ 2 file ngày 2026-11-03, không suy đoán.

| | `cong.png` | `duong.png` |
| --- | --- | --- |
| Kích thước | 2752×1536, RGBA | 2912×1440, **RGB (không alpha)** |
| Dung lượng / sha256 | 1.922.084 B / `9e31bf66…` | 6.818.470 B / `8aec2401…` |
| Vùng art (alpha bbox) | (829, 36) → (1945, 1470) = **1116×1434** | phủ kín khung |
| Mean RGB / luminance | `#5a544a` / **84,8** | `#bb946b` / **153,9** |
| p5 / p50 / p95 luminance | 37 / 81 / 139 | 58 / 166 / 192 |
| Đặc điểm | Lỗ vòm thông xuống đáy, alpha sạch, không còn bệ đá | Texture phẳng, không object, mép gần liền |

Đối chiếu art đang ship: `tower.png` lum 71, `town_center.png` lum 70, `barracks.png` lum 87;
`road_stamp_1.png` lum 147, p5–p95 = 105–184.

Đo căn chân cổng:

- Khe vòm ở y800–1100 là `x1230–1578`, tâm **1404**; tâm bbox **1387** → lệch **17 px** trên
  chiều rộng 1116. Vì tâm lối đi trùng tâm bbox, **căn bottom-center theo bbox là đúng**.
- Điểm chạm đất thấp nhất nằm ở `x1629` (chân trụ gần), lệch phải tâm bbox 242 px — đây là chân
  trụ phía trước trong hình chiếu iso, không phải lỗi cần bù `offsetX`.

## 3. Quyết định

| Mã | Quyết định |
| --- | --- |
| D1 | Căn cổng **bottom-center theo alpha bbox**; không thêm `offsetX`, không dịch ngang art. Tâm lối đi lệch tâm bbox 17 px, dưới ngưỡng nhìn thấy ở 320×360. |
| D2 | Canvas cổng **320×360**, scale theo chiều cao 356 → rộng 277; đáy art đặt ở local y **+40**, tức `SHEET_OFFSET_Y.PORTAL = -140` (cùng quy ước house 2×2: +40). |
| D3 | Đường: cắt 4 cửa sổ 480×240 từ texture, resize **120×60**, chuẩn hoá từng crop về mean **150 ± 3**, giữ p5–p95 ≥ 60; gán alpha elip mềm. |
| D4 | **Không** đưa 2 asset vào `scripts/assets/manifest.json`/`assets.lock.json`: đây là art gốc của project, không có license bên thứ ba và không tái lập được từ URL. Kiểm tra bằng `scripts/process_generated_assets.py --check`, không bằng lock hash. |
| D5 | Giữ fallback: xoá nhánh đặc biệt `PORTAL → building_TOWER`, để `FALLBACK_ART.PORTAL` (`b_tower`) xử lý khi thiếu `building_PORTAL`. Không xoá fallback procedural. |
| D6 | Bump cache: `v=6` → `v=7` cho building, `tv=7` → `tv=8` cho terrain. |

## 4. Hợp đồng kỹ thuật

| | Cổng | Đường |
| --- | --- | --- |
| File | `apps/client/public/assets/buildings/portal.png` | `assets/terrain/road_stamp{,_1,_2,_3}.png` |
| Canvas | 320×360 RGBA | 120×60 RGBA |
| Neo | bottom-center, `bottomInset = 0` | elip phủ canvas, góc alpha = 0 |
| Offset | `SHEET_OFFSET_Y.PORTAL = -140` | — |
| HP bar | `HP_BAR_Y.PORTAL = offsetY - 180 + topInset - 10`; với `topInset ≈ 3` → **-327** | — |
| Texture key | `building_PORTAL` | `road_stamp`, `road_stamp_1..3` |
| Vẽ ở | container tâm footprint 2×2 (`EntityRenderer.ts:213-219`) | mỗi điểm spline, cách 0,35 tile (`TerrainLayer.ts:150-178`) |
| Footprint | 2×2 ⇒ diamond 256×128; art rộng 277, cao 356 | — |

Ràng buộc:

- Cổng **không** được có tint; màu phải tự đọc ra "cổng" (đá xám + cờ chàm + rune tím nhỏ).
- Lòng vòm phải trong suốt để thấy cỏ; không có mảng đặc bịt lối đi.
- Đường không được có object (đá lớn, cỏ, dấu chân) vì stamp chồng lên nhau ~80%.
- Không đổi `isDirtRoadTile`, spline, vị trí portal, footprint hay gameplay.

## 5. Pipeline xử lý

Script mới: `scripts/process_generated_assets.py` (Pillow, không thêm dependency Node).

```bash
python scripts/process_generated_assets.py \
  --gate /Users/dev/Downloads/games/cong.png \
  --road /Users/dev/Downloads/games/duong.png \
  --out apps/client/public/assets

python scripts/process_generated_assets.py --check   # CI gate, không cần ảnh nguồn
```

### 5.1 Cổng

```text
crop alpha bbox -> resize height 356 (LANCZOS, premultiplied)
-> dán vào canvas 320x360, đáy art tại hàng cuối (bottomInset = 0)
-> ghi portal.png; đo topInset/bottomInset, in ra để đối chiếu HP_BAR_Y
```

- Không kéo sáng/tối: giữ lum 84,8 (đã nằm trong 80–92).
- Nếu buộc phải chừa padding đáy, `offsetY = -140 + bottomInset` để đáy art vẫn ở local +40.
- Không thêm shadow, không thêm glow ngoài art.
- Nếu `topInset` đo được khác 3, cập nhật `HP_BAR_Y.PORTAL` theo công thức ở §4.

### 5.2 Đường

```text
4 cửa sổ 480x240 -> resize 120x60 (LANCZOS, premultiplied)
-> gain từng crop về mean 150 (clamp 0..255)
-> alpha ellipse: |x-60|/60 + |y-30|/30 <= 1, feather 0.12
-> ghi road_stamp{,_1,_2,_3}.png
```

Cửa sổ đề xuất (đo từ texture, 2:1):

| File | Box (x0,y0,x1,y1) | mean hiện tại | Ghi chú |
| --- | --- | --- | --- |
| `road_stamp.png` | 120, 300, 600, 540 | 151 | baseline |
| `road_stamp_1.png` | 1100, 200, 1580, 440 | 141 | sáng hơn sau gain 1,06 |
| `road_stamp_2.png` | 1700, 700, 2180, 940 | 151 | baseline |
| `road_stamp_3.png` | 600, 1000, 1080, 1240 | 170 | tối lại sau gain 0,88 |

Nếu một crop có p5 < 70 sau resize, dịch box 120 px rồi đo lại; không kéo giãn contrast để tránh
nhiễu.

## 6. Thay đổi code

| File | Thay đổi |
| --- | --- |
| `scripts/process_generated_assets.py` | **Mới.** Xử lý + `--check`; in bảng đo (size, lum, p5–p95, hash) |
| `apps/client/public/assets/buildings/portal.png` | **Mới.** 320×360 |
| `apps/client/public/assets/terrain/road_stamp*.png` | Thay 4 file |
| `WorldScene.ts:380-389` | `v = 'v=7'`; thêm `this.load.image('building_PORTAL', '/assets/buildings/portal.png?' + v)` |
| `WorldScene.ts:404-418` | `tv = 'v=8'` |
| `buildingArt.ts:83-90` | Xoá nhánh `PORTAL → building_TOWER` |
| `buildingArt.ts:30` | `PORTAL: -140` |
| `buildingArt.ts:65` | `PORTAL: -327` (tính lại theo `topInset` thực tế) |
| `EntityRenderer.ts:257` | Xoá `if (building.type === 'PORTAL') img.setTint(0xc084fc)` |
| `PlacementController.ts` | **Không sửa**: portal do server tạo, không vào placement mode |

Không đổi `PORTAL` blueprint (2×2, `attackable: false`, `maxHp 99999`), không đổi `portals.ts`.

## 7. Test và kiểm chứng

### 7.1 Test tự động

`apps/client/src/game/render/portalArt.test.ts` (mới):

- `buildingArt('PORTAL', () => true)` → `{ textureKey: 'building_PORTAL', offsetY: -140 }`.
- `buildingArt('PORTAL', () => false)` → `{ textureKey: 'b_tower', offsetY: -90 }` (fallback D5).
- `buildingHpBarY('PORTAL')` → `-327`.
- Không có test nào phụ thuộc hash PNG, để đổi art không phải sửa test.

`scripts/process_generated_assets.py --check`:

- `portal.png` đúng 320×360; `bottomInset ≤ 3`; lum 80–92; có vùng alpha = 0 kích thước ≥ 200×300
  ở giữa (lòng vòm); không còn pixel alpha > 0 ở hàng cuối ngoài chân trụ.
- 4 road stamp đúng 120×60; alpha 4 góc = 0; mean 147–153; p5–p95 ≥ 60; 4 MD5 khác nhau.

Chạy thêm: `tsc --noEmit` client, `vitest run` client. `assetManifest.test.ts` không đổi vì 2 asset
không nằm trong lock.

### 7.2 Verify tay

- [ ] Kingdom: cổng ở mép phải, chân đặt trên cỏ, không lơ lửng, không che TC.
- [ ] Battlefield: cổng gần tâm, không lẫn với tower, đọc ra cổng ở zoom mặc định.
- [ ] Click cổng mở panel travel; right-click chở quân đi; quân đi vào đúng lòng vòm.
- [ ] Đường: không còn sọc lặp, 4 biến thể khác nhau, không thấy seam/viền elip khi pan map.
- [ ] Hard refresh không 404 (cache `v`/`tv` đã bump).
- [ ] Minimap vẫn vẽ kim cương cyan, không phụ thuộc art mới.

## 8. Task log

| Task | Nội dung | Commit message |
| --- | --- | --- |
| `GATE-01` | Thêm script xử lý + `portal.png` | `feat(assets): add generated portal art` |
| `GATE-02` | Preload, bỏ nhánh mượn tower, bỏ tint, offset/HP bar, test | `feat(client): render portal with its own art` |
| `ROAD-01` | Xử lý + ghi đè 4 road stamp, bump `tv` | `feat(assets): add four generated dirt road stamps` |
| `ROAD-02` | `--check`, verify tay, cập nhật plan | `docs(plans): mark phase 09 verified` |

Mỗi task một commit, message tiếng Anh; không commit ảnh nguồn trong `Downloads`.

## 9. Rủi ro và edge case

| Rủi ro | Xử lý |
| --- | --- |
| Chân cổng lệch phải tâm bbox 242 px | Đã đo: tâm lối đi trùng tâm bbox 17 px; nếu trong game vẫn lệch, chỉnh `offsetY` ±10 trước khi nghĩ tới `offsetX` |
| Lòng vòm còn lưới sắt/portcullis | Chấp nhận nếu chỉ ở nửa trên; nếu bịt lối đi thì gen lại theo prompt §6.2 |
| 4 crop đường lệch tông | Chuẩn hoá mean từng crop (D3); nếu vẫn thấy vá, giảm còn 2 biến thể và lặp |
| Resize không premultiplied | Dùng premultiplied để tránh viền sẫm ở mép alpha |
| Quên bump cache | `v`/`tv` là query string; không bump thì trình duyệt giữ PNG cũ |
| Ảnh nguồn bị xoá khỏi Downloads | Script nhận path; muốn tái lập thì copy vào `scripts/out/generated/` (gitignored) trước |
| `HP_BAR_Y` sai | Portal không bị đánh (`attackable: false`) nên bar hiếm khi hiện; vẫn tính theo công thức để không drift |

## 10. Definition of Done

- [ ] `cd apps/client && ../../node_modules/.bin/tsc --noEmit` sạch
- [ ] `pnpm --filter @chien-quoc/client test` xanh, gồm `portalArt.test.ts`
- [ ] `python scripts/process_generated_assets.py --check` xanh
- [ ] Ảnh đúng canvas/neo; cổng không còn tint; đường 4 MD5 khác nhau
- [ ] Verify tay 6 mục ở §7.2
- [ ] Không đụng server/shared/schema/DB

## 11. Ngoài phạm vi

- Đổi spline đường, `isDirtRoadTile`, mật độ stamp, xoay/scale stamp (thuộc `VIS-03` nếu làm).
- Đổi vị trí/cách server đặt portal, footprint, cooldown travel.
- Animation cho cổng (glow, portal swirl) — art tĩnh.
- Đưa art vào `manifest.json`/`assets.lock.json` hoặc `CREDITS.md` (không phải third-party).
