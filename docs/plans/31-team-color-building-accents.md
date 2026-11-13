# Phase 31 — Màu phe cho công trình: mask accent 2D + tint runtime (`TEAM-09`)

Status: `IMPLEMENTED 2026-11-13` — code + art + test; còn verify tay §7.

Phase 30 (`30-team-color-unit-sheets.md`) đã cho lính màu phe bằng **hai lớp sheet** bake từ
`linh.glb`: body + accent, accent grayscale rồi `setTint(ownerColor)` lúc chạy. Phase này làm
điều tương tự cho **công trình**, nhưng không có model 3D nào để bake — art công trình là PNG vẽ
sẵn trong `apps/client/public/assets/buildings/`. Câu hỏi đặt ra: đổi màu nhà có buộc phải 3D
hoá toàn bộ asset công trình không?

Trả lời: **không**. Mái nhà đã có sẵn, chỉ thiếu lớp "chỗ nào được đổi màu". Sinh lớp đó từ
chính PNG đang dùng, nên phase này là **art pipeline + client visual-only**: không đổi
`packages/shared`, server, schema hay DB, không thêm dependency, không thêm renderer.

## 1. Hiện trạng trước phase này

- `OwnerColorRegistry` (`apps/client/src/game/render/ownerColor.ts`) đã map `ownerId → 0xRRGGBB`,
  đọc từ `PlayerState.color` (CSS hex trong DB). Một nguồn màu duy nhất cho cả lính và nhà.
- `EntityRenderer.refreshOwnerBase` chỉ vẽ **viền lục giác** dưới chân công trình. Nhìn từ xa,
  hai nhà cùng loại khác chủ vẫn giống nhau; viền chỉ đọc được khi zoom gần.
- Không có PNG công trình nào có lớp màu riêng, và cũng không có mask nào để tint. `img.setTint()`
  trên cả ảnh sẽ nhuộm luôn đá, gỗ, cỏ — sai.
- `scripts/generate_*_assets.py` là các script art một lần, không có bước hậu kỳ dùng lại được.

## 2. Quyết định thiết kế

### D1 — CHỐT: không 3D hoá asset công trình

Ba lựa chọn đã cân nhắc:

| Cách | Chi phí | Vấn đề |
| --- | --- | --- |
| **A.** Dựng model 3D cho 12 công trình rồi bake như `linh.glb` | 12 model + 12 rig + 96 render (12 loại × 8 hướng) | Không có mesh nguồn; phải dựng lại toàn bộ art đang dùng, và mọi chỉnh sửa sau này phải làm trong Blender |
| **B.** Sinh mask accent từ chính PNG vẽ sẵn, tint lúc chạy | 1 script + 12 mask | Mask do tay tác giả theo vùng — không tự động hoá được 100% |
| **C.** Vẽ lại 12 công trình × N màu phe | N × 12 PNG | Bùng nổ số file, mỗi màu phe mới = một đợt art mới |

Chọn **B**. Nó dùng lại toàn bộ art đang ship, giữ nhà là 2D thuần, và thêm màu phe mới (một
dòng trong DB) không cần thêm file art nào.

### D2 — CHỐT: mask là **vùng tay** (polygon/hue), không suy theo luminance

Accent của lính chọn theo face (`D3` phase 30) vì có mesh. Ở đây không có mesh, và một bộ lọc
"pixel tối" hay "pixel ít bão hoà" sẽ bắt cả đá, cửa gỗ, bóng đổ. Nên `ACCENT_SPECS` khai báo
tường minh cho từng công trình:

- `regions`: danh sách polygon trong toạ độ chuẩn hoá `0..1` (y hướng xuống). Chỉ cần đúng
  đường viền — alpha của sprite tự cắt phần thò ra ngoài silhouette, nên một quad thô là đủ cho
  một mái mà diềm mái đã là silhouette.
- `hue`: `(low, high, saturation_min, value_min)` cho hai công trình mà accent là **vải nhuộm**
  chứ không phải mái (portal, town_center). Gộp với `regions` thì là phép giao.

Công trình không có entry trong `ACCENT_SPECS` → script **fail**, không im lặng ra file rỗng.

### D3 — CHỐT: cửa sổ sáng **0,76–1,0 theo giá trị hiển thị** (đúng D5 phase 30)

Tint là phép nhân: `accent × màu phe`. Nếu lớp accent tối, màu phe tối (đỏ đô, xanh navy) nhân
vào ra gần đen. Cửa sổ này là bài học đã trả giá ở phase 30 (linear vs display, xem §9 phase 30
dòng "D5 accent pass"), nên phase này dùng lại đúng con số và đúng đơn vị: **byte PNG**, không
phải linear.

Luminance của vùng accent được **kéo giãn theo percentile 2–98** của chính vùng đó trước khi ép
vào cửa sổ, để một pixel cháy sáng hay một pixel đen không bóp dẹt cả mái.

### D4 — CHỐT: accent là **sprite thứ hai**, không phải tint trên ảnh nền

`updateBuildingBar` đã dùng `image.setTint(0x9a7b52)` để đánh dấu **ruộng hết lúa** (ECO-01).
Nếu accent là tint trên cùng ảnh thì hai ý nghĩa đè nhau: ruộng hết lúa sẽ mất màu phe, hoặc màu
phe sẽ bị nhuộm nâu. Hai sprite riêng thì mỗi lớp giữ đúng một nghĩa.

Accent được `container.add` **ngay sau** ảnh nền nên thanh máu, badge cấp và hiệu ứng cháy vẫn
nằm trên. Trong container không cần `depth` (thứ tự add là thứ tự vẽ); `ACCENT_DEPTH_OFFSET` của
phase 30 chỉ dành cho xác chết, vốn là object rời.

### D5 — CHỐT: key accent suy từ **key của ảnh nền**, không từ `BuildingType`

`buildingAccentKey('building_HOUSE')` → `building_HOUSE_accent`. Hệ quả có chủ đích:

- Sheet theo cấp (`building_HOUSE_2`) tự có accent riêng, không mượn của cấp 1.
- Công trình rơi về placeholder thủ tục (`b_house`) sẽ hỏi `b_house_accent` — key không ai load
  ⇒ `textures.exists` false ⇒ chỉ vẽ body. Đây là nhánh "thiếu file accent" đã có ở phase 30
  (D2), không cần xử lý riêng.

`WALL` **không** có accent: tường người chơi xây mượn sheet nề của kinh thành (`citadel_wall`),
vốn không nằm trong bộ accent. Thêm `WALL` vào danh sách sẽ khiến preload hỏi một file không có.

### D6 — CHỐT: danh sách nguồn là `BUILDING_ACCENT_TYPES`, test đối chiếu với thư mục

Preload và renderer cùng đọc một mảng trong `buildingArt.ts`. Test `buildingAccent.test.ts` so
mảng đó với `readdirSync` của thư mục (hai chiều: thiếu file, và file thừa), nên thêm/bớt một
PNG mà quên sửa mảng là đỏ ngay. Cùng tinh thần với `unitArt.sheets.test.ts`.

### D7 — CHỐT: tint làm mới trong **pass OWN-05**, không cấp timer riêng

Pass `refreshOwnershipVisuals` đã chạy mỗi khi `players` đổi. Công trình nạp từ DB có thể hiện
trên màn hình **trước** khi entry của chủ nhân tới (đúng lý do OWN-05 tồn tại), nên accent phải
được vá lại ở cùng chỗ. `accentSignatures` chặn việc set lại màu khi không đổi.

## 3. Kiến trúc

```
scripts/build_building_accent_masks.py     sinh mask + PNG accent (offline, tay chạy)
        │  ACCENT_SPECS[stem] = {regions?, hue?}
        ▼
apps/client/public/assets/buildings/<stem>_accent.png     (cùng canvas với <stem>.png)
        │
        ├── WorldScene.preload       load.image(buildingAccentKey(`building_${type}`), ...)
        │
        └── EntityRenderer.createBuildingSprite
                accentDecision({available, ownerId}, ownerColorRegistry)
                    → {enabled, tint}
                → scene.add.image(0, offsetY, accentKey)   // cùng offsetY/scale/flipX
                → container.add(accent)                    // ngay sau body
                → accent.setTint(tint)
```

- `buildingAccentKey` / `BUILDING_ACCENT_TYPES`: `apps/client/src/game/render/buildingArt.ts`.
- `accentDecision` (phần dùng chung của quyết định): `entityAccent.ts`. `resolveAccent` của lính
  giờ là wrapper mỏng gọi nó, nên công tắc debug `?accent=0` và fallback `UNKNOWN_OWNER_COLOR`
  dùng chung một chỗ.
- `refreshAccentTint` và `accentSignatures` dùng chung cho lính và nhà: id Colyseus là duy nhất
  toàn world, và dọn dẹp prune theo cả hai map sprite.

## 4. Edge case

| Trường hợp | Xử lý |
| --- | --- |
| PNG accent thiếu / 404 | `textures.exists` false ⇒ không tạo sprite accent, công trình vẽ như trước. Không có ô xanh, không crash |
| Công trình rơi về placeholder (`b_house`, `b_tower`) | Key accent suy từ key placeholder nên không khớp file nào ⇒ body-only (D5) |
| Chủ nhân chưa có entry `players` | `colorOf` trả `UNKNOWN_OWNER_COLOR`; pass OWN-05 vá lại khi entry tới (D7) |
| Ruộng hết lúa (`setTint(0x9a7b52)`) | Accent là sprite riêng nên màu phe giữ nguyên (D4) |
| Nâng cấp đổi cấp có art mới | `applyBuildingTier` đổi texture accent theo; art mới không có accent thì **huỷ** sprite accent cũ thay vì để màu cũ nằm trên mái mới |
| Portal bị `flipX` | Accent nhận cùng `setFlipX(true)`, nếu không lớp màu lệch gương |
| `?accent=0` | `accentDecision` trả `enabled:false` ⇒ công trình mới không tạo accent. Dùng để đo chi phí sprite |
| Xoá nhà | Container bị destroy cùng accent con; entry `accentSignatures` bị prune trong pass kế tiếp |

## 5. Test

- `buildingAccent.test.ts` (16 test):
  - `buildingAccentKey` với key thường, key theo cấp và key placeholder.
  - `BUILDING_ACCENT_TYPES` **bằng đúng** danh sách `*_accent.png` có trên đĩa (hai chiều).
  - `WALL` không nằm trong danh sách.
  - Mỗi type trong danh sách có file thật.
  - Accent cùng kích thước canvas với body (nếu lệch 1 px sẽ lộ viền ma quanh mái).
- `entityAccent.test.ts`: thêm 1 test cho `accentDecision` — cờ `available`, owner lạ, công tắc
  debug.
- `build_building_accent_masks.py --check`: kích thước file, độ phủ 0,4%–60%, floor ≥ 0,74,
  spread ≥ 0,05 trên toàn bộ 12 file.

## 6. Task breakdown

| Task | Nội dung | File |
| --- | --- | --- |
| `TEAM-09a` | Script sinh mask: polygon + hue window, supersample 4, cửa sổ sáng D3, `--check`, `--preview` | `scripts/build_building_accent_masks.py` |
| `TEAM-09b` | 12 PNG accent + tinh chỉnh `ACCENT_SPECS` theo preview | `apps/client/public/assets/buildings/*_accent.png` |
| `TEAM-09c` | `buildingAccentKey`, `BUILDING_ACCENT_TYPES`, `accentDecision` | `buildingArt.ts`, `entityAccent.ts` |
| `TEAM-09d` | Preload + tạo sprite accent + tint trong pass OWN-05 + đổi theo tier | `WorldScene.ts`, `EntityRenderer.ts` |
| `TEAM-09e` | Test | `buildingAccent.test.ts`, `entityAccent.test.ts` |
| `TEAM-09f` | Doc phase + dòng trong index | `docs/plans/31-*.md`, `docs/plans/README.md` |

## 7. Việc còn lại (verify tay)

- [ ] `pnpm dev`, vào kingdom, xem 12 loại công trình ở **2 tài khoản khác màu**: mái/banner phải
      đổi màu, đá và gỗ thì không.
- [ ] Ruộng hết lúa: mái vẫn màu phe, **và** thân ruộng chuyển nâu (hai lớp không đè nhau).
- [ ] Portal ở biên giới phía đông: accent phải lật theo body, không lệch gương.
- [ ] `?accent=0`: công trình mất màu phe, không lỗi console.
- [ ] Zoom xa (minimap-thoáng): màu phe còn đọc được trên nền cỏ.

## 8. Definition of Done

- [x] `scripts/build_building_accent_masks.py` sinh 12 file, `--check` xanh
- [x] `pnpm --filter @chien-quoc/client test` xanh (744 test; +17 so với trước phase)
- [x] `pnpm --filter @chien-quoc/server test` xanh (468 test)
- [x] `tsc --noEmit` sạch cả `apps/client` và `apps/server`
- [x] `pnpm build` xanh
- [ ] Verify tay §7
- [x] Không đổi protocol, không đổi schema, không reset DB
- [x] Code/comment/commit message tiếng Anh; doc tiếng Việt

## 9. Nhật ký thực hiện — chỗ lệch và số đo

| Mục | Thực tế | Lý do |
| --- | --- | --- |
| Độ phủ accent từng công trình | 1,3%–19,8% diện tích canvas: house 19,8 · barracks 16,4 · siege_workshop 16,1 · stable 12,3 · lumber_camp 11,8 · archery_range 6,8 · mill 5,6 · tower 3,7 · mining_camp 2,9 · town_center 1,8 · portal 1,6 · farm 1,3 | Công trình nhỏ (farm, mining_camp, portal, town_center) chỉ có một mảng mái/banner nhỏ, nên phần trăm thấp là đúng, không phải mask thiếu. Ngưỡng `--check` đặt 0,4%–60% để bắt cả hai kiểu hỏng: mask rỗng và mask phủ gần hết (tức là đã nhuộm cả tường) |
| Barracks | Phải trace **16 đỉnh** cho mái dinh thự (3 gable bậc thang) + 2 quad chái; bản đầu 3 quad thô chỉ phủ 6,4% và **thiếu cả hai mái chái** | Mái dinh thự không phải một hình bình hành: ba đỉnh gable bậc xuống, còn diềm mái dốc thoải hơn đường sống mái. Quad thô để lại mảng trống nhìn thấy rõ |
| Siege workshop | Giữ 2 quad; quad chái phải hạ xuống `(0.72,0.50)–(0.96,0.50)` | Bản trước đáy trái quá thấp nên tint lem xuống tường gỗ bên trái |
| Cửa sổ hue cho vải | portal: hue 200–300°, S ≥ 0,15 · town_center: hue 180–245°, S ≥ 0,45 | Banner portal là vải đỏ sẫm viền vàng; banner + khiên kinh thành là xanh. Ngưỡng S cao hơn ở town_center để loại nền đá xám (S thấp) |
| Blur mask hue | Gaussian 0,8 px sau phép thử hue | Phép thử hue là per-pixel nên cạnh vải bị răng cưa khi so với nền; blur 0,8 px làm mượt mà không lem sang đá |
| Dung lượng | 12 PNG accent = 800 KB, bằng ~45% bộ PNG body (1,7 MB) đang ship | Accent là RGBA đầy đủ chứ không phải grayscale+alpha; giữ RGBA để đi đúng đường upload texture đã kiểm chứng của sheet lính, đổi sang LA chỉ để tiết kiệm ~50% nhưng thêm một dạng texture chưa ai thử trong scene này |

### Review sau khi code xong (2026-11-13)

Các lỗi tìm được và đã sửa trước khi commit:

| Lỗi | Sửa |
| --- | --- |
| Docstring OWN-05 nằm nhầm trên `refreshAccentTint` (từ phase 30) | Tách ra, trả OWN-05 về `refreshOwnershipVisuals`, viết lại doc của `refreshAccentTint` cho đúng "unit **hoặc** building" |
| `accentSignatures` prune chỉ theo `unitSprites` ⇒ id của nhà bị xoá khỏi signature mỗi pass, `setTint` chạy lại vô ích | Prune theo cả `unitSprites` và `buildingSprites` |
| `getData('accentSprite')` cast về `Sprite` trong khi nhà là `Image` | Cho phép cả hai kiểu, cả hai đều có `setTint` |
| `applyBuildingTier` chỉ đổi texture body ⇒ accent cấp cũ nằm lại trên mái mới | Đổi texture/offset/scale cho accent, hoặc huỷ sprite accent nếu art mới không có |

### Lệnh tái lập

```bash
python3 scripts/build_building_accent_masks.py            # sinh 12 PNG accent
python3 scripts/build_building_accent_masks.py --check     # cổng D3 + độ phủ
python3 scripts/build_building_accent_masks.py --preview /tmp/bpreview.png
pnpm --filter @chien-quoc/client test
pnpm --filter @chien-quoc/server test
pnpm build
```
