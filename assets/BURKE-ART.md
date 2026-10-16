# 阿利·伯克级（Flight I）驱逐舰 Blender 模型

可编辑源文件 `assets/models/burke-source/Arleigh-Burke-DDG.blend`，导出件 `assets/models/burke.glb`（公制、Y 向上、舰艏朝 -Z、水线 y = 0）。三视图与透视渲染见 `assets/three-views/Arleigh-Burke-DDG51-three-view.png`。1.15 起替换游戏中原有的程序化伯克级，用于美方编队的 US-DDG-51 与 US-DDG-52。

全部几何由 `scripts/build-burke.py` 程序生成，共用 `scripts/ship_kit.py`。没有使用任何第三方网格或照片纹理。

## 采用的构型

游戏中的舷号 51、52 都属于 Flight I，因此模型按 Flight I 建造：无直升机机库，舰尾为直升机甲板；Mk 45 127 mm 舰炮；前部 29 单元、后部 61 单元 Mk 41 垂发；前甲板室四个斜角面上的 4 面 SPY-1D 阵面；倾斜三脚桅；双烟囱；中部 2 组鱼叉四联装与 Mk 32 鱼雷管；后甲板室 2 部 SPG-62 照射雷达与后部密集阵，前部密集阵在舰桥前方。此前的程序模型为“带机库的伯克级概括外形”，与 51/52 号的实际构型不符。

## 尺寸与来源

| 项目 | 公开资料 | 模型 |
| --- | --- | --- |
| 全长 | 153.8 m（505 ft） | 153.8 m |
| 最大宽 | 20.3 m（66 ft；另有 62 ft 的说法） | 20.3 m |
| 水线宽 | 未查到统一数值 | 18 m（估计） |
| 吃水 | 舰体约 6.3 m，声呐罩处约 9.3 m | 6.3 m / 9.4 m |

来源：[GlobalSecurity DDG-51 Flight I](https://www.globalsecurity.org/military/systems/ship/ddg-51-flt1.htm)、[Seaforces 伯克级](https://www.seaforces.org/usnships/ddg/Arleigh-Burke-class.htm)。各设备的具体位置在公开资料中没有给出，按美国海军公开照片判读。参考照片因云端网络策略未随仓库附带，链接见 `assets/models/burke-source/reference/SOURCES.md`。

## 舷号

“Hull number 51 (…)”与“Hull number 52 (…)”是独立对象（白字黑影，位于舰艏两侧）。.blend 与渲染只显示 51；GLB 同时包含两者，游戏按每艘舰的舷号只显示自己的那组。

## 重建

```sh
python scripts/build-burke.py
VIEW_ENGINE=CYCLES python <打开 .blend 后运行 scripts/render-three-views.py> -- assets/three-views/raw burke 14 all
python scripts/compose-three-view.py burke
```

游戏中近景 14 个绘制对象、约 1.25 万三角形，远景 4 个绘制对象、约 3 千三角形。模型为本项目原创，随游戏发布。
