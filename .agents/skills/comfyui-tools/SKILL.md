---
name: comfyui-tools
description: >-
  Comprehensive guide and instructions for using the ComfyUI MCP (Model Context Protocol) tools to generate images (Z-Image Turbo), videos (Wan 2.2), 3D models (Hunyuan3D), character auto-rigging (UniRig), and 2D sprite sheets. Use whenever the user asks to generate images, create videos, build 3D assets, rig 3D meshes, pack sprites, or interact with local/remote ComfyUI generation tools.
---

# ComfyUI MCP Tools Guide

This skill guides the agent on how to interact with the local/remote ComfyUI Generation MCP Server. The server wraps local ComfyUI pipelines and exposes standardized tools over Streamable HTTP (`/mcp`) and Stdio.

---

## 1. Tools Reference

### `check_comfyui_status()`
Inspects backend connectivity and GPU queue state.
- **When to use**: Before submitting long renders or when diagnosing connectivity issues.
- **Returns**: `{"online": bool, "queue_running": int, "queue_pending": int, ...}`

### `generate_image(...)`
Generates high-resolution images using **Z-Image Turbo**.
- **Key Parameters**:
  - `prompt` (string, required): Detailed prompt describing the scene.
  - `negative` (string, optional): Undesired elements/styles.
  - `width`, `height` (int, default `1024`): Must be multiples of 16 (256–1536).
  - `steps` (int, default `8`): Diffusion steps (1–40).
  - `seed` (int, optional): Random seed.
  - `transparent` (bool, default `False`): If `True`, removes the background color to produce an RGBA cutout.
  - `key_color` (hex string, default `"#ffffff"`): Background color to remove when `transparent=True`.
  - `trim` (bool, default `False`): Crops canvas tight to the cutout subject.
- **Tip**: For clean transparent cutouts, prompt for *"on a plain white background"*.

### `generate_video(...)`
Generates text-to-video or image-to-video using **Wan 2.2 TI2V-5B**.
- **Key Parameters**:
  - `prompt` (string, required): Motion and action description.
  - `image_path` (string, optional): Local file path, uploaded filename, or HTTP(S) URL for Image-to-Video.
  - `width` (int, default `832`): 256–1280 (multiple of 16).
  - `height` (int, default `480`): 256–1280 (multiple of 16).
  - `length` (int, default `49`): Frame count (9–121, ~2s at 24fps).
  - `fps` (int, default `24`): Playback frame rate (8–60).
  - `steps` (int, default `20`): Sampling steps.
  - `interpolate` (int, default `1`): RIFE interpolation multiplier (`1`, `2`, `4`, `8`) for smooth high-fps motion.
  - `upscale` (int, default `1`): 4x ESRGAN model scaling factor (`1`, `2`, `4`).

### `generate_3d_model(...)`
Transforms a 2D reference image into a 3D mesh (`.glb`) using **Hunyuan3D 2.1**.
- **Key Parameters**:
  - `image_path` (string, required): Local path, uploaded filename, or HTTP(S) URL.
  - `steps` (int, default `20`): DiT sampling steps (1–50).
  - `octree_resolution` (int, default `256`): 3D grid resolution (64–512). Higher gives finer detail but takes longer.
  - `remove_background` (bool, default `True`): Pre-process reference image with RMBG.

### `rig_3d_model(...)`
Automatically rigs an unrigged 3D character mesh (`.glb` or `.obj`) with skeleton and skin weights using **UniRig**.
- **Key Parameters**:
  - `mesh_path` (string, required): Path, uploaded filename, or HTTP(S) URL to 3D mesh.
  - `rig_type` (string, default `"mixamo"`): Skeleton format (`"mixamo"`, `"game"`, or `"full"`).
- **Output**: Rigged `.fbx` character ready for game engines (Unity/Unreal/Godot).

### `generate_sprites(...)`
Renders or converts images/prompts into 2D game sprite sheet atlases.
- **Key Parameters**:
  - `prompt` (string): Text description if generating from scratch.
  - `image_path` (string, optional): Existing image to slice/pack.
  - `name` (string, default `"spritesheet"`): File name prefix.
  - `columns` (int, default `4`): Grid column count.
  - `frame_size` (int, default `128`): Resolution per frame.
  - `transparent` (bool, default `True`): Remove background.
- **Output**: Combined spritesheet PNG, individual frame PNGs, and TexturePacker JSON metadata.

### `list_jobs(limit=20)`
Retrieves recent jobs and their generated files.

---

## 2. Working with Inputs and Outputs

### Input Flexibility
Tools accepting `image_path` or `mesh_path` accept:
1. **Absolute or relative local paths**: e.g., `D:/AI/wan_frame.png` or `char.glb`.
2. **Uploaded filenames**: e.g., `a1b2c3d4e5.png` stored in `storage/uploads/`.
3. **HTTP/HTTPS URLs**: e.g., `https://example.com/character.png`. The server automatically downloads and stages the asset.

### Output Handling
Each successful tool response returns a `files` array containing:
```json
{
  "status": "succeeded",
  "job_id": "9f38bc...",
  "kind": "image",
  "files": [
    {
      "filename": "image_9f38bc_00001_.png",
      "path": "D:\\AI\\comfy-api\\storage\\jobs\\9f38bc...\\image_9f38bc_00001_.png",
      "url": "http://192.168.1.13:8090/v1/files/9f38bc.../image_9f38bc_00001_.png",
      "kind": "image",
      "size_bytes": 1450200
    }
  ]
}
```
- **Local Agent**: Can immediately access or inspect the file via the absolute `path`.
- **Remote / LAN Agent**: Can download or embed the asset via the provided `url`.

---

## 3. Best Practices & Workflow Chaining

### Pipeline Sequencing
1. **Concept to 3D Character**:
   - `generate_image(prompt="full-body front-facing character on a plain white background", transparent=True)`
   - Feed the resulting image path/URL into `generate_3d_model(image_path=...)`
   - Feed the generated `.glb` into `rig_3d_model(mesh_path=...)`
2. **Video to Spritesheet**:
   - `generate_video(prompt="warrior walking right loop", image_path=...)`
   - Feed frames or video output into `generate_sprites(...)` to build 2D game animations.
   