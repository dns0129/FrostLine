# 原创北境岩石材质

- 日期：2026-10-13。
- 来源：内置 `image_gen.imagegen`，从文字原创生成，无参考照片、网络素材或外部贴图库。
- 原始文件：`rock-original.png`。
- 游戏文件：`rock-albedo.jpg`，768 × 768，macOS `sips` 缩放并转 JPEG，质量参数 55；未改变画面内容或调色。
- 用途：北海风化灰色片麻岩/片岩岛屿，世界空间三向投影的 base-color 贴图；材质光照由游戏 shader 处理。
- 视觉检查：干燥粗糙矿物、细层理、冷灰略棕，无苔藓，无金属/塑料高光，无山体或天空场景。
- 平铺说明：生成时要求无缝。1024 像素中间版本边界 RGB 平均差：左右 18.19、上下 18.98（0–255）；图内相邻像素平均差：横向 13.70、纵向 18.05。边界亮度没有突变，但不能将生成结果视为数学上完全周期连续；建议使用多尺度三向投影降低接缝与重复感。
- 颜色参考：1024 像素中间版本平均 sRGB ≈ (125, 121, 116)，约 `#7d7974`，中等明度的微暖中性灰。

## 完整生成提示词

```
Use case: photorealistic-natural
Asset type: seamless tileable base-color/albedo texture for rocky North Sea island cliffs in a realistic 3D flight game, square 1:1.
Primary request: a flat full-frame orthographic photograph of naturally weathered gray granite gneiss and slate-like metamorphic rock, irregular subtle strata, broken fine mineral grains and small restrained cracks. A two-dimensional pure material texture, not a mountain or cliff scene.
Composition/framing: perfectly straight-on orthographic surface, no perspective, no horizon, no sky, no isolated rock objects, edge-to-edge rock texture. Seamless tiling: left and right edges match and top and bottom edges match. No frame, borders or vignetting.
Material: cold neutral medium gray slightly warm brown in tiny mineral inclusions; fine-to-medium mineral grit and irregular subdued thin layered seams; natural dry roughness. A broad rocky surface sampled for triplanar tiling on 50–100 meter sections of cliff. Overall pattern should have moderate detailed organic variation without large dominant black cracks. Restrained non-directional striation.
Lighting: completely even soft overcast diffuse illumination, unlit-looking color/albedo map. No baked directional shadows, no highlights, no deep shadows, no dramatic crevice occlusion. Keep luminance variation moderate so the game shader adds all major light and shade.
Constraints: photorealistic material scan appearance, only rock, neutral color, natural weathering. No moss, grass, soil, sea, snow, text, logo, watermarks, repeated black grid, obvious tiles, dramatic exaggerated relief, shiny or wet surface, glossy plastic or overly smooth synthetic material. No repeating square shapes or dark polygon network.
```
