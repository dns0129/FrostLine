# 航行舰队模型（1.15.0）

默认编队的四个舰级全部为项目内的 Blender 模型，按同一套规则导出并接入：公制、+Y 向上、舰艏朝 -Z、水线 y = 0，元数据 `*.metadata.json` 记录尺寸、坐标约定、三角形数与 .blend SHA256。运行时不请求互联网，不下载第三方 3D 网格或照片纹理。

| 舰级 | 编队 | 模型 | 说明 |
| --- | --- | --- | --- |
| 企业级航空母舰（最终构型） | US-CVN-65 | `assets/models/enterprise.glb` | [ENTERPRISE-ART.md](ENTERPRISE-ART.md)，1.15 起取代弗莱斯特级 |
| 阿利·伯克级驱逐舰（Flight I） | US-DDG-51、US-DDG-52 | `assets/models/burke.glb` | [BURKE-ART.md](BURKE-ART.md) |
| 福建舰 | CN-CV-18 | `assets/models/fujian.glb` | [FUJIAN-ART.md](FUJIAN-ART.md)，1.14 起 |
| 052D 型驱逐舰 | CN-DDG-172、CN-DDG-173 | `assets/models/type052d.glb` | [TYPE052D-ART.md](TYPE052D-ART.md) |

企业号、伯克级与 052D 由 `scripts/build-*.py` 全部程序生成，共用 `scripts/blender_kit.py`（福建舰与歼-16 的几何工具）和 `scripts/ship_kit.py`（舰体放样、甲板、上层建筑、武器与传感器、舷号、导出）。尺寸取公开资料，设备布局按公开照片判读，是便于海空战识别的游戏外形近似，不是测绘图纸。

## 游戏接入

- `naval-assets.js` 载入四个 GLB：烘焙节点变换，按材质合并（每舰近景至多 15 个绘制对象），并从带 `silhouette` 标记的大体量部件生成远景轮廓（至多 5 个绘制对象）；福建舰导出时没有该标记，按 `NAVAL_MODELS.fujian.silhouette` 的名称表选取。
- 舷号是名为 “Hull number <n> (…)” 的独立对象。一个 GLB 可以同时带 51 / 52 或 172 / 173，`makeNavalShip` 只给每艘舰加上自己的舷号，其余几何与材质在同型舰之间共享。
- `naval-models.js` 只保留舰级定义（公开尺寸，用于尾迹与检阅镜头）和实例构造；原程序化网格、贴图与甲板泊机已删除。航母甲板上不再有停放的舰载机。
- 远景切换距离不变：流畅画质 1.8 公里，精细画质 2.6 公里。模型由渲染器持有，编队只释放自己的尾迹资源。

近景模型截图在 `verification/fleet/model-*.png`（检阅镜头），`desktop-gameplay-*.png` 与 `mobile-*.png` 使用原有驾驶镜头。手机证据来自浏览器尺寸模拟，不代表实体设备帧率验证。
