# 云端迁移与验证记录

日期：2026-10-14。

本地项目此前已上传到 GitHub `dns0129/FrostLine`，提交 `d041d4415bf946c348e517d3156963d23596509e`。本次从该提交恢复到云端 `/workspace/FrostLine`；全部实现、运行、测试与构建均在此执行。`AGENTS.md` 保存后续使用云端的工作约定。无需电脑运行本地服务来继续开发。

## 最终验证

- `npm run check`：全部 JavaScript 语法检查通过。
- `npm test`：264 项测试通过，0 项失败。覆盖新挂点兼容性与数量限制、存档归一化、五级升级费用/XP 门槛、不同飞机基础值、实际推力/机动/耗油/伤害/防御、空空弹种与射程、AIM-7 雷达跟踪、空射鱼叉真实命中、按原配置补给、奖励公式，以及既有飞行、战役、舰炮、地形、相机与资源回收回归。
- `python3 -m unittest discover -s tests -p 'test_*.py'`：4 项服务器测试通过，新运行模块及参数说明已加入资源白名单。
- `npm run test:workshop`：8 项浏览器检查通过，未发现页面异常或失败资源请求。使用云端 Chromium、真实 WebGL 与 Playwright Core。
- `npm run prepare`：生成 40 个静态运行/资源文件；修复原构建清单中未随 GitHub 上传的模型源文件路径，使用仓库现有 Blender 源文件。
- `git diff --check`：通过。

浏览器检查包括：9 挂点与 4 条升级线；购买升级、非对称挂载与刷新后恢复；弹种切换、按键发射、3D 库存同步；飞机反舰训练击沉靶舰；奖励一次结算及持久化；驱逐舰库存回归；390×844、844×390 手机尺寸的触控、滚动、挂点配置和无横向溢出。

浏览器验证结果保存在云端 `verification/workshop/validation.json`，截图包括 `desktop-workshop.png`、`aircraft-sea-training.png`、`390x844-workshop.png`、`844x390-workshop.png`。该目录按仓库原规则不提交。手机测试为浏览器视口与触控模拟，并非实体手机帧率验证。

最初基线为 246 项 JavaScript 测试，239 项通过，7 项因渲染器销毁时访问缺失战机资源而失败；本次补全资源清理的缺失对象检查。旧测试关于飞机没有反舰导弹、强制以战舰进入海战、900 发机炮和单一库存的断言已按新行为更新，保留原交战回归。

## 交付范围

代码与构建在云端准备完成，保存在独立 GitHub 分支供审阅；不自动合并，不执行公开站点部署。玩家进度仍为浏览器单机存档，云端开发不会自动把不同浏览器的存档同步到服务器。

## 1.14 歼-16 与福建舰模型接入（2026-10-15）

模型来源：分支 `claude/fujian-j16-models`（提交 `6a4a08d`）。本次与 `codex/fa18-loadout-upgrades` 一起合并到 `claude/dreamy-fermat-3b2b8r`，在云端实现与验证。

- `npm run check`：通过。`npm test`：277 项全部通过（新增歼-16 注册、挂点与 GLB 实测核对、PL-15 / 鹰击-83K 实际发射与击沉、补给、战役、福建舰导入模型与资源释放等测试）。
- `python3 -m unittest discover -s tests -p 'test_*.py'`：4 项通过，新运行文件已加入白名单。`npm run prepare`：生成 49 个文件。`git diff --check`：通过。
- `npm run test:j16-fujian`（新增）：10 项浏览器检查通过，无页面错误或失败请求。覆盖首页三张载具卡、机库停放歼-16、歼-16 改装中心与刷新后存档、歼-16 拦截任务中按 F 发射 PL-15、反舰训练按 R 发射鹰击-83K 并击沉靶舰、切回大黄蜂、福建舰近景与远景渲染，以及 390×844、844×390、360×780 触控视口。武器锁定与命中使用显式模拟步进，避免依赖软件渲染帧率。
- `tests/browser-base.mjs`：18 项通过。更新了三条早于本次改动就已过时的断言（载具数 3、大黄蜂 M61A1 578 发、1.13 起飞机保留对海任务），并在刷新后等待菜单加载完成。
- `npm run test:workshop`：8 项中 7 项通过。“飞机对海训练发射鱼叉并击沉”在本容器中超时：云端 Chromium 使用 SwiftShader 软件渲染，游戏约 1.6–1.9 帧/秒，模拟时间只有实时的约 0.16–0.19 倍；未改动的基线提交在同一步同样超时。该流程由 Node 测试“aircraft Harpoon locks a sea target … scores a real sinking”覆盖。

浏览器验证截图保存在云端 `verification/j16-fujian/`，按仓库规则不提交。手机测试为浏览器视口与触控模拟，并非实体手机帧率验证。

## 1.15 企业号、伯克级与 052D 模型（2026-10-16）

三个舰级在云端用 PyPI 的 `bpy` 5.0.1（Python 3.11）程序建模并导出；构建脚本 `scripts/build-enterprise.py`、`build-burke.py`、`build-052d.py` 与 `scripts/ship_kit.py` 随仓库提交。云端网络策略不允许访问 Blender 官网与 Wikimedia，因此未下载 Blender 发行包和参考照片；参考链接见各 `*-source/reference/SOURCES.md`。无 GPU 时 EEVEE 无法启动，三视图与透视图改用 Cycles CPU 渲染。

- `npm run check`：通过。`npm test`：279 项全部通过（新增四个舰级的尺寸、朝向、水线、近远景预算、每舰只显示本舰舷号、几何共享、战役第二关护航目标与资源释放测试）。
- `python3 -m unittest discover -s tests -p 'test_*.py'`：4 项通过，新模型与 `naval-assets.js` 已加入白名单。`npm run prepare`：生成 55 个文件。`git diff --check`：通过。
- `tests/browser-fleet.mjs`：12 项通过，包括 8 种桌面出击组合下六舰航行与尾迹、暂停冻结、四个舰级检阅视角的真实 WebGL 渲染（无 WebGL 错误），以及 844×390、390×844 手机视口。该脚本改为可用 `PLAYWRIGHT_PATH`、`CHROMIUM_PATH`、`ANGLE_BACKEND` 指定环境。
- `npm run test:j16-fujian`：10 项在新舰队下重新通过，无页面错误或失败请求。
- 三视图：`assets/three-views/Enterprise-CVN65-three-view.png`、`Arleigh-Burke-DDG51-three-view.png`、`Type-052D-three-view.png`，由 `scripts/render-three-views.py`（`VIEW_ENGINE=CYCLES`）与 `scripts/compose-three-view.py` 生成；原始渲染在 `assets/three-views/raw/`。福建舰与歼-16 的旧图未重新生成。

## 1.19 冰原海域（2026-10-17）

在云端实现并验证第五张地图 `glacial-sea`：入海冰川、139 座实体冰山和海面着色器浮冰。地图说明、现实参考与游戏近似见 `docs/glacial-sea.md`。

- `npm run check`：通过（已加入 `icebergs.js`、`sea-ice.js`）。`npm test`：491 项全部通过。新增 `tests/glacial-sea.test.mjs` 9 项，覆盖冰山目录固定且不重叠、冰崖连续、三档冰山与冰川全部顶点和碰撞面一致、冰川冰崖、海冰水道、海面纹理原地更新和部署图冰山标注。原地图测试已扩展到五张图，并把冰山计入碰撞对照。
- `python3 -m unittest discover -s tests -p 'test_*.py'`：5 项通过，新运行文件已加入白名单。`npm run prepare`：生成 71 个文件。`git diff --check`：通过。
- `npm run test:sortie`：10 项通过。`npm run test:glacial`（新增）：5 项通过，无页面错误或失败请求。覆盖第五个地图按钮、部署图冰山、飞机出击（海冰开启、冰山计入碰撞、无 WebGL 错误）、驱逐舰舰炮训练 10 秒航行不受损，以及 390×844、844×390 触控视口标清出击且无横向溢出。截图在 `verification/glacial-sea/`，按仓库规则不提交。
- 云端 Chromium 使用 SwiftShader 软件渲染。同一视角下，新地图比「极地冰原」多约 15%（标清）到 20%（高清）的帧耗时，只作相对参考，不代表实体设备帧率。SwiftShader 在相机正对 45° 对角或正水平视线时，超大海面三角形的插值会出错；这是软件光栅器的问题，验收截图避开了这些角度，海面网格保持原样。
