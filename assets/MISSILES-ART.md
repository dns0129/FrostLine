# 导弹模型（真实比例）

十一型导弹按公开的长度、弹径和翼展 1:1 建模，几何由 `scripts/missile_kit.py` 生成。详细模型在 `assets/models/missiles/`。可编辑源文件为 `assets/models/missiles-source/Missiles.blend`，中、美两组分两排放在展示架上。对比图为 `assets/three-views/Missiles-real-scale-CN.png` 和 `Missiles-real-scale-US.png`。游戏中所有导弹都使用这些模型，见下文。

| 导弹 | 文件 | 全长 | 弹径 | 翼/舵尖圆直径 | 质量 |
| --- | --- | --- | --- | --- | --- |
| PL-15 霹雳-15 | `pl15.glb` | 3.996 m | 0.203 m | 0.46 m（估） | ≈210 kg |
| PL-10 霹雳-10 | `pl10.glb` | 3.000 m | 0.160 m | 0.40 m（估） | 89 kg |
| HQ-10 红旗-10 | `hq10.glb` | 2.000 m | 0.127 m | 0.28 m（估） | — |
| YJ-83 鹰击-83（舰射型，含助推器） | `yj83.glb` | 6.380 m | 0.360 m | 1.22 m | ≈800 kg |
| YJ-83K 鹰击-83K（空射型） | `yj83k.glb` | 5.200 m（估） | 0.360 m | 1.22 m | — |
| AIM-9M 响尾蛇 | `aim9m.glb` | 2.870 m | 0.127 m | 0.63 m | 85.5 kg |
| AIM-120C AMRAAM | `aim120c.glb` | 3.650 m | 0.178 m | 0.48 m | ≈162 kg |
| AIM-7M 麻雀 | `aim7m.glb` | 3.660 m | 0.203 m | 1.0 m | 231 kg |
| AGM-84D 鱼叉（空射型） | `agm84d.glb` | 3.840 m | 0.343 m | 0.914 m | ≈520 kg |
| RGM-84 鱼叉（舰射型，含助推器） | `rgm84.glb` | 4.630 m | 0.343 m | 0.914 m | ≈690 kg |
| SM-2MR 标准-2（RIM-66M） | `sm2mr.glb` | 4.720 m | 0.343 m | 1.07 m | ≈708 kg |

**数据来源**：
- 公开资料：Wikipedia、NAVAIR、美国空军与海军资料、Air Recognition、Army Recognition 等。
- 各资料之间的差异：AIM-120C 翼展有 0.43–0.48 m 几种说法，这里取美国海军的 19 英寸；AIM-7M 长度有 3.64–3.7 m 几种说法，这里取 3.66 m；AGM-84D 的长度和质量取美国海军资料（12 英尺 7 英寸）。
- 估计值：YJ-83K 没有可靠的长度数据，按舰射型 6.38 m 减去约 1.2 m 助推器估计。舵面弦长、安装位置、分段环、色带和挂钩位置都没有公开数据，按公开照片估计。每型的估计项记录在 `missiles.metadata.json` 的 `estimated` 字段里。
- 外形是示意，不是测绘图纸。

## 外形细节

- PL-15：切线卵形 AESA 雷达罩、中段十字小弹翼、切尖尾舵、电缆整流罩、悬挂钩、脐带插座。
- PL-10：红外成像导引头、四片长边条、尾部控制舵、喷管内燃气舵。
- HQ-10：导引头罩、矩形前舵、尾翼、射频天线。
- YJ-83 / YJ-83K：雷达罩、X 形弹翼与尾舵、腹部进气道；舰射型带四翼助推器，空射型为涡喷尾锥。
- AIM-9M：红外导引头、双三角前舵、带陀螺舵的尾翼。
- AIM-120C：削尖中段弹翼与尾舵、电缆整流罩。
- AIM-7M：中段大三角翼与固定尾翼。
- AGM-84D / RGM-84：钝头雷达罩、中段十字翼、尾舵、腹部进气口；舰射型加四翼助推器。
- SM-2MR：长雷达罩、贯穿弹体的低矮背鳍、尾部控制舵。
- 详细模型另有弹体分段环、战斗部色带和型号字样。

## 游戏接入

`missiles-game.glb` 含十一型的低面数版本（`missile_kit.py` 的 `detail="game"`），每型约 500–800 个三角形，共约 6,600 个，文件约 250 KB。每型按材质分 3–5 个网格，长度、弹径与翼展同详细模型一致。`missile-models.js` 生成以弹轴、弹长中点为原点的模板。渲染器只加载一次，飞机挂载和飞行中的导弹共用这些模板。

| 场合 | 显示的模型 |
| --- | --- |
| 歼-16 挂架与发射 | PL-15、PL-10、鹰击-83K（挂架位置取自 `j16.glb` 原烘焙导弹的中心） |
| 大黄蜂挂架 | AIM-7M、鱼叉、机身挂点的 AIM-120C 用新模型；翼下 AIM-120C 与翼尖 AIM-9M 保留按挂架实测拟合的模型（`fa18-armament.js`）；副油箱仍为程序生成 |
| 大黄蜂发射后 | AIM-9M、AIM-120C、AIM-7M、鱼叉（不带挂架适配器） |
| 伯克级 | 防空 SM-2MR，反舰 RGM-84 |
| 052D 型 | 防空 HQ-10，反舰 YJ-83 |
| D-21 霜卫（虚构） | 沿用 052D 的 HQ-10 / YJ-83（游戏设定） |
| 敌机来袭导弹（虚构敌机） | AIM-7M（与中程半主动的游戏行为对应，游戏设定） |

- 比挂架原校准导弹更粗的挂载（鹰击-83K）整体下移 `STORES.yj83k.visual.hang`（0.08 m）。
- `STORES` 中各型的 `visual` 尺寸与模型一致。
- 模型加载失败时，退回烘焙模板和程序外形，游戏照常运行。
- 弹体外形只影响显示，不改变质量、阻力、射程等游戏数值。
- 测试：`tests/missile-models.test.mjs` 检查尺寸、朝向、面数、资源释放、发射映射、大黄蜂挂载与飞行中的显示；`tests/j16.test.mjs` 检查歼-16 挂载。

## 坐标与导出

GLB 为公制，+Y 向上，弹头朝 -Z，原点在弹长中点的弹轴上。`missiles.metadata.json` 记录 .blend 的 SHA256、每型实测尺寸、三角面数与来源说明；`missiles-game.metadata.json` 记录运行模板的网格名与面数。

## 重建

```sh
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' --background --factory-startup --python scripts/build-missiles.py
for k in YJ-83 YJ-83K PL-15 PL-10 HQ-10 RGM-84 SM-2MR AGM-84D AIM-7M AIM-120C AIM-9M; do n=$(echo $k | tr -d '-' | tr 'A-Z' 'a-z'); '/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" "missile_$n" 260 views "$k"; done
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" missiles_cn 260 hero "Chinese missiles"
'/Applications/Blender 5.2.app/Contents/MacOS/Blender' -b --factory-startup assets/models/missiles-source/Missiles.blend --python scripts/render-three-views.py -- "$PWD/assets/three-views/raw" missiles_us 260 hero "US missiles"
python3 scripts/compose-missile-sheet.py cn
python3 scripts/compose-missile-sheet.py us
```
