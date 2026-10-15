# 福建舰（CV-18）Blender 模型

可编辑源文件 `assets/models/fujian-source/Fujian-CV18.blend`，导出件 `assets/models/fujian.glb`（公制、Y 向上、舰艏朝 -Z，甲板贴图以 JPEG 内嵌）。三视图与海面透视渲染见 `assets/three-views/Fujian-CV18-three-view.png`。1.14 起本模型替换了游戏中原有的程序化福建舰：`fujian.js` 按材质合并网格（近景 15 个绘制对象、约 2.6 万三角形），并从舰体、甲板、舷台和舰岛主体生成远景轮廓（5 个绘制对象、约 3 千三角形），由 `ambient-fleet.js` 用于默认中方编队的 CN-CV-18。

网上没有可免费使用的开放授权福建舰网格（检索到的 CGTrader / TurboSquid / RenderHub 版本均为付费或仅限编辑用途），所以全部几何体由 `scripts/build-fujian.py` 在 Blender 中程序生成。

## 参考资料与校准

- 甲板平面：Gryfia 绘制的 [Type 003 Aircraft Carrier Fujian (18).svg](https://commons.wikimedia.org/wiki/File:Type_003_Aircraft_Carrier_Fujian_(18).svg)（CC BY-SA 4.0）。还原线图的非等比组缩放后测量，校准到全长 316 m、甲板最大宽 76 m。测得的坐标集中在 `scripts/fujian_layout.py`。
- 舰岛、干舷与桅杆高度：日本防卫省统合幕僚监部 2025-09-11 侧面照片（CC BY 4.0），按全长比例估算。
- 甲板细节：中新社福建舰甲板照片（CC BY 4.0）。
- 来源清单见 `assets/models/fujian-source/reference/ATTRIBUTION.md`。

## 模型内容

- 舰体：按水线分层放样，带球鼻艏、外飘舰艏、方尾、舭部圆角；水线以下红色防污漆、黑色水线带、舷侧舷号“18”与锚链孔。水下有 4 具五叶螺旋桨、轴与支架、双舵与舭龙骨（常规航母的估计造型）。
- 飞行甲板：316 × 76.5 m，斜角甲板 7.9°；3 部电磁弹射器轨道与梭车、3 块偏流板、4 道拦阻索与滑轮、2 部右舷舷侧升降机、甲板标线、5 个编号起降点、艏部“18”、防滑涂层、轮胎胶痕与尾焰熏痕；甲板边缘走道与安全网架、左舷光学助降装置、放倒的鞭状天线。
- 舰岛：底座、内倾主体、四面 S 波段相控阵与 X 波段条形阵、前部舰桥翼与窗带、后部飞控平台、一体化桅杆与天线罩、顶部卫通天线罩与排烟口、栏杆。
- 武器舷台：4 座 24 联装 HQ-10 发射装置、4 座 H/PJ-11 近防炮、诱饵发射器、雷达罩与救生筏筒。武器为外形示意。

吃水 11 m、水线宽 40 m、飞行甲板距水线 17.5 m、桅顶距水线 57 m 为估计值；舰岛细部、舷台位置与水下线型都不是测绘数据。

## 重建

```sh
python3 scripts/fujian-deck-texture.py
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background --factory-startup --python scripts/build-fujian.py
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/fujian-source/Fujian-CV18.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" fujian 7 all
python3 scripts/compose-three-view.py fujian
```

甲板平面取自 CC BY-SA 4.0 线图，因此本模型、甲板贴图与三视图同样按 CC BY-SA 4.0 发布，署名“Gryfia（Wikimedia Commons）”。`assets/models/fujian.metadata.json` 记录 .blend SHA256 与主要尺寸。
