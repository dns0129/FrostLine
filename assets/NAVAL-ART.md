# 航行舰队模型（1.10.0）

弗莱斯特级、阿利·伯克级与 052D 型三种程序模型由本项目原创构建，网格、甲板标线、泊机、舰号、涂层色图、粗糙度图、凹凸图与尾迹均由代码生成。1.14 起福建舰改用项目内的 Blender 模型 `assets/models/fujian.glb`（见 `assets/FUJIAN-ART.md`），甲板不再有程序泊机。运行时不请求互联网，不下载第三方 3D 网格或照片纹理。

公开照片仅用于参考可见轮廓和设备布局：

- 弗莱斯特级：美国海军历史与遗产司令部 [USS Forrestal，NH 97657-KN](https://www.history.navy.mil/our-collections/photography/numerical-list-of-images/nhhc-series/nh-series/NH-97000/nh-97657-kn.html)。参考斜角甲板、右舷舰岛、常规烟囱、桅杆与甲板泊机。
- 阿利·伯克级：同机构 [USS Arleigh Burke，NH 106827-KN](https://www.history.navy.mil/our-collections/photography/numerical-list-of-images/nhhc-series/nh-series/NH-106000/nh-106827-kn-uss-arleigh-burke--ddg-51-.html)。参考前部舰炮、舰桥雷达阵列、双烟囱、直升机甲板；游戏版本采用带机库的伯克级外形概括。
- 福建舰：中国国防部 [福建舰首次航行试验照片](https://www.mod.gov.cn/gfbw/qwfb/16306695.html)。参考平直舰艏、斜角回收区、三条弹射轨道、右舷升降机与紧凑舰岛。
- 052D 型：中国国防部英文网 [Type 052D destroyers in training](https://eng.mod.gov.cn/xb/Home/Focus/16363435.html)。参考内倾舰桥、雷达阵面、一体式前桅、前后垂发区、舰尾机库与直升机甲板。

模型为便于海空战识别的游戏外形近似，不是特定舰船、特定改装年代的精确数字复原。尺寸是项目建模尺度，不用于表达精确现实参数；舰号用于区分同型模型实例，不代表精确复刻该舷号的所有设备。

`naval-models.js` 提供四型网格与共享 PBR 材质；`ambient-fleet.js` 提供六舰默认编队、连续闭合航线与尾迹。涂层保持较低金属度和较高粗糙度，暴露的钢制轨道和栏杆使用不同材质。长条钢板焊缝、微粒防滑甲板、局部盐蚀和排水口氧化痕迹提供近景尺度；既有天空环境图提供统一反射。

近景模型截图在 `verification/fleet/model-*.png`，使用测试中的检阅镜头。`desktop-gameplay-*.png` 与 `mobile-*.png` 使用原有驾驶镜头。手机证据来自浏览器尺寸模拟，不代表实体设备帧率验证。
