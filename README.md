# Varen CAD —— AI CAD 建模 Agent：一句话到可复核的机械装配

<p align="center">
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/assets/varen-cad-logo.svg" alt="Varen CAD logo" width="300"/>
</p>

<p align="center">
  <b>AI CAD 建模 Agent：</b>一句话需求进来，先调研计算、结构化提问、出 BOM 计划待你批准，再逐件完成真实 CAD 建模与装配，导出 STEP——参数化 BRep，不是图片或网格。<br/>
  <i>每一步可回放；几何与碰撞检查不过关，就不当作成功交付。</i>
</p>

<p align="center">
  <b><a href="https://github.com/vanyu0710/Varen-AI-CAD/releases">下载 Windows 版</a></b> ·
  <a href="README.en.md">English</a> ·
  <a href="https://vanyu0710.github.io/Varen-AI-CAD/">产品落地页</a> ·
  <a href="docs/beta.md">申请 Beta</a> ·
  <a href="https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=task_failure.yml">报告任务失败</a>
</p>

<p align="center">
  <a href="https://github.com/vanyu0710/Varen-AI-CAD/releases"><img alt="Published release" src="https://img.shields.io/github/v/release/vanyu0710/Varen-AI-CAD?include_prereleases" /></a>
  <img alt="Status" src="https://img.shields.io/badge/status-closed%20beta-blue" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20x64-lightgrey" />
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-green" />
</p>

> **当前状态：** Windows only，封闭 Beta。Varen CAD 面向概念设计和快速原型，不是 SolidWorks 替代品，不提供完整的 2D 工程图流程或通用装配配合求解器，并且 `production_ready` 始终为 `false`。所有输出都需要人工工程复核。

## 先看真实结果

仓库包含 Agent 工作流的真实端到端输出：

<p align="center">
  <b>1:100 三级齿轮减速器装配</b> —— 8 个零件、53 步、758 秒、硬碰撞 0<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-gearbox-assembly.png" alt="Varen CAD 三级齿轮减速器装配" width="820"/>
</p>

<p align="center">
  <b>五挡手动变速器装配</b> —— 渐开线斜齿轮、26 个零件、硬碰撞 0<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-transmission-visual.png" alt="Varen CAD 五挡手动变速器装配" width="860"/>
</p>

<p align="center">
  <b>几何证据渲染器</b> —— 只显示特征边，消除三角化对角线噪声<br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/render-before-after.png" alt="几何证据渲染器对比" width="860"/>
</p>

<p align="center">
  <b>启动页</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-startup.jpg" alt="Varen CAD 启动页" width="820"/>
</p>

<p align="center">
  <b>工作区与 Agent 对话</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-workspace-chat-snapshot.jpg" alt="Varen CAD 工作区与 Agent 对话" width="820"/>
</p>

<p align="center">
  <b>减速器运行总览</b><br/>
  <img src="https://raw.githubusercontent.com/vanyu0710/Varen-AI-CAD/main/docs/images/varen-gearbox-visual.png" alt="Varen CAD 减速器运行总览" width="820"/>
</p>

计划中的 45–60 秒工作流视频请见[视频分镜与制作说明](docs/launch/video-brief.md)。目前尚未在 README 中加入可播放的视频。

## Varen CAD 的差异化

### 1. 真实 CAD 几何，不是图片或网格生成

- 通过 MechKernel CAD 内核使用 OpenCascade 7.9.3。
- 生成可被 CAD 软件检查的边界表示几何（B-Rep），保留拓扑与几何信息。
- 保留参数化特征图和操作历史，可以修改特征并进行参数化重放。
- 导出 STEP 和 STL，供下游 CAD、审查和原型流程使用。

### 2. Agent 工作流，不是一次性生成

多零件任务遵循明确的工程步骤：

1. 调研和工程计算，例如传动比、中心距、轴径估算和壁厚估算。
2. 尺寸或设计意图不明确时，提出结构化问题。
3. 规划 BOM，列出零件名称、数量和关键参数。
4. 用户审批计划后，才允许计划修改几何。
5. 每个零件使用独立内核会话逐件建模。
6. 放置装配、导出并进行审查。
7. 几何验证和干涉检查通过后，才接受产物。

Agent 通过受约束的内核操作和结构化 `StepResult` 反馈工作，不会直接获得一个可以随意执行任意 CAD Python 的黑盒环境。

### 3. 失败会阻止交付

模型回复看起来成功，不代表交付成功。以下情况会让系统停止或拒绝产物：

- 零件包含多个实体或悬浮特征；
- 特征契约与实测孔径、数量或位置不一致；
- 两个零件发生未批准的干涉；
- 参数化重放过程中脚本或操作失败；
- BOM 不完整，或验证门控没有通过。

失败会生成结构化报告，并可以触发回滚或再次建模。每一份交付报告中的 `production_ready` 都保持为 `false`。

### 4. 本地优先，并且全过程可审阅

- 任务数据、中间状态、会话和模型产物可以保存在本地 `work/` 目录。
- 用户可以在任务运行过程中查看工具调用、假设、审批卡、特征历史、快照和报告。
- 模型层支持 OpenAI-compatible 端点，包括用户自行管理的端点。
- 适用于对数据敏感的机械、机器人和硬件团队。

本地存储不等于离线推理：发送到远程端点的提示词、附图和任务上下文受该服务商的数据政策约束。

## 3 分钟快速开始

### Windows 安装包

本次在 GitHub 核对到的 Windows 安装包是 **v0.22.1-beta**（约 180 MiB）。源码 [VERSION](VERSION) 为 `0.22.1-beta`，详见[项目状态](docs/PROJECT_STATUS.md)。

1. 打开 [v0.22.1-beta 发布页](https://github.com/vanyu0710/Varen-AI-CAD/releases/tag/v0.22.1-beta)，在 **Assets** 中下载 `VarenCAD-win64-0.22.1-beta.zip` 和配套 `.sha256` 文件，不要下载源码压缩包。运行 `Get-FileHash .\VarenCAD-win64-0.22.1-beta.zip -Algorithm SHA256`，将结果与校验文件比较。
2. 解压并运行 `VarenCAD.exe`。
3. 打开 **设置 → 模型**，配置一个 OpenAI 兼容端点。
4. 试运行：

   ```text
   做一块 120×120×12 mm 的法兰，中心 Ø30 通孔，Ø90 螺栓圆上均匀分布 6 个 Ø8 孔。报告所有假设，验证失败时拒绝导出。
   ```

### 从源码运行

```powershell
git clone https://github.com/vanyu0710/Varen-AI-CAD.git
git clone https://github.com/vanyu0710/mechcad-kernel.git
cd Varen-AI-CAD
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt build123d==0.11.1 cadquery-ocp-novtk==7.9.3.0
.\start-mechcad-pro.cmd
```

默认内核路径是与主仓库同级的 `mechcad-kernel`。如需覆盖，可设置 `MECHCAD_KERNEL_REPO` 或 `MECHCAD_KERNEL_PYTHON`。详见 [.env.example](.env.example) 和[入门指南](docs/GETTING_STARTED.md)。

## 工作流中实际可见的内容

- **调研：** `design_calculate` 将计算过程和假设记录在会话中。
- **提问：** `ask_user` 展示单选、多选或文本问题。
- **规划：** `propose_plan` 创建 BOM 和分组建模步骤；审批是硬门控。
- **建模：** 公开内核操作和受约束的 `run_build_script` 路径生成真实特征。
- **零件完成：** `finish_part` 在归档 STEP/STL 前执行单实体和特征契约检查。
- **编辑：** 特征树支持改参数、重放、删除、撤销和重做。
- **装配：** `export_assembly` 按 BOM 放置零件，创建装配 STEP，并报告零件对之间的干涉。
- **证据：** execution report 包含假设、已完成零件、失败门控、几何检查和待人工复核项目。

## 技术边界

Varen CAD 明确不声称提供：

- 完整的 2D 工程图和公差标注流程；
- 完整的钣金、标准螺纹或曲面建模流程；
- 通用装配配合、约束或运动求解器；
- 无人值守的制造批准；
- “模型说几何正确，所以几何就一定正确”的承诺。

产品当前仅支持 Windows，处于封闭 Beta。用于制造前必须经过人工工程复核。`production_ready` 始终为 `false`。

## Beta 与失败报告

我们正在招募机械、机器人和硬件设计伙伴：他们可以使用一个真实但已脱敏的任务，并在其他 CAD 软件中检查导出的 STEP。

- [申请封闭 Beta](https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=beta_application.yml)
- [报告任务失败](https://github.com/vanyu0710/Varen-AI-CAD/issues/new?template=task_failure.yml)
- [参与 Discussions](https://github.com/vanyu0710/Varen-AI-CAD/discussions)
- [阅读已知问题](KNOWN_ISSUES.md)

即使 Agent 在门控阶段停止，失败报告也有价值。它们会变成可复现的回归案例，而不会被包装成成功输出。

## 文档

- [系统架构](ARCHITECTURE.md)
- [功能支持矩阵](FEATURE_SUPPORT.md)
- [快速开始](docs/GETTING_STARTED.md)
- [用户指南](docs/USER_GUIDE.md)
- [已知问题与隐私说明](KNOWN_ISSUES.md)
- [封闭 Beta 规则](docs/beta.md)
- [开发与测试](DEVELOPMENT.md)
- [许可策略](docs/license-strategy.md)
- [更新日志](CHANGELOG.md)

## License

主仓库及其 MechKernel 集成遵循 AGPL-3.0-or-later。闭源分发和 OEM 集成可单独申请商业许可，详见 [docs/license-strategy.md](docs/license-strategy.md)。

> 语言切换：当前页面为中文，英文版见 [README.en.md](README.en.md)。
