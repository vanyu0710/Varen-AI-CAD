# 3 分钟快速开始

这份指南只解决一个问题：第一次打开仓库的人，能否在最短路径内跑出一个可验证的 CAD 结果。

## 路径 A：Windows Beta（推荐）

1. 打开 [Releases](https://github.com/vanyu0710/aicad/releases)，下载当前 Beta 的 Windows x64 zip 和同页 `.sha256` 文件。
2. 在 PowerShell 中校验：

   ```powershell
   Get-FileHash .\VarenCAD-win64-*.zip -Algorithm SHA256
   ```

   将输出的哈希值与 Release 附件中的内容比较。

3. 解压并运行 `VarenCAD.exe`。如果 Windows SmartScreen 提示未知发布者，这是因为当前安装包尚未代码签名；请确认下载来源和 SHA256 后再决定是否运行。
4. 在 **设置 → 模型** 配置一个 OpenAI-compatible endpoint。Beta 用户可以申请限额试用端点；否则使用自己的 API key。
5. 输入这条最小任务：

   ```text
   做一块 120×120×12 mm 法兰，中心 Ø30 通孔，6 个 Ø8 螺栓孔均布在 Ø90 圆上。
   输出假设、验证结果和未通过的门控；任何检查失败时不要导出为成功。
   ```

6. 在底部 **过程 / 设计评审 / 导出** 查看工具调用、验证结果和 STEP 文件。

## 路径 B：源码开发

### 前置条件

- Windows 10/11 x64；
- Python 3.12；
- Node.js 20+ 和 npm；
- 与 `aicad` 同级的 `mechcad-kernel` 仓库，或通过环境变量指定内核路径；
- 一个 OpenAI-compatible 或 Anthropic-compatible 模型端点。

### 安装

```powershell
git clone https://github.com/vanyu0710/aicad.git
cd aicad

py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

cd frontend
npm ci
cd ..
```

复制 `.env.example` 为 `.env`，按需设置 `MECHCAD_KERNEL_REPO`、模型 endpoint 和 API key。

### 启动

```powershell
.\start-mechcad-pro.cmd
```

开发模式需要两个进程：

```powershell
# 终端 1：后端
.\.venv\Scripts\python.exe -m backend.main

# 终端 2：前端
cd frontend
npm run dev
```

浏览器打开 `http://127.0.0.1:5173/`。

### 验证安装

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
cd frontend
npm test
npm run build
```

如果只想反馈一个任务，不必先完成源码安装：直接提交 [任务失败报告](https://github.com/vanyu0710/aicad/issues/new?template=task_failure.yml)，附上 prompt、版本、失败环节和脱敏后的诊断包。

## 重要边界

- 文件默认保存在本机；模型请求是否出网取决于你配置的 endpoint。
- 输出用于概念设计和快速原型，`production_ready` 恒为 false。
- 不要上传公司图纸、密钥或未脱敏的日志；安全问题请走 [Security Advisory](https://github.com/vanyu0710/aicad/security/advisories/new)。
