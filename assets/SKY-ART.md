# 原创天空全景

- 生成工具：内置 ImageGen（非 CLI）。
- 生成日期：2026-10-13。
- 原始文件：`sky-original.png`，1774 × 887 像素，严格 2:1。
- 游戏文件：`sky-panorama.jpg`，使用 macOS `sips` 转换为 JPEG，quality 85；没有裁切、拉伸或重绘。
- 用途：北海清晨、自然蓝天与积云的经纬度天空全景纹理。地平线接近图片中心；下半部为蓝灰雾层，没有水面或地面。
- 目视检查：云层保留明暗与蒸汽细节，天空有足够蓝色留白；无文字、地面、山体或飞机；日照来自左侧。
- 使用边界：生成图像并非物理测量 HDRI；左右边缘与极点不是数学严格连续。运行时宜将最顶部少量纬度渐变到统一蓝色，并在经度接缝附近做轻度混合，以免球面包裹产生硬接缝。水面应使用与天空一致的采样方向。

## 最终生成提示词

```text
Use case: photorealistic-natural
Asset type: final ORIGINAL seamless spherical sky texture for a realistic 3D flight game, equirectangular latitude-longitude 360 degree by 180 degree environment map, exactly 2:1 landscape aspect ratio, ideally 2048 x 1024 pixels.
Primary request: A believable northern ocean morning SKY ONLY photographed as a full spherical panorama. Natural soft blue sky with irregular scattered maritime cumulus clouds, organically different sizes and densities, blue gaps, soft silver-white edges with a hint of warm morning light from left-front. The sky must feel expansive, clean and airy, not white and overcast.
Projection: proper equirectangular lat-long layout. The mathematical horizon is exactly at vertical center, y=50%. The upper half contains the hemispherical sky with zenith at the upper edge. Around zenith, mostly clear rich but muted natural blue and sparse soft wisps, suitable for spherical wrapping. Small to medium cumulus groups above the horizon, clear blue passages between them. The LOWER HALF is only a very soft featureless blue-gray atmospheric haze gradient fading darker towards nadir; absolutely NO ocean or terrain. This lower half will usually be hidden below the game's rendered ocean.
Lighting: pale golden morning silver lighting on clouds, subtle warm neutral haze near horizon. Photographically balanced exposure with preserved cloud detail; not dramatic orange sunset. No visible sun disc; a game shader provides the sun separately.
Composition: genuine 360 spherical environment, seamless left and right edges with closely matching sky and low cloud shapes, no frame. Cloud detail varied and naturally distributed across longitude, no duplicated columns or repeating horizontal cloud bands.
Style: premium realistic natural sky photograph, soft vapor, realistic light scattering. No illustration, no painterly brushstrokes, no plastic-looking clouds, no spiral or swirled clouds, no synthetic smooth blobs.
Constraints: sky only. No water, land, mountains, buildings, aircraft, birds, stars, text, watermark, logo, border, sun disc. Full-bleed texture. Do not render it on a sphere or show a sphere or mockup; the output itself is the flat UV texture.
```
