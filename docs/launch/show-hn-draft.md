# Show HN 草稿（发布前提：可下载 + 创始人在线数小时）

> 发布前核对（来自发布检查）：
> - [ ] 用户点进链接能直接下载（GitHub Release 带二进制 + SHA256）
> - [ ] 不需要填表才能看到产品
> - [ ] 标题无营销形容词、全部可验证
> - [ ] 准备好回复：与 Zoo/Onshape 差异、AGPL 选择、门控实现细节、为什么本地优先
> - [ ] 发帖时段：UTC 13:00–15:00 工作日（美东早 9 点前后）

## 标题

Show HN: Varen CAD – a local-first agent that builds and checks parametric assemblies

## 正文（第一条评论由创始人发出，补充细节）

```
Hi HN, we're Varen — an open-source (AGPL) CAD agent for mechanical design that runs
locally on Windows. It's not a "text-to-mesh" toy: an LLM drives a real
OpenCascade-based parametric kernel through 34 audited ops, keeping feature history,
and exports STEP/STL you can open in any mainstream CAD.

The part we care most about is verification, not generation. LLMs will happily claim
success after undoing features that were on screen. So "done" is a program:

- Feature contracts: a part declares its holes ({through_hole, Ø30, ×6}); the kernel
  measures the actual B-rep (cylindrical faces by radius/count). Mismatch → the part
  is NOT archived (FEATURE_CONTRACT_MISMATCH).
- Single-body review: floating features are machine-rejected.
- Interference gate: full pairwise collision check before assembly export; mesh-zone
  overlaps need an explicit `category=mesh` exemption; any hard collision blocks
  export (INTERFERENCE_BLOCKED).
- Honesty: unsupported capabilities (threads, 2D drawings) are refused, never faked.
  `production_ready` is always false — every delivery ships an assumptions list.

One real run (DeepSeek flash, 53 steps, 12.6 min): "design a 1:100 three-stage
gearbox" → research calcs → clarifying questions → BOM plan (approved by harness
gate) → 8 parts modeled one by one → assembly STEP. First attempt was blocked by the
interference gate; the agent redid shaft/gear poses and passed. 0 unexempted
collisions.

What it's NOT: no 2D drawings, no constraint solver (poses come from engineering
calculations), no sheet metal. It's for concept design & rapid prototyping.

We're running a closed beta with ~30 design partners and publishing a reproducible
benchmark including failure samples. Demo video (unCut, one take, 10 min full run)
and everything else in the repo. Happy to answer — especially about where the gates
fail us so far.
```

## 常见质疑预案

| 质疑 | 回复要点 |
|---|---|
| "Zoo/Adam 也有验证" | 差异是硬门控拒归档（程序级）vs 视觉自校验；引 benchmark 负例数据说话 |
| "为什么 AGPL 不 MIT" | 双许可保社区+防云厂商白嫖托管；给商业许可路径说明 |
| "OCC 套壳？" | 是 build123d/OCC 之上自研参数特征层（feature_graph/重放/事务），内核仓测试公开可审 |
| "单人项目能活吗" | 如实回答 + 说明路线图纪律（垂直深扎不做功能列表） |
