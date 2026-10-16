# 052D 型驱逐舰 Blender 模型

可编辑源文件 `assets/models/type052d-source/Type-052D.blend`，导出件 `assets/models/type052d.glb`（公制、Y 向上、舰艏朝 -Z、水线 y = 0）。三视图与透视渲染见 `assets/three-views/Type-052D-three-view.png`。1.15 起替换游戏中原有的程序化 052D，用于中方编队的 CN-DDG-172 与 CN-DDG-173。

全部几何由 `scripts/build-052d.py` 程序生成，共用 `scripts/ship_kit.py`。没有使用任何第三方网格或照片纹理。

## 采用的构型

130 mm 主炮与舰艏防浪板；前部 32 单元垂发；舰桥前方的 H/PJ-12 近防炮；内倾、多面体的前上层建筑，四个斜角面上的 4 面 346A 阵面，顶部为锥形一体化桅杆；单个宽体隐身烟囱；烟囱与机库之间的后部 32 单元垂发；后塔上的 518 型旋转雷达；机库顶 24 联装 HHQ-10；机库后方的直升机甲板（黄色着舰圈）。侧舷 726 型干扰弹发射器与艇舱门为示意。

## 尺寸与来源

| 项目 | 公开资料 | 模型 |
| --- | --- | --- |
| 全长 | 约 157 m（另有 156 m） | 157.0 m |
| 宽 | 17 m 或 18 m，各来源不一 | 最大 17.5 m，水线 16.2 m |
| 吃水 | 约 6.5 m | 6.5 m（声呐罩处约 9.1 m） |

来源：[Naval Technology：Luyang III（052D）](https://www.naval-technology.com/projects/luyang-052d-destroyers/)、[Wikipedia：Type 052D destroyer](https://en.wikipedia.org/wiki/Type_052D_destroyer)。346A 阵面与 518 雷达的具体安装位置公开资料没有明确给出，按公开照片判读。参考照片因云端网络策略未随仓库附带，链接见 `assets/models/type052d-source/reference/SOURCES.md`。

## 舷号

“Hull number 172 (…)”与“Hull number 173 (…)”是独立对象（白字黑影，位于舰艏两侧）。.blend 与渲染只显示 172；GLB 同时包含两者，游戏按每艘舰的舷号只显示自己的那组。

## 重建

```sh
python scripts/build-052d.py
VIEW_ENGINE=CYCLES python <打开 .blend 后运行 scripts/render-three-views.py> -- assets/three-views/raw type052d 14 all
python scripts/compose-three-view.py type052d
```

游戏中近景 15 个绘制对象、约 1.14 万三角形，远景 5 个绘制对象、约 3 千三角形。模型为本项目原创，随游戏发布。
