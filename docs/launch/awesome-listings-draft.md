# 目录/清单收录申请草稿（awesome-cad & agent-skills 生态）

## A. 提交给 earthtojake/text-to-cad（15,978★，CAD agent skills 聚合库）

> 先看该仓库 README 是否收录"独立工具/项目"还是只收 skills；若只收 skills，
> 变体方案：贡献一个 "Varen CAD: build audited parametric assemblies" skill 包装（其格式），在条目里链回我们的仓库。

```markdown
### Varen CAD
Local-first, auditable mechanical design agent: plans a BOM, models multi-part
assemblies on a real OCC kernel (build123d), and refuses delivery when
feature contracts or interference checks fail. AGPL, Windows beta, STEP output.
- Repo: https://github.com/vanyu0710/aicad
- Demo: 1:100 three-stage gearbox, 53 steps, 0 unexempted collisions, with
  reproducible run logs (benchmark/).
```

## B. 提交给 mlightcad/awesome-cad（119★，PR 制收录）

条目模板按其 CONTRIBUTION 惯例（一行描述 + 许可证 + 平台）：

```markdown
- [Varen CAD](https://github.com/vanyu0710/aicad) — AI agent that builds and
  *validates* parametric assemblies on OpenCascade (via build123d); local-first,
  feature-contract & interference gates reject bad output. Windows/desktop.
  `AGPL-3.0` `Python/React`
```

## C. 知乎/B 站简介位固定文案（配合收录，SEO 一致性）

> Varen CAD｜开源（AGPL）本地 AI 机械设计 Agent：一句话 → 调研 → BOM → 逐件建模 → 装配 STEP；孔数、实体、碰撞由程序复检，不过关不交付。github.com/vanyu0710/aicad

## 提交前检查

- [ ] 两仓库 README/贡献规则重读（是否要求特定格式/栏目位置/去重声明）
- [ ] 星数与演示数据以 benchmark/results 可复跑记录为准（禁用词过 positioning.md）
- [ ] 一次 PR 一件事；被拒不重投同格式，改按 maintainer 意见调整

## 发射位步骤（用户确认后执行，今天不提交）

```bash
# awesome-cad（mlightcad/awesome-cad）
gh repo fork mlightcad/awesome-cad --clone   # 或网页 Fork + git clone
cd awesome-cad && git checkout -b add-varen-cad
#   → 在 README.md 的 AI/generative 或合适分区插入 §B 条目
git commit -s -m "Add Varen CAD — auditable local-first CAD agent"
git push origin add-varen-cad
#   → 网页对 upstream 提 PR；标题同上；正文用本文件 §B + 一句"why it fits"

# earthtojake/text-to-cad（先查其收录形态：若仅收 skills 则走变体方案 §A note）
#   → 同流程，正文用 §A；若提 skill 包，附最小示例：
#     "Use Varen CAD MCP/API to build an audited parametric flange" （待我们暴露 MCP 后）
```

**注**：GitHub CLI 未装时可全部走网页（Fork → 在线编辑 → Propose changes → PR）。
PR 描述第一行必须含可点开的 demo 证据链：releases 下载 + benchmark/results 目录。
