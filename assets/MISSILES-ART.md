# 导弹模型（真实比例）

四型导弹按公开的长度和弹径 1:1 建模，几何由 `scripts/missile_kit.py` 生成。单独模型见 `assets/models/missiles/`。可编辑源文件为 `assets/models/missiles-source/Missiles.blend`，四型导弹放在展示架上并排摆放，便于直接比较大小。对比图见 `assets/three-views/Missiles-real-scale.png`。这些模型尚未接入游戏。

| 导弹 | 文件 | 全长 | 弹径 | 翼/舵尖圆直径 | 质量 |
| --- | --- | --- | --- | --- | --- |
| PL-15 霹雳-15 | `pl15.glb` | 3.996 m | 0.203 m | 0.46 m（估） | ≈210 kg |
| PL-10 霹雳-10 | `pl10.glb` | 3.000 m | 0.160 m | 0.40 m（估） | 89 kg |
| HQ-10 红旗-10 | `hq10.glb` | 2.000 m | 0.127 m | 0.28 m（估） | — |
| YJ-83 鹰击-83（舰射型，含助推器） | `yj83.glb` | 6.380 m | 0.360 m | 1.22 m（翼展） | ≈800 kg |

全长、弹径、YJ-83 翼展和质量取自公开资料（Wikipedia、Air Recognition、Army Recognition 等）。舵面弦长、展长、安装位置、分段环、色带和挂钩位置都没有公开数据，是按公开照片估计的；每型的估计项记录在 `missiles.metadata.json` 的 `estimated` 字段里。外形是示意，不是测绘图纸。

## 外形细节

- PL-15：切线卵形 AESA 雷达罩、中段十字小弹翼、切尖尾舵、电缆整流罩、两个悬挂钩、脐带插座、喷管。
- PL-10：红外成像导引头罩、四片长边条、尾部控制舵、喷管内的燃气舵（推力矢量）、导轨发射挂钩。
- HQ-10：导引头罩、矩形前舵、尾翼、射频天线。
- YJ-83：雷达罩、X 形弹翼与尾舵、腹部进气道、带四片稳定翼的助推器。
- 每型都有弹体分段环和型号字样；空空导弹和 YJ-83 另有战斗部色带。

## 坐标与导出

GLB 为公制，+Y 向上，弹头朝 -Z，原点在弹长中点的弹轴上，可以直接挂到挂架位置。`missiles.metadata.json` 记录 .blend 的 SHA256、每型的实测尺寸、三角面数和数据来源说明。

## 重建

```sh
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background --factory-startup --python scripts/build-missiles.py
for k in YJ-83 PL-15 PL-10 HQ-10; do n=$(echo $k | tr -d '-' | tr 'A-Z' 'a-z'); '/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" "missile_$n" 260 views "$k"; done
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" missiles 260 hero
python3 scripts/compose-missile-sheet.py
```

## 与游戏内歼-16 的关系

游戏里的歼-16 仍使用 `j16.glb` 里原来烘焙的 PL-15 / PL-10。`j16.js` 把它们当作挂载模板，长度分别为 3.96 m 和 2.97 m，每枚 3 个网格（body / fins / seeker）。`tests/j16.test.mjs` 锁定了这些尺寸，以及整机不超过 13,000 个三角面。这里的 `yj83.glb` 是带助推器的舰射型，游戏里挂载的鹰击-83K 是 `aircraft-stores.js` 程序生成的空射型。

如果要把歼-16 的挂载换成这套真实比例几何，需要同步修改：
- `build-j16.py` 的挂载输出：低面数版本，按模板约定命名；
- `j16.js` 的模板识别规则；
- `tests/j16.test.mjs` 的尺寸与面数约束；
- `AIRCRAFT.j16` 的挂点坐标。
