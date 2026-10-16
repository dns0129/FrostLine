# 企业号（CVN-65）Blender 模型

可编辑源文件 `assets/models/enterprise-source/Enterprise-CVN65.blend`，导出件 `assets/models/enterprise.glb`（公制、Y 向上、舰艏朝 -Z、水线 y = 0，甲板贴图以 JPEG 内嵌）。三视图与透视渲染见 `assets/three-views/Enterprise-CVN65-three-view.png`。1.15 起替换游戏中原有的程序化弗莱斯特级，作为默认美方编队的 US-CVN-65。

全部几何由 `scripts/build-enterprise.py` 程序生成，共用 `scripts/blender_kit.py` 与 `scripts/ship_kit.py`；布局常数在 `scripts/enterprise_layout.py`，甲板图案由 `scripts/enterprise-deck-texture.py` 绘制。没有使用任何第三方网格或照片纹理。

## 采用的构型

退役前（2000 年代）的最终构型：1979–1982 年改装后的舰岛（SPS-48E 平面阵 + SPS-49 网状天线的桅杆，取代早期的“方塔”相控阵）、9° 斜角甲板、2 部舰艏与 2 部斜角甲板蒸汽弹射器、4 道拦阻索、右舷 3 部（舰岛前 2 部、后 1 部）与左舷舰尾 1 部舷侧升降机。

## 尺寸与来源

| 项目 | 公开资料 | 模型 |
| --- | --- | --- |
| 全长 | 约 342 m（1,123 ft） | 342.0 m |
| 飞行甲板宽 | 约 78.3 m（257 ft；另有 252 ft 的说法） | 78.3 m |
| 水线宽 | 约 40.5 m（133 ft） | 40.5 m |
| 吃水 | 11.3–12 m（37–39 ft，各来源不一） | 11.3 m |
| 飞行甲板距水线 | 未查到公开值 | 18.6 m（估计） |

来源：[GlobalSecurity CVN-65 参数](https://www.globalsecurity.org/military/systems/ship/cvn-65-specs.htm)、[Naval Technology](https://www.naval-technology.com/projects/uss-enterprise/)、[美国海军历史与遗产司令部 DANFS](https://history.navy.mil/research/histories/ship-histories/danfs/e/enterprise-cvan-65-viii-1991-1995.html)。布局（舰岛位置、升降机、弹射器、舷台）按美国海军公开照片判读；云端环境的网络策略不允许下载 Wikimedia 等图片，因此未随仓库附带参考照片，链接见 `assets/models/enterprise-source/reference/SOURCES.md`。

## 模型内容

- 舰体：按水线分层放样的外飘舰艏、方尾、舭部圆角；红色防污漆、黑色水线带。
- 飞行甲板：防滑涂层贴图、斜角着舰区中线与犯规线、弹射器轨道与梭车、偏流板、拦阻索与滑轮、升降机边框、甲板舰首与舰尾“65”。
- 舰岛：主体、导航与旗舰舰桥、主飞控、雷达塔、SPS-48E、SPS-49、杆桅与卫通天线罩，两侧“65”舷号（白字黑影）。
- 舷台武器：3 座 Mk 29 海麻雀、2 座 RAM、2 座密集阵，均为外形示意；位置为估计。
- 水下：4 轴 4 桨、4 舵（估计造型）。

游戏中近景按材质合并为 15 个绘制对象、约 1.3 万三角形；远景轮廓（舰体、甲板、廊道带、舷台、舰岛主体与雷达塔）为 5 个绘制对象、约 4 千三角形。甲板上没有停放舰载机。

## 重建

```sh
python scripts/enterprise-deck-texture.py          # numpy、scipy、Pillow
python scripts/build-enterprise.py                 # Blender 5.x 的 bpy 模块，或 blender --background --python
VIEW_ENGINE=CYCLES python <打开 .blend 后运行 scripts/render-three-views.py> -- assets/three-views/raw enterprise 7 all
python scripts/compose-three-view.py enterprise
```

本次在云端用 PyPI 的 `bpy` 5.0.1（Python 3.11）运行；无 GPU 时三视图与透视图都用 Cycles CPU 渲染。`assets/models/enterprise.metadata.json` 记录 .blend SHA256、尺寸与三角形数。模型为本项目原创，随游戏发布。
