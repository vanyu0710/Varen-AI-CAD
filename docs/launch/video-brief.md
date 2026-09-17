# Varen CAD 旗舰视频 — AI 制作需求包（video-brief v1）

**给谁做**：视频生成 AI（即梦/可灵/Runway/Vidu 均可）+ 少量剪辑。**交付时限**：24h 出 90 秒样片。
**配套**：叙事蓝本见 `demo-video-script.md`；口径纪律见 `positioning.md`（禁用词先过一遍）。
**总原则**：本片主角不是"AI 能建模"，是"**AI 的错误会被抓住**"。所有镜头为这一个论点服务。

---

## 0. 成片规格

| 项 | 值 |
|---|---|
| 时长 | 90s（±5s）；另剪 30s 竖版（仅 §2-B4/B5 门控段） |
| 画幅 | 16:9 · 1920×1080 成片（录屏素材 1280×720@30fps 上变换） |
| 字幕 | 中文硬字幕 + 英文 SRT 外挂（双语物料规范见 positioning.md） |
| 配音 | 女声或男声均可，语速 4.8–5.2 字/秒，冷静工程语气，禁"惊叹体" |
| BGM | lo-fi/极简电子，-22dB 低于人声；无版权库曲目 |
| 品牌 | 片尾板 logo（`assets/varen-cad-logo-v2.svg`）+ 一行 `github.com/vanyu0710/aicad` |

## 1. 分镜表（6 镜 90 秒）

| # | 时码 | 类型 | 画面 | 旁白 |
|---|---|---|---|---|
| S1 | 0:00–0:15 | **AI 生成（文生图轮播）** | 深海蓝渐层背景，减速器四视角/剖视 6 帧慢推轮播，最后一帧定格在"8 个零件分解悬浮图" | "一句话，十三分钟，之后你会看到什么？" |
| S2 | 0:15–0:32 | **真实录屏** | 输入框敲入"给我设计个 1:100 的变速箱"→ 调研卡片（传动比 85/17×85/17×68/17=100）→ ask_user 卡片 → BOM 计划表 8 件 | "它先像工程师一样算账、提问，然后把零件清单摆在你面前——等你点头才动手。" |
| S3 | 0:32–0:50 | **真实录屏（加速）** | 逐件建模蒙太奇：渐开线齿轮生成特写、脚本卡片滚动、四视角快照卡自动嵌入会话流 | "34 个受控操作，每个零件单独归档，每一步都留痕、可回放、可改参数。" |
| S4 | 0:50–1:05 | **真实录屏（本片核心）** | 红色拒绝卡出现：`INTERFERENCE_BLOCKED`（或 `FEATURE_CONTRACT_MISMATCH`）→ agent 读回错误 → 修改轴/齿轮位姿 → 复检通过 | "注意这里——它试图交付一个不合格的装配，硬碰撞门直接拒了，把证据甩回给它。**它会抓住自己的错误，并且不给错误结果盖章。**" |
| S5 | 1:05–1:18 | **AI 生成 + 实拍混合** | 装配四视图旋转变体渲染；切真实画面：同一 STEP 文件在 FreeCAD 中打开、特征树展开 | "8 件、53 步、758 秒、干涉为零。而打开这个 STEP 的，是你手上任何一款 CAD。" |
| S6 | 1:18–1:30 | **UI 实拍** | `run_benchmark.py --all` 终端滚动 → results 目录 JSON 展开 → 黑场品牌板 | "开源，本地运行，失败样本也公开。封闭 Beta，正在招募。" |

## 2. AI 生成素材 — 文生图 prompt（6 帧，给 S1/S5）

统一风格锚：`deep navy-to-teal gradient background (#041e42 → #0b2a4a), technical blueprint-meets-render aesthetic, matte metal parts with subtle iridescence, volumetric rim light, 8K, isometric turntable view, clean engineering composition, no text, no watermark`
负面：`no cartoon, no fantasy, no glowing magic effects, no human hands`

| 帧 | 中文要点 | EN prompt 追加 |
|---|---|---|
| F1 | 三级齿轮减速器完整装配等轴测 | three-stage cylindrical gearbox assembly, cutaway showing helical gears on parallel shafts inside cast housing |
| F2 | 半剖视图：箱体内三根平行轴+真渐开线斜齿轮 | half-section view revealing three parallel shafts with true involute helical gears, bronze shift forks, steel synchronizers |
| F3 | 单齿轮特写：渐开线齿廓+键槽 | close-up of one steel spur gear, precise involute teeth, keyway in bore, shallow depth of field |
| F4 | 阶梯轴组：四段轴径+轴承位 | stepped shaft set, four diameter sections with bearing journals |
| F5 | 8 零件分解悬浮图（爆炸视图） | exploded view, 8 parts floating in ordered disassembly, thin guide lines |
| F6 | 装配 STEP 在 CAD 中打开（屏幕实拍感） | CAD software on monitor, assembly tree expanded, photoreal desk shot, screen UI visible |

图生视频段（3–5s/帧）：慢速 15° 环绕推近；S1 用 F1→F2→F5 三连。

## 3. 录屏素材规格（我方自产，给 AI 剪辑侧对齐用）

- 工具：OBS 1280×720@30fps，深色主题，浏览器 125% 缩放，光标高亮+点击涟漪
- 必含原始素材：①输入 prompt 特写（打字可见）②调研卡片 ③BOM 审批卡 ④一次**真实拒绝**红卡（用 v0.16 记录的返工段或 benchmark 负例复跑）⑤复检通过打勾 ⑥装配四视图 ⑦FreeCAD 打开 STEP
- 红线：**不许用假 UI 摆拍拒绝场景**。录不到真实拒绝就改分镜（S4 用负例任务复跑现录），拒绝瞬间必须是真事件——被观众扒出摆拍等于产品自杀。

## 4. TTS 旁白全稿（中文，逐镜对齐 §1）

1. 一句话，十三分钟，之后你会看到什么？
2. 它先像工程师一样算账、提问，然后把零件清单摆在你面前——等你点头才动手。
3. 34 个受控操作，每个零件单独归档，每一步都留痕、可回放、可改参数。
4. 注意这里——它试图交付一个不合格的装配，硬碰撞门直接拒了，把证据甩回给它。它会抓住自己的错误，并且不给错误结果盖章。
5. 8 件、53 步、758 秒、干涉为零。而打开这个 STEP 的，是你手上任何一款 CAD。
6. 开源，本地运行，失败样本也公开。封闭 Beta，正在招募。

（EN 版：见 launch-deck.md 30-second pitch 拆句直译，语气词删净。）

## 5. 验收清单（12 条，AI 交付后逐项打钩）

- [ ] 总时长 85–95s；竖版 30s 切片存在
- [ ] S4 拒绝画面为**真实事件录屏**（提供原始 OBS 文件哈希）
- [ ] 未出现禁用词（首个/唯一/可制造承诺/工业级）——对照 positioning.md 扫描字幕稿
- [ ] 所有数字（8/53/758/0）与 benchmark/results 记录一致
- [ ] 齿轮齿形特写无乱齿/穿模（AI 生成帧重点查，画错=直接退回）
- [ ] 中文硬字幕无错别字；英文 SRT 同步偏差 <0.3s
- [ ] BGM 电平 ≤ 人声 -22dB；无版权风险曲
- [ ] 片尾 logo 用 v2 文件；仓库 URL 全程可扫码/可读 ≥3s
- [ ] 品牌色一致（深海蓝渐层，禁用高饱和渐变）
- [ ] 首帧 3 秒内出现"冲突感"（拒绝卡前置钩子可测）
- [ ] 1280×720 投屏与手机竖屏预置封面各一版
- [ ] 源工程文件随片交付（可改可续剪）

## 6. 给执行 AI 的一句话总纲

> 这不是产品宣传片，是一份**证据影片**：每个镜头要么展示真实运行痕迹，要么把真实痕迹放大。做不了真的一律不拍。
