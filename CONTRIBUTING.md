# 贡献指南 — Varen CAD

感谢参与！Varen CAD 是 **AGPL-3.0-or-later** 开源项目（见 [LICENSE](LICENSE)），
并采用双许可模式（社区 AGPL + 商业授权），因此贡献流程对许可有明确要求。

## 法律前提：DCO + 再许可授权

提交 PR 即视为你在每条 commit 的信息中加入 `Signed-off-by:` 行（Developer Certificate of Origin 1.1），
并授予项目维护者将你的贡献以当前或未来许可证（含商业许可）再分发的权利：

```
git commit -s -m "fix(agent): ..."
```

仅贡献你有权授予的代码；引用第三方代码请在 PR 中注明来源与许可证。

## 开始之前

- 先看 [Known Issues](KNOWN_ISSUES.md) 与 GitHub Discussions，避免重复劳动；
- 新特性（尤其是新增内核 op、改变门控语义的）请先开 Issue 讨论，再动手；
- 涉及 `backend/agent/`（门控/harness）的改动，必须附带能复现旧缺陷的回归测试——
  这个项目的核心资产是"失败不再被放行"，我们不接受会让某道门失效的"顺手重构"。

## 开发环境与验证

```powershell
# 后端：Python 3.12 venv（见 README「开发模式」）
.\.venv\Scripts\python.exe -m unittest discover -s tests
.\.venv\Scripts\python.exe -m compileall -q backend cad_worker

# 前端
cd frontend && npm test && npm run build
```

PR 检查清单：

- [ ] 全量测试通过（后端 + 内核仓 + 前端），新增行为有测试；
- [ ] 不新增硬编码版本号（版本唯一来源是仓库根 `VERSION` + `backend/version.py`）；
- [ ] UI 文案中文/英文双语走 `frontend/src/i18n.ts`；
- [ ] 提示词改动中英同步（`prompts/prompts.yaml` / `prompts_en.yaml`），且通过
      `tests/test_prompt_contract.py` 的结构锁定；
- [ ] commit 带 `Signed-off-by`。

## Bug 报告 / 失败任务

机械任务失败请优先用 "任务失败报告" Issue 模板——带上你的 prompt、模型、版本、
耗时、失败环节和一键诊断导出文件。失败样本会进入公开 benchmark，这是最有价值的贡献。

## 沟通

GitHub Discussions（问答/展示/RFC）> Issue（缺陷/任务）> 私聊（仅安全问题）。
