# FrostLine 工作约定

用户要求此项目后续工作全部在云端执行。当前云端工作区为 `/workspace/FrostLine`，代码来源为 `https://github.com/dns0129/FrostLine`。在云端完成修改、运行、测试和构建；将完成的代码保存到 GitHub 分支。不要要求用户切回本地继续开发。此约定不表示已授权合并 PR 或部署公开站点。

核心数值模块不依赖 DOM。新增飞机在 `aircraft-systems.js` 的 `AIRCRAFT` 注册独立基础值、现实参考参数和兼容挂点；技术等级全机型共享，禁止在已升级数值上再次叠加。现实参考与游戏近似须在 `docs/aircraft-systems.md` 区分。

新增运行文件同时更新 `server.py` 的资源白名单、`sw.js` 的离线资源和 `scripts/prepare-sites.mjs` 的构建清单。运行 `npm run check`、`npm test`、`python3 -m unittest discover -s tests -p 'test_*.py'` 与 `npm run prepare`。改变 UI 或交战流程时运行适当浏览器验证。
