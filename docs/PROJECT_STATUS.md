# Project status

**更新时间：2026-09-24**

## 当前发行状态

- **当前发行包**：`v0.22.3-beta`，Windows x64，封闭 Beta；已构建并通过打包校验。
- **远端状态**：GitHub Release 提供 `v0.22.3-beta` zip 与 SHA256；beta 期仍不做投产承诺。
- **产品边界**：概念设计与快速原型；`production_ready` 恒为 false；所有输出在投产前必须经过工程师复核。

## 近期证据

- 前端测试：本地 `158` 项通过；
- 后端测试：本地 `502` 项通过；
- 内核测试：本地 `503` 项通过；
- 编译检查：`backend` 与 `cad_worker` 通过 `compileall`；
- CI：仓库包含前后端质量工作流，后续 PR 会自动运行测试与构建。

> 测试数量会随开发分支变化。对外发布 benchmark 时，请同时提供版本、命令和结果文件，不要只引用 README 中的数字。

## 下一次公开发布前必须完成

1. 将 `VERSION`、前端 `package.json`、Release notes、README 下载链接和落地页状态统一到同一个版本；
2. 在干净的 Windows 账户上验证安装、首次启动、模型配置和最小法兰任务；
3. 上传 zip 与 SHA256，并在 GitHub Release 中标注 beta/prerelease；
4. 更新 `KNOWN_ISSUES.md`，明确哪些是安装问题、哪些是模型/任务失败；
5. 用至少一个外部设计伙伴任务补充公开 benchmark，而不是只发布自造案例。

## 外部贡献优先级

当前最有价值的不是泛功能请求，而是：

- 可脱敏的真实机械任务；
- Agent 错误放行或过度拦截的复现；
- STEP 在 FreeCAD、build123d 或其他 CAD 工具中的下游检查；
- 对门控协议和 benchmark 评分的独立批评。

请通过 Issue 模板或 Discussions 提交，详见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
