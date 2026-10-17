## 变更说明

<!-- 做了什么、为什么。涉及门控/harness 语义的，说明改变了哪道门的判定 -->

## 验证

- [ ] 后端全量测试通过：`python -m unittest discover -s tests`
- [ ] 前端测试 + 构建通过：`npm test && npm run build`（如涉前端）
- [ ] 新增/修复行为有回归测试
- [ ] 无硬编码版本号（唯一来源 `VERSION` / `backend/version.py`）
- [ ] 提示词改动已中英同步并通过 prompt 契约测试
- [ ] commit 均带 `Signed-off-by`（DCO）

## 风险

<!-- 对现有任务通过率的影响；不确定的写"不确定 + 观察计划" -->
