# Phase 24 — Tách nhà lính thành 3 loại (bộ binh / kỵ binh / cung thủ) (`MIL-01`)

**Status: `IMPLEMENTED`** (2026-11-07). Server + client + test xanh; **art 2 nhà mới chưa sinh**
(ComfyUI `192.168.1.14:8090` không truy cập được lúc code) — hiện rơi về fallback procedural
`b_barracks`.

Phạm vi: `packages/shared` (types + constants + levels), `apps/server` (CommandSystem + tests),
`apps/client` (BuildMenu, hotkeys, EntityDetails, UpgradePanels, buildingArt, WorldScene preload),
`scripts/generate_buildings_assets.py`, `README.md`, `docs/plans/{08,19}`. **Không** đổi schema DB,
`NetworkMessage`, payload, hay chỉ số lính.

## 1. Vấn đề

`BARRACKS` là nhà quân duy nhất và train cả ba loại lính (`SPEARMAN`, `ARCHER`, `CAVALRY`). Hệ quả:

- Toàn bộ roster quân sự là **một** đơn xây dựng, nên không có lựa chọn hướng quân sự nào.
- Nghiên cứu cấp lính nằm trọn trong một panel ở Barracks và gate chỉ cần **một** Barracks, nên
  nâng cấp lính không gắn với hạ tầng nào cụ thể.
- Barracks vừa là trụ cột gate Nhà chính vừa là nhà sản xuất duy nhất — hai vai trò đè lên một
  công trình.

## 2. Quyết định đã chốt

| Mã | Quyết định |
| --- | --- |
| D1 | Giữ `BARRACKS` = **nhà bộ binh** (chỉ `SPEARMAN`); thêm `STABLE` (kỵ binh) và `ARCHERY_RANGE` (cung thủ). Không rename, không migrate DB (`Building.type` là `String`, save cũ tự thành nhà bộ binh). |
| D2 | `CORE_BUILDING_TYPES` mở rộng thành **6 trụ cột**: `HOUSE, BARRACKS, STABLE, ARCHERY_RANGE, FARM, TOWER`. Gate Nhà chính đòi cả 6 đạt đúng cấp hiện tại của TC. |
| D3 | Nghiên cứu cấp lính gắn với **đúng nhà train loại đó** (`buildingTypeForUnit`): `BARRACKS→SPEARMAN`, `STABLE→CAVALRY`, `ARCHERY_RANGE→ARCHER`, `TOWN_CENTER→VILLAGER`. Panel chỉ hiện loại lính của nhà đang chọn. |
| D4 | Art 2 nhà mới sinh bằng `scripts/generate_buildings_assets.py` (ComfyUI local), canvas 400×320 để dùng lại `SHEET_OFFSET_Y`/`HP_BAR_Y` của Barracks. |
| D5 | Chỉ số: `STABLE` 200 gỗ + 50 đá; `ARCHERY_RANGE` 150 gỗ. Cả hai 3×3, 1200 HP, 10 s — cùng footprint/thời gian với Barracks để khác biệt nằm ở giá và loại lính. |
| D6 | Hotkey thêm `C` (Stable) và `B` (Archery Range), append cuối danh sách; 8 hotkey cũ giữ nguyên. `P` bị bỏ qua vì đã là lệnh patrol. |
| D7 | `MAX_CONCURRENT_BUILDING_UPGRADES` **giữ 2** ở phase này. Gate 6 trụ cột nặng hơn bản 4 trụ cột; nâng slot là quyết định cân bằng riêng, ghi ở §5. |

## 3. Task

| Task | Nội dung |
| --- | --- |
| `MIL-01a` | `BuildingType` thêm `STABLE`, `ARCHERY_RANGE` (`packages/shared/src/types/index.ts`) |
| `MIL-01b` | `BUILDING_BLUEPRINTS`: `BARRACKS.trainableUnits` còn `['SPEARMAN']`; thêm 2 blueprint mới; `buildingTypeForUnit()` quét `trainableUnits` của blueprint (một nguồn sự thật, không có bảng thứ hai) |
| `MIL-01c` | `CORE_BUILDING_TYPES` mở rộng 6 loại |
| `MIL-01d` | `handleUpgradeUnitType` gate theo `buildingTypeForUnit(requestedType)`; message `Build a/an <Trainer> before researching this unit` (helper `indefiniteArticle` để "an Archery Range" đúng ngữ pháp) |
| `MIL-01e` | Test server: 6 gap theo thứ tự; message gate TC mới; train sai nhà bị reject; research sai nhà bị reject; research đúng nhà pass; `buildingTypeForUnit`/`trainableUnits`/`CORE_BUILDING_TYPES` khoá bằng test |
| `MIL-01f` | Client: `BuildMenu` thêm 2 tile + thumbnail, `buildingHotkeys` thêm `C`/`B` |
| `MIL-01g` | Client: `BarracksResearchPanel` → `UnitResearchPanel` nhận `unitTypes`; `EntityDetails` render panel cho **mọi** nhà có `trainableUnits` (nên Villager research chuyển từ Barracks sang Town Center) |
| `MIL-01h` | Client: `buildingArt.ts` thêm `SHEET_OFFSET_Y`/`FALLBACK_ART`/`HP_BAR_Y` cho 2 loại; `WorldScene` preload + bump `v=10`→`v=11`; `buildingHpBarY` nhận `hasTexture` để thanh máu đi theo sprite thật sự được vẽ (fallback nhỏ hơn sheet rất nhiều) |
| `MIL-01k` | Client: gom bảng thumbnail vào `components/buildingThumbnails.ts` để `BuildMenu` và `EntityDetails` không tự dựng path riêng (trước đó panel dùng `subType.toLowerCase()` và sẽ 404 với 2 loại mới) |
| `MIL-01i` | `scripts/generate_buildings_assets.py`: 2 `BUILDING_SPECS` mới (`stable`, `archery_range`), log đếm theo `len(BUILDING_SPECS)` |
| `MIL-01j` | Docs: file này, `README.md` (mục công trình + bảng hotkey), ghi chú 6 trụ cột ở `08-progression-curve.md` D5, message mới ở `19-rejected-command-classification.md` |

## 4. Kiểm chứng

Chạy được trong phiên này:

- `pnpm --filter @chien-quoc/shared run build` — xanh.
- `pnpm --filter @chien-quoc/server run build` — xanh (`tsc`, exit 0).
- `pnpm --filter @chien-quoc/client exec tsc --noEmit` — xanh.
- `pnpm --filter @chien-quoc/server run test` — **22 file / 325 test** xanh.
- `pnpm --filter @chien-quoc/client run test` — **25 file / 440 test** xanh.

Chưa chạy được / cần verify tay:

- `pnpm --filter @chien-quoc/client run build` — `vite build` hỏng ở bước `esbuild` do
  `Access is denied` trên file tạm trong `%TEMP%` (môi trường máy, không phải lỗi TS; `tsc` đã xanh).
- `python scripts/assets/build.py --check` — **đỏ từ trước phase này**: `villager_idle.png` đã bị
  sửa ở commit `fd77182` mà không chạy lại `--legacy`. Không liên quan `MIL-01`; cần
  `python scripts/assets/build.py --legacy` ở một lần riêng.
- Art 2 nhà mới: ComfyUI không truy cập được (`http://192.168.1.14:8090` timeout), nên
  `stable.png`/`archery_range.png` chưa tồn tại. Bản build hiện vẽ fallback `b_barracks` và
  `onError` ẩn thumbnail trong BuildMenu. Khi có mạng nội bộ:
  ```bash
  python scripts/generate_buildings_assets.py   # chỉ chạy 2 spec mới nếu bỏ 5 spec cũ
  python scripts/assets/build.py --legacy       # pin hash 2 PNG mới
  ```
- Manual trên `http://localhost:5173/`: dựng đủ 3 nhà quân, train đúng loại ở đúng nhà, panel
  nghiên cứu mỗi nhà chỉ hiện loại lính của nó, panel Nhà chính hiện 6 hàng trụ cột, hotkey `C`/`B`
  đặt được nhà.

## 5. Hệ quả cần theo dõi

- **Gate Nhà chính nặng hơn**: từ 4 lên 6 trụ cột × 10 cấp. Số liệu `08-progression-curve.md`
  (35,5 h công việc, ~22,5 h wall clock với 2 slot) **không còn đúng**. Hai hướng:
  nâng `MAX_CONCURRENT_BUILDING_UPGRADES` lên 3, hoặc giữ 2 và chấp nhận late game dài hơn.
  Phase này **không** đổi cân bằng.
- **Save cũ**: người chơi đang có Nhà chính cấp cao vẫn giữ cấp, nhưng lần nâng tiếp theo sẽ đòi
  Stable + Archery Range cùng cấp — có thể là bước nhảy lớn với base cũ.
- **Barracks mất quyền train Archer/Cavalry**: người chơi chỉ có Barracks sẽ thấy roster giảm còn
  1 lính cho tới khi xây thêm 2 nhà.
- **Villager research chuyển nhà**: panel nghiên cứu Villager nay ở Nhà chính, không còn ở Barracks.
