# 导弹模型（真实比例）

五型导弹按公开的长度和弹径 1:1 建模，几何由 `scripts/missile_kit.py` 生成。详细模型见 `assets/models/missiles/`。可编辑源文件为 `assets/models/missiles-source/Missiles.blend`，各型放在展示架上并排摆放，便于直接比较大小。对比图见 `assets/three-views/Missiles-real-scale.png`。PL-15、PL-10、鹰击-83K 已接入游戏，用作歼-16 的挂载，见下文。

| 导弹 | 文件 | 全长 | 弹径 | 翼/舵尖圆直径 | 质量 |
| --- | --- | --- | --- | --- | --- |
| PL-15 霹雳-15 | `pl15.glb` | 3.996 m | 0.203 m | 0.46 m（估） | ≈210 kg |
| PL-10 霹雳-10 | `pl10.glb` | 3.000 m | 0.160 m | 0.40 m（估） | 89 kg |
| HQ-10 红旗-10 | `hq10.glb` | 2.000 m | 0.127 m | 0.28 m（估） | — |
| YJ-83 鹰击-83（舰射型，含助推器） | `yj83.glb` | 6.380 m | 0.360 m | 1.22 m（翼展） | ≈800 kg |
| YJ-83K 鹰击-83K（空射型，无助推器） | `yj83k.glb` | 5.200 m（估） | 0.360 m | 1.22 m（翼展） | — |

全长、弹径、YJ-83 翼展和质量取自公开资料（Wikipedia、Air Recognition、Army Recognition 等）。YJ-83K 的长度没有可靠公开数据，按舰射型 6.38 m 减去约 1.2 m 助推器估计。舵面弦长、展长、安装位置、分段环、色带和挂钩位置也都没有公开数据，是按公开照片估计的；每型的估计项记录在 `missiles.metadata.json` 的 `estimated` 字段里。外形是示意，不是测绘图纸。

## 外形细节

- PL-15：切线卵形 AESA 雷达罩、中段十字小弹翼、切尖尾舵、电缆整流罩、两个悬挂钩、脐带插座、喷管。
- PL-10：红外成像导引头罩、四片长边条、尾部控制舵、喷管内的燃气舵（推力矢量）、导轨发射挂钩。
- HQ-10：导引头罩、矩形前舵、尾翼、射频天线。
- YJ-83 / YJ-83K：雷达罩、X 形弹翼与尾舵、腹部进气道；舰射型带有四片稳定翼的助推器，空射型以涡喷尾锥收尾。
- 详细模型有弹体分段环和型号字样；空空导弹和鹰击-83 系列另有战斗部色带。

## 游戏接入

- `missiles-game.glb`：PL-15、PL-10、鹰击-83K 的低面数版本（`missile_kit.py` 的 `detail="game"`）。每型约 580 个三角形，按材质分为 body / seeker / dark / fittings 4 个网格，长度和弹径与详细模型一致。`missiles-game.metadata.json` 记录实测长度、网格名与面数。
- `missile-models.js`：加载上述 GLB，生成以弹轴、弹长中点为原点的挂载模板。鹰击-83K 比 PL-15 粗，模板下移 `STORES.yj83k.visual.hang`（0.08 m），以贴合原为 PL-15 校准的内翼挂架。
- `j16.js`：随歼-16 资源一起加载这些模板并负责释放，用它们替换模型内烘焙的旧导弹（旧导弹长 3.96 / 2.97 m）。挂点位置仍取自烘焙导弹的中心。真实比例模型加载失败时，退回旧模板。
- `renderer.js`：玩家发射的 PL-15 / PL-10 / 鹰击-83K 在飞行中显示同一模型，尾焰位于弹尾。敌方导弹和舰射导弹仍用通用外形。
- `STORES` 中这三型的 `visual` 尺寸改为与模型一致。弹体外形只影响显示，不改变质量、阻力、射程等游戏数值。
- 测试：`tests/missile-models.test.mjs` 检查尺寸、朝向、面数、资源释放和飞行中的显示；`tests/j16.test.mjs` 检查挂载模板。

## 坐标与导出

GLB 为公制，+Y 向上，弹头朝 -Z，原点在弹长中点的弹轴上，可以直接挂到挂架位置。`missiles.metadata.json` 记录 .blend 的 SHA256、每型的实测尺寸、三角面数和数据来源说明。

## 重建

```sh
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background --factory-startup --python scripts/build-missiles.py
for k in YJ-83 YJ-83K PL-15 PL-10 HQ-10; do n=$(echo $k | tr -d '-' | tr 'A-Z' 'a-z'); '/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" "missile_$n" 260 views "$k"; done
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" missiles 260 hero
python3 scripts/compose-missile-sheet.py
```
