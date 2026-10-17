# [置顶] 从这里开始：v0.21.0-beta 安装、已知问题与反馈方式

> 这是 Varen CAD 封闭 Beta 的总入口。三跳可达：**下载安装包 → 跑通第一个任务 → 反馈**。
> （本贴将由 Discussions 管理员置顶）

## ⬇️ 1. 下载

- **Windows x64**：[Releases → v0.21.0-beta](https://github.com/vanyu0710/aicad/releases/tag/v0.21.0-beta)
  下载 `VarenCAD-win64-0.21.0-beta.zip`（≈181 MB）+ 同页 `.sha256` 校验附件
- 校验（PowerShell）：`Get-FileHash .\VarenCAD-win64-0.21.0-beta.zip -Algorithm SHA256`
- 解压即跑：双击 `VarenCAD.exe`（首次预热约 30 秒，自动打开 `http://127.0.0.1:8001/`）
- SmartScreen 提示"未知发布者"是预期行为（当前未代码签名，来源以校验值为准）
- 源码运行（开发者）：见 [README](../../README.md)「开发模式」；需要旁路克隆 `mechcad-kernel` 内核仓

## 🧪 2. 第一个任务（15 分钟内出首个 STEP）

在右侧 AI 助手输入：

> 做一块 120×120×12 法兰，中心 Ø30 通孔，6 个 Ø8 螺栓孔均布在 Ø90 分度圆上

跑通标志：会话流出现几何快照卡片 → 底部产物区可下载 `model.step`。
配置自己的模型端点：设置中心 → 模型（OpenAI 兼容端点即可）。

## ⚠️ 3. 安装前必读

- **[KNOWN_ISSUES.md](../../KNOWN_ISSUES.md)** —— 功能边界（无 2D 工程图/无约束求解/`production_ready` 恒 false）、已知运行问题、数据与隐私说明
- **[docs/beta.md](../beta.md)** —— 封闭 Beta 计划与进入公开 Beta 的数据门
- 你的文件只存本机 `work/` 目录；唯一出网数据是发往**你配置的模型端点**的 prompt 与草图

## 💬 4. 反馈渠道（按优先级）

| 场景 | 去哪 |
|---|---|
| **任务做错了/做不出来**（最有价值） | [任务失败报告模板](https://github.com/vanyu0710/aicad/issues/new?template=task_failure.yml) —— 会进公开 benchmark |
| 软件崩溃/UI 异常 | [Bug 报告模板](https://github.com/vanyu0710/aicad/issues/new?template=bug_report.yml) + 设置中心→支持→导出诊断包 |
| 使用问题/想法/成果展示 | 本 Discussions 对应分类 |
| 想成为长期设计伙伴 | [申请入口](https://github.com/vanyu0710/aicad/issues/new?template=beta_application.yml) |

失败样本会被复现、归因并纳入回归 benchmark——暴露缺陷是这个产品的公开立场，不用客气。

## 📊 5. 我们在盯的数字

- 安装→首个 STEP 导出时间（目标中位数 <15 分钟）
- 任务成功率（通过全部门控的归档比例）
- 每周失败周报：[Discussions · 周报分类] / 仓库 `docs/launch/weekly/`
