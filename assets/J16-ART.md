# 歼-16 Blender 模型

可编辑源文件 `assets/models/j16-source/J-16.blend`，导出件 `assets/models/j16.glb`（内嵌贴图，公制、Y 向上、机头朝 -Z，与 `fa18c.glb` 一致）。三视图与透视渲染见 `assets/three-views/J-16-three-view.png`。本模型尚未接入游戏。

## 素材来源

- 底模网格与解放军涂装：FGUK / [FGMEMBERS SU-27](https://github.com/FGMEMBERS/SU-27)，commit `a9c4863886a5835dfa4406698dd4557fbf72a3aa`，GPL-2.0。原始 `Su-27.ac`、`Su-27_Flanker_P01.png`、`Liveries/PLAAF2Div.png` 与许可全文随 `assets/models/j16-source/` 保存。
- 外形参考：日本防卫省 / 航空自卫队公开的歼-16 照片（Wikimedia Commons，CC BY 4.0），见 `assets/models/j16-source/reference/ATTRIBUTION.md`。
- 尺寸：机长 21.9 m、翼展 14.7 m、机高 6.36 m（公开资料汇总）；苏-27UB / 苏-30 系双座型垂尾比苏-27 高约 0.42 m。

## 由苏-27 改为歼-16 的部分

- 双座串列座舱：新建一体式长座舱盖（前风挡、中间框、后铰链框），切开后座舱并加座舱槽、后仪表板与第二具弹射座椅；座舱后背脊抬高 0.17 m。座舱盖对象原点在后铰链处，可绕 X 轴旋转打开。
- 垂尾加高 0.42 m（方尖顶保留），方向舵同步拉伸。
- 去掉苏-27 单前轮挡泥板（保留双前轮）；停机状态起落架油气柱压缩 0.31 m，使总高为 6.36 m。
- 翼尖电子战吊舱；6 枚 PL-15（进气道下 2、机腹串列 2、内翼挂架 2）与 2 枚 PL-10（外翼挂架、带发射导轨）。弹体为外形示意。
- 涂装：在 GPL 解放军涂装上保留蒙皮线、铆钉、警告标记与机徽，改为歼-16 中灰色，去掉原舷号、部队徽章与尾部色带，换成五位示意舷号 `70316`（不对应具体单机）。

模型按 21.9 m 机长等比校准（缩放 0.992），翼展含翼尖吊舱为 15.25 m。局部形态、进气道、机翼等沿用公开基础网格，不是实机测绘。

## 重建

```sh
python3 scripts/j16-livery.py
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background --factory-startup --python scripts/build-j16.py
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/j16-source/J-16.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" j16 90 all
python3 scripts/compose-three-view.py j16
```

`assets/models/j16.metadata.json` 记录 .blend SHA256、尺寸、缩放、起落架压缩量、三角面数与外挂清单。歼-16 衍生模型沿用 GPL-2.0。
