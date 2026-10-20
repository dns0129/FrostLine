# 飞机与航空升级（1.22）

1.22 已取消挂点编辑、外置挂架、预设挂载和弹药总量限制。玩家在机库购买导弹与机炮等级，购买一次、永久拥有；局内开火不扣币，弹药自动补充。完整价格、冷却、存档迁移及游戏近似见 [武器商店与经济系统](combat-economy.md)。

## 现实参考与游戏数据

| 项目 | F/A-18C 大黄蜂 | 歼-16 |
| --- | --- | --- |
| 游戏基础 HP | 200 | 250 |
| 现实机炮参考 | M61A1，通常 578 发 | GSh-30-1，通常 150 发 |
| 游戏当前弹匣 / 总储备 | 60 发 / 无限 | 60 发 / 无限 |
| 标准机炮单发游戏伤害（未升级） | 20.4 | 34 |
| 空空武器 | AIM-9M / AIM-7M / AIM-120C | PL-10 / PL-15 |
| 反舰武器 | AGM-84D 鱼叉 | 鹰击-83K |
| 内油参考 | 4930 kg | 9400 kg（公开估计） |
| 空重参考 | 10455 kg | 17700 kg（公开估计） |
| 最大起飞重量参考 | 23537 kg | 35000 kg（公开估计） |

现实弹舱数量、重量与武器外形作为参考资料保留，游戏使用独立的无限补充机制。游戏没有以机库武器产生额外外挂重量或不平衡惩罚。外观为无外挂、无挂架的干净机体，发射点在机体下方，是玩法近似，不能作为现实挂载认证或内部弹舱的描述。固定翼尖电子战吊舱和飞机起落架保留。

歼-16 没有官方公开完整参数，重量、推力等使用公开估计。两架飞机保留各自基础推力、滚转、俯仰、速度和燃油差异，技术等级全机型共享，从本机基础值计算一次，重开不重复叠加。

## 射程与制导（游戏尺度）

| 武器 | 锁定距离 | 基础锁定时间 | 引导 |
| --- | --- | --- | --- |
| AIM-9M | 2.8 km | 1.2 秒 | 红外近程 |
| AIM-7M | 4.5 km | 1.5 秒 | 半主动雷达，需保持目标选择和机头雷达跟踪 |
| AIM-120C | 6.5 km | 1.1 秒 | 主动雷达 |
| AGM-84D | 7 km | 1.5 秒 | 反舰，15 m 游戏巡航高度 |
| PL-10 | 3 km | 1 秒 | 红外近程 |
| PL-15 | 7.5 km | 1.2 秒 | 主动雷达 |
| 鹰击-83K | 7.5 km | 1.5 秒 | 反舰 |

公里数、秒数、伤害、热量和燃油消耗均是约 10 km 半径战场的游戏尺度，不是现实作战参数。B 或 HUD 按钮循环本机空空武器；F 空空，R 反舰，两个系统分别补充，切换型号不重置当前冷却。地形会阻挡锁定与飞行。

## 技术升级与存档

引擎、火力、防御、机动各五档，要求指挥官 1 / 3 / 5 / 8 / 12 级，费用 300 / 700 / 1400 / 2400 / 3800 银币，指挥官共 30 级。每档引擎推力 +6%、火力伤害 +5.5%、防御 HP +8%、机动滚转 +5.5%，其余原有散热、减伤和响应效果保留。

存档键仍是 `frostline-workshop-v1`，内容版本为 3。旧升级、经验和货币保留；1.21 已选择武器免费迁移为永久拥有，旧挂载数据不再影响出击。历史挂点解析器仅用于兼容旧数据和模型参考。新增机型在 `AIRCRAFT` 注册独立基础参数、公开参考和本机武器表，实际出击不配置挂架。

导弹仍使用 `missiles-game.glb` 中十一型真实比例模型，来源、尺寸与估计项见 `assets/MISSILES-ART.md`。清洁机体由导入模型共享，不破坏原 GLB 和可编辑源文件；详细几何回归见 `tests/airframe-clean.test.mjs`。

## 公开参考

- [NAVAIR F/A-18 A–D Hornet](https://www.navair.navy.mil/product/FA-18-D-Hornet)：多用途角色、双 F404 引擎、最大起飞重量、330 加仑油箱及武器类别。
- [美国海军 AIM-120 参数](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2168352/aim-120-advanced-medium-range-air-to-air-missile-amraam/)：C-5/6/7/D 的公开质量 356 磅，换算约 162 kg。
- [美国海军 Harpoon](https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2168358/harpoon-missile/)：空射与舰射用途；舰射型带助推器质量不直接用于空射型。
- [Eagle Dynamics F/A-18C 模拟器手册](https://www.digitalcombatsimulator.com/upload/iblock/8d7/2s3e89jqknz7xmti8hrhe1bjt2uw1s3e/DCS%20FA-18C%20Early%20Access%20Guide%20EN.pdf)：9 挂点和武器兼容，翼下 2/3/7/8 可双联 AIM-120。该资料为模拟器指南，而非现实认证挂载文件。

## 云端开发

本地代码此前已上传到 `https://github.com/dns0129/FrostLine`，本次从该提交恢复至云端 `/workspace/FrostLine`。后续开发、测试和构建在云端执行。`npm test` 运行数值与资源生命周期回归；`npm run test:workshop` 需要 Playwright Core 和 Chromium，`BASE_URL` 默认 `http://127.0.0.1:8766`，支持 `PLAYWRIGHT_PATH` 与 `CHROMIUM_PATH`。`npm run prepare` 生成完整静态发布目录，不执行线上部署。
- 歼-16 参数为公开估计，参考 [The Aviationist：Shenyang J-16](https://theaviationist.com/2025/01/16/shenyang-j-16/) 与 [AeroCorner：Shenyang J-16](https://aerocorner.com/aircraft/shenyang-j-16-qianlong/)；两者及其他资料在空重、外挂和推力上并不完全一致。
- PL-10E 展示数据见 [新华网 2021 年 9 月 28 日报道](https://www.news.cn/mil/2021-09/28/c_1211385674.htm)；PL-15 / PL-15E 尺寸与质量参考 [Wikipedia：PL-15](https://en.wikipedia.org/wiki/PL-15)；鹰击-83 家族参考 [Wikipedia：YJ-83](https://en.wikipedia.org/wiki/YJ-83)。

## 模型来源与许可

- F/A-18C：`assets/models/fa18c.glb`，GPL-2.0，源自 [FGMEMBERS/F-18C](https://github.com/FGMEMBERS/F-18C)，可编辑源文件随附 `assets/models/f18-source/`。
- 歼-16：`assets/models/j16.glb`，GPL-2.0，由 [FGMEMBERS/SU-27](https://github.com/FGMEMBERS/SU-27) 网格改制（双座座舱、加高垂尾、翼尖吊舱、PL-15/PL-10 挂载与涂装），可编辑源文件 `assets/models/j16-source/J-16.blend` 与许可证 `COPYING` 随游戏发布。
- 企业号、阿利·伯克级、052D：`assets/models/enterprise.glb`、`burke.glb`、`type052d.glb`，本项目 Blender 程序建模（`scripts/build-*.py`），来源与尺寸见 `assets/NAVAL-ART.md`。
- 导弹：`assets/models/missiles/missiles-game.glb`（游戏用十一型低面数版本）与同目录的详细模型，均由 `scripts/build-missiles.py` 程序建模。尺寸来源与估计项见 `assets/MISSILES-ART.md`。
- 福建舰：`assets/models/fujian.glb`，Blender 程序建模；甲板布局依据 Gryfia 的 Wikimedia Commons 线图 [Type 003 Aircraft Carrier Fujian (18)](https://commons.wikimedia.org/wiki/File:Type_003_Aircraft_Carrier_Fujian_(18).svg)，按 CC BY-SA 4.0 署名并以相同许可发布。
